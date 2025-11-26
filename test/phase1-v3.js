/**
 * Phase 1 Test v3: New FMP "Stable" API Endpoints
 * 
 * FMP migrated to /stable/ endpoints. Testing the new format.
 * Makes exactly 1 call.
 */

import dotenv from 'dotenv';
dotenv.config();

const FMP_API_KEY = process.env.FMP_API_KEY;

console.log('\n🧪 PHASE 1 TEST v3: New FMP Stable API\n');
console.log('═══════════════════════════════════════════════════════════');
console.log(`   API Key: ${FMP_API_KEY ? '✅ Loaded' : '❌ MISSING'}`);
console.log('═══════════════════════════════════════════════════════════\n');

if (!FMP_API_KEY) {
  console.error('❌ No FMP_API_KEY found');
  process.exit(1);
}

// NEW stable endpoint format: /stable/historical-price-eod/full
const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=AAPL&apikey=${FMP_API_KEY}`;

console.log('📡 Testing NEW endpoint: /stable/historical-price-eod/full (1 API call)\n');

try {
  const response = await fetch(url);
  console.log(`   Status: ${response.status} ${response.statusText}`);
  
  const data = await response.json();
  
  if (data['Error Message'] || data.error) {
    console.log(`\n❌ Error: ${data['Error Message'] || data.error}`);
    process.exit(1);
  }
  
  if (response.ok && Array.isArray(data) && data.length > 0) {
    console.log('\n✅ SUCCESS! New stable endpoint works!\n');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`   Data points returned: ${data.length}`);
    console.log('─────────────────────────────────────────────────────────────');
    
    // Show first few entries
    console.log('\n📊 Latest price data (first 3 entries):');
    data.slice(0, 3).forEach((d, i) => {
      console.log(`   ${d.date}: O:$${d.open} H:$${d.high} L:$${d.low} C:$${d.close} V:${d.volume}`);
    });
    
    console.log('\n📊 Full data structure sample:');
    console.log(JSON.stringify(data[0], null, 2));
    
    // Calculate what scanner would see
    if (data.length >= 7) {
      const latest = data[0];
      const weekAgo = data[6];
      const weeklyChange = ((latest.close - weekAgo.close) / weekAgo.close) * 100;
      
      console.log('\n📈 Scanner calculation:');
      console.log(`   Latest: ${latest.date} @ $${latest.close}`);
      console.log(`   7 days ago: ${weekAgo.date} @ $${weekAgo.close}`);
      console.log(`   Weekly change: ${weeklyChange.toFixed(2)}%`);
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 Phase 1 PASSED! We need to update FMP wrapper to use');
    console.log('   /stable/ endpoints instead of /v3/');
    console.log('═══════════════════════════════════════════════════════════\n');
  } else {
    console.log('\n⚠️  Unexpected response format:');
    console.log(JSON.stringify(data, null, 2).slice(0, 500));
  }
  
} catch (error) {
  console.error(`\n❌ Fetch error: ${error.message}`);
  process.exit(1);
}
