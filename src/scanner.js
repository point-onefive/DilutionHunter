/**
 * DilutionHunter Scanner
 * 
 * Main entry point for scanning tickers and detecting dilution signals.
 * Coordinates FMP data fetching, scoring, storage, and posting.
 */

import { 
  logConfig, 
  DRY_RUN, 
  VERBOSE, 
  SCANNER_THRESHOLDS,
  TWITTER_CONFIG 
} from './config.js';
import { 
  getSymbols, 
  getOHLCV, 
  getFinancials, 
  getOfferings,
  getQuote,
  getApiCallCount,
  resetApiCallCount 
} from './vendors/fmp.js';
import { evaluateSignal, calculateWeeklyChange } from './scoreEngine.js';
import { loadSignals, saveSignals, loadDailyLog, saveDailyLog } from './storage.js';
import { generateAndPostTweet } from './postTweet.js';

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCANNER
// ═══════════════════════════════════════════════════════════════════════════

export async function runScan() {
  console.log('\n🔫 DilutionHunter Scanner Starting...\n');
  logConfig();
  
  const startTime = Date.now();
  const scanDate = new Date().toISOString().split('T')[0];
  
  // Reset API call counter for this run
  resetApiCallCount();
  
  // Load existing state
  const activeSignals = loadSignals();
  const dailyLog = loadDailyLog();
  
  // Track new signals this run
  const newSignals = [];
  const skipped = [];
  const errors = [];
  
  // Check daily tweet limits
  const todaysTweets = dailyLog.tweets?.filter(t => t.date === scanDate).length || 0;
  const canTweet = todaysTweets < TWITTER_CONFIG.maxTweetsPerDay;
  const signalsToday = dailyLog.signals?.filter(s => s.date === scanDate).length || 0;
  const canAddSignals = signalsToday < TWITTER_CONFIG.maxNewSignalsPerDay;
  
  console.log(`📊 Daily Status:`);
  console.log(`   Signals today: ${signalsToday}/${TWITTER_CONFIG.maxNewSignalsPerDay}`);
  console.log(`   Tweets today: ${todaysTweets}/${TWITTER_CONFIG.maxTweetsPerDay}\n`);
  
  try {
    // Get symbols to scan
    const symbols = await getSymbols();
    console.log(`\n🎯 Scanning ${symbols.length} symbols...\n`);
    
    for (const ticker of symbols) {
      try {
        // Skip if already tracking this ticker
        if (activeSignals.some(s => s.ticker === ticker)) {
          if (VERBOSE) console.log(`⏭️  ${ticker}: Already tracking, skipping`);
          skipped.push({ ticker, reason: 'already_tracking' });
          continue;
        }
        
        // ─────────────────────────────────────────────────────────────────
        // STEP 1: Get price data and check for parabolic move
        // ─────────────────────────────────────────────────────────────────
        
        const candles = await getOHLCV(ticker, SCANNER_THRESHOLDS.candleLookbackDays);
        
        if (!candles || candles.length < 7) {
          if (VERBOSE) console.log(`⏭️  ${ticker}: Insufficient price data`);
          skipped.push({ ticker, reason: 'insufficient_data' });
          continue;
        }
        
        // Calculate weekly change
        const weeklyChange = calculateWeeklyChange(candles);
        
        if (weeklyChange < SCANNER_THRESHOLDS.minWeeklyGainPct) {
          if (VERBOSE) console.log(`⏭️  ${ticker}: Weekly change ${weeklyChange.toFixed(1)}% below threshold`);
          skipped.push({ ticker, reason: 'below_threshold', weeklyChange });
          continue;
        }
        
        console.log(`\n🚀 ${ticker}: ${weeklyChange.toFixed(1)}% weekly gain - INVESTIGATING...`);
        
        // ─────────────────────────────────────────────────────────────────
        // STEP 2: Get fundamentals (this uses 2 API calls per ticker)
        // ─────────────────────────────────────────────────────────────────
        
        const fundamentals = await getFinancials(ticker);
        
        // ─────────────────────────────────────────────────────────────────
        // STEP 3: Check for equity offerings
        // ─────────────────────────────────────────────────────────────────
        
        const offerings = await getOfferings(ticker);
        
        // ─────────────────────────────────────────────────────────────────
        // STEP 4: Run through scoring engine
        // ─────────────────────────────────────────────────────────────────
        
        const decision = evaluateSignal({
          ticker,
          candles,
          weeklyChange,
          fundamentals,
          offerings
        });
        
        console.log(`   Score: ${decision.score.toFixed(2)} | Trigger: ${decision.shouldTrigger ? '✅ YES' : '❌ NO'}`);
        
        if (decision.shouldTrigger) {
          console.log(`   Reasons: ${decision.reasons.join(', ')}`);
          
          // Add to active signals
          const signal = {
            ticker,
            trigger_date: scanDate,
            entry_price: decision.entryPrice,
            weekly_gain_pct: weeklyChange,
            first_red_day: decision.firstRedDay,
            volume_fade: decision.volumeFade,
            cash: fundamentals.cash,
            debt: fundamentals.totalDebt,
            market_cap: fundamentals.marketCap,
            offering_detected: offerings.hasOfferings,
            offering_count: offerings.count,
            dilution_risk_score: decision.score,
            reason: decision.reasons.join('; '),
            tweet_id: null,
            notes: {
              fundamentals: decision.fundamentalFlags,
              candles: decision.candleFlags
            }
          };
          
          newSignals.push(signal);
          
          // Post tweet if allowed
          if (canTweet && canAddSignals && !DRY_RUN) {
            const tweetResult = await generateAndPostTweet(signal, 'new_signal');
            signal.tweet_id = tweetResult?.tweetId || null;
          } else if (DRY_RUN) {
            console.log(`   📝 DRY RUN: Would tweet about ${ticker}`);
          } else {
            console.log(`   ⚠️  Tweet skipped (daily limit reached)`);
          }
        }
        
      } catch (tickerError) {
        console.error(`❌ Error processing ${ticker}: ${tickerError.message}`);
        errors.push({ ticker, error: tickerError.message });
      }
    }
    
  } catch (error) {
    console.error(`\n❌ Scanner error: ${error.message}`);
    throw error;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // SAVE RESULTS
  // ─────────────────────────────────────────────────────────────────────────
  
  // Merge new signals into active signals
  const updatedSignals = [...activeSignals, ...newSignals];
  saveSignals(updatedSignals);
  
  // Update daily log
  const runLog = {
    date: scanDate,
    timestamp: new Date().toISOString(),
    symbolsScanned: (await getSymbols()).length,
    apiCallsUsed: getApiCallCount(),
    newSignals: newSignals.length,
    skipped: skipped.length,
    errors: errors.length,
    durationMs: Date.now() - startTime
  };
  
  dailyLog.runs = dailyLog.runs || [];
  dailyLog.runs.push(runLog);
  
  dailyLog.signals = dailyLog.signals || [];
  newSignals.forEach(s => {
    dailyLog.signals.push({ date: scanDate, ticker: s.ticker });
  });
  
  saveDailyLog(dailyLog);
  
  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 SCAN COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`   API Calls: ${getApiCallCount()}`);
  console.log(`   Symbols Scanned: ${(await getSymbols()).length}`);
  console.log(`   New Signals: ${newSignals.length}`);
  console.log(`   Skipped: ${skipped.length}`);
  console.log(`   Errors: ${errors.length}`);
  console.log(`   Total Active Signals: ${updatedSignals.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');
  
  if (newSignals.length > 0) {
    console.log('🎯 NEW SIGNALS:');
    newSignals.forEach(s => {
      console.log(`   ${s.ticker}: Score ${s.dilution_risk_score.toFixed(2)} | ${s.reason}`);
    });
    console.log('');
  }
  
  return {
    newSignals,
    skipped,
    errors,
    apiCalls: getApiCallCount()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  runScan()
    .then(result => {
      console.log('✅ Scanner finished successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Scanner failed:', error);
      process.exit(1);
    });
}
