import 'dotenv/config';

const FMP_KEY = process.env.FMP_API_KEY;
console.log('API Key exists:', !!FMP_KEY, 'Length:', FMP_KEY?.length);

async function testStable(endpoint) {
  const url = `https://financialmodelingprep.com/stable${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`;
  console.log('\nTesting STABLE:', endpoint);
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data)) {
      console.log('  ✓ Array with', data.length, 'items');
      if (data.length > 0) console.log('  Sample:', JSON.stringify(data[0]).slice(0, 400));
    } else if (data.error || data['Error Message']) {
      console.log('  ✗ Error:', data.error || data['Error Message']);
    } else {
      console.log('  ✓ Object:', JSON.stringify(data).slice(0, 400));
    }
  } catch (e) {
    console.log('  ✗ Failed:', e.message);
  }
}

async function testV3(endpoint) {
  const url = `https://financialmodelingprep.com/api/v3${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`;
  console.log('\nTesting V3:', endpoint);
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data)) {
      console.log('  ✓ Array with', data.length, 'items');
      if (data.length > 0) console.log('  Sample:', JSON.stringify(data[0]).slice(0, 400));
    } else if (data.error || data['Error Message']) {
      console.log('  ✗ Error:', data.error || data['Error Message']);
    } else {
      console.log('  ✓ Object:', JSON.stringify(data).slice(0, 400));
    }
  } catch (e) {
    console.log('  ✗ Failed:', e.message);
  }
}

async function testV4(endpoint) {
  const url = `https://financialmodelingprep.com/api/v4${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`;
  console.log('\nTesting V4:', endpoint);
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data)) {
      console.log('  ✓ Array with', data.length, 'items');
      if (data.length > 0) console.log('  Sample:', JSON.stringify(data[0]).slice(0, 400));
    } else if (data.error || data['Error Message']) {
      console.log('  ✗ Error:', data.error || data['Error Message']);
    } else {
      console.log('  ✓ Object:', JSON.stringify(data).slice(0, 400));
    }
  } catch (e) {
    console.log('  ✗ Failed:', e.message);
  }
}

(async () => {
  console.log('=== TESTING INSTITUTIONAL ENDPOINTS ===\n');
  
  const testSymbol = 'AAPL';
  
  // Test the suggested endpoints
  const endpoints = [
    `/institutional-holder?symbol=${testSymbol}`,
    `/institutional-buy?symbol=${testSymbol}`,
    `/institutional-sell?symbol=${testSymbol}`,
    `/ownership?symbol=${testSymbol}`,
    `/institutional-ownership/symbol-ownership?symbol=${testSymbol}`,
    `/institutional-ownership/list?symbol=${testSymbol}`,
  ];
  
  for (const endpoint of endpoints) {
    console.log(`\nTesting: ${endpoint}`);
    const url = `https://financialmodelingprep.com/stable${endpoint}&apikey=${FMP_KEY}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        console.log(`  ✓ Array with ${data.length} items`);
        if (data.length > 0) {
          console.log('  Keys:', Object.keys(data[0]).join(', '));
          console.log('  Sample:', JSON.stringify(data[0]).slice(0, 400));
        }
      } else if (data.error || data['Error Message']) {
        console.log(`  ✗ Error:`, data.error || data['Error Message']);
      } else {
        console.log('  ✓ Object:', JSON.stringify(data).slice(0, 400));
      }
    } catch (e) {
      console.log(`  ✗ Failed:`, e.message);
    }
  }
  
  // Also try smaller cap stock in case AAPL has too much data
  console.log('\n\n=== TESTING WITH SMALLER STOCK (HIMS) ===\n');
  const smallSymbol = 'HIMS';
  
  for (const endpoint of [
    `/institutional-holder?symbol=${smallSymbol}`,
    `/institutional-buy?symbol=${smallSymbol}`,
    `/institutional-sell?symbol=${smallSymbol}`,
  ]) {
    console.log(`\nTesting: ${endpoint}`);
    const url = `https://financialmodelingprep.com/stable${endpoint}&apikey=${FMP_KEY}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        console.log(`  ✓ Array with ${data.length} items`);
        if (data.length > 0) {
          console.log('  Keys:', Object.keys(data[0]).join(', '));
          console.log('  Sample:', JSON.stringify(data[0]).slice(0, 400));
        }
      } else {
        console.log('  Response:', JSON.stringify(data).slice(0, 200));
      }
    } catch (e) {
      console.log(`  ✗ Failed:`, e.message);
    }
  }
  
  console.log('\n=== DONE ===');
})();
