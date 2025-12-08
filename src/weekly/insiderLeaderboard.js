/**
 * INSIDER SELLING DISCONNECT WATCH — Weekly Scanner
 * 
 * Detects insiders selling while stock price is rising.
 * "When insiders sell while price goes up, something doesn't add up."
 * 
 * Scoring: IDS (0-100) = insider selling × optimism disconnect
 * 
 * Output: ONE tweet with ranked tickers + one-line reason each
 * 
 * Usage:
 *   node src/weekly/insiderLeaderboard.js           # Preview
 *   node src/weekly/insiderLeaderboard.js --post    # Post tweet
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
const COOLDOWN_DAYS = parseInt(process.env.INSIDER_COOLDOWN_DAYS || '30');
const POSTED_FILE = path.join(DATA_DIR, 'insider_posted.json');

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
// INSIDER TRANSACTION SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

// Get latest insider transactions across all companies
async function getLatestInsiderTransactions(pages = 5) {
  console.log(`   Fetching ${pages} pages of insider transactions...`);
  
  const allTransactions = [];
  
  for (let page = 0; page < pages; page++) {
    const data = await fmpGet(`/insider-trading/latest?page=${page}&limit=100`);
    if (!Array.isArray(data) || data.length === 0) break;
    allTransactions.push(...data);
    console.log(`      Page ${page + 1}: ${data.length} transactions`);
    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }
  
  return allTransactions;
}

// Group transactions by ticker and filter to SALES only
function groupTransactionsByTicker(transactions, days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const byTicker = {};
  
  for (const tx of transactions) {
    // Filter to sales only (S-Sale or Disposition)
    if (tx.transactionType !== 'S-Sale' && tx.acquisitionOrDisposition !== 'D') continue;
    // Skip gifts (no price = no real sale)
    if (tx.transactionType === 'G-Gift') continue;
    if (!tx.price || tx.price === 0) continue;
    
    // Check date
    const txDate = new Date(tx.transactionDate);
    if (txDate < cutoffDate) continue;
    
    const ticker = tx.symbol;
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) continue;
    
    if (!byTicker[ticker]) {
      byTicker[ticker] = [];
    }
    byTicker[ticker].push(tx);
  }
  
  return byTicker;
}

async function analyzeTickerFromTransactions(ticker, sales) {
  // Get quote and historical for price context
  const [quote, historical] = await Promise.all([
    fmpGet(`/quote?symbol=${ticker}`),
    fmpGet(`/historical-price-eod/full?symbol=${ticker}`)
  ]);

  const q = Array.isArray(quote) ? quote[0] : quote;
  if (!q || !q.marketCap || q.marketCap < 10000000) return null; // Min $10M market cap
  if (q.price < 1) return null; // Skip penny stocks

  // Calculate total value sold
  const totalValueSold = sales.reduce((sum, t) => {
    const value = (t.securitiesTransacted || 0) * (t.price || 0);
    return sum + value;
  }, 0);

  if (totalValueSold < 100000) return null; // Min $100k in sales

  // Calculate shares sold
  const totalSharesSold = sales.reduce((sum, t) => sum + (t.securitiesTransacted || 0), 0);

  // Get unique insiders selling
  const uniqueInsiders = new Set(sales.map(t => t.reportingName || t.reportingCik));
  const insiderCount = uniqueInsiders.size;

  // Get roles of sellers
  const hasCEO = sales.some(t => /ceo|chief executive/i.test(t.typeOfOwner || ''));
  const hasCFO = sales.some(t => /cfo|chief financial/i.test(t.typeOfOwner || ''));
  const hasDirector = sales.some(t => /director/i.test(t.typeOfOwner || ''));

  // Calculate % of market cap sold
  const pctMarketCapSold = (totalValueSold / q.marketCap) * 100;

  // Calculate price performance (30 day)
  let priceChange30d = 0;
  let priceChangeYTD = 0;
  
  if (Array.isArray(historical) && historical.length >= 2) {
    const sortedPrices = historical.slice(0, 252).reverse(); // oldest to newest
    
    // 30-day change
    if (sortedPrices.length >= 22) {
      const price30dAgo = sortedPrices[sortedPrices.length - 22]?.close || sortedPrices[0].close;
      const currentPrice = sortedPrices[sortedPrices.length - 1]?.close || q.price;
      priceChange30d = ((currentPrice - price30dAgo) / price30dAgo) * 100;
    }
    
    // YTD change
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const ytdPrices = sortedPrices.filter(p => new Date(p.date) >= yearStart);
    if (ytdPrices.length >= 2) {
      const startPrice = ytdPrices[0].close;
      const currentPrice = ytdPrices[ytdPrices.length - 1].close;
      priceChangeYTD = ((currentPrice - startPrice) / startPrice) * 100;
    }
  }

  // Largest single sale
  const largestSale = Math.max(...sales.map(t => 
    (t.securitiesTransacted || 0) * (t.price || 0)
  ));

  // Most recent sale date
  const mostRecentSale = sales.reduce((latest, t) => {
    const d = new Date(t.transactionDate);
    return d > latest ? d : latest;
  }, new Date(0));
  
  const daysSinceLastSale = Math.floor((Date.now() - mostRecentSale.getTime()) / (1000 * 60 * 60 * 24));

  return {
    ticker,
    companyName: q.name || ticker,
    price: q.price,
    marketCap: q.marketCap,
    totalValueSold,
    totalSharesSold,
    pctMarketCapSold,
    insiderCount,
    salesCount: sales.length,
    hasCEO,
    hasCFO,
    hasDirector,
    priceChange30d,
    priceChangeYTD,
    largestSale,
    daysSinceLastSale,
    isClusterSale: insiderCount >= 2 || sales.length >= 3
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// IDS SCORING (Insider Disconnect Score)
// ═══════════════════════════════════════════════════════════════════════════════

function calculateIDS(ticker) {
  let score = 0;
  const breakdown = {};

  // 1. Selling Value Impact (0-25 pts) - % of market cap sold
  const pctSold = ticker.pctMarketCapSold;
  if (pctSold > 5) { breakdown.valueImpact = 25; }
  else if (pctSold > 2) { breakdown.valueImpact = 20; }
  else if (pctSold > 1) { breakdown.valueImpact = 15; }
  else if (pctSold > 0.5) { breakdown.valueImpact = 10; }
  else { breakdown.valueImpact = 5; }
  score += breakdown.valueImpact;

  // 2. Price Disconnect (0-25 pts) - selling while stock is UP
  const priceUp = Math.max(ticker.priceChange30d, 0);
  if (priceUp > 50) { breakdown.priceDisconnect = 25; }
  else if (priceUp > 30) { breakdown.priceDisconnect = 20; }
  else if (priceUp > 15) { breakdown.priceDisconnect = 15; }
  else if (priceUp > 5) { breakdown.priceDisconnect = 10; }
  else { breakdown.priceDisconnect = 0; } // No disconnect if price flat/down
  score += breakdown.priceDisconnect;

  // 3. Insider Seniority (0-20 pts)
  breakdown.seniority = 0;
  if (ticker.hasCEO) breakdown.seniority += 10;
  if (ticker.hasCFO) breakdown.seniority += 7;
  if (ticker.hasDirector) breakdown.seniority += 3;
  breakdown.seniority = Math.min(20, breakdown.seniority);
  score += breakdown.seniority;

  // 4. Cluster Signal (0-15 pts) - multiple insiders or multiple sales
  if (ticker.insiderCount >= 3) { breakdown.cluster = 15; }
  else if (ticker.insiderCount >= 2) { breakdown.cluster = 12; }
  else if (ticker.salesCount >= 3) { breakdown.cluster = 10; }
  else if (ticker.salesCount >= 2) { breakdown.cluster = 5; }
  else { breakdown.cluster = 0; }
  score += breakdown.cluster;

  // 5. Recency (0-10 pts)
  const days = ticker.daysSinceLastSale;
  if (days <= 3) { breakdown.recency = 10; }
  else if (days <= 7) { breakdown.recency = 8; }
  else if (days <= 14) { breakdown.recency = 5; }
  else { breakdown.recency = 2; }
  score += breakdown.recency;

  // 6. Dollar Amount (0-5 pts) - absolute size matters for attention
  const valueSold = ticker.totalValueSold;
  if (valueSold > 10e6) { breakdown.dollarSize = 5; }
  else if (valueSold > 5e6) { breakdown.dollarSize = 4; }
  else if (valueSold > 1e6) { breakdown.dollarSize = 3; }
  else { breakdown.dollarSize = 1; }
  score += breakdown.dollarSize;

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
    ids: t.scoring.score,
    totalValueSold: t.totalValueSold,
    pctMarketCapSold: t.pctMarketCapSold?.toFixed(2),
    insiderCount: t.insiderCount,
    salesCount: t.salesCount,
    hasCEO: t.hasCEO,
    hasCFO: t.hasCFO,
    priceChange30d: t.priceChange30d?.toFixed(1),
    isClusterSale: t.isClusterSale,
    marketCap: t.marketCap
  }));

  const prompt = `Generate exactly one short reason line for each ticker explaining why this insider selling pattern is concerning.

Format MUST be: "$Xm sold · context → meaning clause"

RULES:
1. ALWAYS start with dollar amount sold (e.g. "$3.9M sold", "$22M sold", "$175K sold")
2. ONE context metric combining WHO + PRICE using VARIED language (NEVER use same price word twice):
   - "CEO + CFO · +38% rally"
   - "multiple execs · new highs"  
   - "CEO · peak breakout"
   - "3 insiders · +29% spike"
   - "management · extended rally"
   - "cluster · momentum stretch"
   - "CEO · YTD highs"
   - "1 insider · parabolic"
   - "senior leadership · +8% bounce"
3. End with a SHORT trader-native meaning clause with HERO WORDS (2-4 words):
   - "dumping into strength"
   - "distribution at peak"
   - "smart money exiting"
   - "top-ticking the move"
   - "confidence fading"
   - "quiet profit-taking"
   - "exit wave forming"
   - "insider exit signal"
   - "exit into strength"
   - "risk of snapback"
4. NEVER repeat the same meaning clause OR price word (rally/breakout/spike/bounce) OR cluster label twice in the list
5. If hasCEO=true, mention "CEO". If hasCFO=true, mention "CFO". If both, use "CEO + CFO"
6. If isClusterSale=true (3+ insiders), VARY the label: "cluster", "multiple execs", "management", "X insiders", "senior leadership"
7. Keep total length under 55 characters

Tickers to analyze:
${JSON.stringify(tickerData, null, 2)}

Return ONLY valid JSON object mapping ticker to reason string. Example:
{"TICK1": "$3.9M sold · CEO + CFO · +38% rally → dumping into strength", "TICK2": "$22M sold · multiple execs · new highs → exit into strength"}`;

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

// Varied price context phrases (no repeats - rally/breakout/spike/parabolic)
const PRICE_CONTEXTS = [
  (pct) => `+${Math.round(pct)}% rally`,
  (pct) => `+${Math.round(pct)}% breakout`,
  (pct) => `new highs`,
  (pct) => `+${Math.round(pct)}% spike`,
  (pct) => `momentum stretch`,
  (pct) => pct > 40 ? `parabolic` : `+${Math.round(pct)}% bounce`,
];

// Trader-native meaning clauses with hero words
const MEANING_CLAUSES = {
  highMomentum: ['dumping into strength', 'distribution at peak', 'selling the top', 'top-ticking the move'],
  ceoSale: ['confidence fading', 'insider exit signal', 'smart money exiting', 'exit wave forming'],
  cluster: ['coordinated exit', 'smart money leaving', 'risk-off tell', 'insiders heading out'],
  moderate: ['quiet profit-taking', 'risk of snapback', 'fading buyers', 'momentum could snap']
};

// Varied cluster labels
const CLUSTER_LABELS = ['cluster', 'multiple execs', 'management', 'senior leadership'];

let fallbackIndex = 0; // Track to avoid repeats

function generateFallbackReason(t) {
  const parts = [];
  
  // First: Always lead with $ amount
  const valueMil = t.totalValueSold / 1e6;
  if (valueMil >= 1) {
    parts.push(`$${valueMil.toFixed(1)}M sold`);
  } else {
    parts.push(`$${Math.round(t.totalValueSold / 1000)}K sold`);
  }
  
  // Second: WHO sold (CEO/CFO/cluster) + price context
  let whoContext = '';
  if (t.hasCEO && t.hasCFO) {
    whoContext = 'CEO + CFO · ';
  } else if (t.hasCEO) {
    whoContext = 'CEO · ';
  } else if (t.hasCFO) {
    whoContext = 'CFO · ';
  } else if (t.isClusterSale && t.insiderCount >= 3) {
    const clusterLabel = CLUSTER_LABELS[fallbackIndex % CLUSTER_LABELS.length];
    whoContext = `${clusterLabel} · `;
  }
  
  const priceFormatter = PRICE_CONTEXTS[fallbackIndex % PRICE_CONTEXTS.length];
  parts.push(whoContext + priceFormatter(t.priceChange30d));
  
  // Meaning clause - based on metrics, varied
  let meaningPool;
  if (t.priceChange30d > 30) meaningPool = MEANING_CLAUSES.highMomentum;
  else if (t.hasCEO || t.hasCFO) meaningPool = MEANING_CLAUSES.ceoSale;
  else if (t.isClusterSale) meaningPool = MEANING_CLAUSES.cluster;
  else meaningPool = MEANING_CLAUSES.moderate;
  
  const meaning = meaningPool[fallbackIndex % meaningPool.length];
  fallbackIndex++;
  
  return `${parts.join(' · ')} → ${meaning}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateInsiderLeaderboard(options = {}) {
  const { maxTickers = 10, minScore = 40 } = options;

  // Calculate date range for display
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const dateRange = `${formatDate(startDate)}–${formatDate(endDate)}`;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  INSIDER SELLING DISCONNECT WATCH — Weekly Scan                               ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get latest insider transactions from FMP
  console.log(`📡 Step 1: Fetching insider transactions from FMP...\n`);
  const allTransactions = await getLatestInsiderTransactions(10); // 10 pages = ~1000 transactions
  console.log(`\n   Total transactions fetched: ${allTransactions.length}\n`);

  // Step 2: Group by ticker and filter to sales
  console.log(`🔍 Step 2: Grouping sales by ticker...\n`);
  const salesByTicker = groupTransactionsByTicker(allTransactions, 30);
  const tickersWithSales = Object.keys(salesByTicker);
  console.log(`   Found ${tickersWithSales.length} tickers with insider SALES\n`);

  if (tickersWithSales.length === 0) {
    return { leaderboard: [], dateRange };
  }

  // Step 3: Analyze each ticker with sales
  console.log(`📊 Step 3: Analyzing tickers with price data...\n`);
  const analyzed = [];
  
  for (const ticker of tickersWithSales) {
    process.stdout.write(`   ${ticker}...`);
    const sales = salesByTicker[ticker];
    const data = await analyzeTickerFromTransactions(ticker, sales);
    if (data) {
      analyzed.push(data);
      console.log(` ✓ $${(data.totalValueSold / 1e6).toFixed(1)}M sold, +${data.priceChange30d.toFixed(0)}%`);
    } else {
      console.log(` skip`);
    }
    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }

  console.log(`\n   Analyzed ${analyzed.length} tickers with significant sales\n`);

  if (analyzed.length === 0) {
    return { leaderboard: [], dateRange };
  }

  // Step 4: Score and rank
  console.log(`🧮 Step 4: Scoring (IDS) and ranking...\n`);
  const scored = analyzed.map(t => {
    const scoring = calculateIDS(t);
    return { ...t, scoring };
  });

  // Load cooldown history
  const posted = loadPostedHistory();
  const skippedCooldown = [];

  // Filter by minimum score, require price UP (disconnect), exclude cooldown
  const qualified = scored
    .filter(t => {
      if (t.scoring.score < minScore) return false;
      if (t.priceChange30d < 5) return false; // Must be selling into STRENGTH
      if (isOnCooldown(t.ticker, posted)) {
        skippedCooldown.push(t.ticker);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.scoring.score - a.scoring.score)
    .slice(0, maxTickers);

  // Add rank
  qualified.forEach((t, i) => { t.rank = i + 1; });

  if (skippedCooldown.length > 0) {
    console.log(`   ⏳ Skipped ${skippedCooldown.length} on cooldown: ${skippedCooldown.slice(0, 5).join(', ')}${skippedCooldown.length > 5 ? '...' : ''}\n`);
  }

  console.log(`   ${qualified.length} tickers qualify (score ≥ ${minScore}, price +5%+)\n`);

  // Step 4: Generate AI one-liners
  console.log(`🤖 Step 4: Generating AI one-liners...\n`);
  const aiOneLiners = await generateAIOneLiners(qualified);
  
  qualified.forEach(t => {
    if (aiOneLiners && aiOneLiners[t.ticker]) {
      t.reason = aiOneLiners[t.ticker];
    } else {
      t.reason = generateFallbackReason(t);
    }
  });

  // Step 5: Display leaderboard
  console.log('═'.repeat(70));
  console.log('🕵️ INSIDER SELLING WATCH (Ranked by Risk)');
  console.log('═'.repeat(70));
  
  qualified.forEach((t, i) => {
    console.log(`#${i + 1} $${t.ticker.padEnd(6)} — Risk: ${t.scoring.score.toString().padStart(2)}/100 → ${t.reason}`);
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
      totalValueSold: t.totalValueSold,
      pctMarketCapSold: t.pctMarketCapSold?.toFixed(2),
      insiderCount: t.insiderCount,
      salesCount: t.salesCount,
      priceChange30d: t.priceChange30d?.toFixed(1),
      hasCEO: t.hasCEO,
      hasCFO: t.hasCFO,
      isClusterSale: t.isClusterSale
    }
  }));

  // Save to file
  const outputPath = path.join(DATA_DIR, 'insider_leaderboard.json');
  const output = {
    generatedAt: new Date().toISOString(),
    period: '30d',
    dateRange,
    totalTransactions: allTransactions.length,
    tickersWithSales: tickersWithSales.length,
    analyzed: analyzed.length,
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
    return `🔻 Weekly Insider Selling Watch

No significant insider disconnect this week.
Insiders holding steady.

Back next week.`;
  }

  const lines = leaderboardData.leaderboard.slice(0, 10).map(t => {
    return `#${t.rank} $${t.ticker} — Risk: ${t.score}/100\n→ ${t.reason}`;
  });
  
  return `🔻 WEEKLY INSIDER SELLING WATCH
Price rising + insiders selling = someone's leaving early.
📅 Last 30 days · SEC Form 4 filings

${lines.join('\n\n')}

💬 Insiders give interviews. Their trades tell the truth — every time.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

export async function runInsiderLeaderboard(options = {}) {
  const { post = false, greeting = null } = options;

  const leaderboardData = await generateInsiderLeaderboard();
  
  console.log('\n🤖 Generating tweet...\n');
  let tweet = await generateTweet(leaderboardData);
  
  if (greeting) {
    tweet = `${greeting}\n\n${tweet}`;
  }

  console.log('═'.repeat(70));
  console.log('📝 INSIDER SELLING TWEET');
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

  runInsiderLeaderboard({ post, greeting })
    .then(() => console.log('\n✅ Done!'))
    .catch(e => { console.error(e); process.exit(1); });
}
