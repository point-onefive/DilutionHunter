/**
 * FMP (Financial Modeling Prep) API Wrapper
 * 
 * Modular design for easy swap between:
 * - Test mode (small ticker list, conservative calls)
 * - Full mode (universe scan, screener endpoints)
 * - Mock mode (cached responses for development)
 */

import { 
  FMP_CONFIG, 
  TEST_TICKERS, 
  DRY_RUN, 
  MOCK_FMP, 
  VERBOSE,
  DATA_PATHS 
} from '../config.js';
import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// API CALL TRACKING (to stay within limits)
// ═══════════════════════════════════════════════════════════════════════════

let apiCallCount = 0;
const apiCallLog = [];

export function getApiCallCount() {
  return apiCallCount;
}

export function resetApiCallCount() {
  apiCallCount = 0;
  apiCallLog.length = 0;
}

function logApiCall(endpoint, ticker = null) {
  apiCallCount++;
  const entry = {
    timestamp: new Date().toISOString(),
    endpoint,
    ticker,
    callNumber: apiCallCount
  };
  apiCallLog.push(entry);
  
  if (VERBOSE) {
    console.log(`📡 FMP Call #${apiCallCount}: ${endpoint}${ticker ? ` (${ticker})` : ''}`);
  }
  
  // Safety check
  if (apiCallCount >= FMP_CONFIG.maxCallsPerRun) {
    console.warn(`⚠️  WARNING: Approaching max API calls per run (${FMP_CONFIG.maxCallsPerRun})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE FETCH HELPER
// ═══════════════════════════════════════════════════════════════════════════

async function fmpFetch(endpoint, params = {}) {
  // Check if we should use mock data
  if (DRY_RUN && MOCK_FMP) {
    return loadMockData(endpoint, params);
  }
  
  // Safety: check call limits
  if (apiCallCount >= FMP_CONFIG.maxCallsPerRun) {
    throw new Error(`API call limit reached (${FMP_CONFIG.maxCallsPerRun} per run). Aborting.`);
  }
  
  // Build URL
  const url = new URL(`${FMP_CONFIG.baseUrl}${endpoint}`);
  url.searchParams.set('apikey', FMP_CONFIG.apiKey);
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  
  // Rate limiting delay
  await sleep(FMP_CONFIG.delayBetweenCalls);
  
  logApiCall(endpoint, params.symbol || null);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FMP_CONFIG.requestTimeout);
    
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`FMP API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Cache response for future mock use (optional)
    if (VERBOSE) {
      saveMockData(endpoint, params, data);
    }
    
    return data;
    
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`FMP API timeout after ${FMP_CONFIG.requestTimeout}ms`);
    }
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function getMockFilePath(endpoint, params) {
  const safeName = endpoint.replace(/\//g, '_').replace(/^_/, '');
  const paramStr = params.symbol || params.cik || 'default';
  return path.join(DATA_PATHS.mockData, `${safeName}_${paramStr}.json`);
}

function loadMockData(endpoint, params) {
  const filePath = getMockFilePath(endpoint, params);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (VERBOSE) console.log(`📦 Loaded mock data: ${filePath}`);
      return data;
    }
  } catch (e) {
    console.warn(`⚠️  Could not load mock data: ${filePath}`);
  }
  
  // Return empty array as fallback
  console.warn(`⚠️  No mock data for ${endpoint}, returning empty`);
  return [];
}

function saveMockData(endpoint, params, data) {
  const filePath = getMockFilePath(endpoint, params);
  const dir = path.dirname(filePath);
  
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    // Silent fail on mock save
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYMBOL UNIVERSE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get symbols to scan.
 * 
 * CURRENT: Returns TEST_TICKERS array (free tier mode)
 * FUTURE: Swap to getFullUniverse() or getScreenedSymbols() when upgrading
 */
export async function getSymbols() {
  // For now, use the test ticker list (no API call needed!)
  console.log(`📋 Using TEST_TICKERS list (${TEST_TICKERS.length} symbols)`);
  return TEST_TICKERS;
}

/**
 * FUTURE: Get full US stock universe
 * Requires paid FMP tier - uses ~1 API call
 */
export async function getFullUniverse() {
  console.log('🌍 Fetching full US stock universe...');
  
  // NEW: Using /stable/ endpoint format
  const stocks = await fmpFetch('/stable/stock-list');
  
  // Filter to US exchanges only
  const usStocks = stocks.filter(s => 
    ['NYSE', 'NASDAQ', 'AMEX'].includes(s.exchangeShortName) &&
    s.type === 'stock'
  );
  
  console.log(`   Found ${usStocks.length} US stocks`);
  return usStocks.map(s => s.symbol);
}

/**
 * FUTURE: Get stocks using FMP screener
 * More efficient - pre-filters on FMP's side
 */
export async function getScreenedSymbols(params = {}) {
  console.log('🔍 Using FMP screener...');
  
  const defaults = {
    marketCapMoreThan: 1000000,      // > $1M market cap
    marketCapLowerThan: 2000000000,  // < $2B (small/micro cap focus)
    volumeMoreThan: 100000,          // minimum liquidity
    exchange: 'NYSE,NASDAQ,AMEX',
    isActivelyTrading: true
  };
  
  const screenerParams = { ...defaults, ...params };
  // NEW: Using /stable/ endpoint format
  const results = await fmpFetch('/stable/company-screener', screenerParams);
  
  console.log(`   Screener returned ${results.length} symbols`);
  return results.map(s => s.symbol);
}

// ═══════════════════════════════════════════════════════════════════════════
// PRICE / OHLCV DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get historical daily OHLCV candles
 * @param {string} symbol - Ticker symbol
 * @param {number} days - Number of days of history (default 30)
 */
export async function getOHLCV(symbol, days = 30) {
  // NEW: Using /stable/ endpoint format
  const data = await fmpFetch(`/stable/historical-price-eod/full`, {
    symbol
  });
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.warn(`⚠️  No OHLCV data for ${symbol}`);
    return [];
  }
  
  // Stable API returns array directly, newest first - take only what we need and reverse
  const limited = data.slice(0, days);
  return limited.reverse().map(candle => ({
    date: candle.date,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    change: candle.change,
    changePercent: candle.changePercent
  }));
}

/**
 * Get current quote (real-time or delayed)
 */
export async function getQuote(symbol) {
  // NEW: Using /stable/ endpoint format
  const data = await fmpFetch(`/stable/quote`, { symbol });
  return data?.[0] || null;
}

/**
 * Get batch quotes for multiple symbols (more efficient)
 * Max ~50 symbols per call recommended
 */
export async function getBatchQuotes(symbols) {
  if (symbols.length === 0) return [];
  
  // NEW: Using /stable/ endpoint format with comma-separated symbols
  const symbolString = symbols.join(',');
  const data = await fmpFetch(`/stable/batch-quote`, { symbols: symbolString });
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNDAMENTAL DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get key financial metrics (balance sheet summary)
 */
export async function getFinancials(symbol) {
  // NEW: Using /stable/ endpoint format
  const metrics = await fmpFetch(`/stable/key-metrics-ttm`, { symbol });
  const profile = await fmpFetch(`/stable/profile`, { symbol });
  
  const m = metrics?.[0] || {};
  const p = profile?.[0] || {};
  
  return {
    symbol,
    marketCap: p.mktCap || 0,
    price: p.price || 0,
    cash: m.cashPerShareTTM * (p.sharesOutstanding || 0) || 0, // estimate
    totalDebt: m.debtToEquityTTM * (m.bookValuePerShareTTM * (p.sharesOutstanding || 0)) || 0,
    cashPerShare: m.cashPerShareTTM || 0,
    debtToEquity: m.debtToEquityTTM || 0,
    currentRatio: m.currentRatioTTM || 0,
    freeCashFlow: m.freeCashFlowPerShareTTM * (p.sharesOutstanding || 0) || 0,
    revenuePerShare: m.revenuePerShareTTM || 0,
    sharesOutstanding: p.sharesOutstanding || 0,
    sector: p.sector || '',
    industry: p.industry || ''
  };
}

/**
 * Get balance sheet data (more detailed)
 */
export async function getBalanceSheet(symbol, period = 'quarter', limit = 4) {
  // NEW: Using /stable/ endpoint format
  const data = await fmpFetch(`/stable/balance-sheet-statement`, {
    symbol,
    period,
    limit
  });
  return data || [];
}

/**
 * Get cash flow statement
 */
export async function getCashFlow(symbol, period = 'quarter', limit = 4) {
  // NEW: Using /stable/ endpoint format
  const data = await fmpFetch(`/stable/cash-flow-statement`, {
    symbol,
    period,
    limit
  });
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUITY OFFERINGS / SEC DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search for equity offerings by symbol
 * Note: FMP's offering data can be limited on free tier
 */
export async function getOfferings(symbol) {
  try {
    // NEW: Using /stable/ endpoint format for SEC filings
    const filings = await fmpFetch(`/stable/sec-filings-search/symbol`, {
      symbol,
      limit: 10
    });
    
    // Parse for offering-related filings
    const offerings = (filings || []).filter(f => 
      f.type?.includes('S-') || 
      f.type?.includes('424') ||
      f.description?.toLowerCase().includes('offering') ||
      f.description?.toLowerCase().includes('prospectus')
    );
    
    return {
      hasOfferings: offerings.length > 0,
      recentFilings: offerings,
      count: offerings.length
    };
    
  } catch (e) {
    console.warn(`⚠️  Could not fetch offerings for ${symbol}: ${e.message}`);
    return { hasOfferings: false, recentFilings: [], count: 0 };
  }
}

/**
 * Get offerings by CIK (SEC identifier)
 */
export async function getOfferingsByCIK(cik) {
  try {
    // NEW: Using /stable/ endpoint format
    const data = await fmpFetch(`/stable/fundraising`, {
      cik
    });
    return data || [];
  } catch (e) {
    console.warn(`⚠️  Could not fetch offerings by CIK ${cik}: ${e.message}`);
    return [];
  }
}

/**
 * Search for recent equity offering announcements
 * FUTURE: This may need a paid tier
 */
export async function searchRecentOfferings(limit = 50) {
  try {
    // NEW: Using /stable/ endpoint format
    const data = await fmpFetch('/stable/fundraising-latest', { limit });
    return data || [];
  } catch (e) {
    console.warn(`⚠️  Could not fetch recent offerings: ${e.message}`);
    return [];
  }
}

/**
 * Search for equity offerings by company name
 * Returns list of matching companies with CIKs and dates
 */
export async function searchOfferingsByName(companyName) {
  try {
    const data = await fmpFetch('/stable/fundraising-search', { name: companyName });
    return data || [];
  } catch (e) {
    console.warn(`⚠️  Could not search offerings for ${companyName}: ${e.message}`);
    return [];
  }
}

/**
 * Get full offering details by CIK
 * Returns complete offering data including amounts
 */
export async function getOfferingDetailsByCIK(cik) {
  try {
    const data = await fmpFetch('/stable/fundraising', { cik });
    return data || [];
  } catch (e) {
    console.warn(`⚠️  Could not fetch offering details for CIK ${cik}: ${e.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOAT & SHARES DATA (CRITICAL FOR DILUTION IMPACT)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get shares float data - critical for dilution sensitivity
 * Returns floatShares, outstandingShares, freeFloat percentage
 */
export async function getSharesFloat(symbol) {
  try {
    const data = await fmpFetch('/stable/shares-float', { symbol });
    const d = data?.[0] || null;
    
    if (!d) {
      console.warn(`⚠️  No float data for ${symbol}`);
      return null;
    }
    
    return {
      symbol: d.symbol,
      floatShares: d.floatShares,
      outstandingShares: d.outstandingShares,
      freeFloat: d.freeFloat, // percentage
      floatRatio: d.floatShares / d.outstandingShares, // 0-1
      source: d.source,
      date: d.date
    };
  } catch (e) {
    console.warn(`⚠️  Could not fetch float data for ${symbol}: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CASH RUNWAY CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate cash runway in months
 * Uses balance sheet cash and cash flow burn rate
 */
export async function getCashRunway(symbol) {
  try {
    // Get latest balance sheet for cash position
    const balanceSheet = await getBalanceSheet(symbol, 'quarter', 1);
    const cashFlow = await getCashFlow(symbol, 'quarter', 2);
    
    if (!balanceSheet?.[0] || !cashFlow?.[0]) {
      return null;
    }
    
    const bs = balanceSheet[0];
    const cf = cashFlow[0];
    
    // Cash position
    const cashOnHand = bs.cashAndCashEquivalents || bs.cashAndShortTermInvestments || 0;
    
    // Operating cash flow (negative = burning cash)
    const operatingCashFlow = cf.operatingCashFlow || 0;
    
    // If operating cash flow is positive, they're not burning - infinite runway
    if (operatingCashFlow >= 0) {
      return {
        symbol,
        cashOnHand,
        quarterlyBurn: 0,
        monthlyBurn: 0,
        runwayMonths: Infinity,
        status: 'PROFITABLE',
        operatingCashFlow
      };
    }
    
    // Calculate burn rate and runway
    const quarterlyBurn = Math.abs(operatingCashFlow);
    const monthlyBurn = quarterlyBurn / 3;
    const runwayMonths = cashOnHand / monthlyBurn;
    
    // Determine status
    let status = 'SAFE';
    if (runwayMonths < 2) status = 'CRITICAL';
    else if (runwayMonths < 3) status = 'DANGER';
    else if (runwayMonths < 6) status = 'WARNING';
    
    return {
      symbol,
      cashOnHand,
      quarterlyBurn,
      monthlyBurn,
      runwayMonths,
      status,
      operatingCashFlow
    };
  } catch (e) {
    console.warn(`⚠️  Could not calculate runway for ${symbol}: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE DILUTION ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get complete dilution analysis package for a symbol
 * Combines all relevant data in one call for efficiency
 */
export async function getDilutionAnalysis(symbol) {
  try {
    // Parallel fetch for efficiency (but still counts as separate API calls)
    const [quote, profile, sharesFloat] = await Promise.all([
      getQuote(symbol),
      fmpFetch('/stable/profile', { symbol }).then(d => d?.[0] || null),
      getSharesFloat(symbol)
    ]);
    
    if (!quote || !profile) {
      return null;
    }
    
    // Get company CIK for offering lookup
    const cik = profile.cik;
    
    // Search for offerings if we have CIK
    let offerings = [];
    if (cik) {
      offerings = await getOfferingDetailsByCIK(cik);
    }
    
    // Get recent offerings (last 2 years)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    
    const recentOfferings = offerings.filter(o => {
      const offeringDate = new Date(o.date);
      return offeringDate >= twoYearsAgo;
    });
    
    // Calculate offering impact
    let offeringImpact = {
      hasRecentOfferings: recentOfferings.length > 0,
      count: recentOfferings.length,
      totalAmount: 0,
      totalRemaining: 0,
      impactRatio: 0,
      mostRecent: null
    };
    
    if (recentOfferings.length > 0) {
      // Sum up offering amounts
      offeringImpact.totalAmount = recentOfferings.reduce((sum, o) => 
        sum + (o.totalOfferingAmount || 0), 0);
      offeringImpact.totalRemaining = recentOfferings.reduce((sum, o) => 
        sum + (o.totalAmountRemaining || 0), 0);
      
      // Calculate impact ratio vs market cap
      if (quote.marketCap > 0) {
        offeringImpact.impactRatio = offeringImpact.totalRemaining / quote.marketCap;
      }
      
      // Most recent offering
      offeringImpact.mostRecent = recentOfferings[0];
    }
    
    return {
      symbol,
      price: quote.price,
      marketCap: quote.marketCap,
      volume: quote.volume,
      avgVolume: quote.avgVolume,
      cik,
      companyName: profile.companyName,
      
      // Float data
      float: sharesFloat,
      floatRatio: sharesFloat?.floatRatio || null,
      
      // Offering data
      offerings: offeringImpact
    };
  } catch (e) {
    console.warn(`⚠️  Dilution analysis failed for ${symbol}: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STOCK GAINERS / MOVERS (efficient pre-filtering)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get biggest gainers today
 * Useful for finding parabolic movers efficiently
 */
export async function getGainers() {
  // NEW: Using /stable/ endpoint format
  const data = await fmpFetch('/stable/biggest-gainers');
  return data || [];
}

/**
 * Get biggest losers today
 */
export async function getLosers() {
  // NEW: Using /stable/ endpoint format
  const data = await fmpFetch('/stable/biggest-losers');
  return data || [];
}

/**
 * Get most active by volume
 */
export async function getMostActive() {
  // NEW: Using /stable/ endpoint format
  const data = await fmpFetch('/stable/most-actives');
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // Universe
  getSymbols,
  getFullUniverse,
  getScreenedSymbols,
  
  // Price data
  getOHLCV,
  getQuote,
  getBatchQuotes,
  
  // Fundamentals
  getFinancials,
  getBalanceSheet,
  getCashFlow,
  
  // Float & Shares
  getSharesFloat,
  getCashRunway,
  
  // Offerings
  getOfferings,
  getOfferingsByCIK,
  searchRecentOfferings,
  searchOfferingsByName,
  getOfferingDetailsByCIK,
  getDilutionAnalysis,
  
  // Movers
  getGainers,
  getLosers,
  getMostActive,
  
  // Tracking
  getApiCallCount,
  resetApiCallCount
};
