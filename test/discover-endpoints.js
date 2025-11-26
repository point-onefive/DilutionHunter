/**
 * FMP API Endpoint Discovery
 * 
 * Test which endpoints work on current FMP free tier
 * Makes minimal calls to find working endpoints
 */

import dotenv from 'dotenv';
dotenv.config();

const FMP_API_KEY = process.env.FMP_API_KEY;
const TEST_TICKER = 'AAPL';

console.log('\n🔍 FMP API Endpoint Discovery\n');
console.log('Testing which endpoints work on your plan...\n');

// Endpoints to test (one call each)
const endpoints = [
  {
    name: 'Quote (real-time price)',
    url: `/api/v3/quote/${TEST_TICKER}`,
  },
  {
    name: 'Quote Short',
    url: `/api/v3/quote-short/${TEST_TICKER}`,
  },
  {
    name: 'Company Profile',
    url: `/api/v3/profile/${TEST_TICKER}`,
  },
  {
    name: 'Stock Price Change',
    url: `/api/v3/stock-price-change/${TEST_TICKER}`,
  },
  {
    name: 'Gainers',
    url: `/api/v3/stock_market/gainers`,
  },
];

async function testEndpoint(endpoint) {
  const url = `https://financialmodelingprep.com${endpoint.url}?apikey=${FMP_API_KEY}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (response.ok && !data['Error Message']) {
      return { success: true, data };
    } else {
      return { success: false, error: data['Error Message'] || response.statusText };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Test ONE endpoint at a time with user confirmation
const readline = await import('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

let callCount = 0;

for (const endpoint of endpoints) {
  const answer = await ask(`\nTest "${endpoint.name}"? (y/n/q to quit): `);
  
  if (answer.toLowerCase() === 'q') {
    console.log('\nStopped. Total API calls made:', callCount);
    break;
  }
  
  if (answer.toLowerCase() !== 'y') {
    console.log('   Skipped');
    continue;
  }
  
  callCount++;
  console.log(`   Testing... (call #${callCount})`);
  
  const result = await testEndpoint(endpoint);
  
  if (result.success) {
    console.log(`   ✅ WORKS!`);
    console.log(`   Sample data:`, JSON.stringify(result.data, null, 2).slice(0, 500));
  } else {
    console.log(`   ❌ Failed: ${result.error}`);
  }
}

rl.close();
console.log('\n✅ Discovery complete. Total calls:', callCount);
