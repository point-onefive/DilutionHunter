/**
 * Phase 4: Complete DilutionHunter Analysis Test
 * 
 * Tests the FULL enhanced analysis pipeline with all V2 metrics:
 * - 7-Day Gain %
 * - Red Candle Detection
 * - Volume Capitulation (5-day vs prior 5-day)
 * - Cash Runway (months)
 * - Offering Impact Ratio (% of market cap)
 * - Float Fragility
 * 
 * Uses AAPL as test (won't trigger - it's a healthy company)
 * but validates all data collection works.
 * 
 * Expected API calls: ~7-8 per ticker
 */

import dotenv from 'dotenv';
dotenv.config();

import {
  getQuote,
  getOHLCV,
  getSharesFloat,
  getCashRunway,
  getDilutionAnalysis,
  getApiCallCount
} from '../src/vendors/fmp.js';

import { evaluateSignalV2, DILUTION_THRESHOLDS } from '../src/scoreEngineV2.js';

const TEST_TICKER = 'AAPL';

async function runCompleteAnalysis(symbol) {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  DILUTIONHUNTER V2 - COMPLETE ANALYSIS TEST');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Ticker: ${symbol}`);
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Get Quote
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📊 [1/5] Fetching quote...');
  const quote = await getQuote(symbol);
  if (!quote) {
    console.log('❌ Failed to get quote');
    return null;
  }
  console.log(`   ✅ Price: $${quote.price} | Market Cap: $${(quote.marketCap / 1e9).toFixed(2)}B\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Get OHLCV (30 days for volume analysis)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📈 [2/5] Fetching 30-day OHLCV...');
  const candles = await getOHLCV(symbol, 30);
  if (!candles || candles.length < 10) {
    console.log('❌ Insufficient candle data');
    return null;
  }
  console.log(`   ✅ Retrieved ${candles.length} candles\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Get Float Data
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('🎯 [3/5] Fetching float data...');
  const floatData = await getSharesFloat(symbol);
  if (floatData) {
    console.log(`   ✅ Float: ${(floatData.floatRatio * 100).toFixed(2)}%`);
    console.log(`      Float Shares: ${(floatData.floatShares / 1e9).toFixed(2)}B`);
    console.log(`      Outstanding: ${(floatData.outstandingShares / 1e9).toFixed(2)}B\n`);
  } else {
    console.log('   ⚠️ Float data unavailable\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Calculate Cash Runway
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('💰 [4/5] Calculating cash runway...');
  const runwayData = await getCashRunway(symbol);
  if (runwayData) {
    console.log(`   ✅ Status: ${runwayData.status}`);
    console.log(`      Cash on Hand: $${(runwayData.cashOnHand / 1e9).toFixed(2)}B`);
    if (runwayData.status !== 'PROFITABLE') {
      console.log(`      Monthly Burn: $${(runwayData.monthlyBurn / 1e6).toFixed(2)}M`);
      console.log(`      Runway: ${runwayData.runwayMonths.toFixed(1)} months\n`);
    } else {
      console.log(`      Operating Cash Flow: $${(runwayData.operatingCashFlow / 1e9).toFixed(2)}B (positive)\n`);
    }
  } else {
    console.log('   ⚠️ Runway calculation failed\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Get Dilution/Offering Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('💸 [5/5] Analyzing equity offerings...');
  const dilutionData = await getDilutionAnalysis(symbol);
  if (dilutionData?.offerings) {
    const off = dilutionData.offerings;
    console.log(`   ✅ CIK: ${dilutionData.cik || 'N/A'}`);
    console.log(`      Recent Offerings: ${off.count}`);
    if (off.hasRecentOfferings) {
      console.log(`      Total Amount: $${(off.totalAmount / 1e6).toFixed(2)}M`);
      console.log(`      Amount Remaining: $${(off.totalRemaining / 1e6).toFixed(2)}M`);
      console.log(`      Impact Ratio: ${(off.impactRatio * 100).toFixed(2)}% of market cap`);
    }
  } else {
    console.log('   ⚠️ No offering data available');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RUN V2 SCORING ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  SCORING ENGINE V2 RESULTS');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const result = evaluateSignalV2({
    ticker: symbol,
    candles,
    quote,
    floatData,
    runwayData,
    offeringData: dilutionData?.offerings
  });

  // Display results
  displayResults(result);

  return result;
}

function displayResults(r) {
  console.log('📊 FACTOR BREAKDOWN:');
  console.log('─'.repeat(70));
  console.log(`   Gain Factor (30%):         ${formatFactor(r.factors.gainFactor)} → +${r.metrics.gainPct?.toFixed(1)}% 7-day gain`);
  console.log(`   Red Candle (15%):          ${formatFactor(r.factors.redCandleFactor)} → ${r.metrics.isRedCandle ? 'YES' : 'NO'}`);
  console.log(`   Volume Fade (10%):         ${formatFactor(r.factors.volumeFadeFactor)} → ratio: ${r.metrics.volumeFadeRatio?.toFixed(2) || 'N/A'}`);
  console.log(`   Runway (15%):              ${formatFactor(r.factors.runwayFactor)} → ${r.metrics.runwayMonths === Infinity ? '∞' : r.metrics.runwayMonths?.toFixed(1) + ' months'}`);
  console.log(`   Offering Impact (20%):     ${formatFactor(r.factors.offeringImpactFactor)} → ${(r.metrics.offeringImpactRatio * 100).toFixed(2)}% of mcap`);
  console.log(`   Float Fragility (10%):     ${formatFactor(r.factors.floatFragilityFactor)} → ${r.metrics.floatRatio ? (r.metrics.floatRatio * 100).toFixed(1) + '% float' : 'unknown'}`);
  
  console.log('\n' + '═'.repeat(70));
  console.log(`   TOTAL SCORE: ${r.score.toFixed(3)} / 1.000`);
  console.log(`   THRESHOLD:   ${DILUTION_THRESHOLDS.minScoreToTrigger}`);
  console.log('═'.repeat(70));
  
  console.log('\n🎯 TRIGGER CONDITIONS:');
  console.log('─'.repeat(70));
  console.log(`   Score >= 0.65:              ${r.triggerConditions.scoreThreshold ? '✅ YES' : '❌ NO'} (${r.score.toFixed(3)})`);
  console.log(`   Offering Impact > 10%:      ${r.triggerConditions.hasSignificantOffering ? '✅ YES' : '❌ NO'} (${(r.metrics.offeringImpactRatio * 100).toFixed(2)}%)`);
  console.log(`   Weekly Gain > 150%:         ${r.triggerConditions.hasParabolicRun ? '✅ YES' : '❌ NO'} (${r.metrics.gainPct?.toFixed(1)}%)`);
  
  console.log('\n' + '═'.repeat(70));
  if (r.shouldTrigger) {
    console.log('   🚨 SIGNAL TRIGGERED - WOULD POST TO TWITTER');
  } else {
    console.log('   ✅ NO SIGNAL - Does not meet all trigger criteria');
  }
  console.log('═'.repeat(70));
  
  if (r.reasons.length > 0) {
    console.log('\n📝 REASONS:');
    r.reasons.forEach(reason => console.log(`   • ${reason}`));
  }
  
  // API Usage
  const calls = getApiCallCount();
  console.log(`\n📊 API Calls Used: ${calls}`);
}

function formatFactor(value) {
  const bar = '█'.repeat(Math.round(value * 10)) + '░'.repeat(10 - Math.round(value * 10));
  return `${bar} ${value.toFixed(3)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN TEST
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    const result = await runCompleteAnalysis(TEST_TICKER);
    
    console.log('\n\n📋 FULL JSON RESULT:');
    console.log('─'.repeat(70));
    // Remove raw data for cleaner output
    const { _raw, ...cleanResult } = result || {};
    console.log(JSON.stringify(cleanResult, null, 2));
    
    console.log('\n✅ Phase 4 Complete Analysis Test Finished\n');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
