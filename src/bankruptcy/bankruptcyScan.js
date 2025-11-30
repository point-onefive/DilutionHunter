/**
 * BANKRUPTCY SCANNER - Main Orchestration
 * 
 * Weekly scan for companies showing insolvency/distress risk.
 * 
 * Flow:
 * 1. Load universe (from JSON or refresh from screener)
 * 2. Fetch financial data for each ticker
 * 3. Score using bankruptcyScoreEngine
 * 4. Filter to INSOLVENCY_ALERT and DISTRESS_WATCHLIST
 * 5. Generate tweet threads for top alerts
 * 6. Post to Twitter (if not DRY_RUN)
 * 7. Save results to bankruptcy_signals.json
 * 
 * Anti-Duplication:
 * - Tracks posted tickers in bankruptcy_posted.json
 * - 30-day cooldown before re-posting same ticker (configurable via BANKRUPTCY_COOLDOWN_DAYS)
 * - Automatically skips to next ticker if top pick is on cooldown
 * - Use --force to bypass cooldown
 * 
 * Usage:
 *   node src/bankruptcy/bankruptcyScan.js                  # Scan universe, preview
 *   node src/bankruptcy/bankruptcyScan.js --post           # Scan + post top alert
 *   node src/bankruptcy/bankruptcyScan.js --ticker=MULN    # Scan single ticker
 *   node src/bankruptcy/bankruptcyScan.js --refresh        # Refresh universe first
 *   node src/bankruptcy/bankruptcyScan.js --status         # Show posting history & cooldowns
 *   node src/bankruptcy/bankruptcyScan.js --force --post   # Bypass VIS threshold & cooldown
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { fetchBankruptcyInputs, fetchUniverseCandidates, fetchViralityInputs } from './fmpBankruptcy.js';
import { scoreBankruptcyRisk, scoreWithVIS } from './bankruptcyScoreEngine.js';
import { generateBankruptcyThread, generateFallbackThread } from './bankruptcyThesis.js';
import { postAlertThread } from '../twitterPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const UNIVERSE_FILE = path.join(DATA_DIR, 'bankruptcy_universe.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'bankruptcy_signals.json');
const POSTED_FILE = path.join(DATA_DIR, 'bankruptcy_posted.json');

const DRY_RUN = process.env.DRY_RUN !== 'false';
const MAX_TICKERS_PER_RUN = parseInt(process.env.BANKRUPTCY_MAX_TICKERS || '50');
const COOLDOWN_DAYS = parseInt(process.env.BANKRUPTCY_COOLDOWN_DAYS || '30');  // Days before re-posting same ticker

// Bankruptcy thresholds (raw score)
const ALERT_THRESHOLD = 70;
const WATCH_THRESHOLD = 50;

// VIS thresholds (viral insolvency score)
const VIS_PRIME_ALERT = 75;   // Auto-post as ALERT
const VIS_WATCHLIST = 60;     // Auto-post as WATCHLIST
// Below 60 = STORE_ONLY

// ═══════════════════════════════════════════════════════════════════════════════
// FILE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadJson(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${filepath}:`, e.message);
  }
  return null;
}

function saveJson(filepath, data) {
  ensureDataDir();
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function loadPostedTickers() {
  const data = loadJson(POSTED_FILE);
  return data?.tickers || {};
}

function markAsPosted(symbol) {
  const data = loadJson(POSTED_FILE) || { tickers: {} };
  data.tickers[symbol] = new Date().toISOString().split('T')[0];
  saveJson(POSTED_FILE, data);
}

function isOnCooldown(symbol, posted) {
  const lastPosted = posted[symbol];
  if (!lastPosted) return false;
  
  const lastDate = new Date(lastPosted);
  const now = new Date();
  const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
  
  return daysSince < COOLDOWN_DAYS;
}

function getCooldownInfo(symbol, posted) {
  const lastPosted = posted[symbol];
  if (!lastPosted) return null;
  
  const lastDate = new Date(lastPosted);
  const now = new Date();
  const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
  const daysRemaining = COOLDOWN_DAYS - daysSince;
  
  return { lastPosted, daysSince, daysRemaining };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// Core distressed watchlist - always included
const CORE_DISTRESS_LIST = [
  'MULN', 'WKHS', 'GOEV', 'NKLA', 'LCID', 'RIVN', 'FFIE', 'FSR', 'LAZR', 'QS',
  'PLUG', 'FCEL', 'BLNK', 'CHPT', 'EVGO', 'RIDE', 'ARVL', 'PTRA', 'XL',
  'BYND', 'TTCF', 'OTLY', 'PRTY',
  'TLRY', 'CGC', 'ACB', 'SNDL', 'HEXO', 'GRWG',
  'BBBY', 'GME', 'AMC', 'CLOV', 'WISH', 'SOFI', 'OPEN', 'HOOD',
  'SPCE', 'RKLB', 'ASTR', 'RDW', 'ASTS',
  'UPST', 'AFRM', 'LMND', 'ROOT'
];

async function loadUniverse() {
  const data = loadJson(UNIVERSE_FILE);
  if (data?.symbols?.length) {
    console.log(`📂 Loaded ${data.symbols.length} tickers from cached universe`);
    return data.symbols;
  }
  
  // Fallback to core list
  console.log(`📂 Using core distress list (${CORE_DISTRESS_LIST.length} tickers)`);
  return CORE_DISTRESS_LIST;
}

async function refreshUniverse() {
  console.log('🔄 Refreshing universe from FMP market movers...\n');
  
  // Fetch fresh candidates from FMP (losers, actives, gainers)
  const freshCandidates = await fetchUniverseCandidates();
  const freshSymbols = freshCandidates.map(c => c.symbol);
  
  // Merge with core distress list (deduplicated)
  const allSymbols = [...new Set([...freshSymbols, ...CORE_DISTRESS_LIST])];
  
  console.log(`\n   📊 Fresh from FMP: ${freshSymbols.length}`);
  console.log(`   📋 Core list: ${CORE_DISTRESS_LIST.length}`);
  console.log(`   ✅ Total unique: ${allSymbols.length}\n`);

  const universeData = {
    refreshedAt: new Date().toISOString(),
    count: allSymbols.length,
    freshCount: freshSymbols.length,
    coreCount: CORE_DISTRESS_LIST.length,
    symbols: allSymbols,
    freshDetails: freshCandidates
  };

  saveJson(UNIVERSE_FILE, universeData);
  console.log(`💾 Saved combined universe to file`);
  
  return allSymbols;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

async function scanTicker(symbol) {
  try {
    // Fetch both financial and virality data
    const [financialInputs, viralityInputs] = await Promise.all([
      fetchBankruptcyInputs(symbol),
      fetchViralityInputs(symbol)
    ]);
    
    // Score with VIS (Viral Insolvency Score)
    const analysis = scoreWithVIS(financialInputs, viralityInputs);
    return analysis;
  } catch (error) {
    console.error(`   ❌ Error scanning ${symbol}: ${error.message}`);
    return null;
  }
}

export async function runBankruptcyScan(options = {}) {
  const {
    refresh = false,
    post = false,
    ticker = null,
    maxTickers = MAX_TICKERS_PER_RUN,
    force = false  // Force post even if VIS is below threshold
  } = options;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  BANKRUPTCY WATCHDOG SCANNER                                                  ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get universe
  let universe;
  if (ticker) {
    universe = [ticker.toUpperCase()];
    console.log(`🎯 Single ticker mode: ${ticker}`);
  } else if (refresh) {
    universe = await refreshUniverse();
  } else {
    universe = await loadUniverse();
  }

  if (!universe.length) {
    console.log('❌ No tickers to scan. Use --refresh to build universe.');
    return null;
  }

  // Limit tickers per run
  const toScan = universe.slice(0, maxTickers);
  console.log(`\n📊 Scanning ${toScan.length} tickers (max ${maxTickers})...\n`);

  // Step 2: Scan each ticker
  const results = [];
  for (let i = 0; i < toScan.length; i++) {
    const symbol = toScan[i];
    process.stdout.write(`   [${i + 1}/${toScan.length}] ${symbol}...`);
    
    const analysis = await scanTicker(symbol);
    
    if (analysis && analysis.classification !== 'INSUFFICIENT_DATA') {
      if (analysis.classification !== 'HEALTHY_IGNORE') {
        results.push(analysis);
        const visEmoji = analysis.vis >= VIS_PRIME_ALERT ? '🔥' : analysis.vis >= VIS_WATCHLIST ? '⚠️' : '📊';
        console.log(` ${visEmoji} VIS:${analysis.vis} | Risk:${analysis.score}/100 | Viral:${analysis.virality?.score}/100`);
      } else {
        console.log(` ✓ healthy (${analysis.score}/100)`);
      }
    } else {
      console.log(' skip (no data)');
    }

    // Rate limiting - delay between tickers to avoid 429
    await new Promise(r => setTimeout(r, 500));
  }

  // Step 3: Sort by VIS (Viral Insolvency Score) and classify
  results.sort((a, b) => b.vis - a.vis);
  
  const primeAlerts = results.filter(r => r.vis >= VIS_PRIME_ALERT);
  const watchlist = results.filter(r => r.vis >= VIS_WATCHLIST && r.vis < VIS_PRIME_ALERT);
  const storeOnly = results.filter(r => r.vis < VIS_WATCHLIST);

  // Step 4: Display results
  console.log(`
════════════════════════════════════════════════════════════════════════════════
📊 BANKRUPTCY SCAN RESULTS (Ranked by Viral Insolvency Score)
════════════════════════════════════════════════════════════════════════════════

🔥 PRIME ALERTS (VIS ≥ ${VIS_PRIME_ALERT}) — Auto-post: ${primeAlerts.length}
`);

  for (const a of primeAlerts) {
    console.log(`   $${a.symbol.padEnd(6)} VIS: ${a.vis} | Risk: ${a.score}/100 | Viral: ${a.virality.score}/100 | ${a.metrics.runwayFormatted} runway`);
    console.log(`           ${a.visSummary}`);
  }

  console.log(`
⚠️  WATCHLIST (VIS ${VIS_WATCHLIST}-${VIS_PRIME_ALERT - 1}) — Auto-post: ${watchlist.length}
`);

  for (const w of watchlist.slice(0, 10)) {
    console.log(`   $${w.symbol.padEnd(6)} VIS: ${w.vis} | Risk: ${w.score}/100 | Viral: ${w.virality.score}/100`);
  }
  if (watchlist.length > 10) {
    console.log(`   ... and ${watchlist.length - 10} more`);
  }

  console.log(`
📁 STORE ONLY (VIS < ${VIS_WATCHLIST}) — No auto-post: ${storeOnly.length}
`);

  // Step 5: Save results
  const signalsData = {
    scannedAt: new Date().toISOString(),
    totalScanned: toScan.length,
    primeAlerts: primeAlerts.map(a => ({
      symbol: a.symbol,
      vis: a.vis,
      score: a.score,
      viralityScore: a.virality.score,
      classification: a.classification,
      visClassification: a.visClassification,
      shouldPost: a.shouldPost,
      metrics: a.metrics,
      virality: a.virality,
      outcomes: a.outcomes,
      breakdown: a.breakdown
    })),
    watchlist: watchlist.map(w => ({
      symbol: w.symbol,
      vis: w.vis,
      score: w.score,
      viralityScore: w.virality.score,
      classification: w.classification,
      visClassification: w.visClassification,
      shouldPost: w.shouldPost,
      metrics: w.metrics,
      virality: w.virality,
      outcomes: w.outcomes
    })),
    storeOnly: storeOnly.map(s => ({
      symbol: s.symbol,
      vis: s.vis,
      score: s.score,
      viralityScore: s.virality?.score
    }))
  };
  saveJson(SIGNALS_FILE, signalsData);
  console.log(`\n📁 Saved results to ${SIGNALS_FILE}`);

  // Step 6: Generate and post thread for top VIS alert (with cooldown check)
  const allPostable = [...primeAlerts, ...watchlist].filter(r => r.shouldPost);
  
  // If force flag, allow posting any distressed ticker (even low VIS)
  const forcePostable = force ? results.filter(r => r.score >= WATCH_THRESHOLD) : [];
  const postsToProcess = allPostable.length > 0 ? allPostable : forcePostable;
  
  if (postsToProcess.length > 0 && post) {
    const posted = loadPostedTickers();
    
    // Filter out tickers on cooldown (unless --force)
    const skippedCooldown = [];
    let selectedAlert = null;
    
    for (const alert of postsToProcess) {
      if (!force && isOnCooldown(alert.symbol, posted)) {
        const info = getCooldownInfo(alert.symbol, posted);
        skippedCooldown.push({ symbol: alert.symbol, ...info });
      } else {
        selectedAlert = alert;
        break;  // Found one that's not on cooldown
      }
    }
    
    // Show what was skipped due to cooldown
    if (skippedCooldown.length > 0) {
      console.log(`\n⏭️  Skipped (on ${COOLDOWN_DAYS}-day cooldown):`);
      for (const skip of skippedCooldown) {
        console.log(`   $${skip.symbol} — posted ${skip.daysSince}d ago (${skip.daysRemaining}d remaining)`);
      }
    }
    
    if (!selectedAlert) {
      console.log(`\n📭 All postable tickers are on cooldown. Nothing to post.`);
    } else {
      if (force && selectedAlert.vis < VIS_WATCHLIST) {
        console.log(`\n⚠️  FORCE MODE: Posting despite low VIS (${selectedAlert.vis})`);
      }
      if (force && isOnCooldown(selectedAlert.symbol, posted)) {
        const info = getCooldownInfo(selectedAlert.symbol, posted);
        console.log(`\n⚠️  FORCE MODE: Bypassing cooldown (posted ${info.daysSince}d ago)`);
      }
      
      console.log(`\n🤖 Generating thread for $${selectedAlert.symbol}...`);
      console.log(`   VIS: ${selectedAlert.vis} (${selectedAlert.visClassification})`);
      console.log(`   Bankruptcy Risk: ${selectedAlert.score}/100 | Virality: ${selectedAlert.virality.score}/100`);
      
      let threadData = await generateBankruptcyThread(selectedAlert);
      if (!threadData) {
        console.log('   OpenAI failed, using fallback...');
        threadData = generateFallbackThread(selectedAlert);
      }

      console.log(`
════════════════════════════════════════════════════════════════════════════════
📝 BANKRUPTCY ${selectedAlert.visClassification} THREAD
════════════════════════════════════════════════════════════════════════════════
`);
      threadData.thread.forEach((tweet, i) => {
        console.log(tweet);
        console.log('---');
      });

      if (DRY_RUN) {
        console.log('\n[DRY_RUN] Would post thread. Set DRY_RUN=false to post.');
      } else {
        console.log('\n🚀 Posting to Twitter...');
        try {
          // Post as thread (alert tweet first, then rest)
          const result = await postAlertThread(
            threadData.thread[0],  // Alert tweet
            threadData.thread.slice(1),  // Rest of thread
            null  // No chart for now
          );
          console.log(`✅ Posted! First tweet ID: ${result.tweetIds?.[0]}`);
          markAsPosted(selectedAlert.symbol);
        } catch (error) {
          console.error(`❌ Post failed: ${error.message}`);
        }
      }
    }
  } else if (postsToProcess.length > 0 && !post) {
    console.log(`\n${postsToProcess.length} tickers qualify for posting. Use --post to generate and post thread.`);
  } else if (results.length > 0 && !post) {
    console.log(`\n${results.length} distressed tickers found but VIS below threshold. Use --force --post to override.`);
  } else {
    console.log('\n✅ No high-VIS alerts this scan. Nothing to post.');
  }

  return {
    scanned: toScan.length,
    primeAlerts,
    watchlist,
    storeOnly
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS COMMAND - Show what's been posted and cooldown status
// ═══════════════════════════════════════════════════════════════════════════════

function showPostingStatus() {
  const posted = loadPostedTickers();
  const symbols = Object.keys(posted);
  
  if (symbols.length === 0) {
    console.log('\n📭 No tickers have been posted yet.');
    return;
  }
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  BANKRUPTCY POSTING STATUS                                                    ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
  console.log(`Cooldown period: ${COOLDOWN_DAYS} days\n`);
  
  const onCooldown = [];
  const available = [];
  
  for (const symbol of symbols) {
    const info = getCooldownInfo(symbol, posted);
    if (isOnCooldown(symbol, posted)) {
      onCooldown.push({ symbol, ...info });
    } else {
      available.push({ symbol, ...info });
    }
  }
  
  if (onCooldown.length > 0) {
    console.log(`🔒 ON COOLDOWN (${onCooldown.length}):`);
    onCooldown
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .forEach(t => {
        console.log(`   $${t.symbol.padEnd(6)} — posted ${t.daysSince}d ago, available in ${t.daysRemaining}d`);
      });
    console.log('');
  }
  
  if (available.length > 0) {
    console.log(`✅ AVAILABLE TO RE-POST (${available.length}):`);
    available.forEach(t => {
      console.log(`   $${t.symbol.padEnd(6)} — last posted ${t.daysSince}d ago`);
    });
    console.log('');
  }
  
  console.log(`Total tracked: ${symbols.length} tickers`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const args = process.argv.slice(2);
  
  // Status command - show posting history
  if (args.includes('--status')) {
    showPostingStatus();
    process.exit(0);
  }
  
  const refresh = args.includes('--refresh');
  const post = args.includes('--post');
  const force = args.includes('--force');  // Force post even if VIS is low or on cooldown
  const tickerArg = args.find(a => a.startsWith('--ticker='));
  const ticker = tickerArg ? tickerArg.split('=')[1] : null;
  const maxArg = args.find(a => a.startsWith('--max='));
  const maxTickers = maxArg ? parseInt(maxArg.split('=')[1]) : MAX_TICKERS_PER_RUN;

  runBankruptcyScan({ refresh, post, ticker, maxTickers, force })
    .then(result => {
      if (!result) process.exit(1);
    })
    .catch(err => {
      console.error('Scanner error:', err);
      process.exit(1);
    });
}
