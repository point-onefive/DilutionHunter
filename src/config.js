/**
 * DilutionHunter Configuration
 * 
 * Central config for all settings, thresholds, and API behavior.
 * Toggle DRY_RUN to prevent external API calls during testing.
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// ENVIRONMENT FLAGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DRY_RUN Mode
 * - true: No external API calls (Twitter, optionally mock FMP)
 * - false: Live mode, real API calls
 */
export const DRY_RUN = process.env.DRY_RUN === 'false' ? false : true;

/**
 * MOCK_FMP Mode (only applies when DRY_RUN is true)
 * - true: Use cached/mock FMP data instead of real API
 * - false: Still call FMP even in DRY_RUN (for testing scanner with real data)
 */
export const MOCK_FMP = process.env.MOCK_FMP === 'true' ? true : false;

/**
 * Verbose logging for debugging
 */
export const VERBOSE = process.env.VERBOSE === 'true' ? true : false;

// ═══════════════════════════════════════════════════════════════════════════
// TEST TICKER LIST (Free Tier Mode)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Small list of tickers for development/testing on FMP free tier.
 * These are typical small-cap/microcap names that could see parabolic moves.
 * 
 * TO EXPAND: When upgrading FMP tier, switch getSymbols() to use
 * a screener or full universe endpoint instead of this list.
 */
export const TEST_TICKERS = [
  // Recent volatile small-caps (examples - update as needed)
  'TTOO', 'MULN', 'FFIE', 'SIDU', 'TOP', 
  'BFRG', 'CXAI', 'GFAI', 'PRSO', 'BIOL',
  'NLSP', 'KTTA', 'BTCS', 'WORX', 'DRUG',
  'ATNF', 'IMPP', 'TPET', 'CRDF', 'COHN',
  // Add more as you find interesting candidates
  'GNPX', 'NKLA', 'WKHS', 'GOEV', 'RIDE',
  'ATER', 'BBIG', 'PROG', 'SPRT', 'GREE',
  'APRN', 'BYND', 'PLTR', 'SOFI', 'LCID',
  'RIVN', 'LAZR', 'MVIS', 'SKLZ', 'CLOV'
];

// ═══════════════════════════════════════════════════════════════════════════
// FMP API SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

export const FMP_CONFIG = {
  baseUrl: 'https://financialmodelingprep.com',
  apiKey: process.env.FMP_API_KEY || '',
  
  // Rate limiting (free tier = 250/day, ~10/hour safe)
  maxCallsPerDay: 250,
  maxCallsPerRun: 100,  // Safety cap per scanner run
  delayBetweenCalls: 200, // ms between API calls to avoid rate limits
  
  // Timeouts
  requestTimeout: 10000, // 10 seconds
};

// ═══════════════════════════════════════════════════════════════════════════
// SCANNER THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════

export const SCANNER_THRESHOLDS = {
  // Minimum weekly gain % to consider (parabolic filter)
  minWeeklyGainPct: 200,
  
  // Alternative: minimum 5-day gain %
  min5DayGainPct: 150,
  
  // Volume fade threshold (today's volume vs yesterday's, as ratio)
  volumeFadeRatio: 0.7, // today < 70% of yesterday = volume fade
  
  // Minimum volume for consideration (filter out illiquid junk)
  minAvgVolume: 100000,
  
  // Cash/debt ratio threshold (lower = more dilution risk)
  cashDebtRatioThreshold: 0.5, // cash < 50% of debt = risky
  
  // Offering size relative to market cap (higher = more dilution)
  offeringSizeToMcapThreshold: 0.1, // offering > 10% of mcap = significant
  
  // Candle lookback for analysis
  candleLookbackDays: 30,
  
  // Minimum score to trigger a signal (0-1 scale)
  minScoreToTrigger: 0.6,
};

// ═══════════════════════════════════════════════════════════════════════════
// TWITTER / X SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

export const TWITTER_CONFIG = {
  // Daily caps to stay sane
  maxNewSignalsPerDay: 10,
  maxTweetsPerDay: 20, // includes follow-ups
  
  // Thread settings
  maxThreadLength: 4, // max tweets per thread
  
  // Credentials from env
  apiKey: process.env.TWITTER_API_KEY || '',
  apiSecret: process.env.TWITTER_API_SECRET || '',
  accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
  accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
};

// ═══════════════════════════════════════════════════════════════════════════
// OPENAI SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

export const OPENAI_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o-mini', // cost-effective for tweet generation
  maxTokens: 500,
  temperature: 0.7, // some creativity but not too wild
};

// ═══════════════════════════════════════════════════════════════════════════
// FILE PATHS
// ═══════════════════════════════════════════════════════════════════════════

export const DATA_PATHS = {
  activeSignals: './data/active_signals.json',
  performanceHistory: './data/performance_history.json',
  dailyLog: './data/daily_log.json', // tracks API usage, tweets sent, etc.
  mockData: './data/mock/', // folder for cached/mock FMP responses
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Log config on startup
// ═══════════════════════════════════════════════════════════════════════════

export function logConfig() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔫 DilutionHunter Configuration');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   DRY_RUN:     ${DRY_RUN ? '✅ ON (no external side effects)' : '🔴 OFF (LIVE MODE)'}`);
  console.log(`   MOCK_FMP:    ${MOCK_FMP ? '✅ ON (using cached data)' : '❌ OFF (real FMP calls)'}`);
  console.log(`   VERBOSE:     ${VERBOSE ? '✅ ON' : '❌ OFF'}`);
  console.log(`   Test Tickers: ${TEST_TICKERS.length} symbols`);
  console.log(`   FMP API Key: ${FMP_CONFIG.apiKey ? '✅ Set' : '❌ Missing'}`);
  console.log(`   Twitter Key: ${TWITTER_CONFIG.apiKey ? '✅ Set' : '❌ Missing'}`);
  console.log(`   OpenAI Key:  ${OPENAI_CONFIG.apiKey ? '✅ Set' : '❌ Missing'}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}
