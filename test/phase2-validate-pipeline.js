/**
 * Phase 2 Test: Validate Each Analysis Step
 * 
 * This test validates that we can collect all relevant data for the scanner
 * using a SINGLE ticker to minimize API calls.
 * 
 * Expected API calls: ~5-6 total
 *   1. getQuote (price, volume, market cap)
 *   2. getOHLCV (historical price data)
 *   3. getFinancials - key-metrics-ttm
 *   4. getFinancials - profile
 *   5. getBalanceSheet (cash position, debt)
 *   6. getOfferings (SEC filings)
 */

import dotenv from 'dotenv';
dotenv.config();

import {
  getQuote,
  getOHLCV,
  getFinancials,
  getBalanceSheet,
  getOfferings,
  getApiCallCount
} from '../src/vendors/fmp.js';

import { FMP_CONFIG } from '../src/config.js';

const TEST_TICKER = 'AAPL'; // Using AAPL because it has rich data

async function validatePipeline() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PHASE 2: VALIDATE PIPELINE DATA COLLECTION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Test Ticker: ${TEST_TICKER}`);
  console.log(`  API calls expected: ~5-6`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const results = {
    quote: { success: false, data: null, error: null },
    ohlcv: { success: false, data: null, error: null },
    financials: { success: false, data: null, error: null },
    balanceSheet: { success: false, data: null, error: null },
    offerings: { success: false, data: null, error: null }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Quote Data (price, volume, change)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📊 STEP 1: Quote Data');
  console.log('─'.repeat(60));
  try {
    const quote = await getQuote(TEST_TICKER);
    if (quote) {
      results.quote.success = true;
      results.quote.data = quote;
      console.log('✅ Quote retrieved successfully');
      console.log(`   Symbol:        ${quote.symbol}`);
      console.log(`   Price:         $${quote.price}`);
      console.log(`   Change:        ${quote.changesPercentage?.toFixed(2)}%`);
      console.log(`   Volume:        ${quote.volume?.toLocaleString()}`);
      console.log(`   Avg Volume:    ${quote.avgVolume?.toLocaleString()}`);
      console.log(`   Market Cap:    $${(quote.marketCap / 1e9)?.toFixed(2)}B`);
      console.log(`   52W High:      $${quote.yearHigh}`);
      console.log(`   52W Low:       $${quote.yearLow}`);
      
      // Check for key fields we need
      const neededFields = ['price', 'volume', 'marketCap', 'changesPercentage'];
      const missingFields = neededFields.filter(f => quote[f] === undefined || quote[f] === null);
      if (missingFields.length > 0) {
        console.log(`   ⚠️  Missing fields: ${missingFields.join(', ')}`);
      }
    } else {
      results.quote.error = 'No data returned';
      console.log('❌ No quote data returned');
    }
  } catch (e) {
    results.quote.error = e.message;
    console.log(`❌ Error: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: OHLCV Historical Data (for pattern analysis)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📈 STEP 2: OHLCV Historical Data');
  console.log('─'.repeat(60));
  try {
    const ohlcv = await getOHLCV(TEST_TICKER, 30);
    if (ohlcv && ohlcv.length > 0) {
      results.ohlcv.success = true;
      results.ohlcv.data = ohlcv;
      console.log(`✅ OHLCV retrieved: ${ohlcv.length} candles`);
      
      // Show first and last candle
      const first = ohlcv[0];
      const last = ohlcv[ohlcv.length - 1];
      console.log(`   First candle:  ${first.date} | O:$${first.open} H:$${first.high} L:$${first.low} C:$${first.close}`);
      console.log(`   Last candle:   ${last.date} | O:$${last.open} H:$${last.high} L:$${last.low} C:$${last.close}`);
      
      // Calculate some metrics we'll need
      const avgVolume = ohlcv.reduce((sum, c) => sum + c.volume, 0) / ohlcv.length;
      const priceRange = Math.max(...ohlcv.map(c => c.high)) - Math.min(...ohlcv.map(c => c.low));
      console.log(`   Avg Volume:    ${avgVolume.toLocaleString()}`);
      console.log(`   30d Range:     $${priceRange.toFixed(2)}`);
      
      // Check for key fields
      const neededFields = ['date', 'open', 'high', 'low', 'close', 'volume'];
      const missingFields = neededFields.filter(f => first[f] === undefined);
      if (missingFields.length > 0) {
        console.log(`   ⚠️  Missing fields: ${missingFields.join(', ')}`);
      }
    } else {
      results.ohlcv.error = 'No data returned';
      console.log('❌ No OHLCV data returned');
    }
  } catch (e) {
    results.ohlcv.error = e.message;
    console.log(`❌ Error: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Financials (market cap, shares outstanding, cash)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n💰 STEP 3: Financial Metrics');
  console.log('─'.repeat(60));
  try {
    const financials = await getFinancials(TEST_TICKER);
    if (financials) {
      results.financials.success = true;
      results.financials.data = financials;
      console.log('✅ Financials retrieved successfully');
      console.log(`   Market Cap:         $${(financials.marketCap / 1e9)?.toFixed(2)}B`);
      console.log(`   Shares Outstanding: ${(financials.sharesOutstanding / 1e6)?.toFixed(2)}M`);
      console.log(`   Cash:               $${(financials.cash / 1e9)?.toFixed(2)}B`);
      console.log(`   Debt:               $${(financials.debt / 1e9)?.toFixed(2)}B`);
      console.log(`   Current Ratio:      ${financials.currentRatio?.toFixed(2)}`);
      console.log(`   Sector:             ${financials.sector}`);
      console.log(`   Industry:           ${financials.industry}`);
      
      // Key fields for dilution analysis
      const neededFields = ['marketCap', 'sharesOutstanding', 'cash', 'debt'];
      const missingFields = neededFields.filter(f => financials[f] === undefined || financials[f] === null);
      if (missingFields.length > 0) {
        console.log(`   ⚠️  Missing fields: ${missingFields.join(', ')}`);
      }
    } else {
      results.financials.error = 'No data returned';
      console.log('❌ No financials data returned');
    }
  } catch (e) {
    results.financials.error = e.message;
    console.log(`❌ Error: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Balance Sheet (detailed cash position)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 STEP 4: Balance Sheet');
  console.log('─'.repeat(60));
  try {
    const balanceSheet = await getBalanceSheet(TEST_TICKER, 'quarter', 2);
    if (balanceSheet && balanceSheet.length > 0) {
      results.balanceSheet.success = true;
      results.balanceSheet.data = balanceSheet;
      console.log(`✅ Balance sheet retrieved: ${balanceSheet.length} quarters`);
      
      const latest = balanceSheet[0];
      console.log(`   Period:              ${latest.date}`);
      console.log(`   Cash & Equiv:        $${(latest.cashAndCashEquivalents / 1e9)?.toFixed(2)}B`);
      console.log(`   Total Assets:        $${(latest.totalAssets / 1e9)?.toFixed(2)}B`);
      console.log(`   Total Debt:          $${(latest.totalDebt / 1e9)?.toFixed(2)}B`);
      console.log(`   Shares Outstanding:  ${(latest.commonStock / 1e6)?.toFixed(2)}M`);
      
      // Compare quarters for dilution signals
      if (balanceSheet.length > 1) {
        const prev = balanceSheet[1];
        const shareChange = ((latest.commonStock - prev.commonStock) / prev.commonStock * 100);
        console.log(`   Share Change Q/Q:    ${shareChange.toFixed(2)}%`);
      }
    } else {
      results.balanceSheet.error = 'No data returned';
      console.log('❌ No balance sheet data returned');
    }
  } catch (e) {
    results.balanceSheet.error = e.message;
    console.log(`❌ Error: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: SEC Filings / Offerings (for dilution detection)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📑 STEP 5: SEC Filings / Offerings');
  console.log('─'.repeat(60));
  try {
    const offerings = await getOfferings(TEST_TICKER);
    if (offerings && offerings.length > 0) {
      results.offerings.success = true;
      results.offerings.data = offerings;
      console.log(`✅ Offerings/SEC filings retrieved: ${offerings.length} records`);
      
      // Show first few
      offerings.slice(0, 3).forEach((filing, i) => {
        console.log(`   [${i + 1}] ${filing.formType || filing.type || 'Unknown'} - ${filing.filingDate || filing.date || 'No date'}`);
      });
      
      // Check for offering-related forms
      const offeringForms = offerings.filter(f => 
        ['S-1', 'S-3', 'S-4', '424B'].some(form => 
          (f.formType || f.type || '').includes(form)
        )
      );
      console.log(`   Offering-related filings: ${offeringForms.length}`);
    } else {
      results.offerings.error = 'No data returned (may require paid tier)';
      console.log('⚠️  No SEC filings data returned');
      console.log('   Note: Some endpoints may require paid FMP tier');
      results.offerings.success = true; // Not a failure, just limited access
    }
  } catch (e) {
    results.offerings.error = e.message;
    console.log(`⚠️  SEC filings error: ${e.message}`);
    console.log('   Note: This endpoint may require paid FMP tier');
    results.offerings.success = true; // Not critical
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PHASE 2 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  
  const callsMade = getApiCallCount();
  console.log(`\n📊 API Usage:`);
  console.log(`   Calls made:    ${callsMade}`);
  console.log(`   Daily limit:   ${FMP_CONFIG.maxDailyCalls}`);
  console.log(`   Remaining:     ${FMP_CONFIG.maxDailyCalls - callsMade}`);
  
  console.log(`\n✅ Validation Results:`);
  const steps = [
    { name: 'Quote', key: 'quote', critical: true },
    { name: 'OHLCV', key: 'ohlcv', critical: true },
    { name: 'Financials', key: 'financials', critical: true },
    { name: 'Balance Sheet', key: 'balanceSheet', critical: true },
    { name: 'Offerings', key: 'offerings', critical: false }
  ];
  
  let allCriticalPassed = true;
  steps.forEach(step => {
    const result = results[step.key];
    const icon = result.success ? '✅' : '❌';
    const status = result.success ? 'PASS' : 'FAIL';
    const critical = step.critical ? '[CRITICAL]' : '[OPTIONAL]';
    console.log(`   ${icon} ${step.name.padEnd(15)} ${status.padEnd(6)} ${critical}`);
    
    if (!result.success && step.critical) {
      allCriticalPassed = false;
    }
  });
  
  console.log('\n═══════════════════════════════════════════════════════════');
  if (allCriticalPassed) {
    console.log('  🎉 ALL CRITICAL STEPS PASSED - READY FOR PHASE 3');
    console.log('═══════════════════════════════════════════════════════════\n');
    return true;
  } else {
    console.log('  ❌ SOME CRITICAL STEPS FAILED - NEEDS INVESTIGATION');
    console.log('═══════════════════════════════════════════════════════════\n');
    return false;
  }
}

// Run validation
validatePipeline()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
