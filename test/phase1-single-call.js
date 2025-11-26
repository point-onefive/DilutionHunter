/**
 * Phase 1 Test: Single API Call
 * 
 * Makes exactly ONE FMP API call to validate:
 * 1. API key is working
 * 2. Data format is as expected
 * 3. Our parsing logic is correct
 */

import dotenv from 'dotenv';
dotenv.config();

const FMP_API_KEY = process.env.FMP_API_KEY;
const TEST_TICKER = 'AAPL'; // Use a reliable ticker for testing

console.log('\n🧪 PHASE 1 TEST: Single API Call\n');
console.log('═══════════════════════════════════════════════════════════');
console.log(`   API Key: ${FMP_API_KEY ? '✅ Loaded (' + FMP_API_KEY.slice(0, 8) + '...)' : '❌ MISSING'}`);
console.log(`   Test Ticker: ${TEST_TICKER}`);
console.log('═══════════════════════════════════════════════════════════\n');

if (!FMP_API_KEY) {
  console.error('❌ No FMP_API_KEY found in .env file');
  process.exit(1);
}

// Make ONE call: get 30 days of OHLCV for AAPL
const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${TEST_TICKER}?timeseries=30&apikey=${FMP_API_KEY}`;

console.log('📡 Making 1 API call: historical-price-full...\n');

try {
  const response = await fetch(url);
  
  console.log(`   Status: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`\n❌ API Error: ${errorText}`);
    process.exit(1);
  }
  
  const data = await response.json();
  
  console.log('\n✅ SUCCESS! Data received:\n');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`   Symbol: ${data.symbol}`);
  console.log(`   Candles returned: ${data.historical?.length || 0}`);
  console.log('─────────────────────────────────────────────────────────────');
  
  if (data.historical && data.historical.length > 0) {
    const latest = data.historical[0]; // FMP returns newest first
    const oldest = data.historical[data.historical.length - 1];
    
    console.log('\n📊 Latest candle:');
    console.log(JSON.stringify(latest, null, 2));
    
    console.log('\n📊 Oldest candle in range:');
    console.log(JSON.stringify(oldest, null, 2));
    
    // Calculate what our scanner would see
    const weekAgo = data.historical[6] || oldest;
    const weeklyChange = ((latest.close - weekAgo.close) / weekAgo.close) * 100;
    
    console.log('\n📈 Scanner would calculate:');
    console.log(`   Latest close: $${latest.close}`);
    console.log(`   7 days ago close: $${weekAgo.close}`);
    console.log(`   Weekly change: ${weeklyChange.toFixed(2)}%`);
    console.log(`   Would trigger (>=200%)? ${weeklyChange >= 200 ? '✅ YES' : '❌ NO'}`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🎉 Phase 1 PASSED - API connection working!');
  console.log('   Next: Run phase 2 test with 10-20 tickers');
  console.log('═══════════════════════════════════════════════════════════\n');
  
} catch (error) {
  console.error(`\n❌ Fetch error: ${error.message}`);
  process.exit(1);
}
