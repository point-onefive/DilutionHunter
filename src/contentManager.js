/**
 * CONTENT MANAGER - Track and classify ATM candidates for Twitter content
 * 
 * Three Buckets:
 *   📚 CASE_STUDY   - Already crashed, educational post-mortem
 *   👀 WATCH_LIST   - Developing, pending additional signals  
 *   🎯 ACTIONABLE   - Meets all criteria NOW, real-time tip
 * 
 * Tracking Rules:
 *   - Case Studies: Tweet once, don't repeat
 *   - Watch List: Can be promoted to Actionable (re-tweet if upgraded)
 *   - Actionable: Can become Case Study (follow-up showing outcome)
 * 
 * Usage:
 *   node src/contentManager.js                 # Classify today's candidates
 *   node src/contentManager.js --history       # Show tweet history
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'tweet_history.json');

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFICATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify a ticker into one of three content buckets
 * @param {Object} ticker - Enriched ticker data from atmScanner
 * @returns {Object} - { bucket, reason, tweetable, quality }
 */
export function classifyTicker(ticker) {
  const { peakGain, currentGain, pullback, peakDay, isSameDaySpikeCrash, rampDays } = ticker;
  
  // Quality assessment for educational value
  // Ideal: multi-day ramp, visible peak day, then decline
  // Bad: same-day spike+crash (happens too fast to be educational)
  const hasVisibleRamp = rampDays >= 2 || !isSameDaySpikeCrash;
  const qualityScore = hasVisibleRamp ? 'GOOD' : 'POOR';
  const qualityNote = isSameDaySpikeCrash 
    ? '⚠️ Same-day spike+crash (spike and dump on one candle)' 
    : rampDays >= 2 
      ? `✓ ${rampDays}-day ramp visible` 
      : '✓ Normal pattern';
  
  // CASE STUDY: Already crashed (pullback > 50% from peak)
  // The opportunity passed, but great educational content
  if (pullback > 50) {
    return {
      bucket: 'CASE_STUDY',
      emoji: '📚',
      reason: `Peaked ${peakGain.toFixed(0)}%, now ${currentGain.toFixed(0)}% — crashed ${pullback.toFixed(0)}% from peak`,
      headline: `Case Study: ${ticker.ticker} crashed after ATM dilution`,
      angle: 'post_mortem',
      tweetable: hasVisibleRamp, // Skip if same-day spike (not educational)
      quality: qualityScore,
      qualityNote
    };
  }
  
  // ACTIONABLE: Meets ideal criteria
  // - 100%+ peak gain
  // - Peaked recently (day 5-7)
  // - Small pullback (5-30%) — just starting to roll
  // - Still elevated (current > 50%)
  if (
    peakGain >= 100 &&
    peakDay >= 5 &&
    pullback >= 5 && pullback <= 30 &&
    currentGain >= 50
  ) {
    return {
      bucket: 'ACTIONABLE',
      emoji: '🎯',
      reason: `Peak ${peakGain.toFixed(0)}% on day ${peakDay}, pullback ${pullback.toFixed(0)}%, still at ${currentGain.toFixed(0)}%`,
      headline: `Alert: ${ticker.ticker} showing dilution signals after ${peakGain.toFixed(0)}% run`,
      angle: 'live_alert',
      tweetable: true,
      quality: qualityScore,
      qualityNote
    };
  }
  
  // WATCH LIST: Developing situation, not yet ideal
  // Either: hasn't run enough, or hasn't started pulling back yet
  if (peakGain >= 50) {
    let reason;
    let angle;
    
    if (peakGain < 100) {
      reason = `Peak ${peakGain.toFixed(0)}% — needs bigger run for ideal setup`;
      angle = 'needs_more_momentum';
    } else if (pullback < 5) {
      reason = `Peak ${peakGain.toFixed(0)}%, but only ${pullback.toFixed(1)}% pullback — waiting for rollover`;
      angle = 'waiting_for_rollover';
    } else if (peakDay < 5) {
      reason = `Peaked on day ${peakDay} — may have more upside before rollover`;
      angle = 'may_run_more';
    } else if (currentGain < 50) {
      reason = `Peak ${peakGain.toFixed(0)}%, now ${currentGain.toFixed(0)}% — getting late but watching`;
      angle = 'getting_late';
    } else {
      reason = `Peak ${peakGain.toFixed(0)}%, current ${currentGain.toFixed(0)}% — monitoring`;
      angle = 'monitoring';
    }
    
    return {
      bucket: 'WATCH_LIST',
      emoji: '👀',
      reason,
      headline: `Watching: ${ticker.ticker} with ATM filing — ${peakGain.toFixed(0)}% peak`,
      angle,
      tweetable: true,
      quality: qualityScore,
      qualityNote
    };
  }
  
  // NOT INTERESTING: Didn't run enough
  return {
    bucket: 'SKIP',
    emoji: '⏭️',
    reason: `Only ${peakGain.toFixed(0)}% peak — not significant enough`,
    headline: null,
    angle: null,
    tweetable: false,
    quality: 'N/A',
    qualityNote: 'Insufficient price movement'
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWEET HISTORY TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

function ensureDataDir() {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadHistory() {
  ensureDataDir();
  if (!fs.existsSync(HISTORY_FILE)) {
    return { tweets: [], lastUpdated: null };
  }
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
}

export function saveHistory(history) {
  ensureDataDir();
  history.lastUpdated = new Date().toISOString();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Record a tweet in history
 */
export function recordTweet(ticker, bucket, notes = '') {
  const history = loadHistory();
  
  history.tweets.push({
    ticker: ticker.ticker,
    bucket,
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    peakGain: ticker.peakGain,
    currentGain: ticker.currentGain,
    pullback: ticker.pullback,
    filingDate: ticker.fileDate,
    notes
  });
  
  saveHistory(history);
  return history;
}

/**
 * Check if we should tweet about this ticker
 * @returns {Object} { shouldTweet, reason, previousTweets }
 */
export function shouldTweet(ticker, classification) {
  const history = loadHistory();
  const previousTweets = history.tweets.filter(t => t.ticker === ticker.ticker);
  
  // First check if classification says it's tweetable
  if (!classification.tweetable) {
    return { 
      shouldTweet: false, 
      reason: classification.quality === 'POOR' 
        ? `Poor quality pattern: ${classification.qualityNote}` 
        : 'Does not meet tweetable criteria',
      previousTweets 
    };
  }
  
  if (previousTweets.length === 0) {
    return { shouldTweet: true, reason: 'Never tweeted about this ticker', previousTweets };
  }
  
  const lastTweet = previousTweets[previousTweets.length - 1];
  
  // CASE STUDY: Only tweet once
  if (classification.bucket === 'CASE_STUDY') {
    const hadCaseStudy = previousTweets.some(t => t.bucket === 'CASE_STUDY');
    if (hadCaseStudy) {
      return { shouldTweet: false, reason: 'Already posted case study for this ticker', previousTweets };
    }
    // But if we previously had it as WATCH_LIST or ACTIONABLE, this is a follow-up!
    const wasActionable = previousTweets.some(t => t.bucket === 'ACTIONABLE');
    if (wasActionable) {
      return { 
        shouldTweet: true, 
        reason: '🔄 FOLLOW-UP: Previously alerted, now crashed — show outcome!', 
        previousTweets,
        isFollowUp: true
      };
    }
    return { shouldTweet: true, reason: 'First case study for this ticker', previousTweets };
  }
  
  // ACTIONABLE: Tweet if upgraded from WATCH_LIST
  if (classification.bucket === 'ACTIONABLE') {
    const wasWatchList = previousTweets.some(t => t.bucket === 'WATCH_LIST');
    const wasActionable = previousTweets.some(t => t.bucket === 'ACTIONABLE');
    
    if (wasActionable) {
      return { shouldTweet: false, reason: 'Already posted actionable alert for this ticker', previousTweets };
    }
    if (wasWatchList) {
      return { 
        shouldTweet: true, 
        reason: '⬆️ UPGRADE: Previously on watch list, now actionable!', 
        previousTweets,
        isUpgrade: true
      };
    }
    return { shouldTweet: true, reason: 'First actionable alert for this ticker', previousTweets };
  }
  
  // WATCH LIST: Only tweet once unless situation changed significantly
  if (classification.bucket === 'WATCH_LIST') {
    const hadWatchList = previousTweets.some(t => t.bucket === 'WATCH_LIST');
    if (hadWatchList) {
      return { shouldTweet: false, reason: 'Already on watch list', previousTweets };
    }
    return { shouldTweet: true, reason: 'Adding to watch list', previousTweets };
  }
  
  return { shouldTweet: false, reason: 'Does not meet criteria', previousTweets };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT GENERATION CONTEXT (for GPT prompt)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate context object for GPT tweet generation
 */
export function generateGPTContext(ticker, classification, tweetDecision) {
  return {
    // Ticker data
    ticker: ticker.ticker,
    companyName: ticker.companyName,
    price: ticker.price,
    marketCap: ticker.marketCap,
    
    // ATM filing info
    filingDate: ticker.fileDate,
    filingType: ticker.form,
    daysSinceFiling: ticker.daysSinceFiling,
    
    // Price action (7-day window)
    peakGain: ticker.peakGain,
    currentGain: ticker.currentGain,
    pullbackFromPeak: ticker.pullback,
    peakDay: ticker.peakDay,
    
    // Classification
    bucket: classification.bucket,
    bucketEmoji: classification.emoji,
    reason: classification.reason,
    headline: classification.headline,
    angle: classification.angle,
    
    // Tweet decision
    shouldTweet: tweetDecision.shouldTweet,
    tweetReason: tweetDecision.reason,
    isFollowUp: tweetDecision.isFollowUp || false,
    isUpgrade: tweetDecision.isUpgrade || false,
    previousTweets: tweetDecision.previousTweets,
    
    // Content guidelines per bucket
    contentGuidelines: getContentGuidelines(classification.bucket, tweetDecision)
  };
}

function getContentGuidelines(bucket, tweetDecision) {
  if (bucket === 'CASE_STUDY') {
    if (tweetDecision.isFollowUp) {
      return {
        tone: 'Educational, validating',
        goal: 'Show we called it correctly — build credibility',
        structure: 'Reference original alert → Show what happened → Key takeaway',
        cta: 'Follow for more real-time alerts'
      };
    }
    return {
      tone: 'Educational, analytical',
      goal: 'Teach the pattern — pump with ATM → inevitable dilution dump',
      structure: 'What happened → Why it happened (ATM) → What to watch for',
      cta: 'Learn to spot these before they crash'
    };
  }
  
  if (bucket === 'WATCH_LIST') {
    return {
      tone: 'Cautious, observational',
      goal: 'Highlight developing situation without making a call',
      structure: 'Ticker + ATM filing → Current price action → What would make it actionable',
      cta: 'Following this one closely'
    };
  }
  
  if (bucket === 'ACTIONABLE') {
    if (tweetDecision.isUpgrade) {
      return {
        tone: 'Urgent, confident',
        goal: 'Signal that previously watched ticker now meets criteria',
        structure: 'Reference previous mention → New signals → Current setup',
        cta: 'This is what we were waiting for'
      };
    }
    return {
      tone: 'Alert, data-driven',
      goal: 'Provide actionable intelligence on potential short setup',
      structure: 'Ticker + key stats → ATM evidence → Risk/reward assessment',
      cta: 'Do your own DD, but this fits the pattern'
    };
  }
  
  return {};
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--history')) {
    const history = loadHistory();
    console.log('\n📜 TWEET HISTORY\n');
    console.log(`Last updated: ${history.lastUpdated || 'Never'}\n`);
    
    if (history.tweets.length === 0) {
      console.log('No tweets recorded yet.\n');
      return;
    }
    
    // Group by bucket
    const byBucket = {};
    for (const tweet of history.tweets) {
      if (!byBucket[tweet.bucket]) byBucket[tweet.bucket] = [];
      byBucket[tweet.bucket].push(tweet);
    }
    
    for (const [bucket, tweets] of Object.entries(byBucket)) {
      const emoji = bucket === 'CASE_STUDY' ? '📚' : bucket === 'WATCH_LIST' ? '👀' : '🎯';
      console.log(`${emoji} ${bucket} (${tweets.length})`);
      console.log('─'.repeat(60));
      for (const t of tweets.slice(-10)) {
        console.log(`  ${t.date} | ${t.ticker.padEnd(6)} | Peak ${t.peakGain?.toFixed(0) || '?'}% → ${t.currentGain?.toFixed(0) || '?'}%`);
      }
      console.log();
    }
    return;
  }
  
  // Demo: classify some sample data
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  CONTENT MANAGER - Classification Demo                            ║
╚═══════════════════════════════════════════════════════════════════╝
`);

  // Sample tickers (normally these come from atmScanner)
  const samples = [
    { ticker: 'INHD', companyName: 'INNO Holdings', peakGain: 399.5, currentGain: -67.4, pullback: 466.8, peakDay: 5, fileDate: '2025-11-13', price: 0.23, marketCap: 1700000 },
    { ticker: 'MNDR', companyName: 'Mobile-health Network', peakGain: 215.1, currentGain: 54.1, pullback: 161.0, peakDay: 4, fileDate: '2025-11-24', price: 2.65, marketCap: 2300000 },
    { ticker: 'ANVS', companyName: 'Annovis Bio', peakGain: 76.2, currentGain: 65.1, pullback: 11.1, peakDay: 7, fileDate: '2025-10-28', price: 4.92, marketCap: 96800000 },
    { ticker: 'GPUS', companyName: 'Hyperscale Data', peakGain: 72.5, currentGain: 66.5, pullback: 6.0, peakDay: 7, fileDate: '2025-11-04', price: 0.33, marketCap: 36400000 },
  ];

  for (const ticker of samples) {
    const classification = classifyTicker(ticker);
    const decision = shouldTweet(ticker, classification);
    
    console.log(`${classification.emoji} ${ticker.ticker} → ${classification.bucket}`);
    console.log(`   ${classification.reason}`);
    console.log(`   Tweet: ${decision.shouldTweet ? '✅ YES' : '❌ NO'} — ${decision.reason}`);
    console.log();
  }
  
  console.log('Run with --history to see tweet history');
  console.log('Integration with atmScanner coming next...\n');
}

// Run if called directly
if (process.argv[1].includes('contentManager')) {
  main().catch(console.error);
}
