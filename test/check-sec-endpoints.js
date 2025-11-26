/**
 * Test SEC/Offerings endpoints to confirm what's available on free tier
 * 
 * We'll test multiple endpoint variations to see which ones work
 * Expected: Most will return 400/403 on free tier
 */

import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.FMP_API_KEY;
const BASE = 'https://financialmodelingprep.com';

async function testEndpoint(name, url) {
  try {
    const response = await fetch(url);
    const status = response.status;
    
    if (status === 200) {
      const data = await response.json();
      const hasData = Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0;
      console.log(`✅ ${name}`);
      console.log(`   Status: ${status} | Has Data: ${hasData}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   Sample: ${JSON.stringify(data[0]).slice(0, 100)}...`);
      }
      return { name, status, works: true, hasData };
    } else {
      const text = await response.text();
      console.log(`❌ ${name}`);
      console.log(`   Status: ${status} | Error: ${text.slice(0, 80)}`);
      return { name, status, works: false, error: text.slice(0, 80) };
    }
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err.message}`);
    return { name, status: 'error', works: false, error: err.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TESTING SEC/OFFERING ENDPOINTS ON FREE TIER');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  API Key: ${API_KEY?.slice(0, 8)}...`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const endpoints = [
    // SEC Filings variations
    ['SEC Filings (stable)', `${BASE}/stable/sec-filings?symbol=AAPL&apikey=${API_KEY}`],
    ['SEC Filings Search (stable)', `${BASE}/stable/sec-filings-search/symbol?symbol=AAPL&apikey=${API_KEY}`],
    ['SEC Filings (v3)', `${BASE}/api/v3/sec_filings/AAPL?apikey=${API_KEY}`],
    
    // Fundraising/Offerings variations
    ['Fundraising (stable)', `${BASE}/stable/fundraising?symbol=AAPL&apikey=${API_KEY}`],
    ['Fundraising Latest (stable)', `${BASE}/stable/fundraising-latest?apikey=${API_KEY}`],
    ['Equity Offering (v4)', `${BASE}/api/v4/equity_offering?symbol=AAPL&apikey=${API_KEY}`],
    ['Equity Offering Search (v4)', `${BASE}/api/v4/equity_offering_search?name=Apple&apikey=${API_KEY}`],
    
    // Stock news (might contain offering announcements)
    ['Stock News (stable)', `${BASE}/stable/news?symbol=AAPL&limit=5&apikey=${API_KEY}`],
    
    // Press releases (often announce offerings)
    ['Press Releases (stable)', `${BASE}/stable/press-releases?symbol=AAPL&limit=5&apikey=${API_KEY}`],
    
    // Insider trading (related to dilution)
    ['Insider Trading (stable)', `${BASE}/stable/insider-trading?symbol=AAPL&limit=5&apikey=${API_KEY}`],
    
    // Stock split history (another form of dilution)
    ['Stock Split (stable)', `${BASE}/stable/historical-stock-split?symbol=AAPL&apikey=${API_KEY}`],
    
    // Shares float (useful for dilution analysis)
    ['Shares Float (stable)', `${BASE}/stable/shares-float?symbol=AAPL&apikey=${API_KEY}`],
  ];

  const results = [];
  
  for (const [name, url] of endpoints) {
    const result = await testEndpoint(name, url);
    results.push(result);
    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const working = results.filter(r => r.works);
  const blocked = results.filter(r => !r.works);
  
  console.log(`\n✅ WORKING ON FREE TIER (${working.length}):`);
  working.forEach(r => console.log(`   • ${r.name}`));
  
  console.log(`\n❌ BLOCKED/REQUIRES UPGRADE (${blocked.length}):`);
  blocked.forEach(r => console.log(`   • ${r.name} (${r.status})`));
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Total API calls made: ${endpoints.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main();
