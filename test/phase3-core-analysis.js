/**
 * Phase 3: Core DilutionHunter Analysis
 * 
 * This test performs a COMPLETE analysis as the app will run in production.
 * We're testing with a single ticker to validate we have all data points.
 * 
 * CORE METRICS WE NEED:
 * 1. 7-Day Gain % - Has it run parabolically?
 * 2. Volume Analysis - Is volume fading after the spike?
 * 3. Red Candle Detection - First bearish day after the run?
 * 4. Cash vs Debt Position - Do they NEED to raise capital?
 * 5. Offering Detection - Are they actively selling shares?
 * 
 * Expected API calls: ~4-5 per ticker
 */

import dotenv from 'dotenv';
dotenv.config();

import {
  getQuote,
  getOHLCV,
  getFinancials,
  getBalanceSheet,
  getApiCallCount
} from '../src/vendors/fmp.js';

import { FMP_CONFIG } from '../src/config.js';

// Use a small-cap that's more likely to show dilution patterns
// AAPL won't trigger our criteria, but we can validate data collection
const TEST_TICKER = 'AAPL';

async function runCoreAnalysis(symbol) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DILUTIONHUNTER - CORE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Ticker: ${symbol}`);
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Get Quote (current price, market cap)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📊 Fetching current quote...');
  const quote = await getQuote(symbol);
  
  if (!quote) {
    console.log('❌ Could not get quote data');
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Get 30-day OHLCV (for 7-day gain, volume analysis, red candle)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📈 Fetching 30-day price history...');
  const candles = await getOHLCV(symbol, 30);
  
  if (!candles || candles.length < 7) {
    console.log('❌ Insufficient price history');
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Get Balance Sheet (cash, debt, shares outstanding)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('💰 Fetching balance sheet...');
  const balanceSheet = await getBalanceSheet(symbol, 'quarter', 2);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CALCULATE CORE METRICS
  // ═══════════════════════════════════════════════════════════════════════════
  
  const analysis = calculateMetrics(symbol, quote, candles, balanceSheet);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DISPLAY RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  displayAnalysis(analysis);
  
  return analysis;
}

function calculateMetrics(symbol, quote, candles, balanceSheet) {
  const result = {
    symbol,
    timestamp: new Date().toISOString(),
    
    // Price Data
    currentPrice: quote.price,
    marketCap: quote.marketCap,
    
    // Core Metrics
    sevenDayGainPct: null,
    volumeFading: null,
    isRedCandle: null,
    cashPosition: null,
    debtPosition: null,
    cashToDebtRatio: null,
    sharesOutstanding: null,
    shareChangeQoQ: null,
    
    // Signal Assessment
    needsCapital: null,
    dilutionRisk: null,
    
    // Raw data for debugging
    _raw: { quote, candles, balanceSheet }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // METRIC 1: 7-Day Gain Percentage
  // ─────────────────────────────────────────────────────────────────────────────
  if (candles.length >= 7) {
    const latestClose = candles[candles.length - 1].close;
    const sevenDaysAgoClose = candles[candles.length - 7].close;
    result.sevenDayGainPct = ((latestClose - sevenDaysAgoClose) / sevenDaysAgoClose) * 100;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // METRIC 2: Volume Fading (compare last 3 days vs prior 3 days)
  // ─────────────────────────────────────────────────────────────────────────────
  if (candles.length >= 6) {
    const recent3 = candles.slice(-3);
    const prior3 = candles.slice(-6, -3);
    
    const recentAvgVol = recent3.reduce((sum, c) => sum + c.volume, 0) / 3;
    const priorAvgVol = prior3.reduce((sum, c) => sum + c.volume, 0) / 3;
    
    result.volumeFading = recentAvgVol < priorAvgVol;
    result._volumeDetails = {
      recent3DayAvg: recentAvgVol,
      prior3DayAvg: priorAvgVol,
      volumeChangePercent: ((recentAvgVol - priorAvgVol) / priorAvgVol) * 100
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // METRIC 3: Red Candle Detection (last candle closed lower than opened)
  // ─────────────────────────────────────────────────────────────────────────────
  const lastCandle = candles[candles.length - 1];
  result.isRedCandle = lastCandle.close < lastCandle.open;
  result._lastCandle = {
    date: lastCandle.date,
    open: lastCandle.open,
    close: lastCandle.close,
    change: ((lastCandle.close - lastCandle.open) / lastCandle.open * 100).toFixed(2) + '%'
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // METRIC 4 & 5: Cash & Debt Position
  // ─────────────────────────────────────────────────────────────────────────────
  if (balanceSheet && balanceSheet.length > 0) {
    const latest = balanceSheet[0];
    
    result.cashPosition = latest.cashAndCashEquivalents || latest.cashAndShortTermInvestments || 0;
    result.debtPosition = latest.totalDebt || latest.longTermDebt || 0;
    result.sharesOutstanding = latest.commonStock || latest.weightedAverageShsOut || 0;
    
    // Cash to Debt ratio (higher = healthier)
    if (result.debtPosition > 0) {
      result.cashToDebtRatio = result.cashPosition / result.debtPosition;
    } else {
      result.cashToDebtRatio = result.cashPosition > 0 ? Infinity : 0;
    }
    
    // Does company need to raise capital?
    result.needsCapital = result.cashPosition < result.debtPosition;
    
    // Quarter-over-quarter share change (dilution signal)
    if (balanceSheet.length > 1) {
      const prev = balanceSheet[1];
      const prevShares = prev.commonStock || prev.weightedAverageShsOut || 0;
      if (prevShares > 0) {
        result.shareChangeQoQ = ((result.sharesOutstanding - prevShares) / prevShares) * 100;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OVERALL DILUTION RISK ASSESSMENT
  // ─────────────────────────────────────────────────────────────────────────────
  // Score from 0-100 based on signals
  let riskScore = 0;
  const riskFactors = [];
  
  // Parabolic run? (+30 points if >100% gain, +20 if >50%)
  if (result.sevenDayGainPct > 100) {
    riskScore += 30;
    riskFactors.push('Extreme 7-day run (>100%)');
  } else if (result.sevenDayGainPct > 50) {
    riskScore += 20;
    riskFactors.push('Strong 7-day run (>50%)');
  }
  
  // Volume fading? (+20 points)
  if (result.volumeFading) {
    riskScore += 20;
    riskFactors.push('Volume fading');
  }
  
  // Red candle? (+15 points)
  if (result.isRedCandle) {
    riskScore += 15;
    riskFactors.push('Red candle (bearish reversal)');
  }
  
  // Needs capital? (+25 points)
  if (result.needsCapital) {
    riskScore += 25;
    riskFactors.push('Cash < Debt (needs capital)');
  }
  
  // Recent share dilution? (+10 points if >5% QoQ increase)
  if (result.shareChangeQoQ > 5) {
    riskScore += 10;
    riskFactors.push(`Recent dilution (${result.shareChangeQoQ.toFixed(1)}% share increase QoQ)`);
  }
  
  result.dilutionRisk = {
    score: riskScore,
    level: riskScore >= 60 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW',
    factors: riskFactors
  };

  return result;
}

function displayAnalysis(a) {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  ${a.symbol} - ANALYSIS RESULTS`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  // Basic Info
  console.log('\n📌 BASIC INFO');
  console.log('─'.repeat(60));
  console.log(`   Current Price:     $${a.currentPrice?.toFixed(2)}`);
  console.log(`   Market Cap:        $${(a.marketCap / 1e9)?.toFixed(2)}B`);
  
  // Core Metrics
  console.log('\n📊 CORE DILUTION METRICS');
  console.log('─'.repeat(60));
  
  // 7-Day Gain
  const gainIcon = a.sevenDayGainPct > 50 ? '🔥' : a.sevenDayGainPct > 20 ? '📈' : '➖';
  console.log(`   7-Day Gain:        ${gainIcon} ${a.sevenDayGainPct?.toFixed(2)}%`);
  
  // Volume Fading
  const volIcon = a.volumeFading ? '⚠️' : '✅';
  const volChange = a._volumeDetails?.volumeChangePercent?.toFixed(1);
  console.log(`   Volume Fading:     ${volIcon} ${a.volumeFading ? 'YES' : 'NO'} (${volChange}% change)`);
  
  // Red Candle
  const redIcon = a.isRedCandle ? '🔴' : '🟢';
  console.log(`   Red Candle Today:  ${redIcon} ${a.isRedCandle ? 'YES' : 'NO'} (${a._lastCandle?.change})`);
  
  // Financial Health
  console.log('\n💰 FINANCIAL HEALTH');
  console.log('─'.repeat(60));
  console.log(`   Cash Position:     $${(a.cashPosition / 1e9)?.toFixed(2)}B`);
  console.log(`   Debt Position:     $${(a.debtPosition / 1e9)?.toFixed(2)}B`);
  console.log(`   Cash/Debt Ratio:   ${a.cashToDebtRatio === Infinity ? '∞ (no debt)' : a.cashToDebtRatio?.toFixed(2)}`);
  console.log(`   Needs Capital:     ${a.needsCapital ? '⚠️ YES' : '✅ NO'}`);
  
  // Share Dilution
  console.log('\n📉 SHARE DILUTION');
  console.log('─'.repeat(60));
  console.log(`   Shares Outstanding: ${(a.sharesOutstanding / 1e6)?.toFixed(2)}M`);
  console.log(`   QoQ Share Change:   ${a.shareChangeQoQ?.toFixed(2)}%`);
  
  // Risk Assessment
  console.log('\n🎯 DILUTION RISK ASSESSMENT');
  console.log('─'.repeat(60));
  const riskEmoji = a.dilutionRisk.level === 'HIGH' ? '🚨' : a.dilutionRisk.level === 'MEDIUM' ? '⚠️' : '✅';
  console.log(`   Risk Level:        ${riskEmoji} ${a.dilutionRisk.level} (Score: ${a.dilutionRisk.score}/100)`);
  
  if (a.dilutionRisk.factors.length > 0) {
    console.log(`   Risk Factors:`);
    a.dilutionRisk.factors.forEach(f => console.log(`     • ${f}`));
  } else {
    console.log(`   Risk Factors:      None detected`);
  }
  
  // Would this trigger?
  console.log('\n═══════════════════════════════════════════════════════════════');
  if (a.dilutionRisk.score >= 60) {
    console.log('  🚨 SIGNAL: Would TRIGGER alert for this ticker');
  } else {
    console.log('  ✅ NO SIGNAL: Does not meet trigger criteria');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  
  // API Usage
  const calls = getApiCallCount();
  console.log(`\n📊 API Calls Used: ${calls}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    const analysis = await runCoreAnalysis(TEST_TICKER);
    
    if (analysis) {
      // Also output JSON for inspection
      console.log('\n\n📋 RAW JSON OUTPUT (for debugging):');
      console.log('─'.repeat(60));
      const { _raw, ...cleanAnalysis } = analysis;
      console.log(JSON.stringify(cleanAnalysis, null, 2));
    }
    
    console.log('\n✅ Phase 3 Core Analysis Complete\n');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
