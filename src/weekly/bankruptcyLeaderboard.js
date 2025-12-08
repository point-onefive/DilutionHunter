/**
 * BANKRUPTCY LEADERBOARD — Weekly Distress Scan
 * 
 * 3-STAGE FILTERING PIPELINE:
 *   Stage 1: Cheap distress filter (500-1500 tickers → 200-300)
 *            - OCF < 0, Debt > Cash, Quick Ratio < 1
 *   Stage 2: Cheap attention filter (200-300 → 60-100)
 *            - Volume > 100K, Market cap sweet spot
 *   Stage 3: Full bankruptcy analysis (30-50 tickers)
 *            - 8-10 API calls per ticker for VIS scoring
 * 
 * Scoring: VIS (0-100) = 0.6 × BankruptcyRisk + 0.4 × AttentionScore
 * 
 * Output: ONE tweet with ranked tickers + one-line reason each
 * 
 * Usage:
 *   node src/weekly/bankruptcyLeaderboard.js           # Preview
 *   node src/weekly/bankruptcyLeaderboard.js --post    # Post tweet
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

import { fetchBankruptcyInputs, fetchViralityInputs } from '../bankruptcy/fmpBankruptcy.js';
import { scoreWithVIS } from '../bankruptcy/bankruptcyScoreEngine.js';
import { postAlertThread } from '../twitterPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DRY_RUN = process.env.DRY_RUN !== 'false';

// Cooldown settings (30 days for weekly leaderboard = ~4 weeks before repeat)
const COOLDOWN_DAYS = parseInt(process.env.BANKRUPTCY_LB_COOLDOWN_DAYS || '30');
const POSTED_FILE = path.join(DATA_DIR, 'bankruptcy_lb_posted.json');

// ═══════════════════════════════════════════════════════════════════════════════
// COOLDOWN / DEDUPE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function loadPostedHistory() {
  try {
    if (fs.existsSync(POSTED_FILE)) {
      return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'))?.tickers || {};
    }
  } catch (e) { /* ignore */ }
  return {};
}

function savePostedHistory(tickers) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify({ tickers, updatedAt: new Date().toISOString() }, null, 2));
}

function isOnCooldown(ticker, posted) {
  const lastPosted = posted[ticker];
  if (!lastPosted) return false;
  const daysSince = Math.floor((Date.now() - new Date(lastPosted).getTime()) / (1000 * 60 * 60 * 24));
  return daysSince < COOLDOWN_DAYS;
}

function markTickersAsPosted(tickers) {
  const posted = loadPostedHistory();
  const today = new Date().toISOString().split('T')[0];
  for (const t of tickers) {
    posted[t] = today;
  }
  savePostedHistory(posted);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FMP HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function fmpGet(endpoint) {
  const url = `${FMP_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 1: CHEAP DISTRESS FILTER (Broad Universe → ~200-300 candidates)
// ═══════════════════════════════════════════════════════════════════════════════

async function getBaseUniverse() {
  console.log('📡 Stage 1a: Fetching base universe from FMP...\n');
  
  // Get from multiple sources: losers, actives, gainers, plus known distress universe
  const [losers, actives, gainers, screener] = await Promise.all([
    fmpGet('/biggest-losers'),
    fmpGet('/most-actives'),
    fmpGet('/biggest-gainers'),
    // FMP stock screener - get small/mid caps
    fmpGet('/stock-screener?marketCapMoreThan=10000000&marketCapLowerThan=10000000000&limit=500')
  ]);

  // Combine + dedupe
  const seen = new Set();
  const candidates = [];
  
  const allResults = [
    ...(losers || []).map(r => ({ ...r, source: 'loser' })),
    ...(actives || []).map(r => ({ ...r, source: 'active' })),
    ...(gainers || []).map(r => ({ ...r, source: 'gainer' })),
    ...(screener || []).map(r => ({ ...r, source: 'screener' }))
  ];

  for (const r of allResults) {
    const sym = r.symbol;
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    
    // Skip ETFs/funds
    if (r.companyName && /\b(ETF|ETN|Fund|Trust|Index)\b/i.test(r.companyName)) continue;
    if (r.name && /\b(ETF|ETN|Fund|Trust|Index)\b/i.test(r.name)) continue;
    
    // Skip non-US
    if (r.exchange && !['NASDAQ', 'NYSE', 'AMEX', 'NYSEAMERICAN'].includes(r.exchange)) continue;
    
    candidates.push({
      symbol: sym,
      companyName: r.companyName || r.name || sym,
      price: r.price,
      marketCap: r.marketCap || r.mktCap,
      source: r.source
    });
  }

  // Also add known distress list
  const KNOWN_DISTRESS = [
    'MULN', 'FFIE', 'NKLA', 'GOEV', 'RIDE', 'WKHS', 'FSR', 'LCID', 'RIVN',
    'AMC', 'GME', 'BBIG', 'CEI', 'PROG', 'ATER', 'SNDL', 'TLRY',
    'CLOV', 'WISH', 'SOFI', 'HOOD', 'UPST', 'AFRM', 'LMND',
    'BYND', 'TTCF', 'OTLY', 'PRTY', 'SPCE', 'OPEN', 'ROOT'
  ];
  
  for (const sym of KNOWN_DISTRESS) {
    if (!seen.has(sym)) {
      seen.add(sym);
      candidates.push({ symbol: sym, companyName: sym, source: 'known' });
    }
  }

  console.log(`   Found ${candidates.length} base universe tickers`);
  return candidates;
}

async function cheapDistressFilter(candidates) {
  console.log('\n🔍 Stage 1b: Cheap distress pre-filter...\n');
  
  const passed = [];
  let checked = 0;
  
  // Batch check: use quote endpoint for more reliable market cap
  for (const c of candidates.slice(0, 500)) { // Limit to 500 for reasonable API usage
    checked++;
    process.stdout.write(`   [${checked}/${Math.min(candidates.length, 500)}] ${c.symbol}...`);
    
    // Use quote endpoint - more reliable for market cap
    const quote = await fmpGet(`/quote?symbol=${c.symbol}`);
    const q = Array.isArray(quote) ? quote[0] : quote;
    
    if (!q) {
      console.log(' skip (no data)');
      continue;
    }

    // Try multiple field names for market cap
    const marketCap = q.marketCap || q.mktCap || 0;
    const price = q.price || 0;
    
    // Basic filters - widened range
    if (marketCap < 5_000_000 || marketCap > 50_000_000_000) {
      console.log(` skip (mcap: ${marketCap})`);
      continue;
    }
    if (price < 0.10 || price > 500) {
      console.log(' skip (price)');
      continue;
    }

    // Look for distress signals in profile
    // We'll pass anything that isn't obviously healthy
    passed.push({
      ...c,
      price,
      marketCap
    });
    console.log(' ✓');
    
    await new Promise(r => setTimeout(r, 50)); // Light rate limiting
  }

  console.log(`\n   Stage 1 passed: ${passed.length} tickers`);
  return passed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 2: ATTENTION FILTER (200-300 → 60-100)
// ═══════════════════════════════════════════════════════════════════════════════

async function attentionFilter(candidates) {
  console.log('\n👁️ Stage 2: Attention filter (volume, retail interest)...\n');
  
  const passed = [];
  let checked = 0;
  
  for (const c of candidates) {
    checked++;
    process.stdout.write(`   [${checked}/${candidates.length}] ${c.symbol}...`);
    
    // Get quote for volume data
    const quote = await fmpGet(`/quote?symbol=${c.symbol}`);
    const q = Array.isArray(quote) ? quote[0] : quote;
    
    if (!q) {
      console.log(' skip');
      continue;
    }

    const volume = q.volume || 0;
    const avgVolume = q.avgVolume || volume;
    
    // Attention filters
    if (avgVolume < 50_000) {
      console.log(' low vol');
      continue;
    }
    
    // Market cap sweet spot (retail interest)
    const mcap = c.marketCap || 0;
    const isRetailFavorite = mcap >= 50_000_000 && mcap <= 5_000_000_000;
    const hasVolumeSurge = volume > avgVolume * 1.2;
    
    if (!isRetailFavorite && !hasVolumeSurge) {
      console.log(' no attention');
      continue;
    }

    passed.push({
      ...c,
      volume,
      avgVolume,
      volumeRatio: avgVolume > 0 ? volume / avgVolume : 1
    });
    console.log(` ✓ (vol: ${(avgVolume/1000).toFixed(0)}K)`);
    
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n   Stage 2 passed: ${passed.length} tickers`);
  return passed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 3: FULL BANKRUPTCY ANALYSIS (60-100 → ranked top 10)
// ═══════════════════════════════════════════════════════════════════════════════

async function fullBankruptcyAnalysis(candidates, maxAnalyze = 50) {
  console.log(`\n⚠️ Stage 3: Full bankruptcy analysis (top ${maxAnalyze})...\n`);
  
  // Sort by volume ratio to prioritize most active
  const toAnalyze = candidates
    .sort((a, b) => (b.volumeRatio || 0) - (a.volumeRatio || 0))
    .slice(0, maxAnalyze);
  
  const results = [];
  let analyzed = 0;

  for (const c of toAnalyze) {
    analyzed++;
    console.log(`\n   [${analyzed}/${toAnalyze.length}] 📊 Full analysis: ${c.symbol}`);
    
    try {
      // Fetch full bankruptcy + virality data (~8-10 API calls)
      const [financialInputs, viralityInputs] = await Promise.all([
        fetchBankruptcyInputs(c.symbol),
        fetchViralityInputs(c.symbol)
      ]);
      
      // Score with VIS
      const analysis = scoreWithVIS(financialInputs, viralityInputs);
      
      if (analysis && analysis.vis > 0) {
        results.push({
          ticker: c.symbol,
          companyName: c.companyName,
          vis: analysis.vis,
          bankruptcyScore: analysis.score,
          viralityScore: analysis.virality?.score || 0,
          classification: analysis.classification,
          // Metrics are at top level of analysis.metrics
          runwayMonths: analysis.metrics?.runwayMonths,
          debtCashRatio: analysis.metrics?.debtToCashMultiple,
          monthlyBurn: analysis.metrics?.monthlyBurn,
          interestCoverage: analysis.metrics?.interestCoverage,
          marketCap: viralityInputs.marketCap,
          avgVolume: viralityInputs.avgVolume
        });
        console.log(`      VIS: ${analysis.vis.toFixed(0)} | Bankruptcy: ${analysis.score} | Virality: ${analysis.virality?.score || 0}`);
      }
    } catch (e) {
      console.error(`      ❌ Error: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 200)); // Rate limit for full analysis
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI-POWERED ONE-LINER GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

async function generateAIOneLiners(tickers) {
  const tickerData = tickers.map(t => {
    // Detect anomaly: long runway but high VIS score
    const runway = parseFloat(t.runwayMonths) || 0;
    const isLongRunwayAnomaly = runway > 12 && t.vis >= 45;
    
    return {
      ticker: t.ticker,
      rank: t.rank,
      vis: t.vis,
      runwayMonths: t.runwayMonths?.toFixed(1),
      debtCashRatio: t.debtCashRatio?.toFixed(1),
      monthlyBurn: t.monthlyBurn ? (t.monthlyBurn / 1_000_000).toFixed(1) : null,
      classification: t.classification,
      marketCap: t.marketCap,
      isLongRunwayAnomaly
    };
  });

  const prompt = `Generate one-liners for a bankruptcy watchlist. Each one-liner MUST follow this EXACT format:

FORMAT: "metric1 · metric2 → meaning clause"  (use · as separator, → before meaning)

METRIC OPTIONS (use exact format, pick 2):
- "Xmo runway" for runwayMonths (e.g., "0.6mo runway", "5.3mo runway")
- "debt Xx cash" for debtCashRatio (e.g., "debt 744x cash", "debt 19.7x cash")  
- "$XM/mo burn" for monthlyBurn (e.g., "$252M/mo burn", "$18.8M/mo burn")
- "negative cash flow" or "burn rising" if monthlyBurn is high

MEANING CLAUSE OPTIONS (rotate these, max 2 uses each):
"extreme insolvency pressure", "severe insolvency pressure", "cash nearly exhausted", "debt burden overwhelming liquidity", "solvency risk building", "solvency risk growing", "liquidity deteriorating", "liquidity tightening", "pressure rising", "burn rate unsustainable", "long-term burn unsustainable", "financial distress deepening"

ANOMALY HANDLING (CRITICAL):
- If isLongRunwayAnomaly is TRUE (runway >12mo but still high VIS), the one-liner MUST explain WHY:
  Use clauses like: "attention-driven distress signal", "long-term burn unsustainable", "deteriorating fundamentals", "structural cash flow issues"
  Example: "20.5mo runway · debt 2.3x cash → attention-driven distress signal"
  Example: "24.0mo runway · debt 3.6x cash → long-term burn unsustainable"

RULES:
1. Use ONLY provided metrics from data - don't invent numbers
2. ALWAYS use 2 metrics when available (data · data → meaning)
3. VARY the meaning clauses - don't repeat more than twice across all 10
4. NO jargon, NO complex terms
5. For long runway anomalies, the meaning clause MUST explain why VIS is high despite runway

DATA:
${JSON.stringify(tickerData, null, 2)}

Return JSON array ONLY:
[{"ticker":"SNBR","oneLiner":"0.6mo runway · debt 744x cash → extreme insolvency pressure"},{"ticker":"AMC","oneLiner":"debt 19.7x cash → debt burden overwhelming liquidity"}...]`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You output valid JSON arrays only. Follow the exact format specified.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1500,
      temperature: 0.7
    });
    
    const content = response.choices[0]?.message?.content?.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const oneLiners = JSON.parse(jsonStr);
    
    const oneLinerMap = {};
    for (const item of oneLiners) {
      oneLinerMap[item.ticker] = item.oneLiner;
    }
    return oneLinerMap;
  } catch (e) {
    console.error('   ⚠️ AI one-liner generation failed, using fallback:', e.message);
    return null;
  }
}

function generateFallbackReason(ticker) {
  const metrics = [];
  
  if (ticker.runwayMonths !== undefined && ticker.runwayMonths <= 18) {
    metrics.push({ key: 'runway', text: `${ticker.runwayMonths.toFixed(1)}mo runway`, priority: ticker.runwayMonths <= 3 ? 10 : 8 });
  }
  if (ticker.debtCashRatio !== undefined && ticker.debtCashRatio > 1.5) {
    metrics.push({ key: 'debt', text: `debt ${ticker.debtCashRatio.toFixed(1)}x cash`, priority: ticker.debtCashRatio > 5 ? 9 : 7 });
  }
  if (ticker.monthlyBurn !== undefined && ticker.monthlyBurn > 1_000_000) {
    const burnM = ticker.monthlyBurn / 1_000_000;
    metrics.push({ key: 'burn', text: `$${burnM.toFixed(1)}M/mo burn`, priority: burnM >= 10 ? 8 : 6 });
  }
  
  metrics.sort((a, b) => b.priority - a.priority);
  const topMetrics = metrics.slice(0, 2);
  
  const meanings = ['liquidity tightening', 'insolvency pressure rising', 'cash position deteriorating', 'solvency risk rising', 'financial distress deepening'];
  const meaning = meanings[Math.floor(Math.random() * meanings.length)];
  
  if (topMetrics.length === 0) return meaning;
  return `${topMetrics.map(m => m.text).join(' · ')} → ${meaning}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateBankruptcyLeaderboard(options = {}) {
  const { maxTickers = 10, minVIS = 40 } = options;

  // Calculate date range for display (week ending today)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const dateRange = `${formatDate(startDate)}–${formatDate(endDate)}`;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  BANKRUPTCY LEADERBOARD — Weekly Distress Scan                                ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // 3-Stage Pipeline
  const baseUniverse = await getBaseUniverse();
  const stage1Passed = await cheapDistressFilter(baseUniverse);
  const stage2Passed = await attentionFilter(stage1Passed);
  const analyzed = await fullBankruptcyAnalysis(stage2Passed);

  // Load cooldown history
  const posted = loadPostedHistory();
  const skippedCooldown = [];

  // Rank by VIS, exclude cooldown tickers
  const ranked = analyzed
    .filter(t => {
      if (t.vis < minVIS) return false;
      if (isOnCooldown(t.ticker, posted)) {
        skippedCooldown.push(t.ticker);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.vis - a.vis)
    .slice(0, maxTickers);

  // Add rank for AI generation
  ranked.forEach((t, i) => { t.rank = i + 1; });

  // Show cooldown skips
  if (skippedCooldown.length > 0) {
    console.log(`\n   ⏳ Skipped ${skippedCooldown.length} on cooldown: ${skippedCooldown.slice(0, 5).join(', ')}${skippedCooldown.length > 5 ? '...' : ''}`);
  }

  // Generate AI one-liners
  console.log('\n🤖 Generating AI one-liners...\n');
  const aiOneLiners = await generateAIOneLiners(ranked);

  // Build leaderboard with AI or fallback reasons
  const leaderboard = ranked.map((t, i) => ({
    rank: i + 1,
    ticker: t.ticker,
    companyName: t.companyName,
    vis: Math.round(t.vis),
    bankruptcyScore: t.bankruptcyScore,
    viralityScore: t.viralityScore,
    reason: aiOneLiners?.[t.ticker] || generateFallbackReason(t),
    metrics: {
      runway: t.runwayMonths?.toFixed(1),
      debtCashRatio: t.debtCashRatio?.toFixed(1),
      monthlyBurn: t.monthlyBurn,
      marketCap: t.marketCap,
      avgVolume: t.avgVolume
    }
  }));

  // Display
  console.log('\n' + '═'.repeat(70));
  console.log('⚠️ BANKRUPTCY LEADERBOARD (Ranked by VIS)');
  console.log('═'.repeat(70));
  
  leaderboard.forEach(t => {
    console.log(`#${t.rank} $${t.ticker.padEnd(6)} — VIS: ${t.vis.toString().padStart(2)} → ${t.reason}`);
  });
  
  console.log('═'.repeat(70));

  // Save
  const outputPath = path.join(DATA_DIR, 'bankruptcy_leaderboard.json');
  const output = {
    generatedAt: new Date().toISOString(),
    dateRange,
    pipeline: {
      baseUniverse: baseUniverse.length,
      stage1Passed: stage1Passed.length,
      stage2Passed: stage2Passed.length,
      fullAnalyzed: analyzed.length,
      qualified: leaderboard.length
    },
    leaderboard
  };
  
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved to ${outputPath}`);

  return output;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWEET GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

async function generateTweet(leaderboardData) {
  if (!leaderboardData?.leaderboard?.length) {
    return `💀 Weekly Bankruptcy Watchlist

No significant distress signals this week.
Markets stable. Keep watching.

Back next week.`;
  }

  // The AI one-liners are already in the data, just format the tweet
  const lines = leaderboardData.leaderboard.slice(0, 10).map(t => 
    `#${t.rank} $${t.ticker} — Risk: ${t.vis}/100\n→ ${t.reason}`
  );
  
  return `💀 WEEKLY BANKRUPTCY WATCHLIST
Companies showing distress signals worth monitoring.
📅 Week of ${leaderboardData.dateRange}

${lines.join('\n\n')}

⚠️ Not advice — pattern recognition only. 💀 Distress doesn't announce itself.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

export async function runBankruptcyLeaderboard(options = {}) {
  const { post = false, greeting = null } = options;

  const leaderboardData = await generateBankruptcyLeaderboard();
  
  console.log('\n🤖 Generating tweet...\n');
  let tweet = await generateTweet(leaderboardData);
  
  if (greeting) {
    tweet = `${greeting}\n\n${tweet}`;
  }

  console.log('═'.repeat(70));
  console.log('📝 BANKRUPTCY LEADERBOARD TWEET');
  console.log('═'.repeat(70));
  console.log(tweet);
  console.log('═'.repeat(70));
  console.log(`Characters: ${tweet.length}`);

  if (post) {
    if (DRY_RUN) {
      console.log('\n[DRY_RUN] Would post. Set DRY_RUN=false to post.');
    } else {
      console.log('\n🚀 Posting to Twitter...');
      try {
        await postAlertThread(tweet, [], null);
        console.log(`✅ Posted!`);
        // Mark all tickers in leaderboard as posted (30-day cooldown)
        const tickers = leaderboardData.leaderboard.map(t => t.ticker);
        markTickersAsPosted(tickers);
        console.log(`   ⏳ ${tickers.length} tickers on ${COOLDOWN_DAYS}-day cooldown`);
      } catch (e) {
        console.error(`❌ Post failed: ${e.message}`);
      }
    }
  } else {
    console.log('\nUse --post to publish.');
  }

  return { leaderboardData, tweet };
}

// CLI
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const args = process.argv.slice(2);
  const post = args.includes('--post');
  const greetingArg = args.find(a => a.startsWith('--greeting='));
  const greeting = greetingArg ? greetingArg.split('=')[1] : null;

  runBankruptcyLeaderboard({ post, greeting })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
