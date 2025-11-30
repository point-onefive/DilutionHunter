/**
 * FMP DATA FETCHER FOR BANKRUPTCY SCANNER
 * 
 * Fetches all required financial data for bankruptcy/insolvency analysis:
 * - Quote (price, market cap)
 * - Balance Sheet (cash, debt, assets)
 * - Cash Flow Statement (operating CF, burn rate)
 * - Income Statement (revenue, EBIT, interest expense)
 * - Key Metrics (Altman Z-score if available)
 * - Insider Trading activity
 * 
 * ~7-8 API calls per ticker
 */

import 'dotenv/config';

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';

async function fmpGet(endpoint) {
  const url = `${FMP_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_API_KEY}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FMP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`FMP fetch error for ${endpoint}:`, error.message);
    return null;
  }
}

/**
 * Fetch all bankruptcy-relevant data for a single ticker
 * Returns structured object with all financial inputs needed for scoring
 */
export async function fetchBankruptcyInputs(symbol) {
  console.log(`   📊 Fetching bankruptcy data for ${symbol}...`);
  
  // Parallel fetch all required data
  const [quote, balanceSheet, cashFlow, income, keyMetrics, insiders] = await Promise.all([
    fmpGet(`/profile?symbol=${symbol}`),
    fmpGet(`/balance-sheet-statement?symbol=${symbol}&period=quarter&limit=4`),
    fmpGet(`/cash-flow-statement?symbol=${symbol}&period=quarter&limit=4`),
    fmpGet(`/income-statement?symbol=${symbol}&period=quarter&limit=4`),
    fmpGet(`/key-metrics?symbol=${symbol}&period=quarter&limit=4`),
    fmpGet(`/insider-trading?symbol=${symbol}&limit=50`)
  ]);

  return {
    symbol,
    quote: Array.isArray(quote) ? quote[0] : quote,
    balanceSheet: balanceSheet || [],
    cashFlow: cashFlow || [],
    income: income || [],
    keyMetrics: keyMetrics || [],
    insiders: insiders || []
  };
}

/**
 * Fetch universe candidates from FMP screener
 * Pre-filter to small/mid caps with signs of distress
 */
export async function fetchUniverseCandidates(options = {}) {
  const {
    minMarketCap = 10_000_000,      // $10M minimum
    maxMarketCap = 5_000_000_000,   // $5B maximum
    minPrice = 0.50,                 // Above $0.50 (avoid pennies)
    maxPrice = 50,                   // Under $50
    limit = 500
  } = options;

  console.log('📡 Fetching universe candidates from FMP screener...');
  
  // Use stock screener to find small/mid caps
  const screenerUrl = `/stock-screener?marketCapMoreThan=${minMarketCap}&marketCapLowerThan=${maxMarketCap}&priceMoreThan=${minPrice}&priceLowerThan=${maxPrice}&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=${limit}`;
  
  const results = await fmpGet(screenerUrl);
  
  if (!results || !Array.isArray(results)) {
    console.error('Failed to fetch screener results');
    return [];
  }

  console.log(`   Found ${results.length} candidates from screener`);
  
  // Extract just the symbols
  return results.map(r => ({
    symbol: r.symbol,
    companyName: r.companyName,
    marketCap: r.marketCap,
    price: r.price,
    sector: r.sector,
    industry: r.industry
  }));
}

/**
 * Quick pre-filter check - uses minimal API calls to identify likely distressed companies
 * Returns true if ticker should be fully analyzed
 */
export async function preFilterCheck(symbol) {
  // Quick quote check - look for beaten down stocks
  const quote = await fmpGet(`/profile?symbol=${symbol}`);
  
  if (!quote || !Array.isArray(quote) || quote.length === 0) {
    return { pass: false, reason: 'No quote data' };
  }

  const q = quote[0];
  const marketCap = q.mktCap || 0;
  const price = q.price || 0;

  // Basic filters
  if (marketCap < 10_000_000) {
    return { pass: false, reason: 'Market cap too small' };
  }
  if (marketCap > 10_000_000_000) {
    return { pass: false, reason: 'Market cap too large' };
  }
  if (price < 0.50) {
    return { pass: false, reason: 'Price too low (penny stock)' };
  }

  return { pass: true, reason: 'Passed pre-filter', quote: q };
}

/**
 * Fetch virality inputs for a ticker (volume, news, options availability)
 * Used to calculate Viral Insolvency Score (VIS)
 */
export async function fetchViralityInputs(symbol) {
  console.log(`   📰 Fetching virality data for ${symbol}...`);
  
  // Fetch quote data (volume is in the quote)
  const quoteData = await fmpGet(`/quote?symbol=${symbol}`);
  const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;
  
  // Calculate average volume (use avgVolume if available, else use volume)
  const avgVolume = quote?.avgVolume || quote?.volume || 0;
  const marketCap = quote?.marketCap || 0;
  
  // News count - FMP news endpoint is limited in free tier
  // Try to fetch but gracefully handle failure
  let newsCount = 0;
  try {
    const newsData = await fmpGet(`/news/stock?symbols=${symbol}&limit=20`);
    if (Array.isArray(newsData)) {
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      newsCount = newsData.filter(n => {
        const publishedDate = new Date(n.publishedDate).getTime();
        return publishedDate > sevenDaysAgo;
      }).length;
    }
  } catch (e) {
    // News endpoint may not be available, continue without it
    newsCount = 0;
  }

  // Check if options exist (simple heuristic: actively traded stocks with decent market cap usually have options)
  // Stocks > $100M market cap and actively traded usually have options
  const hasOptions = marketCap > 100_000_000 && avgVolume > 100_000;

  return {
    symbol,
    avgVolume,
    marketCap,
    newsCount,
    hasOptions,
    recentNews: []  // Simplified - news is supplementary
  };
}

export default {
  fetchBankruptcyInputs,
  fetchUniverseCandidates,
  preFilterCheck,
  fetchViralityInputs
};
