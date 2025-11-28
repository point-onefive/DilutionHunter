/**
 * ATM SCANNER - At-The-Market First Approach
 * 
 * Philosophy: Start from the ATM filing, find which ones are pumping.
 * ATM is the rare signal. Pumps are common.
 * 
 * Data Sources:
 *   - SEC EDGAR (FREE): 424B5 filings (prospectus supplements = ATM sales)
 *   - SEC EDGAR (FREE): S-3 filings (shelf registrations)
 *   - FMP (Paid): Price data, financials, momentum
 * 
 * Usage:
 *   node src/atmScanner.js                    # Last 30 days of ATM filings
 *   node src/atmScanner.js --days=7           # Last 7 days
 *   node src/atmScanner.js --days=90          # Last 90 days
 *   node src/atmScanner.js --analyze          # Full analysis on matches
 */

import 'dotenv/config';
import { analyzeSymbol } from './analystBrief.js';

const SEC_USER_AGENT = 'DilutionHunter/1.0 (dilutionhunter@proton.me)';
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';

// ═══════════════════════════════════════════════════════════════════════════════
// SEC EDGAR FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function searchSECFilings(query, forms, startDate, endDate, limit = 100) {
  const url = new URL('https://efts.sec.gov/LATEST/search-index');
  url.searchParams.set('q', query);
  url.searchParams.set('dateRange', 'custom');
  url.searchParams.set('startdt', startDate);
  url.searchParams.set('enddt', endDate);
  url.searchParams.set('forms', forms);
  url.searchParams.set('size', limit.toString());

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': SEC_USER_AGENT }
  });

  if (!res.ok) throw new Error(`SEC API error: ${res.status}`);
  const data = await res.json();
  return data.hits?.hits || [];
}

function extractTicker(displayName) {
  // Extract ticker from "Company Name  (TICK, TICK2)  (CIK ...)"
  const match = displayName?.match(/\(([A-Z]{1,5})/);
  return match ? match[1] : null;
}

export async function getRecentATMFilings(days = 30) {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`\n📡 Searching SEC EDGAR for ATM filings (${startDate} to ${endDate})...\n`);

  // 424B5 = Prospectus Supplement (used when selling from ATM)
  const filings = await searchSECFilings(
    '"at-the-market" OR "ATM offering" OR "equity distribution agreement"',
    '424B5',
    startDate,
    endDate,
    200
  );

  // Deduplicate by ticker and get most recent filing
  const tickerMap = new Map();
  
  for (const filing of filings) {
    const source = filing._source;
    const ticker = extractTicker(source.display_names?.[0]);
    if (!ticker) continue;

    const existing = tickerMap.get(ticker);
    if (!existing || source.file_date > existing.fileDate) {
      tickerMap.set(ticker, {
        ticker,
        companyName: source.display_names?.[0]?.split('  (')[0] || ticker,
        fileDate: source.file_date,
        form: source.form,
        cik: source.ciks?.[0],
        filingId: source.adsh
      });
    }
  }

  return Array.from(tickerMap.values()).sort((a, b) => 
    b.fileDate.localeCompare(a.fileDate)
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FMP FUNCTIONS  
// ═══════════════════════════════════════════════════════════════════════════════

async function getQuote(symbol) {
  const url = `${FMP_BASE}/quote?symbol=${symbol}&apikey=${FMP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

async function getDailyCandles(symbol, days = 7) {
  // Fetch daily OHLC data for peak analysis
  // Request extra days to account for weekends/holidays
  const url = `${FMP_BASE}/historical-price-eod/full?symbol=${symbol}&apikey=${FMP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  
  // FMP returns array directly (newest first), we need oldest first for our window
  if (!Array.isArray(data) || data.length < 2) return null;
  
  const candles = data.slice(0, days + 5).reverse();
  
  // Take last N trading days
  const window = candles.slice(-days);
  if (window.length < 2) return null;
  
  const startPrice = window[0].open;
  const currentPrice = window[window.length - 1].close;
  
  // Find the highest high in the window (intraday peak)
  const peakHigh = Math.max(...window.map(c => c.high));
  
  // Calculate metrics
  const peakGain = ((peakHigh - startPrice) / startPrice) * 100;
  const currentGain = ((currentPrice - startPrice) / startPrice) * 100;
  const pullback = peakGain - currentGain;
  
  // Find which day had the peak
  const peakDayIdx = window.findIndex(c => c.high === peakHigh);
  const peakDay = peakDayIdx + 1;
  
  // Detect SAME-DAY spike+crash scenario
  // If peak candle has both the high AND a big red body (close much lower than open)
  const peakCandle = window[peakDayIdx];
  const peakIntraday = ((peakCandle.high - peakCandle.open) / peakCandle.open) * 100;
  const peakCandleBody = ((peakCandle.close - peakCandle.open) / peakCandle.open) * 100;
  
  // Same-day if: spike happened intraday (+50%+ from open to high) AND closed red (or near open)
  const isSameDaySpikeCrash = peakIntraday > 50 && peakCandleBody < peakIntraday * 0.3;
  
  // Count "ramp up" days before peak (days with positive closes leading to peak)
  let rampDays = 0;
  for (let i = peakDayIdx - 1; i >= 0; i--) {
    if (window[i].close > window[i].open) rampDays++;
    else break;
  }
  
  return {
    startPrice,
    currentPrice,
    peakHigh,
    peakGain,        // Highest point in window vs start
    currentGain,     // Where it is now vs start
    pullback,        // How far it's fallen from peak
    peakDay,         // Which day (1-7) had the peak
    isRollingOver: pullback > 5 && peakDay < window.length, // Peaked earlier, now falling
    isSameDaySpikeCrash, // Peak and crash on same candle
    rampDays,        // Number of green candles before peak
    candles: window
  };
}

function formatNumber(num) {
  if (!num) return 'N/A';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatPct(num) {
  if (num === null || num === undefined) return 'N/A';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

async function scanATMFilings(days = 30, runFullAnalysis = false) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  DILUTIONHUNTER ATM SCANNER                                       ║
║  ${new Date().toISOString().split('T')[0]}                                             ║
╚═══════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get ATM filings from SEC
  const atmFilings = await getRecentATMFilings(days);
  console.log(`📋 Found ${atmFilings.length} unique tickers with ATM activity\n`);

  if (atmFilings.length === 0) {
    console.log('⚠️  No ATM filings found in date range');
    return [];
  }

  // Step 2: Enrich with price data from FMP
  console.log('📊 Fetching price data...\n');
  
  const enriched = [];
  
  for (const filing of atmFilings) {
    try {
      const [quote, candles] = await Promise.all([
        getQuote(filing.ticker),
        getDailyCandles(filing.ticker, 7)  // 7-day window for peak detection
      ]);

      if (!quote || !candles) {
        // console.log(`   ⚠️  ${filing.ticker}: No quote/candle data`);
        continue;
      }

      enriched.push({
        ...filing,
        price: quote.price,
        marketCap: quote.marketCap,
        volume: quote.volume,
        avgVolume: quote.avgVolume,
        dayPct: quote.changesPercentage,
        // NEW: Peak-based metrics (7-day window)
        peakGain: candles.peakGain,       // Highest point vs start
        currentGain: candles.currentGain, // Where it is now
        pullback: candles.pullback,       // How much it's dropped from peak
        peakDay: candles.peakDay,         // Which day peaked
        isRollingOver: candles.isRollingOver, // Peaked and now falling
        isSameDaySpikeCrash: candles.isSameDaySpikeCrash, // ⚠️ Spike+crash same day
        rampDays: candles.rampDays,       // Days of ramp-up before peak
        daysSinceFiling: Math.floor((Date.now() - new Date(filing.fileDate).getTime()) / (24 * 60 * 60 * 1000))
      });

      // Rate limit
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      // Skip failed lookups
    }
  }

  // Sort by PEAK gain (not current gain) - captures stocks that ran and are now rolling over
  enriched.sort((a, b) => b.peakGain - a.peakGain);

  // Step 3: Display results
  console.log(`${'═'.repeat(100)}`);
  console.log(`📈 ATM TICKERS WITH PRICE DATA: ${enriched.length}`);
  console.log(`${'═'.repeat(100)}\n`);

  // Group by PEAK momentum (not current) - this captures "ran then rolled over"
  const pumping = enriched.filter(e => e.peakGain >= 100);
  const rising = enriched.filter(e => e.peakGain >= 50 && e.peakGain < 100);
  const flat = enriched.filter(e => e.peakGain >= -10 && e.peakGain < 50);
  const falling = enriched.filter(e => e.peakGain < -10);

  const printTable = (items, label, emoji) => {
    if (items.length === 0) return;
    
    console.log(`${emoji} ${label} (${items.length})`);
    console.log(`${'─'.repeat(115)}`);
    console.log(
      `${'Ticker'.padEnd(8)} ` +
      `${'Filing'.padEnd(12)} ` +
      `${'Price'.padEnd(9)} ` +
      `${'Peak'.padEnd(9)} ` +
      `${'Now'.padEnd(9)} ` +
      `${'Pull'.padEnd(8)} ` +
      `${'Day'.padEnd(5)} ` +
      `${'Status'.padEnd(12)} ` +
      `${'MCap'.padEnd(10)} ` +
      `Company`
    );
    console.log(`${'─'.repeat(115)}`);
    
    for (const item of items.slice(0, 15)) {
      const status = item.isRollingOver ? '🔻 ROLLOVER' : 
                     item.pullback > 10 ? '📉 Pulling' :
                     item.currentGain > item.peakGain * 0.95 ? '📈 AtPeak' : '➖';
      
      console.log(
        `${item.ticker.padEnd(8)} ` +
        `${item.fileDate.padEnd(12)} ` +
        `$${item.price.toFixed(2).padEnd(8)} ` +
        `${formatPct(item.peakGain).padEnd(9)} ` +
        `${formatPct(item.currentGain).padEnd(9)} ` +
        `${formatPct(-item.pullback).padEnd(8)} ` +
        `${String(item.peakDay).padEnd(5)} ` +
        `${status.padEnd(12)} ` +
        `${formatNumber(item.marketCap).padEnd(10)} ` +
        `${item.companyName.slice(0, 22)}`
      );
    }
    console.log();
  };

  printTable(pumping, 'PUMPING + ATM (100%+ peak in 7d) 🎯 HIGH PRIORITY', '🔴');
  printTable(rising, 'RISING + ATM (50-100% peak)', '🟠');
  printTable(flat, 'FLAT + ATM (-10% to +50% peak)', '🟡');
  printTable(falling, 'FALLING + ATM (never gained 10%+)', '⚪');

  // Step 4: Run full analysis on top candidates
  if (runFullAnalysis && pumping.length > 0) {
    console.log(`\n${'═'.repeat(100)}`);
    console.log(`🔬 FULL ANALYSIS ON TOP ATM + PUMP CANDIDATES`);
    console.log(`${'═'.repeat(100)}\n`);

    for (const candidate of pumping.slice(0, 5)) {
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`Analyzing ${candidate.ticker} (424B5 filed ${candidate.fileDate})...`);
      console.log(`${'─'.repeat(70)}`);
      
      try {
        await analyzeSymbol(candidate.ticker, { silent: false });
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(115)}`);
  console.log(`📊 SUMMARY`);
  console.log(`${'═'.repeat(115)}\n`);
  console.log(`Total ATM filings (${days} days):  ${atmFilings.length}`);
  console.log(`With valid price data:            ${enriched.length}`);
  console.log(`🔴 Pumping (100%+ 7d peak):        ${pumping.length} ${pumping.length > 0 ? '← PRIORITY TARGETS' : ''}`);
  console.log(`🟠 Rising (50-100% peak):          ${rising.length}`);
  console.log(`🟡 Flat (-10% to +50% peak):       ${flat.length}`);
  console.log(`⚪ Falling (never gained):         ${falling.length}\n`);

  // EARLY ROLLOVER = The ideal short setup
  // - Peaked recently (day 5-7 of window)
  // - Small pullback so far (5-30%) — not already crashed
  // - Still elevated (current gain > 50%)
  const earlyRollovers = enriched.filter(p => 
    p.peakGain >= 50 &&           // Had a significant run
    p.peakDay >= 5 &&             // Peaked recently (last 3 days of 7-day window)
    p.pullback >= 5 &&            // Started pulling back
    p.pullback <= 30 &&           // But hasn't crashed yet
    p.currentGain >= 30           // Still elevated (room to fall)
  );
  
  if (earlyRollovers.length > 0) {
    console.log(`🎯 EARLY ROLLOVER - IDEAL SHORT SETUPS (peaked recently, just starting to pull back):`);
    earlyRollovers.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.ticker} - Peak ${formatPct(p.peakGain)} on day ${p.peakDay} → Now ${formatPct(p.currentGain)} (${formatPct(-p.pullback)} pullback)`);
    });
    console.log();
  }

  // Highlight "already crashed" - these we missed
  const alreadyCrashed = pumping.filter(p => p.pullback > 50);
  if (alreadyCrashed.length > 0) {
    console.log(`⚠️  ALREADY CRASHED (missed the opportunity, pullback >50%):`);
    alreadyCrashed.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.ticker} - Peak ${formatPct(p.peakGain)} → Now ${formatPct(p.currentGain)} (${formatPct(-p.pullback)} from peak) ❌ TOO LATE`);
    });
    console.log();
  }

  // Actionable candidates = pumping but NOT already crashed
  const actionable = pumping.filter(p => p.pullback <= 50);
  if (actionable.length > 0) {
    console.log(`🎯 ACTIONABLE CANDIDATES (100%+ peak, pullback <50%):`);
    actionable.forEach((p, i) => {
      const tag = p.peakDay >= 5 && p.pullback >= 5 ? ' ← EARLY ROLLOVER' : '';
      console.log(`   ${i + 1}. ${p.ticker} - Peak ${formatPct(p.peakGain)}, Now ${formatPct(p.currentGain)}, 424B5 ${p.fileDate}${tag}`);
    });
  } else if (pumping.length > 0) {
    console.log(`⚠️  All 100%+ candidates have already crashed >50% — no actionable setups right now.`);
  }

  return { pumping, rising, flat, falling, earlyRollovers, actionable, all: enriched };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI - Only run when executed directly, not when imported
// ═══════════════════════════════════════════════════════════════════════════════

// Check if this file is being run directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 30;
  const runAnalysis = args.includes('--analyze');

  try {
    await scanATMFilings(days, runAnalysis);
  } catch (err) {
    console.error('❌ Scanner error:', err.message);
    process.exit(1);
  }
}
