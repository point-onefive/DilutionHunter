/**
 * DAILY SELECTOR - Pick the best tickers to post each day
 * 
 * Priority:
 *   1. ACTIONABLE (time-sensitive, highest value)
 *   2. WATCH_LIST (building anticipation)
 *   3. CASE_STUDY (educational, evergreen)
 * 
 * Sorting within buckets:
 *   - Fresher ATM filings first (prioritize recent filings)
 *   - Then by peak gain (most dramatic price action)
 * 
 * Rules:
 *   - Max 2 posts per day
 *   - Post 1: Highest priority bucket available
 *   - Post 2: Next bucket down (if different from Post 1)
 *   - Skip if quality = POOR
 *   - Skip if already tweeted
 * 
 * Caching:
 *   - Caches enriched candidates for 1 hour to avoid repeated FMP calls
 *   - Use --no-cache to force fresh data
 * 
 * Usage:
 *   node src/dailySelector.js              # Show today's picks (uses cache)
 *   node src/dailySelector.js --no-cache   # Force fresh data
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyTicker, shouldTweet, loadHistory } from './contentManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', 'data', 'candidates_cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const SEC_USER_AGENT = 'DilutionHunter/1.0 (dilutionhunter@proton.me)';

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age > CACHE_TTL_MS) {
      console.log(`   Cache expired (${Math.round(age / 60000)} min old)`);
      return null;
    }
    console.log(`   Using cached data (${Math.round(age / 60000)} min old, ${data.candidates.length} tickers)`);
    return data.candidates;
  } catch {
    return null;
  }
}

function saveCache(candidates) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      timestamp: new Date().toISOString(),
      candidates
    }, null, 2));
  } catch (err) {
    console.warn(`   Warning: Could not save cache: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEC EDGAR - Fetch ATM filings
// ═══════════════════════════════════════════════════════════════════════════════

async function searchSECFilings(query, forms, startDate, endDate, limit = 100) {
  const url = new URL('https://efts.sec.gov/LATEST/search-index');
  url.searchParams.set('q', query);
  url.searchParams.set('dateRange', 'custom');
  url.searchParams.set('startdt', startDate);
  url.searchParams.set('enddt', endDate);
  url.searchParams.set('forms', forms);
  url.searchParams.set('size', limit.toString());

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': SEC_USER_AGENT }
  });

  if (!res.ok) throw new Error(`SEC API error: ${res.status}`);
  const data = await res.json();
  return data.hits?.hits || [];
}

function extractTicker(displayName) {
  const match = displayName?.match(/\(([A-Z]{1,5})/);
  return match ? match[1] : null;
}

async function getRecentATMFilings(days = 30) {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const filings = await searchSECFilings(
    '"at-the-market" OR "ATM offering" OR "equity distribution agreement"',
    '424B5',
    startDate,
    endDate,
    200
  );

  const tickerMap = new Map();
  
  for (const filing of filings) {
    const source = filing._source;
    const ticker = extractTicker(source.display_names?.[0]);
    if (!ticker) continue;

    const existing = tickerMap.get(ticker);
    if (!existing || source.file_date > existing.fileDate) {
      tickerMap.set(ticker, {
        ticker,
        companyName: source.display_names?.[0]?.split('  (')[0] || ticker,
        fileDate: source.file_date,
        form: source.form,
        cik: source.ciks?.[0]
      });
    }
  }

  return Array.from(tickerMap.values());
}

// ═══════════════════════════════════════════════════════════════════════════════
// FMP - Fetch price data
// ═══════════════════════════════════════════════════════════════════════════════

async function getQuote(symbol) {
  const url = `${FMP_BASE}/quote?symbol=${symbol}&apikey=${FMP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

async function getDailyCandles(symbol, days = 7) {
  const url = `${FMP_BASE}/historical-price-eod/full?symbol=${symbol}&apikey=${FMP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  
  if (!Array.isArray(data) || data.length < 2) return null;
  
  const candles = data.slice(0, days + 5).reverse();
  const window = candles.slice(-days);
  if (window.length < 2) return null;
  
  const startPrice = window[0].open;
  const currentPrice = window[window.length - 1].close;
  const peakHigh = Math.max(...window.map(c => c.high));
  
  const peakGain = ((peakHigh - startPrice) / startPrice) * 100;
  const currentGain = ((currentPrice - startPrice) / startPrice) * 100;
  const pullback = peakGain - currentGain;
  
  const peakDayIdx = window.findIndex(c => c.high === peakHigh);
  const peakDay = peakDayIdx + 1;
  
  // Same-day spike detection
  const peakCandle = window[peakDayIdx];
  const peakIntraday = ((peakCandle.high - peakCandle.open) / peakCandle.open) * 100;
  const peakCandleBody = ((peakCandle.close - peakCandle.open) / peakCandle.open) * 100;
  const isSameDaySpikeCrash = peakIntraday > 50 && peakCandleBody < peakIntraday * 0.3;
  
  // Ramp days
  let rampDays = 0;
  for (let i = peakDayIdx - 1; i >= 0; i--) {
    if (window[i].close > window[i].open) rampDays++;
    else break;
  }
  
  return {
    peakGain,
    currentGain,
    pullback,
    peakDay,
    isSameDaySpikeCrash,
    rampDays,
    candles: window
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY SELECTION LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

async function getAllCandidates(days = 30, options = {}) {
  const { noCache = false } = options;
  
  // Check cache first (unless --no-cache)
  if (!noCache) {
    const cached = loadCache();
    if (cached) {
      // Re-run classification in case tweet history changed
      return cached.map(c => ({
        ...c,
        classification: classifyTicker(c),
        tweetDecision: shouldTweet(c, classifyTicker(c))
      }));
    }
  }
  
  console.log(`\n📡 Fetching ATM filings (last ${days} days)...`);
  const filings = await getRecentATMFilings(days);
  console.log(`   Found ${filings.length} unique tickers\n`);
  
  console.log(`📊 Enriching with price data (${filings.length} API calls)...`);
  const candidates = [];
  let apiCalls = 0;
  
  for (const filing of filings) {
    try {
      const [quote, candles] = await Promise.all([
        getQuote(filing.ticker),
        getDailyCandles(filing.ticker, 7)
      ]);
      apiCalls += 2;
      
      if (!quote || !candles) continue;
      
      const enriched = {
        ...filing,
        price: quote.price,
        marketCap: quote.marketCap,
        ...candles,
        daysSinceFiling: Math.floor((Date.now() - new Date(filing.fileDate).getTime()) / (24 * 60 * 60 * 1000))
      };
      
      // Classify
      const classification = classifyTicker(enriched);
      const tweetDecision = shouldTweet(enriched, classification);
      
      candidates.push({
        ...enriched,
        classification,
        tweetDecision
      });
      
      await new Promise(r => setTimeout(r, 100)); // Rate limit
    } catch (err) {
      // Skip failed
    }
  }
  
  console.log(`   ✓ ${apiCalls} FMP API calls made`);
  
  // Save to cache
  saveCache(candidates);
  console.log(`   ✓ Cached ${candidates.length} candidates (valid for 1 hour)`);
  
  return candidates;
}

function selectDailyPosts(candidates, maxPosts = 2) {
  // Filter to tweetable, good quality only
  const tweetable = candidates.filter(c => 
    c.tweetDecision.shouldTweet && 
    c.classification.quality === 'GOOD'
  );
  
  // Group by bucket
  const byBucket = {
    ACTIONABLE: tweetable.filter(c => c.classification.bucket === 'ACTIONABLE'),
    WATCH_LIST: tweetable.filter(c => c.classification.bucket === 'WATCH_LIST'),
    CASE_STUDY: tweetable.filter(c => c.classification.bucket === 'CASE_STUDY')
  };
  
  // Sort each bucket by: 
  // 1. Fresher filing dates first (daysSinceFiling ascending)
  // 2. Then by peak gain (most dramatic)
  Object.values(byBucket).forEach(arr => 
    arr.sort((a, b) => {
      // Prioritize fresher filings (lower daysSinceFiling = better)
      const freshnessDiff = a.daysSinceFiling - b.daysSinceFiling;
      if (Math.abs(freshnessDiff) > 7) {
        // If >7 days apart, prioritize the fresher one
        return freshnessDiff;
      }
      // Within 7 days, sort by peak gain
      return b.peakGain - a.peakGain;
    })
  );
  
  const selected = [];
  
  // Post 1: Highest priority available
  if (byBucket.ACTIONABLE.length > 0) {
    selected.push({ ...byBucket.ACTIONABLE[0], postNumber: 1 });
  } else if (byBucket.WATCH_LIST.length > 0) {
    selected.push({ ...byBucket.WATCH_LIST[0], postNumber: 1 });
  } else if (byBucket.CASE_STUDY.length > 0) {
    selected.push({ ...byBucket.CASE_STUDY[0], postNumber: 1 });
  }
  
  if (selected.length === 0 || maxPosts === 1) {
    return selected;
  }
  
  // Post 2: Next bucket down (different from Post 1)
  const post1Bucket = selected[0].classification.bucket;
  
  if (post1Bucket === 'ACTIONABLE') {
    // Add WATCH_LIST or CASE_STUDY
    if (byBucket.WATCH_LIST.length > 0) {
      selected.push({ ...byBucket.WATCH_LIST[0], postNumber: 2 });
    } else if (byBucket.CASE_STUDY.length > 0) {
      selected.push({ ...byBucket.CASE_STUDY[0], postNumber: 2 });
    }
  } else if (post1Bucket === 'WATCH_LIST') {
    // Add CASE_STUDY
    if (byBucket.CASE_STUDY.length > 0) {
      selected.push({ ...byBucket.CASE_STUDY[0], postNumber: 2 });
    }
  }
  // If Post 1 was CASE_STUDY, no Post 2 (nothing more urgent)
  
  return selected;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════

function displayResults(candidates, selected) {
  // Summary by bucket
  const byBucket = {
    ACTIONABLE: candidates.filter(c => c.classification.bucket === 'ACTIONABLE'),
    WATCH_LIST: candidates.filter(c => c.classification.bucket === 'WATCH_LIST'),
    CASE_STUDY: candidates.filter(c => c.classification.bucket === 'CASE_STUDY')
  };
  
  const tweetable = {
    ACTIONABLE: byBucket.ACTIONABLE.filter(c => c.tweetDecision.shouldTweet && c.classification.quality === 'GOOD'),
    WATCH_LIST: byBucket.WATCH_LIST.filter(c => c.tweetDecision.shouldTweet && c.classification.quality === 'GOOD'),
    CASE_STUDY: byBucket.CASE_STUDY.filter(c => c.tweetDecision.shouldTweet && c.classification.quality === 'GOOD')
  };
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  DAILY POST SELECTOR - ${new Date().toISOString().split('T')[0]}                                   ║
╚═══════════════════════════════════════════════════════════════════════════════╝

📊 CANDIDATE SUMMARY
${'─'.repeat(60)}
🎯 ACTIONABLE:  ${byBucket.ACTIONABLE.length} total, ${tweetable.ACTIONABLE.length} tweetable
👀 WATCH_LIST:  ${byBucket.WATCH_LIST.length} total, ${tweetable.WATCH_LIST.length} tweetable
📚 CASE_STUDY:  ${byBucket.CASE_STUDY.length} total, ${tweetable.CASE_STUDY.length} tweetable
${'─'.repeat(60)}
`);

  if (selected.length === 0) {
    console.log(`⚠️  NO POSTS TODAY - No quality candidates available\n`);
    return;
  }
  
  console.log(`✅ TODAY'S POSTS (${selected.length})
${'═'.repeat(60)}
`);
  
  for (const post of selected) {
    console.log(`📱 POST ${post.postNumber}: ${post.classification.emoji} ${post.classification.bucket}
${'─'.repeat(60)}
   Ticker:    $${post.ticker}
   Company:   ${post.companyName}
   Price:     $${post.price.toFixed(2)}
   Peak:      +${post.peakGain.toFixed(0)}%
   Current:   ${post.currentGain >= 0 ? '+' : ''}${post.currentGain.toFixed(0)}%
   Quality:   ${post.classification.quality}
   Reason:    ${post.classification.reason}
`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const generate = args.includes('--generate');
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  DILUTIONHUNTER DAILY SELECTOR                                                ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Get all candidates
  const candidates = await getAllCandidates(30);
  console.log(`   Enriched ${candidates.length} tickers\n`);
  
  // Select today's posts
  const selected = selectDailyPosts(candidates, 2);
  
  // Display results
  displayResults(candidates, selected);
  
  // Generate content if requested
  if (generate && selected.length > 0) {
    console.log(`\n🔧 GENERATING CONTENT...`);
    console.log(`${'─'.repeat(60)}`);
    
    // Dynamic import to avoid circular deps
    const { runPipeline } = await import('./contentPipeline.js');
    
    for (const post of selected) {
      console.log(`\n📝 Generating for ${post.ticker}...`);
      try {
        await runPipeline(post.ticker, { force: false });
      } catch (err) {
        console.error(`   ❌ Failed: ${err.message}`);
      }
    }
  } else if (!generate && selected.length > 0) {
    console.log(`💡 Run with --generate to create content for these picks\n`);
  }
  
  return selected;
}

// Export for use in other modules
export { getAllCandidates, selectDailyPosts };

// Run if called directly
main().catch(console.error);
