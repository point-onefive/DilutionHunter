/**
 * SHELF OFFERING RADAR — Weekly SEC Filing Scan
 * 
 * Detects S-3 shelf registrations and other filings indicating
 * dilution is armed but not yet triggered.
 * 
 * Scoring: SDR (0-100) = shelf dilution risk × urgency
 * 
 * Output: ONE tweet with ranked tickers + one-line reason each
 * 
 * Usage:
 *   node src/weekly/shelfLeaderboard.js           # Preview
 *   node src/weekly/shelfLeaderboard.js --post    # Post tweet
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

import { postAlertThread } from '../twitterPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DRY_RUN = process.env.DRY_RUN !== 'false';

// Cooldown settings (30 days for weekly leaderboard)
const COOLDOWN_DAYS = parseInt(process.env.SHELF_COOLDOWN_DAYS || '30');
const POSTED_FILE = path.join(DATA_DIR, 'shelf_posted.json');

const SEC_USER_AGENT = 'DilutionHunter/1.0 (dilutionhunter@proton.me)';

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
    if (!res.ok) {
      if (res.status === 429) console.log(`   ⚠️  FMP 429: ${endpoint.split('?')[0]}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEC EDGAR SHELF FILING SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

async function searchSECFilings(query, forms, startDate, endDate, limit = 200) {
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
  // Extract ticker from "Company Name  (TICK, TICK2)  (CIK ...)"
  const match = displayName?.match(/\(([A-Z]{1,5})/);
  return match ? match[1] : null;
}

async function getRecentShelfFilings(days = 7) {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`\n📡 Searching SEC EDGAR for shelf filings (${startDate} to ${endDate})...\n`);

  const tickerMap = new Map();

  // S-3 = Shelf Registration Statement
  console.log('   📄 Searching S-3 (shelf registration)...');
  const s3Filings = await searchSECFilings(
    '"shelf registration" OR "securities registered"',
    'S-3,S-3/A',
    startDate,
    endDate,
    200
  );
  console.log(`      Found ${s3Filings.length} S-3 filings`);

  for (const filing of s3Filings) {
    const source = filing._source;
    const ticker = extractTicker(source.display_names?.[0]);
    if (!ticker) continue;

    const existing = tickerMap.get(ticker);
    const fileDate = source.file_date;
    if (!existing || fileDate > existing.fileDate) {
      tickerMap.set(ticker, {
        ticker,
        companyName: source.display_names?.[0]?.split('  (')[0] || ticker,
        fileDate,
        formType: source.form || 'S-3',
        daysSinceFiling: Math.floor((Date.now() - new Date(fileDate).getTime()) / (1000 * 60 * 60 * 24))
      });
    }
  }

  await new Promise(r => setTimeout(r, 200)); // Rate limit SEC

  // S-1 = Initial Registration (also for capital raises)
  console.log('   📄 Searching S-1 (initial registration)...');
  const s1Filings = await searchSECFilings(
    '"securities registered" OR "offering price"',
    'S-1,S-1/A',
    startDate,
    endDate,
    200
  );
  console.log(`      Found ${s1Filings.length} S-1 filings`);

  for (const filing of s1Filings) {
    const source = filing._source;
    const ticker = extractTicker(source.display_names?.[0]);
    if (!ticker) continue;

    const existing = tickerMap.get(ticker);
    const fileDate = source.file_date;
    if (!existing || fileDate > existing.fileDate) {
      tickerMap.set(ticker, {
        ticker,
        companyName: source.display_names?.[0]?.split('  (')[0] || ticker,
        fileDate,
        formType: source.form || 'S-1',
        daysSinceFiling: Math.floor((Date.now() - new Date(fileDate).getTime()) / (1000 * 60 * 60 * 24))
      });
    }
  }

  await new Promise(r => setTimeout(r, 200));

  // S-8 = Employee Benefit Plan (stock compensation)
  console.log('   📄 Searching S-8 (stock compensation)...');
  const s8Filings = await searchSECFilings(
    '"employee stock" OR "equity incentive" OR "compensation plan"',
    'S-8',
    startDate,
    endDate,
    200
  );
  console.log(`      Found ${s8Filings.length} S-8 filings`);

  for (const filing of s8Filings) {
    const source = filing._source;
    const ticker = extractTicker(source.display_names?.[0]);
    if (!ticker) continue;

    const existing = tickerMap.get(ticker);
    const fileDate = source.file_date;
    // Only add S-8 if no higher priority filing exists
    if (!existing) {
      tickerMap.set(ticker, {
        ticker,
        companyName: source.display_names?.[0]?.split('  (')[0] || ticker,
        fileDate,
        formType: source.form || 'S-8',
        daysSinceFiling: Math.floor((Date.now() - new Date(fileDate).getTime()) / (1000 * 60 * 60 * 24))
      });
    }
  }

  const results = Array.from(tickerMap.values()).sort((a, b) => 
    b.fileDate.localeCompare(a.fileDate)
  );

  console.log(`\n   Found ${results.length} unique shelf filings\n`);
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════════

async function enrichShelfTicker(filing) {
  const { ticker } = filing;
  
  const [profile, quote, balanceSheet, cashFlow] = await Promise.all([
    fmpGet(`/profile?symbol=${ticker}`),
    fmpGet(`/quote?symbol=${ticker}`),
    fmpGet(`/balance-sheet-statement?symbol=${ticker}&limit=1`),
    fmpGet(`/cash-flow-statement?symbol=${ticker}&limit=1`)
  ]);

  const p = Array.isArray(profile) ? profile[0] : profile;
  const q = Array.isArray(quote) ? quote[0] : quote;
  const bs = Array.isArray(balanceSheet) ? balanceSheet[0] : balanceSheet;
  const cf = Array.isArray(cashFlow) ? cashFlow[0] : cashFlow;

  if (!q || !q.marketCap) return null;

  const cash = bs?.cashAndCashEquivalents || bs?.cashAndShortTermInvestments || 0;
  const totalDebt = bs?.totalDebt || 0;
  const ocf = cf?.operatingCashFlow || 0;
  const monthlyBurn = ocf < 0 ? Math.abs(ocf / 12) : 0;
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : 999;

  return {
    ...filing,
    companyName: p?.companyName || filing.companyName,
    price: q.price,
    marketCap: q.marketCap,
    avgVolume: q.avgVolume || 0,
    change: q.changesPercentage || 0,
    yearHigh: q.yearHigh,
    yearLow: q.yearLow,
    cash,
    totalDebt,
    ocf,
    monthlyBurn,
    runwayMonths,
    debtCashRatio: cash > 0 ? totalDebt / cash : 999,
    sharesOutstanding: q.sharesOutstanding || p?.sharesOutstanding || 0
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SDR SCORING (Shelf Dilution Risk)
// ═══════════════════════════════════════════════════════════════════════════════

function calculateSDR(ticker) {
  let score = 0;
  const breakdown = {};

  // 1. Runway Risk (0-25 pts) - shorter runway = more urgent to raise
  const runway = ticker.runwayMonths;
  if (runway < 3) { breakdown.runwayRisk = 25; }
  else if (runway < 6) { breakdown.runwayRisk = 20; }
  else if (runway < 12) { breakdown.runwayRisk = 15; }
  else if (runway < 24) { breakdown.runwayRisk = 10; }
  else { breakdown.runwayRisk = 5; }
  score += breakdown.runwayRisk;

  // 2. Debt Pressure (0-20 pts)
  const debtCash = ticker.debtCashRatio;
  if (debtCash > 10) { breakdown.debtRisk = 20; }
  else if (debtCash > 5) { breakdown.debtRisk = 15; }
  else if (debtCash > 2) { breakdown.debtRisk = 10; }
  else if (debtCash > 1) { breakdown.debtRisk = 5; }
  else { breakdown.debtRisk = 0; }
  score += breakdown.debtRisk;

  // 3. Filing Recency (0-20 pts) - more recent = more urgent
  const days = ticker.daysSinceFiling || 0;
  if (days <= 2) { breakdown.recencyRisk = 20; }
  else if (days <= 5) { breakdown.recencyRisk = 15; }
  else if (days <= 7) { breakdown.recencyRisk = 10; }
  else { breakdown.recencyRisk = 5; }
  score += breakdown.recencyRisk;

  // 4. Market Cap Risk (0-15 pts) - smaller = more dilution impact
  const mcap = ticker.marketCap;
  if (mcap < 50e6) { breakdown.mcapRisk = 15; }
  else if (mcap < 200e6) { breakdown.mcapRisk = 12; }
  else if (mcap < 500e6) { breakdown.mcapRisk = 8; }
  else if (mcap < 1e9) { breakdown.mcapRisk = 5; }
  else { breakdown.mcapRisk = 2; }
  score += breakdown.mcapRisk;

  // 5. Form Type Risk (0-10 pts) - S-3/A amendments = more urgent
  const form = ticker.formType;
  if (form.includes('/A')) { breakdown.formRisk = 10; } // Amendments = moving forward
  else if (form === 'S-3' || form === 'S-1') { breakdown.formRisk = 8; }
  else if (form === '424B5') { breakdown.formRisk = 7; } // Prospectus supplement
  else if (form === 'S-8') { breakdown.formRisk = 5; } // Stock comp plan
  else { breakdown.formRisk = 5; }
  score += breakdown.formRisk;

  // 6. Cash Burn (0-10 pts)
  if (ticker.monthlyBurn > 0) {
    const burnRate = ticker.monthlyBurn;
    if (burnRate > 10e6) { breakdown.burnRisk = 10; }
    else if (burnRate > 5e6) { breakdown.burnRisk = 8; }
    else if (burnRate > 1e6) { breakdown.burnRisk = 5; }
    else { breakdown.burnRisk = 3; }
  } else {
    breakdown.burnRisk = 0; // Profitable
  }
  score += breakdown.burnRisk;

  return {
    score: Math.min(100, Math.round(score)),
    breakdown
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI ONE-LINER GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

async function generateAIOneLiners(tickers) {
  if (!tickers.length) return {};

  const tickerData = tickers.map(t => ({
    ticker: t.ticker,
    sdr: t.scoring.score,
    formType: t.formType,
    daysSinceFiling: t.daysSinceFiling,
    runway: t.runwayMonths?.toFixed(1),
    debtCashRatio: t.debtCashRatio?.toFixed(1),
    marketCap: t.marketCap,
    monthlyBurn: t.monthlyBurn
  }));

  const prompt = `Generate exactly one short reason line for each ticker explaining why this shelf filing is concerning.

Format MUST be: "metric1 · metric2 → meaning clause"

RULES:
1. Use exactly 2 quantitative metrics from: Xmo runway, debt Xx cash, $XM cap, $XM/mo burn, filed Xd ago
2. End with a SHORT meaning clause (2-5 words). VARY these across tickers - use DIFFERENT phrases:
   - "dilution imminent"
   - "emergency capital needed"
   - "shelf prepped for use"
   - "filing suggests raise incoming"
   - "high re-pricing risk"
   - "watch for offerings"
   - "early shelf positioning"
   - "preemptive shelf filing"
   - "dilution setup forming"
   - "funding likely soon"
3. NEVER repeat the same meaning clause twice in the list
4. For market cap < $1M, say "ultra-microcap funding likely" or similar
5. For long runway (>6mo) with high SDR, use "early shelf positioning" or "preemptive filing"
6. Keep total length under 60 characters

Tickers to analyze:
${JSON.stringify(tickerData, null, 2)}

Return ONLY valid JSON object mapping ticker to reason string. Example:
{"TICK1": "2.1mo runway · debt 5.2x cash → dilution likely imminent", "TICK2": "filed 2d ago · $45M cap → shelf ready to deploy"}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.log(`   ⚠️ AI generation failed: ${e.message}`);
  }
  return {};
}

function generateFallbackReason(t, scoring) {
  const parts = [];
  
  if (t.runwayMonths < 24) {
    parts.push(`${t.runwayMonths.toFixed(1)}mo runway`);
  }
  if (t.debtCashRatio > 1) {
    parts.push(`debt ${t.debtCashRatio.toFixed(1)}x cash`);
  }
  if (parts.length < 2 && t.marketCap < 500e6) {
    parts.push(`$${Math.round(t.marketCap / 1e6)}M cap`);
  }
  if (parts.length < 2) {
    parts.push(`filed ${t.daysSinceFiling}d ago`);
  }
  
  // Varied meanings based on metrics
  let meaning;
  if (t.runwayMonths < 1) meaning = 'dilution imminent';
  else if (t.runwayMonths < 3 && t.debtCashRatio > 10) meaning = 'emergency capital needed';
  else if (t.marketCap < 1e6) meaning = 'ultra-microcap funding likely';
  else if (t.runwayMonths > 6) meaning = 'early shelf positioning';
  else if (t.debtCashRatio > 20) meaning = 'high re-pricing risk';
  else meaning = 'dilution setup forming';
  
  return `${parts.slice(0, 2).join(' · ')} → ${meaning}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateShelfLeaderboard(options = {}) {
  const { days = 7, maxTickers = 10, minScore = 30 } = options;

  // Calculate date range for display
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const dateRange = `${formatDate(startDate)}–${formatDate(endDate)}`;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  SHELF OFFERING RADAR — Weekly Filing Scan                                    ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get shelf filings from SEC EDGAR
  console.log(`📡 Step 1: Fetching shelf filings from SEC EDGAR (${days} days)...`);
  const filings = await getRecentShelfFilings(days);

  if (filings.length === 0) {
    return { leaderboard: [], dateRange };
  }

  // Step 2: Enrich with FMP data
  console.log(`📊 Step 2: Enriching with FMP data...\n`);
  const enriched = [];
  
  for (const filing of filings) {
    process.stdout.write(`   ${filing.ticker}...`);
    const data = await enrichShelfTicker(filing);
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
  console.log(`🧮 Step 3: Scoring (SDR) and ranking...\n`);
  const scored = enriched.map(t => {
    const scoring = calculateSDR(t);
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

  console.log(`   ${qualified.length} tickers qualify (SDR ≥ ${minScore})\n`);

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
  console.log('📋 SHELF OFFERING RADAR (Ranked by SDR)');
  console.log('═'.repeat(70));
  
  qualified.forEach((t, i) => {
    console.log(`#${i + 1} $${t.ticker.padEnd(6)} — SDR: ${t.scoring.score.toString().padStart(2)} → ${t.reason}`);
  });
  
  console.log('═'.repeat(70));

  // Build output
  const leaderboard = qualified.map((t, i) => ({
    rank: i + 1,
    ticker: t.ticker,
    companyName: t.companyName,
    score: t.scoring.score,
    formType: t.formType,
    reason: t.reason,
    metrics: {
      runway: t.runwayMonths?.toFixed(1),
      daysSinceFiling: t.daysSinceFiling,
      marketCap: t.marketCap,
      debtCashRatio: t.debtCashRatio?.toFixed(1),
      monthlyBurn: t.monthlyBurn
    }
  }));

  // Save to file
  const outputPath = path.join(DATA_DIR, 'shelf_leaderboard.json');
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
    return `📋 Weekly Shelf Offering Scan

No significant shelf filings this week.
Quiet week = less dilution prep.

Back next week with fresh scans.`;
  }

  // The AI one-liners are already in the data, just format the tweet
  const lines = leaderboardData.leaderboard.slice(0, 10).map(t => 
    `#${t.rank} $${t.ticker} — Risk: ${t.score}/100\n→ ${t.reason}`
  );
  
  return `📋 WEEKLY SHELF OFFERING RADAR
Shelf = legal paperwork to issue new shares later.
Gun is loaded — now we watch for the trigger.
Filings from ${leaderboardData.dateRange}

${lines.join('\n\n')}

Companies file shelves quietly. Most investors never read them.
We do.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

export async function runShelfLeaderboard(options = {}) {
  const { post = false, days = 7, greeting = null } = options;

  const leaderboardData = await generateShelfLeaderboard({ days });
  
  console.log('\n🤖 Generating tweet...\n');
  let tweet = await generateTweet(leaderboardData);
  
  if (greeting) {
    tweet = `${greeting}\n\n${tweet}`;
  }

  console.log('═'.repeat(70));
  console.log('📝 SHELF OFFERING TWEET');
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

  runShelfLeaderboard({ post, days, greeting })
    .then(() => console.log('\n✅ Done!'))
    .catch(e => { console.error(e); process.exit(1); });
}
