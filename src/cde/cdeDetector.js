/**
 * CDE DETECTOR - Critical Distress Event Scanner
 * 
 * Detects collision events where MULTIPLE failure signals converge:
 * 
 *   🔫 Dilution Hunter    → ATM/equity mechanism detected
 *   🏚  Bankruptcy Watchdog → Insolvency risk ≥ 50/100
 *   📢  VIS Score          → Market attention ≥ 60 (people will care)
 * 
 * When all three align = CRITICAL DISTRESS EVENT (CDE)
 * 
 * These are not quiet failures — they're LOUD failures.
 * The market reacts hardest when:
 *   - A company needs cash urgently (dilution mechanism active)
 *   - Their runway is dangerously short (bankruptcy risk)
 *   - Retail/traders are watching (viral potential)
 * 
 * This is where sentiment breaks.
 * This is where traders get trapped.
 * This is where posts go viral.
 * 
 * Usage:
 *   node src/cde/cdeDetector.js                    # Scan for CDEs
 *   node src/cde/cdeDetector.js --ticker=AMZE      # Check single ticker
 *   node src/cde/cdeDetector.js --post             # Post top CDE thread
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { fetchBankruptcyInputs, fetchViralityInputs } from '../bankruptcy/fmpBankruptcy.js';
import { scoreWithVIS } from '../bankruptcy/bankruptcyScoreEngine.js';
import { getOfferings } from '../vendors/fmp.js';
import { generateCDEThread } from './cdeThesis.js';
import { postAlertThread } from '../twitterPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const BANKRUPTCY_SIGNALS_FILE = path.join(DATA_DIR, 'bankruptcy_signals.json');
const DILUTION_SIGNALS_FILE = path.join(DATA_DIR, 'active_signals.json');
const CDE_SIGNALS_FILE = path.join(DATA_DIR, 'cde_signals.json');
const CDE_POSTED_FILE = path.join(DATA_DIR, 'cde_posted.json');

const DRY_RUN = process.env.DRY_RUN !== 'false';

// ═══════════════════════════════════════════════════════════════════════════════
// CDE THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════════

const CDE_THRESHOLDS = {
  // Must have dilution mechanism active
  dilutionRequired: true,
  
  // Bankruptcy risk minimum (0-100)
  minBankruptcyRisk: 50,
  
  // VIS minimum (0-100) - people must care
  minVIS: 60,
  
  // Cooldown days before re-posting same ticker
  cooldownDays: 30
};

// ═══════════════════════════════════════════════════════════════════════════════
// FILE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function loadPostedCDEs() {
  const data = loadJson(CDE_POSTED_FILE);
  return data?.tickers || {};
}

function markCDEAsPosted(symbol) {
  const data = loadJson(CDE_POSTED_FILE) || { tickers: {} };
  data.tickers[symbol] = new Date().toISOString().split('T')[0];
  saveJson(CDE_POSTED_FILE, data);
}

function isOnCooldown(symbol, posted) {
  const lastPosted = posted[symbol];
  if (!lastPosted) return false;
  
  const lastDate = new Date(lastPosted);
  const now = new Date();
  const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
  
  return daysSince < CDE_THRESHOLDS.cooldownDays;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DILUTION CHECK
// ═══════════════════════════════════════════════════════════════════════════════

// Known tickers with active dilution mechanisms (manually curated when FMP data is missing)
// Add tickers here when you know they have active ATM/shelf but FMP doesn't show it
const KNOWN_DILUTION_ACTIVE = new Set([
  'AMZE',   // Recent ATM detected by Dilution Hunter
  'MULN',   // Serial diluter
  'FFIE',   // Multiple ATMs
  'GOEV',   // Active shelf
  'NKLA',   // Ongoing dilution
  'WKHS',   // ATM programs
]);

async function checkDilutionMechanism(symbol) {
  console.log(`   🔫 Checking dilution mechanism for ${symbol}...`);
  
  // First check our known list (manual override for FMP gaps)
  if (KNOWN_DILUTION_ACTIVE.has(symbol.toUpperCase())) {
    console.log(`   ✅ ${symbol} in known dilution list`);
    return {
      hasActiveMechanism: true,
      offeringCount: 1,
      recentFilings: 1,
      details: { source: 'manual_override', note: 'Known active dilution mechanism' }
    };
  }
  
  try {
    const offerings = await getOfferings(symbol);
    
    // Check for active ATM or shelf registration
    const hasActiveOffering = offerings?.hasOfferings || false;
    const offeringCount = offerings?.count || 0;
    const recentFilings = offerings?.filings?.filter(f => {
      // Check if filing is within last 180 days
      const filingDate = new Date(f.filingDate || f.date);
      const daysSince = Math.floor((Date.now() - filingDate) / (1000 * 60 * 60 * 24));
      return daysSince < 180;
    }) || [];

    return {
      hasActiveMechanism: hasActiveOffering || recentFilings.length > 0,
      offeringCount,
      recentFilings: recentFilings.length,
      details: offerings
    };
  } catch (error) {
    console.error(`   ⚠️  Dilution check failed: ${error.message}`);
    return {
      hasActiveMechanism: false,
      offeringCount: 0,
      recentFilings: 0,
      details: null
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CDE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

async function analyzeCDE(symbol) {
  console.log(`\n🔥 Analyzing CDE potential for $${symbol}...`);
  
  // 1. Check bankruptcy/distress score + VIS
  const [financialInputs, viralityInputs] = await Promise.all([
    fetchBankruptcyInputs(symbol),
    fetchViralityInputs(symbol)
  ]);
  
  const analysis = scoreWithVIS(financialInputs, viralityInputs);
  
  if (!analysis || analysis.classification === 'INSUFFICIENT_DATA') {
    return { isCDE: false, reason: 'Insufficient financial data' };
  }
  
  console.log(`   🏚  Bankruptcy Risk: ${analysis.score}/100`);
  console.log(`   📢  VIS Score: ${analysis.vis}/100`);
  console.log(`   🔥  Virality: ${analysis.virality?.score}/100`);
  
  // 2. Check dilution mechanism
  const dilution = await checkDilutionMechanism(symbol);
  console.log(`   🔫 Dilution Active: ${dilution.hasActiveMechanism ? 'YES' : 'NO'}`);
  
  // 3. Evaluate CDE criteria
  const criteria = {
    dilutionActive: dilution.hasActiveMechanism,
    bankruptcyRisk: analysis.score >= CDE_THRESHOLDS.minBankruptcyRisk,
    visThreshold: analysis.vis >= CDE_THRESHOLDS.minVIS
  };
  
  const passCount = Object.values(criteria).filter(Boolean).length;
  const isCDE = criteria.dilutionActive && criteria.bankruptcyRisk && criteria.visThreshold;
  
  // Calculate CDE intensity (how strongly signals converge)
  const cdeIntensity = isCDE ? 
    Math.round((analysis.score + analysis.vis + (dilution.recentFilings * 10)) / 3) : 0;
  
  return {
    symbol,
    isCDE,
    cdeIntensity,
    passCount,
    criteria,
    bankruptcyScore: analysis.score,
    vis: analysis.vis,
    viralityScore: analysis.virality?.score || 0,
    dilution,
    analysis,
    summary: isCDE 
      ? `🔥 CDE DETECTED — ${passCount}/3 signals converging`
      : `📊 ${passCount}/3 criteria met (need all 3 for CDE)`
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-REFERENCE EXISTING SIGNALS
// ═══════════════════════════════════════════════════════════════════════════════

function getCandidatesFromSignals() {
  const candidates = new Set();
  
  // Load bankruptcy watchlist/alerts
  const bankruptcyData = loadJson(BANKRUPTCY_SIGNALS_FILE);
  if (bankruptcyData) {
    // Add prime alerts
    (bankruptcyData.primeAlerts || []).forEach(a => candidates.add(a.symbol));
    // Add watchlist
    (bankruptcyData.watchlist || []).forEach(w => candidates.add(w.symbol));
    // Add store-only that have decent VIS
    (bankruptcyData.storeOnly || [])
      .filter(s => s.vis >= 50)  // Lower threshold for CDE check
      .forEach(s => candidates.add(s.symbol));
  }
  
  // Load dilution signals
  const dilutionData = loadJson(DILUTION_SIGNALS_FILE);
  if (Array.isArray(dilutionData)) {
    dilutionData.forEach(s => candidates.add(s.ticker));
  }
  
  return Array.from(candidates);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

export async function runCDEScan(options = {}) {
  const {
    ticker = null,
    post = false,
    force = false
  } = options;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  🔥 CRITICAL DISTRESS EVENT (CDE) SCANNER                                    ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  console.log(`📋 CDE Criteria:`);
  console.log(`   🔫 Dilution mechanism active (ATM/shelf)`);
  console.log(`   🏚  Bankruptcy risk ≥ ${CDE_THRESHOLDS.minBankruptcyRisk}/100`);
  console.log(`   📢  VIS ≥ ${CDE_THRESHOLDS.minVIS}/100 (market attention)`);
  console.log(`   → All three must align for CDE classification\n`);

  // Get candidates
  let candidates;
  if (ticker) {
    candidates = [ticker.toUpperCase()];
    console.log(`🎯 Single ticker mode: ${ticker}\n`);
  } else {
    candidates = getCandidatesFromSignals();
    if (candidates.length === 0) {
      console.log('⚠️  No candidates found. Run bankruptcy and dilution scans first.');
      console.log('   node src/bankruptcy/bankruptcyScan.js --refresh');
      return null;
    }
    console.log(`📊 Found ${candidates.length} candidates from existing signals\n`);
  }

  // Analyze each candidate
  const cdeEvents = [];
  const nearMisses = [];
  
  for (const symbol of candidates) {
    const result = await analyzeCDE(symbol);
    
    if (result.isCDE) {
      cdeEvents.push(result);
      console.log(`   ✅ ${result.summary}`);
    } else if (result.passCount >= 2) {
      nearMisses.push(result);
      console.log(`   ⚠️  ${result.summary}`);
    } else {
      console.log(`   ❌ ${result.summary}`);
    }
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Sort CDEs by intensity
  cdeEvents.sort((a, b) => b.cdeIntensity - a.cdeIntensity);

  // Display results
  console.log(`
════════════════════════════════════════════════════════════════════════════════
🔥 CDE SCAN RESULTS
════════════════════════════════════════════════════════════════════════════════
`);

  if (cdeEvents.length > 0) {
    console.log(`🔥 CRITICAL DISTRESS EVENTS DETECTED: ${cdeEvents.length}\n`);
    
    for (const cde of cdeEvents) {
      console.log(`   $${cde.symbol.padEnd(6)} | Intensity: ${cde.cdeIntensity}`);
      console.log(`           Bankruptcy: ${cde.bankruptcyScore}/100 | VIS: ${cde.vis}/100 | Dilution: ✅`);
      console.log(`           ${cde.analysis.metrics?.runwayFormatted || 'N/A'} runway | ${cde.dilution.recentFilings} recent filings`);
      console.log('');
    }
  } else {
    console.log(`   No CDEs detected in current signals.\n`);
  }

  if (nearMisses.length > 0) {
    console.log(`⚠️  NEAR MISSES (2/3 criteria): ${nearMisses.length}\n`);
    for (const nm of nearMisses.slice(0, 5)) {
      const missing = [];
      if (!nm.criteria.dilutionActive) missing.push('No dilution');
      if (!nm.criteria.bankruptcyRisk) missing.push(`Risk ${nm.bankruptcyScore}<${CDE_THRESHOLDS.minBankruptcyRisk}`);
      if (!nm.criteria.visThreshold) missing.push(`VIS ${nm.vis}<${CDE_THRESHOLDS.minVIS}`);
      console.log(`   $${nm.symbol.padEnd(6)} | Missing: ${missing.join(', ')}`);
    }
  }

  // Save results
  const results = {
    scannedAt: new Date().toISOString(),
    totalScanned: candidates.length,
    cdeEvents: cdeEvents.map(c => ({
      symbol: c.symbol,
      cdeIntensity: c.cdeIntensity,
      bankruptcyScore: c.bankruptcyScore,
      vis: c.vis,
      viralityScore: c.viralityScore,
      dilutionActive: c.dilution.hasActiveMechanism,
      recentFilings: c.dilution.recentFilings,
      metrics: c.analysis.metrics
    })),
    nearMisses: nearMisses.map(n => ({
      symbol: n.symbol,
      bankruptcyScore: n.bankruptcyScore,
      vis: n.vis,
      criteria: n.criteria
    }))
  };
  
  saveJson(CDE_SIGNALS_FILE, results);
  console.log(`\n📁 Saved results to ${CDE_SIGNALS_FILE}`);

  // Post if requested
  if (post && cdeEvents.length > 0) {
    const posted = loadPostedCDEs();
    
    // Find first CDE not on cooldown
    let targetCDE = null;
    for (const cde of cdeEvents) {
      if (!isOnCooldown(cde.symbol, posted) || force) {
        targetCDE = cde;
        break;
      } else {
        console.log(`\n⏳ $${cde.symbol} on cooldown, checking next...`);
      }
    }

    if (targetCDE) {
      console.log(`\n🔥 Generating CDE thread for $${targetCDE.symbol}...`);
      
      try {
        const thread = await generateCDEThread(targetCDE);
        
        console.log('\n📝 CDE THREAD PREVIEW:');
        console.log('─'.repeat(60));
        thread.forEach((tweet, i) => {
          console.log(`\n[${i + 1}/${thread.length}]`);
          console.log(tweet);
        });
        console.log('─'.repeat(60));

        if (!DRY_RUN) {
          console.log('\n🚀 Posting to Twitter...');
          const tweetIds = await postAlertThread(thread);
          
          if (tweetIds?.length) {
            markCDEAsPosted(targetCDE.symbol);
            console.log(`✅ Posted CDE thread for $${targetCDE.symbol}`);
            console.log(`   First tweet: https://twitter.com/i/web/status/${tweetIds[0]}`);
          }
        } else {
          console.log('\n📝 DRY RUN: Would post above thread');
        }
      } catch (error) {
        console.error(`❌ Failed to generate/post thread: ${error.message}`);
      }
    } else {
      console.log('\n⏳ All CDEs are on cooldown. Use --force to override.');
    }
  } else if (post && cdeEvents.length === 0) {
    console.log('\n❌ No CDEs to post.');
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const parsedArgs = {};

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    parsedArgs[key] = value || true;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCDEScan({
    ticker: parsedArgs.ticker,
    post: parsedArgs.post === true,
    force: parsedArgs.force === true
  }).catch(console.error);
}

export default { runCDEScan, analyzeCDE };
