/**
 * Phase 1 Test v2: Test FMP Free Tier Endpoints
 * 
 * FMP changed their API - let's find what works.
 * This makes exactly 1 call to the most likely endpoint.
 */

import dotenv from 'dotenv';
dotenv.config();

const FMP_API_KEY = process.env.FMP_API_KEY;

console.log('\n🧪 PHASE 1 TEST v2: Finding Working Endpoints\n');
console.log('═══════════════════════════════════════════════════════════');
console.log(`   API Key: ${FMP_API_KEY ? '✅ Loaded' : '❌ MISSING'}`);
console.log('═══════════════════════════════════════════════════════════\n');

if (!FMP_API_KEY) {
  console.error('❌ No FMP_API_KEY found');
  process.exit(1);
}

// Try the stock gainers endpoint - likely available on free tier
// This is PERFECT for our use case anyway (finding parabolic movers)
const url = `https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${FMP_API_KEY}`;

console.log('📡 Testing: /v3/stock_market/gainers (1 API call)\n');

try {
  const response = await fetch(url);
  console.log(`   Status: ${response.status} ${response.statusText}`);
  
  const data = await response.json();
  
  if (data['Error Message']) {
    console.log(`\n❌ Error: ${data['Error Message']}`);
    console.log('\n💡 Your FMP plan may not include this endpoint.');
    console.log('   Check: https://site.financialmodelingprep.com/developer/docs/pricing');
    process.exit(1);
  }
  
  if (response.ok && Array.isArray(data)) {
    console.log('\n✅ SUCCESS! Gainers endpoint works!\n');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`   Stocks returned: ${data.length}`);
    console.log('─────────────────────────────────────────────────────────────');
    
    // Show top 5 gainers
    console.log('\n🚀 Top 5 Gainers Today:\n');
    data.slice(0, 5).forEach((stock, i) => {
      console.log(`   ${i+1}. $${stock.symbol.padEnd(6)} | +${stock.changesPercentage?.toFixed(2)}% | $${stock.price?.toFixed(2)} | ${stock.name?.slice(0, 30)}`);
    });
    
    console.log('\n📊 Full data structure for first stock:');
    console.log(JSON.stringify(data[0], null, 2));
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 GOOD NEWS: This endpoint is perfect for DilutionHunter!');
    console.log('   We can scan daily gainers instead of a fixed ticker list.');
    console.log('   This is MORE efficient and finds actual movers.');
    console.log('═══════════════════════════════════════════════════════════\n');
  } else {
    console.log('\n❌ Unexpected response:', JSON.stringify(data).slice(0, 300));
  }
  
} catch (error) {
  console.error(`\n❌ Fetch error: ${error.message}`);
  process.exit(1);
}
