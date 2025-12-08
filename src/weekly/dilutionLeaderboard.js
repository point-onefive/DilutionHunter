/**
 * DILUTION LEADERBOARD — Weekly ATM Scan
 * 
 * Sources: SEC EDGAR ATM filings (7 days) → FMP enrichment → Score → Rank
 * 
 * Scoring: Dilution Severity Score (0-100)
 *   40% Distress (cash runway, burn rate, debt)
 *   40% ATM Impact (ATM size ÷ market cap, pullback from peak)
 *   20% Attention (volume percentile, volatility)
 * 
 * Output: ONE tweet with ranked tickers + one-line reason each
 * 
 * Usage:
 *   node src/weekly/dilutionLeaderboard.js           # Preview
 *   node src/weekly/dilutionLeaderboard.js --post    # Post tweet
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

import { getRecentATMFilings } from '../atmScanner.js';
import { postAlertThread } from '../twitterPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DRY_RUN = process.env.DRY_RUN !== 'false';

// Cooldown settings (30 days for weekly leaderboard = ~4 weeks before repeat)
const COOLDOWN_DAYS = parseInt(process.env.DILUTION_COOLDOWN_DAYS || '30');
const POSTED_FILE = path.join(DATA_DIR, 'dilution_posted.json');

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
// DATA ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════════

async function enrichATMTicker(filing) {
  const { ticker } = filing;
  
  // Parallel fetch: quote, balance sheet, cash flow, historical prices
  const [quote, balanceSheet, cashFlow, historical] = await Promise.all([
    fmpGet(`/quote?symbol=${ticker}`),
    fmpGet(`/balance-sheet-statement?symbol=${ticker}&period=quarter&limit=1`),
    fmpGet(`/cash-flow-statement?symbol=${ticker}&period=quarter&limit=4`),
    fmpGet(`/historical-price-eod/full?symbol=${ticker}`)
  ]);

  if (!quote?.[0]) return null;

  const q = quote[0];
  const bs = balanceSheet?.[0] || {};
  const cf = cashFlow || [];

  // Calculate metrics
  const cash = bs.cashAndCashEquivalents || 0;
  const debt = (bs.totalDebt || 0) + (bs.shortTermDebt || 0) + (bs.longTermDebt || 0);
  
  // Quarterly burn = negative operating cash flow
  const quarterlyOCF = cf.map(c => c.operatingCashFlow || 0);
  const avgQuarterlyBurn = quarterlyOCF.filter(o => o < 0).length > 0
    ? Math.abs(quarterlyOCF.filter(o => o < 0).reduce((a, b) => a + b, 0) / quarterlyOCF.filter(o => o < 0).length)
    : 0;
  const monthlyBurn = avgQuarterlyBurn / 3;
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : 999;

  // Price action from historical
  let peakGain = 0, currentGain = 0, pullback = 0;
  if (Array.isArray(historical) && historical.length >= 7) {
    const candles = historical.slice(0, 30).reverse(); // oldest to newest
    if (candles.length >= 7) {
      const filingIdx = candles.findIndex(c => c.date >= filing.fileDate);
      const startIdx = Math.max(0, filingIdx);
      const window = candles.slice(startIdx);
      
      if (window.length >= 2) {
        const startPrice = window[0].open;
        const currentPrice = window[window.length - 1].close;
        const peakHigh = Math.max(...window.map(c => c.high));
        
        peakGain = ((peakHigh - startPrice) / startPrice) * 100;
        currentGain = ((currentPrice - startPrice) / startPrice) * 100;
        pullback = peakGain - currentGain;
      }
    }
  }

  // Volume percentile (simple: current vs average)
  const volumeRatio = q.avgVolume > 0 ? q.volume / q.avgVolume : 1;

  return {
    ...filing,
    price: q.price,
    marketCap: q.marketCap,
    volume: q.volume,
    avgVolume: q.avgVolume,
    volumeRatio,
    cash,
    debt,
    monthlyBurn,
    runwayMonths,
    peakGain,
    currentGain,
    pullback,
    daysSinceFiling: Math.floor((Date.now() - new Date(filing.fileDate).getTime()) / (1000 * 60 * 60 * 24))
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING — Dilution Severity Score (0-100)
// ═══════════════════════════════════════════════════════════════════════════════

function calculateDilutionSeverity(ticker) {
  let distressScore = 0;  // 40% weight
  let impactScore = 0;    // 40% weight
  let attentionScore = 0; // 20% weight

  // === DISTRESS (40 pts max) ===
  // Runway
  if (ticker.runwayMonths <= 3) distressScore += 15;
  else if (ticker.runwayMonths <= 6) distressScore += 12;
  else if (ticker.runwayMonths <= 12) distressScore += 8;
  else if (ticker.runwayMonths <= 18) distressScore += 4;

  // Burn rate relative to cash
  const burnRatio = ticker.monthlyBurn > 0 ? ticker.cash / ticker.monthlyBurn : 999;
  if (burnRatio < 3) distressScore += 15;
  else if (burnRatio < 6) distressScore += 10;
  else if (burnRatio < 12) distressScore += 5;

  // Debt vs cash
  const debtCashRatio = ticker.cash > 0 ? ticker.debt / ticker.cash : 999;
  if (debtCashRatio > 5) distressScore += 10;
  else if (debtCashRatio > 2) distressScore += 7;
  else if (debtCashRatio > 1) distressScore += 4;

  // === ATM IMPACT (40 pts max) ===
  // Pullback from peak (dilution may have started)
  if (ticker.pullback >= 30) impactScore += 15;
  else if (ticker.pullback >= 20) impactScore += 12;
  else if (ticker.pullback >= 10) impactScore += 8;
  else if (ticker.pullback >= 5) impactScore += 4;

  // Peak gain (setup magnitude)
  if (ticker.peakGain >= 100) impactScore += 15;
  else if (ticker.peakGain >= 50) impactScore += 12;
  else if (ticker.peakGain >= 30) impactScore += 8;
  else if (ticker.peakGain >= 15) impactScore += 4;

  // Recency of filing
  if (ticker.daysSinceFiling <= 3) impactScore += 10;
  else if (ticker.daysSinceFiling <= 7) impactScore += 7;
  else if (ticker.daysSinceFiling <= 14) impactScore += 4;

  // === ATTENTION (20 pts max) ===
  // Volume ratio
  if (ticker.volumeRatio >= 3) attentionScore += 10;
  else if (ticker.volumeRatio >= 2) attentionScore += 7;
  else if (ticker.volumeRatio >= 1.5) attentionScore += 5;
  else if (ticker.volumeRatio >= 1) attentionScore += 3;

  // Market cap sweet spot (retail favorites: $50M - $2B)
  const mcap = ticker.marketCap || 0;
  if (mcap >= 50_000_000 && mcap <= 500_000_000) attentionScore += 10;
  else if (mcap >= 500_000_000 && mcap <= 2_000_000_000) attentionScore += 7;
  else if (mcap >= 10_000_000 && mcap < 50_000_000) attentionScore += 5;

  const totalScore = Math.min(100, distressScore + impactScore + attentionScore);

  return {
    score: totalScore,
    dss: totalScore, // Dilution Severity Score (DSS) - branded name
    distressScore,
    impactScore,
    attentionScore,
    breakdown: {
      runway: ticker.runwayMonths,
      burnRatio,
      debtCashRatio,
      pullback: ticker.pullback,
      peakGain: ticker.peakGain,
      daysSinceFiling: ticker.daysSinceFiling,
      volumeRatio: ticker.volumeRatio
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI-POWERED ONE-LINER GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

async function generateAIOneLiners(tickers) {
  const tickerData = tickers.map(t => {
    // Format market cap for display
    const mcap = t.marketCap || 0;
    let marketCapStr = null;
    if (mcap < 100_000_000) {
      marketCapStr = `$${(mcap / 1_000_000).toFixed(0)}M cap`;
    }
    
    return {
      ticker: t.ticker,
      rank: t.rank,
      dss: t.scoring.score,
      runwayMonths: t.runwayMonths?.toFixed(1),
      pullback: t.pullback?.toFixed(0),
      peakGain: t.peakGain?.toFixed(0),
      daysSinceFiling: t.daysSinceFiling,
      debtCashRatio: t.scoring.breakdown.debtCashRatio?.toFixed(1),
      marketCapStr,
      marketCapRaw: mcap
    };
  });

  const prompt = `Generate one-liners for an ATM dilution leaderboard. Each one-liner MUST follow this EXACT format:

FORMAT: "metric1 · metric2 → meaning clause"  (use · as separator, → before meaning)

METRIC OPTIONS (use exact format, pick 2 quantitative metrics):
- "Xmo runway" for runwayMonths (e.g., "0.7mo runway", "3.6mo runway")
- "-X% off peak" for pullback (e.g., "-49% off peak", "-31% off peak")
- "+X% spike" for peakGain (e.g., "+92% spike")
- "ATM filed Xd ago" for daysSinceFiling (e.g., "ATM filed 3d ago")
- "debt Xx cash" for debtCashRatio (e.g., "debt 13.1x cash", "debt 196x cash")
- "$XM cap" for marketCapStr if provided (e.g., "$72M cap", "$35M cap")
- "thin liquidity" for small caps under $100M

MEANING CLAUSE OPTIONS (rotate these, max 2 uses each):
"rally unwinding", "fading after spike", "spike losing momentum", "momentum reversed", "dilution overhang building", "dilution overhang severe", "heavy dilution pressure", "pressure to raise high", "cash position collapsing", "cash almost gone", "likely raise into weakness", "distressed setup", "reversal forming"

ANOMALY HANDLING:
- If runway is LONG (>6 months) but DSS score is still high, explain WHY with clauses like:
  "attention-driven risk", "setup despite runway", "volume-driven distress signal"

RULES:
1. Use ONLY provided metrics from data - don't invent numbers
2. ALWAYS use 2 quantitative metrics (data · data → meaning), NOT (data · tag → meaning)
3. VARY the meaning clauses - don't repeat more than twice across all 10
4. NO jargon, NO vague tags like just "microcap" alone - always pair with numbers
5. If marketCapStr is provided, use it instead of vague terms

DATA:
${JSON.stringify(tickerData, null, 2)}

Return JSON array ONLY:
[{"ticker":"FTEL","oneLiner":"0.7mo runway · -49% off peak → rally unwinding"},{"ticker":"WOK","oneLiner":"-31% off peak · debt 13.1x cash → dilution overhang severe"}...]`;

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
    // Parse JSON (handle markdown code blocks if present)
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const oneLiners = JSON.parse(jsonStr);
    
    // Map back to tickers
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

function generateFallbackReason(ticker, scoring) {
  const metrics = [];
  
  if (ticker.runwayMonths <= 12) {
    metrics.push({ key: 'runway', text: `${ticker.runwayMonths.toFixed(1)}mo runway`, priority: ticker.runwayMonths <= 3 ? 10 : 8 });
  }
  if (ticker.pullback >= 10) {
    metrics.push({ key: 'pullback', text: `-${ticker.pullback.toFixed(0)}% off peak`, priority: ticker.pullback >= 30 ? 9 : 7 });
  }
  if (ticker.daysSinceFiling <= 7) {
    metrics.push({ key: 'days', text: `ATM filed ${ticker.daysSinceFiling}d ago`, priority: ticker.daysSinceFiling <= 3 ? 9 : 5 });
  }
  if (scoring.breakdown.debtCashRatio > 2) {
    metrics.push({ key: 'debt', text: `debt ${scoring.breakdown.debtCashRatio.toFixed(1)}x cash`, priority: scoring.breakdown.debtCashRatio > 5 ? 9 : 6 });
  }
  
  metrics.sort((a, b) => b.priority - a.priority);
  const topMetrics = metrics.slice(0, 2);
  
  const meanings = ['dilution overhang building', 'fading after spike', 'heavy dilution pressure', 'rally unwinding', 'momentum reversed'];
  const meaning = meanings[Math.floor(Math.random() * meanings.length)];
  
  if (topMetrics.length === 0) return `ATM filed → ${meaning}`;
  return `${topMetrics.map(m => m.text).join(' · ')} → ${meaning}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateDilutionLeaderboard(options = {}) {
  const { days = 7, maxTickers = 10, minScore = 30 } = options;

  // Calculate date range for display
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const dateRange = `${formatDate(startDate)}–${formatDate(endDate)}`;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  DILUTION LEADERBOARD — Weekly ATM Scan                                       ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get ATM filings from SEC EDGAR
  console.log(`📡 Step 1: Fetching ATM filings from SEC EDGAR (${days} days)...\n`);
  const filings = await getRecentATMFilings(days);
  console.log(`   Found ${filings.length} unique ATM filings\n`);

  if (filings.length === 0) {
    return { leaderboard: [], tweet: 'No ATM filings found this week.' };
  }

  // Step 2: Enrich with FMP data
  console.log(`📊 Step 2: Enriching with FMP data...\n`);
  const enriched = [];
  
  for (const filing of filings) {
    process.stdout.write(`   ${filing.ticker}...`);
    const data = await enrichATMTicker(filing);
    if (data && data.marketCap > 0) {
      enriched.push(data);
      console.log(` ✓`);
    } else {
      console.log(` skip`);
    }
    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }

  console.log(`\n   Enriched ${enriched.length} tickers\n`);

  // Step 3: Score and rank
  console.log(`🧮 Step 3: Scoring (DSS) and ranking...\n`);
  const scored = enriched.map(t => {
    const scoring = calculateDilutionSeverity(t);
    return { ...t, scoring };
  });

  // Load cooldown history
  const posted = loadPostedHistory();
  const skippedCooldown = [];

  // Filter by minimum score, exclude cooldown tickers, and sort
  const qualified = scored
    .filter(t => {
      if (t.scoring.score < minScore) return false;
      if (isOnCooldown(t.ticker, posted)) {
        skippedCooldown.push(t.ticker);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.scoring.score - a.scoring.score)
    .slice(0, maxTickers);

  // Add rank for AI generation
  qualified.forEach((t, i) => { t.rank = i + 1; });

  // Show cooldown skips
  if (skippedCooldown.length > 0) {
    console.log(`   ⏳ Skipped ${skippedCooldown.length} on cooldown: ${skippedCooldown.slice(0, 5).join(', ')}${skippedCooldown.length > 5 ? '...' : ''}\n`);
  }

  console.log(`   ${qualified.length} tickers qualify (DSS ≥ ${minScore})\n`);

  // Step 4: Generate AI one-liners
  console.log(`🤖 Step 4: Generating AI one-liners...\n`);
  const aiOneLiners = await generateAIOneLiners(qualified);
  
  // Apply AI one-liners or fallback
  qualified.forEach(t => {
    if (aiOneLiners && aiOneLiners[t.ticker]) {
      t.reason = aiOneLiners[t.ticker];
    } else {
      t.reason = generateFallbackReason(t, t.scoring);
    }
  });

  // Step 5: Display leaderboard
  console.log('═'.repeat(70));
  console.log('📊 DILUTION LEADERBOARD (Ranked by DSS)');
  console.log('═'.repeat(70));
  
  qualified.forEach((t, i) => {
    console.log(`#${i + 1} $${t.ticker.padEnd(6)} — DSS: ${t.scoring.score.toString().padStart(2)} → ${t.reason}`);
  });
  
  console.log('═'.repeat(70));

  // Build output
  const leaderboard = qualified.map((t, i) => ({
    rank: i + 1,
    ticker: t.ticker,
    companyName: t.companyName,
    score: t.scoring.score,
    reason: t.reason,
    metrics: {
      runway: t.runwayMonths?.toFixed(1),
      pullback: t.pullback?.toFixed(1),
      peakGain: t.peakGain?.toFixed(1),
      daysSinceFiling: t.daysSinceFiling,
      marketCap: t.marketCap,
      debtCashRatio: t.scoring.breakdown.debtCashRatio?.toFixed(1)
    }
  }));

  // Save to file
  const outputPath = path.join(DATA_DIR, 'dilution_leaderboard.json');
  const output = {
    generatedAt: new Date().toISOString(),
    period: `${days}d`,
    dateRange,
    totalFilings: filings.length,
    enriched: enriched.length,
    qualified: qualified.length,
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
    return `🔎 Weekly ATM Dilution Scan

No significant ATM setups this week.
Quiet week = less dilution pressure.

Back next week with fresh scans.`;
  }

  // The AI one-liners are already in the data, just format the tweet
  const lines = leaderboardData.leaderboard.slice(0, 10).map(t => 
    `#${t.rank} $${t.ticker} — DSS: ${t.score}\n→ ${t.reason}`
  );
  
  return `🔎 WEEKLY ATM DILUTION LEADERBOARD
ATMs let companies sell shares anytime — diluting you.
These aren't announced. We dig through SEC filings.
Filings from ${leaderboardData.dateRange} · DSS = dilution pressure × distress

${lines.join('\n\n')}

Not advice — pattern recognition only.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

export async function runDilutionLeaderboard(options = {}) {
  const { post = false, days = 7, greeting = null } = options;

  const leaderboardData = await generateDilutionLeaderboard({ days });
  
  console.log('\n🤖 Generating tweet...\n');
  let tweet = await generateTweet(leaderboardData);
  
  if (greeting) {
    tweet = `${greeting}\n\n${tweet}`;
  }

  console.log('═'.repeat(70));
  console.log('📝 DILUTION LEADERBOARD TWEET');
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
        const result = await postAlertThread(tweet, [], null);
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
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 7;
  const greetingArg = args.find(a => a.startsWith('--greeting='));
  const greeting = greetingArg ? greetingArg.split('=')[1] : null;

  runDilutionLeaderboard({ post, days, greeting })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
