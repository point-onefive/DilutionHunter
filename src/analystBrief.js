/**
 * DilutionHunter - Enhanced Analysis Engine
 * 
 * Produces hedge fund-style analyst briefs with deep risk context.
 * 
 * API Calls per ticker: ~8-10
 */

import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.FMP_API_KEY;
const BASE = 'https://financialmodelingprep.com';

// ═══════════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function fmpFetch(endpoint, params = {}) {
  const url = new URL(BASE + endpoint);
  url.searchParams.set('apikey', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  
  const res = await fetch(url);
  const text = await res.text();
  
  if (!text.startsWith('[') && !text.startsWith('{')) {
    return null; // Premium/unavailable
  }
  return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function analyzeSymbol(symbol, options = {}) {
  const silent = options.silent || false;
  
  if (!silent) {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log(`║  DILUTIONHUNTER ANALYST BRIEF: ${symbol.padEnd(36)}║`);
    console.log(`║  Generated: ${new Date().toISOString().split('T')[0].padEnd(43)}║`);
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
  }

  const data = {};
  const scores = {};
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. QUOTE DATA
  // ─────────────────────────────────────────────────────────────────────────────
  const quote = await fmpFetch('/stable/quote', { symbol });
  if (!quote?.[0]) {
    if (!silent) console.log('\n❌ Symbol not available on free tier or invalid.');
    return null;
  }
  data.quote = quote[0];
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 2. FLOAT DATA
  // ─────────────────────────────────────────────────────────────────────────────
  const float = await fmpFetch('/stable/shares-float', { symbol });
  data.float = float?.[0] || null;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 3. PRICE HISTORY (30 days)
  // ─────────────────────────────────────────────────────────────────────────────
  const ohlcv = await fmpFetch('/stable/historical-price-eod/full', { symbol });
  data.candles = ohlcv?.slice(0, 30).reverse() || []; // chronological
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 4. BALANCE SHEET
  // ─────────────────────────────────────────────────────────────────────────────
  const bs = await fmpFetch('/stable/balance-sheet-statement', { symbol, period: 'quarter', limit: 4 });
  data.balanceSheet = bs || [];
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 5. CASH FLOW
  // ─────────────────────────────────────────────────────────────────────────────
  const cf = await fmpFetch('/stable/cash-flow-statement', { symbol, period: 'quarter', limit: 4 });
  data.cashFlow = cf || [];
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 6. INSIDER TRADING
  // ─────────────────────────────────────────────────────────────────────────────
  const insider = await fmpFetch('/stable/insider-trading/search', { symbol, limit: 20 });
  data.insiderTrades = insider || [];
  
  // ─────────────────────────────────────────────────────────────────────────────
  // 7. OFFERINGS
  // ─────────────────────────────────────────────────────────────────────────────
  const companyName = data.quote.name?.split(' ')[0] || symbol;
  const offerings = await fmpFetch('/stable/fundraising-search', { name: companyName });
  data.offerings = offerings || [];
  
  // Get details if offerings found
  if (data.offerings.length > 0) {
    const relevantOfferings = data.offerings.filter(o => 
      o.name?.toLowerCase().includes(companyName.toLowerCase()) ||
      o.name?.toLowerCase().includes(symbol.toLowerCase())
    );
    if (relevantOfferings[0]?.cik) {
      const details = await fmpFetch('/stable/fundraising', { cik: relevantOfferings[0].cik });
      data.offeringDetails = details || [];
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPUTE METRICS & SCORES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const metrics = computeMetrics(data);
  const analysis = computeScores(metrics, data);
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // OUTPUT REPORT
  // ═══════════════════════════════════════════════════════════════════════════════
  
  if (!silent) {
    printReport(symbol, data, metrics, analysis);
  }
  
  // Return structured data for programmatic use
  return { 
    symbol,
    score: Math.round(analysis.totalScore * 100),
    triggered: analysis.totalScore >= 0.65,
    quote: {
      price: data.quote.price,
      marketCap: data.quote.marketCap,
      fiftyTwoWeekHigh: data.quote.yearHigh,
      fiftyTwoWeekLow: data.quote.yearLow,
    },
    priceAction: {
      threeDayReturn: metrics.gain3d,
      sevenDayReturn: metrics.gain7d,
      thirtyDayReturn: metrics.gain30d,
      atrPercent: metrics.atrPercent,
      isRedCandle: metrics.isRedCandle,
    },
    float: {
      floatShares: data.float?.floatShares,
      floatRatio: metrics.floatRatio,
    },
    financials: {
      cash: metrics.cash,
      debt: metrics.totalDebt,
      cashDebtRatio: metrics.cashDebtRatio,
    },
    cashFlow: {
      quarterlyBurn: metrics.quarterlyBurn,
      monthlyBurn: metrics.monthlyBurn,
      runwayMonths: metrics.runwayMonths,
      isPositive: metrics.isCashFlowPositive,
    },
    offerings: {
      latestDate: metrics.latestOfferingDate,
      totalSize: metrics.offeringSize,
      amountSold: metrics.offeringsSold,
      remainingCapacity: metrics.offeringsRemaining,
      marketCapRatio: metrics.offeringToMktCapRatio,
      hasActiveATM: metrics.hasActiveATM,
      isSerialDiluter: metrics.isSerialDiluter,
    },
    insiders: {
      netFlow: metrics.netInsiderFlow,
      sellCount: metrics.insiderSellCount,
    },
    scores: analysis.components,
    data, 
    metrics, 
    analysis 
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE ALL METRICS
// ═══════════════════════════════════════════════════════════════════════════════

function computeMetrics(data) {
  const m = {};
  const candles = data.candles;
  const q = data.quote;
  
  // ── PRICE ACTION ──────────────────────────────────────────────────────────────
  if (candles.length >= 7) {
    const latest = candles[candles.length - 1];
    const d3 = candles[candles.length - 3] || candles[0];
    const d7 = candles[candles.length - 7] || candles[0];
    const d30 = candles[0];
    
    m.currentPrice = latest.close;
    m.gain3d = ((latest.close - d3.close) / d3.close) * 100;
    m.gain7d = ((latest.close - d7.close) / d7.close) * 100;
    m.gain30d = ((latest.close - d30.close) / d30.close) * 100;
    
    // Red candle check
    m.isRedCandle = latest.close < latest.open;
    m.candleChange = ((latest.close - latest.open) / latest.open) * 100;
    
    // ATR (Average True Range) - volatility measure
    const trs = candles.slice(-14).map((c, i, arr) => {
      if (i === 0) return c.high - c.low;
      const prev = arr[i-1];
      return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    });
    m.atr14 = trs.reduce((s, v) => s + v, 0) / trs.length;
    m.atrPercent = (m.atr14 / latest.close) * 100;
    
    // Gap detection (overnight move)
    const prevCandle = candles[candles.length - 2];
    if (prevCandle) {
      m.gapPercent = ((latest.open - prevCandle.close) / prevCandle.close) * 100;
      m.hasGapUp = m.gapPercent > 3;
      m.hasGapDown = m.gapPercent < -3;
    }
    
    // % off highs
    const high30d = Math.max(...candles.map(c => c.high));
    m.high30d = high30d;
    m.offHighPercent = ((latest.close - high30d) / high30d) * 100;
  }
  
  // ── VOLUME STRUCTURE ──────────────────────────────────────────────────────────
  if (candles.length >= 10) {
    const volumes = candles.map(c => c.volume);
    m.avgVolume30d = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    m.latestVolume = candles[candles.length - 1].volume;
    m.volumeVsAvg = m.latestVolume / m.avgVolume30d;
    
    // Peak volume in last 7 days
    const recent7Vols = volumes.slice(-7);
    m.peakVolume7d = Math.max(...recent7Vols);
    m.peakVolumeVsAvg = m.peakVolume7d / m.avgVolume30d;
    
    // Volume fade (recent 3 vs prior 3)
    const recent3Vol = volumes.slice(-3).reduce((s, v) => s + v, 0) / 3;
    const prior3Vol = volumes.slice(-6, -3).reduce((s, v) => s + v, 0) / 3;
    m.volumeFadeRatio = recent3Vol / prior3Vol;
    m.isVolumeFading = m.volumeFadeRatio < 0.7;
    
    // Blow-off detection (any day 3x+ avg volume)
    m.hadBlowOffVolume = recent7Vols.some(v => v > m.avgVolume30d * 3);
  }
  
  // ── FLOAT ANALYSIS ────────────────────────────────────────────────────────────
  if (data.float) {
    m.floatShares = data.float.floatShares;
    m.sharesOutstanding = data.float.outstandingShares;
    m.floatRatio = m.floatShares / m.sharesOutstanding;
    m.isLowFloat = m.floatRatio < 0.4;
    m.isFragileFloat = m.floatRatio < 0.2;
  }
  
  // ── FINANCIAL HEALTH ──────────────────────────────────────────────────────────
  if (data.balanceSheet[0]) {
    const bs = data.balanceSheet[0];
    m.cash = bs.cashAndCashEquivalents || 0;
    m.totalDebt = bs.totalDebt || 0;
    m.cashToDebtRatio = m.totalDebt > 0 ? m.cash / m.totalDebt : Infinity;
    m.isDistressed = m.cash < m.totalDebt;
    
    // QoQ share change
    if (data.balanceSheet[1]) {
      const prevShares = data.balanceSheet[1].commonStock || data.balanceSheet[1].totalStockholdersEquity;
      const currShares = bs.commonStock || bs.totalStockholdersEquity;
      if (prevShares && currShares) {
        m.shareChangeQoQ = ((currShares - prevShares) / prevShares) * 100;
      }
    }
  }
  
  // ── CASH RUNWAY ───────────────────────────────────────────────────────────────
  if (data.cashFlow[0] && m.cash !== undefined) {
    const cf = data.cashFlow[0];
    m.operatingCF = cf.operatingCashFlow || 0;
    m.freeCashFlow = cf.freeCashFlow || 0;
    m.isBurningCash = m.operatingCF < 0;
    
    if (m.isBurningCash && m.cash > 0) {
      m.quarterlyBurn = Math.abs(m.operatingCF);
      m.monthlyBurn = m.quarterlyBurn / 3;
      m.runwayMonths = m.cash / m.monthlyBurn;
      m.runwayQuarters = m.runwayMonths / 3;
    }
    
    // Avg burn over last 4 quarters for stability
    if (data.cashFlow.length >= 4) {
      const burns = data.cashFlow.filter(c => c.operatingCashFlow < 0).map(c => Math.abs(c.operatingCashFlow));
      if (burns.length > 0) {
        m.avgQuarterlyBurn = burns.reduce((s, v) => s + v, 0) / burns.length;
        m.runwayMonthsAvg = m.cash / (m.avgQuarterlyBurn / 3);
      }
    }
  }
  
  // ── INSIDER ACTIVITY ──────────────────────────────────────────────────────────
  if (data.insiderTrades.length > 0) {
    const recent90 = data.insiderTrades.filter(t => {
      const d = new Date(t.transactionDate);
      const now = new Date();
      return (now - d) / (1000*60*60*24) <= 90;
    });
    
    m.insiderTrades90d = recent90.length;
    m.insiderSells90d = recent90.filter(t => t.acquistionOrDisposition === 'D').length;
    m.insiderBuys90d = recent90.filter(t => t.acquistionOrDisposition === 'A').length;
    m.netInsiderSentiment = m.insiderBuys90d - m.insiderSells90d;
  }
  
  // ── OFFERING ANALYSIS ─────────────────────────────────────────────────────────
  m.marketCap = q.marketCap;
  
  if (data.offeringDetails?.length > 0) {
    // Sort by date descending
    const sorted = data.offeringDetails.sort((a, b) => new Date(b.date) - new Date(a.date));
    const latest = sorted[0];
    
    m.latestOffering = {
      date: latest.filingDate,
      totalAmount: latest.totalOfferingAmount,
      amountSold: latest.totalAmountSold,
      amountRemaining: latest.totalAmountRemaining,
      isEquity: latest.securitiesOfferedAreOfEquityType
    };
    
    // Offering impact
    if (m.marketCap > 0) {
      m.offeringImpactRatio = latest.totalAmountRemaining / m.marketCap;
      m.totalOfferingVsMktCap = latest.totalOfferingAmount / m.marketCap;
    }
    
    // Serial diluter check (offerings in last 3 years)
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    m.offeringsLast3Years = sorted.filter(o => new Date(o.date) > threeYearsAgo).length;
    m.isSerialDiluter = m.offeringsLast3Years >= 3;
    
    // Active ATM check (recent + remaining > 0)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    m.hasActiveATM = sorted.some(o => 
      new Date(o.date) > sixMonthsAgo && 
      o.totalAmountRemaining > 0
    );
  }
  
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE RISK SCORES
// ═══════════════════════════════════════════════════════════════════════════════

function computeScores(m, data) {
  const scores = {
    momentum: 0,        // 0-1 scale
    blowoffStrength: 0,
    reversalSignal: 0,
    financialStress: 0,
    runwayUrgency: 0,
    dilutionImpact: 0,
    floatFragility: 0,
    insiderFlight: 0
  };
  
  // ── MOMENTUM (30% weight) ─────────────────────────────────────────────────────
  if (m.gain7d !== undefined) {
    if (m.gain7d >= 200) scores.momentum = 1.0;
    else if (m.gain7d >= 150) scores.momentum = 0.8;
    else if (m.gain7d >= 100) scores.momentum = 0.6;
    else if (m.gain7d >= 50) scores.momentum = 0.3;
    else scores.momentum = 0;
  }
  
  // ── BLOWOFF STRENGTH (10% weight) ─────────────────────────────────────────────
  if (m.peakVolumeVsAvg !== undefined) {
    if (m.peakVolumeVsAvg >= 5) scores.blowoffStrength = 1.0;
    else if (m.peakVolumeVsAvg >= 3) scores.blowoffStrength = 0.7;
    else if (m.peakVolumeVsAvg >= 2) scores.blowoffStrength = 0.4;
    else scores.blowoffStrength = 0;
  }
  
  // ── REVERSAL SIGNAL (15% weight) ──────────────────────────────────────────────
  if (m.isRedCandle && m.isVolumeFading) scores.reversalSignal = 1.0;
  else if (m.isRedCandle || m.isVolumeFading) scores.reversalSignal = 0.5;
  else scores.reversalSignal = 0;
  
  // ── FINANCIAL STRESS (15% weight) ─────────────────────────────────────────────
  if (m.cashToDebtRatio !== undefined) {
    if (m.cashToDebtRatio < 0.25) scores.financialStress = 1.0;
    else if (m.cashToDebtRatio < 0.5) scores.financialStress = 0.7;
    else if (m.cashToDebtRatio < 1.0) scores.financialStress = 0.4;
    else scores.financialStress = 0;
  }
  
  // ── RUNWAY URGENCY (15% weight) ───────────────────────────────────────────────
  if (m.runwayMonths !== undefined) {
    if (m.runwayMonths <= 2) scores.runwayUrgency = 1.0;
    else if (m.runwayMonths <= 4) scores.runwayUrgency = 0.8;
    else if (m.runwayMonths <= 6) scores.runwayUrgency = 0.5;
    else if (m.runwayMonths <= 12) scores.runwayUrgency = 0.2;
    else scores.runwayUrgency = 0;
  }
  
  // ── DILUTION IMPACT (10% weight) ──────────────────────────────────────────────
  if (m.offeringImpactRatio !== undefined) {
    if (m.offeringImpactRatio >= 0.5) scores.dilutionImpact = 1.0;
    else if (m.offeringImpactRatio >= 0.25) scores.dilutionImpact = 0.7;
    else if (m.offeringImpactRatio >= 0.10) scores.dilutionImpact = 0.4;
    else scores.dilutionImpact = 0;
  }
  
  // Active ATM bonus
  if (m.hasActiveATM) scores.dilutionImpact = Math.min(1, scores.dilutionImpact + 0.3);
  
  // ── FLOAT FRAGILITY (5% weight) ───────────────────────────────────────────────
  if (m.floatRatio !== undefined) {
    if (m.floatRatio < 0.2) scores.floatFragility = 1.0;
    else if (m.floatRatio < 0.4) scores.floatFragility = 0.6;
    else scores.floatFragility = 0;
  }
  
  // ── INSIDER FLIGHT RISK ───────────────────────────────────────────────────────
  if (m.netInsiderSentiment !== undefined) {
    if (m.netInsiderSentiment <= -5) scores.insiderFlight = 1.0;
    else if (m.netInsiderSentiment <= -2) scores.insiderFlight = 0.6;
    else if (m.netInsiderSentiment < 0) scores.insiderFlight = 0.3;
    else scores.insiderFlight = 0;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // WEIGHTED FINAL SCORE
  // ═══════════════════════════════════════════════════════════════════════════════
  
  const weights = {
    momentum: 0.25,
    blowoffStrength: 0.10,
    reversalSignal: 0.15,
    financialStress: 0.15,
    runwayUrgency: 0.15,
    dilutionImpact: 0.10,
    floatFragility: 0.05,
    insiderFlight: 0.05
  };
  
  let finalScore = 0;
  for (const [key, weight] of Object.entries(weights)) {
    finalScore += scores[key] * weight;
  }
  
  // Determine verdict
  let verdict = 'NO SIGNAL';
  let emoji = '✅';
  
  if (finalScore >= 0.65 && m.gain7d >= 100 && (m.offeringImpactRatio > 0.1 || m.runwayMonths < 6)) {
    verdict = 'HIGH CONVICTION SHORT';
    emoji = '🚨';
  } else if (finalScore >= 0.50 && m.gain7d >= 50) {
    verdict = 'WATCHLIST - DEVELOPING';
    emoji = '⚠️';
  } else if (finalScore >= 0.35) {
    verdict = 'LOW RISK - MONITOR';
    emoji = '👀';
  }
  
  return {
    components: scores,
    weights,
    totalScore: finalScore,
    verdict,
    emoji
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRINT ANALYST BRIEF
// ═══════════════════════════════════════════════════════════════════════════════

function printReport(symbol, data, m, analysis) {
  const q = data.quote;
  
  // ── HEADER ────────────────────────────────────────────────────────────────────
  console.log('\n┌─────────────────────────────────────────────────────────────────┐');
  console.log(`│  ${analysis.emoji} VERDICT: ${analysis.verdict.padEnd(47)}│`);
  console.log(`│  RISK SCORE: ${(analysis.finalScore * 100).toFixed(0)}% ${getRiskBar(analysis.finalScore).padEnd(44)}│`);
  console.log('└─────────────────────────────────────────────────────────────────┘');
  
  // ── SNAPSHOT ──────────────────────────────────────────────────────────────────
  console.log('\n📋 SNAPSHOT');
  console.log('─'.repeat(65));
  console.log(`  Price:        $${m.currentPrice?.toFixed(2) || 'N/A'}    Market Cap: $${(m.marketCap/1e6).toFixed(1)}M`);
  console.log(`  52W Range:    $${q.yearLow} — $${q.yearHigh}`);
  console.log(`  Off Highs:    ${m.offHighPercent?.toFixed(1)}%    Float: ${m.floatRatio ? (m.floatRatio*100).toFixed(0)+'%' : 'N/A'}`);
  
  // ── PRICE ACTION ──────────────────────────────────────────────────────────────
  console.log('\n📈 PRICE ACTION');
  console.log('─'.repeat(65));
  console.log(`  3-Day:  ${formatPercent(m.gain3d)}    7-Day: ${formatPercent(m.gain7d)}    30-Day: ${formatPercent(m.gain30d)}`);
  console.log(`  ATR%:   ${m.atrPercent?.toFixed(1)}% (volatility)    Gap Today: ${formatPercent(m.gapPercent)}`);
  console.log(`  Today:  ${m.isRedCandle ? '🔴 RED CANDLE' : '🟢 GREEN'} (${formatPercent(m.candleChange)})`);
  
  // ── VOLUME STRUCTURE ──────────────────────────────────────────────────────────
  console.log('\n📊 VOLUME STRUCTURE');
  console.log('─'.repeat(65));
  console.log(`  Today vs Avg:     ${m.volumeVsAvg?.toFixed(2)}x`);
  console.log(`  Peak 7d vs Avg:   ${m.peakVolumeVsAvg?.toFixed(2)}x ${m.hadBlowOffVolume ? '🔥 BLOWOFF DETECTED' : ''}`);
  console.log(`  Volume Fade:      ${m.volumeFadeRatio?.toFixed(2)}x ${m.isVolumeFading ? '⚠️ BUYERS LEAVING' : '✅ Stable'}`);
  
  // ── FLOAT ANALYSIS ────────────────────────────────────────────────────────────
  console.log('\n📉 FLOAT ANALYSIS');
  console.log('─'.repeat(65));
  if (m.floatShares) {
    console.log(`  Float:          ${(m.floatShares/1e6).toFixed(1)}M / ${(m.sharesOutstanding/1e6).toFixed(1)}M outstanding`);
    console.log(`  Float Ratio:    ${(m.floatRatio*100).toFixed(0)}% ${m.isFragileFloat ? '🚨 EXTREMELY FRAGILE' : m.isLowFloat ? '⚠️ Low float' : '✅ Normal'}`);
  } else {
    console.log('  Float data unavailable');
  }
  
  // ── FINANCIAL HEALTH ──────────────────────────────────────────────────────────
  console.log('\n🏦 FINANCIAL HEALTH');
  console.log('─'.repeat(65));
  console.log(`  Cash:           $${(m.cash/1e6).toFixed(1)}M`);
  console.log(`  Total Debt:     $${(m.totalDebt/1e6).toFixed(1)}M`);
  console.log(`  Cash/Debt:      ${m.cashToDebtRatio === Infinity ? '∞ (no debt)' : m.cashToDebtRatio?.toFixed(2)} ${m.isDistressed ? '🚨 DISTRESSED' : '✅'}`);
  
  if (m.isBurningCash) {
    console.log(`\n  💸 BURN RATE:`);
    console.log(`  Quarterly Burn: $${(m.quarterlyBurn/1e6).toFixed(1)}M`);
    console.log(`  Monthly Burn:   $${(m.monthlyBurn/1e6).toFixed(1)}M`);
    console.log(`  ⏱️  RUNWAY:      ${m.runwayMonths?.toFixed(1)} months (${m.runwayQuarters?.toFixed(1)} quarters)`);
    if (m.runwayMonths <= 6) {
      console.log(`  🚨 RUNWAY CRITICAL - DILUTION IMMINENT`);
    }
  } else {
    console.log(`  ✅ Cash flow positive - no immediate funding need`);
  }
  
  // ── INSIDER ACTIVITY ──────────────────────────────────────────────────────────
  console.log('\n👔 INSIDER ACTIVITY (90 days)');
  console.log('─'.repeat(65));
  if (m.insiderTrades90d > 0) {
    console.log(`  Total Trades:   ${m.insiderTrades90d}`);
    console.log(`  Buys:           ${m.insiderBuys90d}    Sells: ${m.insiderSells90d}`);
    console.log(`  Net Sentiment:  ${m.netInsiderSentiment > 0 ? '🟢' : m.netInsiderSentiment < 0 ? '🔴' : '⚪'} ${m.netInsiderSentiment}`);
  } else {
    console.log('  No insider trades in last 90 days');
  }
  
  // ── OFFERING ANALYSIS ─────────────────────────────────────────────────────────
  console.log('\n💥 OFFERING / DILUTION RISK');
  console.log('─'.repeat(65));
  if (m.latestOffering) {
    console.log(`  Latest Filing:  ${m.latestOffering.date}`);
    console.log(`  Total Size:     $${(m.latestOffering.totalAmount/1e6).toFixed(1)}M (${(m.totalOfferingVsMktCap*100).toFixed(1)}% of mkt cap)`);
    console.log(`  Already Sold:   $${(m.latestOffering.amountSold/1e6).toFixed(1)}M`);
    console.log(`  REMAINING:      $${(m.latestOffering.amountRemaining/1e6).toFixed(1)}M ${m.offeringImpactRatio > 0.1 ? '🚨 SIGNIFICANT' : ''}`);
    console.log(`  Impact Ratio:   ${(m.offeringImpactRatio*100).toFixed(1)}% of market cap`);
    console.log(`  Active ATM:     ${m.hasActiveATM ? '🔴 YES - LIVE DILUTION' : '⚪ No'}`);
    console.log(`  Serial Diluter: ${m.isSerialDiluter ? '🔴 YES (' + m.offeringsLast3Years + ' offerings in 3yr)' : '⚪ No'}`);
  } else {
    console.log('  No recent offering data found');
  }
  
  // ── SCORE BREAKDOWN ───────────────────────────────────────────────────────────
  console.log('\n📊 RISK SCORE BREAKDOWN');
  console.log('─'.repeat(65));
  for (const [key, score] of Object.entries(analysis.components)) {
    const weight = analysis.weights[key];
    const contribution = (score * weight * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(score * 10)) + '░'.repeat(10 - Math.round(score * 10));
    console.log(`  ${key.padEnd(18)} ${bar} ${(score*100).toFixed(0).padStart(3)}% (${contribution}% contrib)`);
  }
  console.log('─'.repeat(65));
  console.log(`  TOTAL SCORE:       ${(analysis.totalScore*100).toFixed(0)}% ${analysis.totalScore >= 0.65 ? '🚨 TRIGGER' : analysis.totalScore >= 0.50 ? '⚠️ WATCH' : '✅ PASS'}`);
  
  // ── THESIS ────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(65));
  console.log('📝 ANALYST THESIS');
  console.log('═'.repeat(65));
  
  // Why it might implode
  console.log('\n🔥 WHY IT MIGHT IMPLODE:');
  const bearCase = [];
  if (m.gain7d > 50) bearCase.push(`  • ${m.gain7d.toFixed(0)}% run in 7 days — parabolic moves revert`);
  if (m.runwayMonths && m.runwayMonths < 12) bearCase.push(`  • Only ${m.runwayMonths.toFixed(0)} months runway — funding needed soon`);
  if (m.offeringImpactRatio > 0.05) bearCase.push(`  • ${(m.offeringImpactRatio*100).toFixed(0)}% of mkt cap in pending dilution`);
  if (m.hasActiveATM) bearCase.push(`  • Active ATM = shares being sold into every rally`);
  if (m.isSerialDiluter) bearCase.push(`  • Serial diluter — ${m.offeringsLast3Years} offerings in 3 years`);
  if (m.isLowFloat) bearCase.push(`  • Low float (${(m.floatRatio*100).toFixed(0)}%) — dilution hits harder`);
  if (m.netInsiderSentiment < -2) bearCase.push(`  • Insiders net selling (${m.netInsiderSentiment} trades)`);
  if (bearCase.length === 0) bearCase.push('  • No major red flags detected');
  console.log(bearCase.join('\n'));
  
  // Why it might not
  console.log('\n🧊 WHY IT MIGHT NOT:');
  const bullCase = [];
  if (m.gain7d < 50) bullCase.push(`  • No parabolic run — only ${m.gain7d?.toFixed(0)}% in 7 days`);
  if (!m.isBurningCash) bullCase.push(`  • Cash flow positive — no urgent funding need`);
  if (m.runwayMonths > 12) bullCase.push(`  • ${m.runwayMonths.toFixed(0)} months runway — time to execute`);
  if (m.cashToDebtRatio > 1) bullCase.push(`  • More cash than debt — balance sheet solid`);
  if (!m.hasActiveATM) bullCase.push(`  • No active ATM dripping shares`);
  if (m.floatRatio > 0.5) bullCase.push(`  • High float (${(m.floatRatio*100).toFixed(0)}%) — dilution absorbed easier`);
  if (bullCase.length === 0) bullCase.push('  • Limited defensive factors');
  console.log(bullCase.join('\n'));
  
  // What must happen
  console.log('\n🧭 WHAT MUST HAPPEN TO VALIDATE:');
  if (analysis.finalScore >= 0.50) {
    console.log('  • Watch for FIRST RED DAY with volume fade');
    console.log('  • Monitor for ATM/shelf filing announcement');
    console.log('  • Track insider Form 4 filings');
    if (m.runwayMonths < 6) console.log('  • Financing announcement likely within 30-60 days');
  } else {
    console.log('  • Need 100%+ weekly run to become actionable');
    console.log('  • Watch for offering announcement to activate thesis');
    console.log('  • Currently not a setup — revisit on momentum spike');
  }
  
  // Timer
  console.log('\n🕒 TIMING:');
  if (m.isRedCandle && m.isVolumeFading) {
    console.log('  ⚡ REVERSAL IN PROGRESS — Monitor for continuation');
  } else if (m.gain7d > 100) {
    console.log('  ⏰ Watch next 1-3 days for first red candle');
  } else {
    console.log('  📅 No immediate catalyst — add to watchlist');
  }
  
  console.log('\n' + '═'.repeat(65));
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function formatPercent(val) {
  if (val === undefined || val === null) return 'N/A';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

function getRiskBar(score) {
  const filled = Math.round(score * 20);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

// Export alias for batch scanning
export const runAnalystBrief = analyzeSymbol;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

// Only run if called directly (not imported)
const isMainModule = process.argv[1]?.includes('analystBrief');
if (isMainModule) {
  const symbol = process.argv[2] || 'RIOT';
  analyzeSymbol(symbol).catch(console.error);
}
