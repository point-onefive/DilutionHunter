/**
 * INSIDER BUYING RADAR — Weekly Scanner (Friday)
 * 
 * Detects insiders BUYING while stock price is flat/down.
 * "Insiders buy for one reason: they believe."
 * 
 * The BULLISH counterpart to Thursday's Insider Selling Watch.
 * 
 * Scoring: 0-100 = conviction score based on:
 *   - $ amount bought
 *   - C-suite involvement (CEO/CFO > Director)
 *   - Price context (buying dips = more conviction)
 *   - Cluster buying (multiple insiders)
 * 
 * Output: ONE tweet with ranked tickers + one-line reason each
 * 
 * Usage:
 *   node src/weekly/insiderBuyingLeaderboard.js           # Preview
 *   node src/weekly/insiderBuyingLeaderboard.js --post    # Post tweet
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
const COOLDOWN_DAYS = parseInt(process.env.INSIDER_BUY_COOLDOWN_DAYS || '30');
const POSTED_FILE = path.join(DATA_DIR, 'insider_buying_posted.json');

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
async function getLatestInsiderTransactions(pages = 10) {
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

// Group transactions by ticker and filter to PURCHASES only (P-Purchase)
function groupPurchasesByTicker(transactions, days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const byTicker = {};
  
  for (const tx of transactions) {
    // Filter to OPEN MARKET PURCHASES only (P-Purchase)
    // This excludes awards, options exercises, etc.
    if (tx.transactionType !== 'P-Purchase') continue;
    
    // Must have a price (real market transaction)
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

async function analyzeTickerFromPurchases(ticker, purchases) {
  // Get quote and historical for price context
  const [quote, historical] = await Promise.all([
    fmpGet(`/quote?symbol=${ticker}`),
    fmpGet(`/historical-price-eod/full?symbol=${ticker}`)
  ]);

  const q = Array.isArray(quote) ? quote[0] : quote;
  if (!q || !q.marketCap || q.marketCap < 10000000) return null; // Min $10M market cap
  if (q.price < 1) return null; // Skip penny stocks

  // Calculate total value bought
  const totalValueBought = purchases.reduce((sum, t) => {
    const value = (t.securitiesTransacted || 0) * (t.price || 0);
    return sum + value;
  }, 0);

  if (totalValueBought < 50000) return null; // Min $50k in purchases (lower threshold for buys)

  // Calculate shares bought
  const totalSharesBought = purchases.reduce((sum, t) => sum + (t.securitiesTransacted || 0), 0);

  // Get unique insiders buying
  const uniqueInsiders = new Set(purchases.map(t => t.reportingName || t.reportingCik));
  const insiderCount = uniqueInsiders.size;

  // Get roles of buyers
  const hasCEO = purchases.some(t => /ceo|chief executive/i.test(t.typeOfOwner || ''));
  const hasCFO = purchases.some(t => /cfo|chief financial/i.test(t.typeOfOwner || ''));
  const hasDirector = purchases.some(t => /director/i.test(t.typeOfOwner || ''));
  const has10PctOwner = purchases.some(t => /10 percent|10%/i.test(t.typeOfOwner || ''));

  // Calculate % of market cap bought
  const pctMarketCapBought = (totalValueBought / q.marketCap) * 100;

  // Calculate price performance (30 day) - for BUYS, we want to see flat/down prices
  let priceChange30d = 0;
  let priceChangeYTD = 0;
  let volatility30d = 0;
  
  if (Array.isArray(historical) && historical.length >= 2) {
    const sortedPrices = historical.slice(0, 252).reverse(); // oldest to newest
    
    // 30-day change
    if (sortedPrices.length >= 22) {
      const recentPrices = sortedPrices.slice(-22);
      const price30dAgo = recentPrices[0]?.close || sortedPrices[0].close;
      const currentPrice = recentPrices[recentPrices.length - 1]?.close || q.price;
      priceChange30d = ((currentPrice - price30dAgo) / price30dAgo) * 100;
      
      // Calculate volatility (std dev of daily returns)
      const returns = [];
      for (let i = 1; i < recentPrices.length; i++) {
        const ret = (recentPrices[i].close - recentPrices[i-1].close) / recentPrices[i-1].close;
        returns.push(ret);
      }
      if (returns.length > 0) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        volatility30d = Math.sqrt(variance) * 100; // Daily volatility in %
      }
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

  // Largest single purchase
  const largestPurchase = Math.max(...purchases.map(t => 
    (t.securitiesTransacted || 0) * (t.price || 0)
  ));

  // Most recent purchase date
  const mostRecentPurchase = purchases.reduce((latest, t) => {
    const d = new Date(t.transactionDate);
    return d > latest ? d : latest;
  }, new Date(0));
  
  const daysSinceLastPurchase = Math.floor((Date.now() - mostRecentPurchase.getTime()) / (1000 * 60 * 60 * 24));

  // Determine price context (flat, dip, or rising)
  let priceContext = 'flat base';
  if (priceChange30d <= -20) priceContext = 'major dip';
  else if (priceChange30d <= -10) priceContext = 'pullback';
  else if (priceChange30d <= -5) priceContext = 'dip';
  else if (priceChange30d <= 5) priceContext = 'flat base';
  else if (priceChange30d <= 15) priceContext = 'slight uptick';
  else priceContext = 'rally'; // Less attractive for "conviction buy" narrative

  return {
    ticker,
    companyName: q.name || ticker,
    price: q.price,
    marketCap: q.marketCap,
    totalValueBought,
    totalSharesBought,
    pctMarketCapBought,
    insiderCount,
    purchaseCount: purchases.length,
    hasCEO,
    hasCFO,
    hasDirector,
    has10PctOwner,
    priceChange30d,
    priceChangeYTD,
    volatility30d,
    largestPurchase,
    daysSinceLastPurchase,
    priceContext,
    isClusterBuy: insiderCount >= 2 || purchases.length >= 3
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVICTION SCORING (Buy Signal Score)
// ═══════════════════════════════════════════════════════════════════════════════

function calculateConvictionScore(ticker) {
  let score = 0;
  const breakdown = {};

  // 1. Purchase Value Impact (0-25 pts) - % of market cap bought
  const pctBought = ticker.pctMarketCapBought;
  if (pctBought > 2) { breakdown.valueImpact = 25; }
  else if (pctBought > 1) { breakdown.valueImpact = 20; }
  else if (pctBought > 0.5) { breakdown.valueImpact = 15; }
  else if (pctBought > 0.1) { breakdown.valueImpact = 10; }
  else { breakdown.valueImpact = 5; }
  score += breakdown.valueImpact;

  // 2. Price Context (0-25 pts) - buying dips/flat = MORE conviction
  const priceDown = Math.min(0, ticker.priceChange30d); // Negative = good for conviction
  if (priceDown <= -20) { breakdown.priceContext = 25; } // Major dip buy
  else if (priceDown <= -10) { breakdown.priceContext = 20; } // Pullback buy
  else if (priceDown <= -5) { breakdown.priceContext = 15; } // Dip buy
  else if (ticker.priceChange30d <= 5) { breakdown.priceContext = 12; } // Flat base
  else if (ticker.priceChange30d <= 15) { breakdown.priceContext = 5; } // Slight up
  else { breakdown.priceContext = 0; } // Chasing = less interesting
  score += breakdown.priceContext;

  // 3. Insider Seniority (0-25 pts) - CEO/CFO buying = strongest signal
  breakdown.seniority = 0;
  if (ticker.hasCEO) breakdown.seniority += 15;
  if (ticker.hasCFO) breakdown.seniority += 10;
  if (ticker.has10PctOwner) breakdown.seniority += 8;
  if (ticker.hasDirector) breakdown.seniority += 5;
  breakdown.seniority = Math.min(25, breakdown.seniority);
  score += breakdown.seniority;

  // 4. Cluster Signal (0-15 pts) - multiple insiders buying = coordinated conviction
  if (ticker.insiderCount >= 3) { breakdown.cluster = 15; }
  else if (ticker.insiderCount >= 2) { breakdown.cluster = 12; }
  else if (ticker.purchaseCount >= 3) { breakdown.cluster = 8; }
  else if (ticker.purchaseCount >= 2) { breakdown.cluster = 5; }
  else { breakdown.cluster = 0; }
  score += breakdown.cluster;

  // 5. Recency (0-10 pts)
  const days = ticker.daysSinceLastPurchase;
  if (days <= 3) { breakdown.recency = 10; }
  else if (days <= 7) { breakdown.recency = 8; }
  else if (days <= 14) { breakdown.recency = 5; }
  else { breakdown.recency = 2; }
  score += breakdown.recency;

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
    score: t.scoring.score,
    totalValueBought: t.totalValueBought,
    pctMarketCapBought: t.pctMarketCapBought?.toFixed(2),
    insiderCount: t.insiderCount,
    purchaseCount: t.purchaseCount,
    hasCEO: t.hasCEO,
    hasCFO: t.hasCFO,
    has10PctOwner: t.has10PctOwner,
    priceChange30d: t.priceChange30d?.toFixed(1),
    priceContext: t.priceContext,
    isClusterBuy: t.isClusterBuy,
    marketCap: t.marketCap
  }));

  const prompt = `Generate exactly one short reason line for each ticker explaining why this insider BUYING pattern shows conviction.

Format MUST be: "$Xm bought · context → meaning clause"

RULES:
1. ALWAYS start with dollar amount bought (e.g. "$3.9M bought", "$500K bought")
2. ONE context metric combining WHO + PRICE using VARIED language (NEVER repeat):
   - "CEO · -14% dip"
   - "CFO · flat base"
   - "cluster · pullback"
   - "3 insiders · year lows"
   - "CEO + Director · 2-week base"
   - "management · post-earnings dip"
   - "10% owner · consolidation"
   - "CEO · rally" (for rising price cases)
3. End with a SHORT bullish meaning clause (2-4 words):
   - For DIPS/FLAT: "loading the dip", "conviction buy", "quiet accumulation", "smart money entry", "dip buyer detected", "accumulation signal", "loading before move", "confidence buy"
   - For RALLY cases (price up >10%): "rare bullish tell", "insiders buying strength", "conviction entry into strength", "high-conviction momentum buy"
4. NEVER repeat the same meaning clause OR price phrasing twice in the list
5. If hasCEO=true, mention "CEO". If hasCFO=true, mention "CFO". If both, use "CEO + CFO"
6. If isClusterBuy=true (2+ insiders), VARY the label: "cluster", "multiple insiders", "management", "X insiders"
7. Keep total length under 55 characters
8. For stocks where priceChange30d > 10%, use rally-specific meaning clauses to explain the anomaly

Tickers to analyze:
${JSON.stringify(tickerData, null, 2)}

Return ONLY valid JSON object mapping ticker to reason string. Example:
{"TICK1": "$1.2M bought · CEO · -14% dip → loading the dip", "TICK2": "$500K bought · cluster · flat base → quiet accumulation"}`;

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

// Varied price context phrases for buys (emphasize dips/flat)
const PRICE_CONTEXTS = [
  (pct) => pct <= -15 ? 'major dip' : pct <= -5 ? `${Math.abs(Math.round(pct))}% pullback` : 'flat base',
  (pct) => pct <= -10 ? 'post-selloff' : pct <= 0 ? 'consolidation' : 'base building',
  (pct) => pct <= -20 ? 'year lows' : pct <= -5 ? 'dip' : '2-week base',
  (pct) => pct <= -10 ? 'drawdown' : pct <= 5 ? 'tight range' : 'slight uptick',
  (pct) => pct <= -15 ? 'steep pullback' : pct <= 0 ? 'price compression' : 'quiet base',
];

// Bullish meaning clauses
const MEANING_CLAUSES = {
  majorDip: ['loading the dip', 'conviction buy', 'smart money entry', 'bottom fishing'],
  dip: ['dip buyer detected', 'accumulation signal', 'quiet accumulation', 'accumulation phase'],
  flat: ['loading before move', 'flat base build', 'confidence buy', 'patient accumulation'],
  ceoLevel: ['insider confidence', 'management conviction', 'leadership buying', 'C-suite loading'],
  rally: ['rare bullish tell', 'insiders buying strength', 'high-conviction entry', 'buying into momentum'],
};

// Varied cluster labels for buys
const CLUSTER_LABELS = ['cluster', 'multiple insiders', 'management', 'leadership team'];

let fallbackIndex = 0;

function generateFallbackReason(t) {
  const parts = [];
  
  // First: Always lead with $ amount
  const valueMil = t.totalValueBought / 1e6;
  if (valueMil >= 1) {
    parts.push(`$${valueMil.toFixed(1)}M bought`);
  } else {
    parts.push(`$${Math.round(t.totalValueBought / 1000)}K bought`);
  }
  
  // Second: WHO bought + price context
  let whoContext = '';
  if (t.hasCEO && t.hasCFO) {
    whoContext = 'CEO + CFO · ';
  } else if (t.hasCEO) {
    whoContext = 'CEO · ';
  } else if (t.hasCFO) {
    whoContext = 'CFO · ';
  } else if (t.has10PctOwner) {
    whoContext = '10% owner · ';
  } else if (t.isClusterBuy && t.insiderCount >= 2) {
    const clusterLabel = CLUSTER_LABELS[fallbackIndex % CLUSTER_LABELS.length];
    whoContext = `${clusterLabel} · `;
  }
  
  const priceFormatter = PRICE_CONTEXTS[fallbackIndex % PRICE_CONTEXTS.length];
  parts.push(whoContext + priceFormatter(t.priceChange30d));
  
  // Meaning clause - based on metrics (including rally cases)
  let meaningPool;
  if (t.priceChange30d > 10) meaningPool = MEANING_CLAUSES.rally; // Rally case = rare bullish tell
  else if (t.priceChange30d <= -15) meaningPool = MEANING_CLAUSES.majorDip;
  else if (t.priceChange30d <= -5) meaningPool = MEANING_CLAUSES.dip;
  else if (t.hasCEO || t.hasCFO) meaningPool = MEANING_CLAUSES.ceoLevel;
  else meaningPool = MEANING_CLAUSES.flat;
  
  const meaning = meaningPool[fallbackIndex % meaningPool.length];
  fallbackIndex++;
  
  return `${parts.join(' · ')} → ${meaning}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateInsiderBuyingLeaderboard(options = {}) {
  const { maxTickers = 10, minScore = 40 } = options;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  INSIDER BUYING RADAR — Weekly Scan (Friday)                                  ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get latest insider transactions from FMP
  console.log(`📡 Step 1: Fetching insider transactions from FMP...\n`);
  const allTransactions = await getLatestInsiderTransactions(20); // More pages to find buys
  console.log(`\n   Total transactions fetched: ${allTransactions.length}\n`);

  // Step 2: Group by ticker and filter to PURCHASES only
  console.log(`🔍 Step 2: Filtering to open market PURCHASES (P-Purchase)...\n`);
  const purchasesByTicker = groupPurchasesByTicker(allTransactions, 30);
  const tickersWithPurchases = Object.keys(purchasesByTicker);
  console.log(`   Found ${tickersWithPurchases.length} tickers with insider PURCHASES\n`);

  if (tickersWithPurchases.length === 0) {
    return { leaderboard: [], dateRange: '' };
  }

  // Step 3: Analyze each ticker with purchases
  console.log(`📊 Step 3: Analyzing tickers with price data...\n`);
  const analyzed = [];
  
  for (const ticker of tickersWithPurchases) {
    process.stdout.write(`   ${ticker}...`);
    const purchases = purchasesByTicker[ticker];
    const data = await analyzeTickerFromPurchases(ticker, purchases);
    if (data) {
      analyzed.push(data);
      const context = data.priceChange30d <= 0 ? '📉' : '📈';
      console.log(` ✓ $${(data.totalValueBought / 1e6).toFixed(2)}M bought, ${data.priceChange30d.toFixed(0)}% ${context}`);
    } else {
      console.log(` skip`);
    }
    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }

  console.log(`\n   Analyzed ${analyzed.length} tickers with significant purchases\n`);

  if (analyzed.length === 0) {
    return { leaderboard: [], dateRange: '' };
  }

  // Step 4: Score and rank
  console.log(`🎯 Step 4: Scoring and ranking...\n`);
  const scored = analyzed.map(t => ({
    ...t,
    scoring: calculateConvictionScore(t)
  }));

  // Filter by minimum score and cooldown
  const posted = loadPostedHistory();
  const candidates = scored
    .filter(t => t.scoring.score >= minScore)
    .filter(t => !isOnCooldown(t.ticker, posted))
    .sort((a, b) => b.scoring.score - a.scoring.score)
    .slice(0, maxTickers);

  console.log(`   Candidates after filtering: ${candidates.length}\n`);

  if (candidates.length === 0) {
    return { leaderboard: [], dateRange: '' };
  }

  // Step 5: Generate AI one-liners
  console.log(`🤖 Step 5: Generating one-liners...\n`);
  const aiReasons = await generateAIOneLiners(candidates);

  // Build final leaderboard
  const leaderboard = candidates.map((t, i) => ({
    rank: i + 1,
    ticker: t.ticker,
    companyName: t.companyName,
    score: t.scoring.score,
    reason: aiReasons[t.ticker] || generateFallbackReason(t),
    metrics: {
      totalValueBought: t.totalValueBought,
      pctMarketCapBought: t.pctMarketCapBought,
      insiderCount: t.insiderCount,
      purchaseCount: t.purchaseCount,
      priceChange30d: t.priceChange30d,
      priceContext: t.priceContext,
      hasCEO: t.hasCEO,
      hasCFO: t.hasCFO
    },
    breakdown: t.scoring.breakdown
  }));

  // Save output
  const outputPath = path.join(DATA_DIR, 'insider_buying_leaderboard.json');
  const output = {
    generatedAt: new Date().toISOString(),
    scanner: 'insider-buying-radar',
    leaderboard,
    stats: {
      totalTransactions: allTransactions.length,
      tickersWithPurchases: tickersWithPurchases.length,
      analyzed: analyzed.length,
      qualified: candidates.length
    }
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
    return `🟢 Weekly Insider Buying Radar

No significant insider buying this week.
Smart money staying quiet.

Back next week.`;
  }

  const lines = leaderboardData.leaderboard.slice(0, 10).map(t => {
    return `#${t.rank} $${t.ticker} — Score: ${t.score}\n→ ${t.reason}`;
  });
  
  return `🟢 WEEKLY INSIDER BUYING RADAR
Insiders buy weakness — not stories. That's conviction.
📅 Last 30 days · SEC Form 4 filings

${lines.join('\n\n')}

💡 Insiders sell for many reasons — they buy for one: they believe.
👀 Watch what they do — not what they say.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

export async function runInsiderBuyingLeaderboard(options = {}) {
  const { post = false, greeting = null } = options;

  const leaderboardData = await generateInsiderBuyingLeaderboard();
  
  console.log('\n🤖 Generating tweet...\n');
  let tweet = await generateTweet(leaderboardData);
  
  if (greeting) {
    tweet = `${greeting}\n\n${tweet}`;
  }

  console.log('═'.repeat(70));
  console.log('📝 INSIDER BUYING TWEET');
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

  runInsiderBuyingLeaderboard({ post, greeting })
    .then(() => console.log('\n✅ Done!'))
    .catch(e => { console.error(e); process.exit(1); });
}
