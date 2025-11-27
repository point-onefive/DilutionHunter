/**
 * CONTENT PIPELINE - Full end-to-end content generation for Twitter
 * 
 * Flow:
 *   1. Fetch ticker data (price, candles)
 *   2. Classify into bucket (Case Study / Watch List / Actionable)
 *   3. Generate tweets + chart instructions via OpenAI
 *   4. Create annotated chart image
 *   5. Output ready-to-post content
 * 
 * Usage:
 *   node src/contentPipeline.js INHD              # Full pipeline for ticker
 *   node src/contentPipeline.js INHD --force      # Generate even if already tweeted
 *   node src/contentPipeline.js INHD --record     # Record in tweet history
 */

import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { classifyTicker, generateGPTContext, shouldTweet, recordTweet, loadHistory } from './contentManager.js';
import { generateChart, fetchCandles } from './chartGenerator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';

// ═══════════════════════════════════════════════════════════════════════════════
// OPENAI TWEET GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are DilutionHunter, a sharp-eyed analyst who spots dilution patterns in small-cap stocks.

Your communication style:
- Short-form, direct, punchy, zero jargon where avoidable
- Feels like a trader whispering what's about to break
- Sounds like a signal, not a research paper
- Risk awareness framing, never trade suggestions

Two-layer communication:
1. Fast alert tweet — short, clear, unmistakably bearish
2. Full breakdown thread — narrative + metrics + thesis

Language rules:
- Every acronym explained in plain English
- ATM = "At-The-Market offering" (company sells new shares directly into market)
- Use analogies: pizza slices, watered-down coffee
- Assume reader has ZERO finance knowledge
- Include framing: "not advice — pattern recognition", "elevated risk profile"

You don't give financial advice — you spot patterns and explain mechanics.`;

function buildPrompt(context) {
  // Calculate risk score for categorization
  const riskScore = calculateRiskScore(context);
  const alertTone = riskScore >= 65 ? 'HIGH RISK ALERT' : 'WATCH';
  const alertEmoji = riskScore >= 65 ? '🚨' : '🟡';
  
  // Calculate additional metrics
  const marketCapSize = context.marketCap < 50000000 ? 'micro-cap (extremely vulnerable)' :
                        context.marketCap < 100000000 ? 'tiny (very vulnerable)' :
                        context.marketCap < 300000000 ? 'small (vulnerable)' :
                        context.marketCap < 1000000000 ? 'mid-small (moderate risk)' : 'larger (lower risk)';
  
  const filingAge = context.daysSinceFiling <= 3 ? 'just filed' :
                    context.daysSinceFiling <= 7 ? 'very fresh' :
                    context.daysSinceFiling <= 14 ? 'recent' : 'within window';

  return `Generate a TWO-LAYER Twitter alert for this dilution setup.

## TICKER DATA
- Symbol: ${context.ticker}
- Company: ${context.companyName}
- Current Price: $${context.price?.toFixed(2) || 'N/A'}
- Market Cap: $${((context.marketCap || 0) / 1e6).toFixed(1)}M — ${marketCapSize}

## THE FILING
- Form: 424B5 ATM Filing
- Filing Date: ${context.filingDate}
- Days Since Filing: ${context.daysSinceFiling} (${filingAge})

## PRICE ACTION
- Peak Gain: +${context.peakGain?.toFixed(0)}%
- Current Gain: ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(0)}%
- Pullback from Peak: -${context.pullbackFromPeak?.toFixed(0)}%

## RISK ASSESSMENT
- Score: ${riskScore}%
- Category: ${alertTone}
- Bucket: ${context.bucket}

## OUTPUT STRUCTURE — GENERATE EXACTLY THIS:

Return JSON with these fields:

### 1. tweetAlert (max 280 chars) — THE FAST ALERT
This is the HOOK. Must be readable in 3 seconds. 5-7 lines max.
Format EXACTLY like this template:

"${alertEmoji} Dilution Risk Setup — $${context.ticker}

+${context.peakGain?.toFixed(0)}% spike → now ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(0)}%
ATM filed ${context.filingDate} (${filingAge})
$${((context.marketCap || 0) / 1e6).toFixed(0)}M cap = vulnerable
Volume fading from peak

Pump → ATM → slow bleed pattern forming

Full breakdown below ↓"

### 2. tweetBreakdown — Array of 5 tweets (each max 280 chars)

**Thread Tweet 1 — ATM Explainer (analogy required)**
Explain what ATM means in plain English. Use pizza or pie analogy.
Example: "ATM = At-The-Market offering. Company can sell new shares anytime → more supply → weaker price. Like splitting a pizza into more slices — same pie, smaller pieces. 🍕"

**Thread Tweet 2 — The Setup (bullet points with numbers)**
Why this caught my eye:
• Market cap: $${((context.marketCap || 0) / 1e6).toFixed(0)}M (tiny = vulnerable)
• ATM filed: ${context.filingDate} (${context.daysSinceFiling} days ago)
• Spiked +${context.peakGain?.toFixed(0)}% → now ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(0)}%
High price + cash need = prime dilution setup

**Thread Tweet 3 — Confirming Signals**
What to watch for:
• Heavy red candle with volume
• Selling pressure expanding
• Support break without recovery
• ${context.pullbackFromPeak?.toFixed(0)}% off highs — cracks forming
Motive: company likely needs funding

**Thread Tweet 4 — Bear vs Bull Scenarios**
Bear thesis builds if:
• Red candle + sell volume spike
• Price fails to reclaim highs
• ATM usage confirmed

Bull invalidation: strong volume breakout

Traders get trapped when dilution lands during pullbacks — not the run.

**Thread Tweet 5 — Final Takeaway**
Pattern recognition frame. Risk awareness. Single sentence summary.
Example: "Not advice — just pattern recognition. Big spike + small cap + fresh ATM = elevated risk profile. Watch how it reacts to selling pressure. 🦅"

### 3. chartAnnotations
- highlightZones: Array of { type: 'entry'|'danger'|'watch', startDay, endDay, label }
- arrows: Array of { day, direction: 'up'|'down', label }
- overallStyle: 'bearish_confirmed'|'cautious_watch'|'neutral_watch'

### 4. hashtags — Array of 3-4 tags like #Stocks #Trading #Dilution

### 5. sentiment — 'bearish'|'cautious'|'neutral'

### 6. riskCategory — '${alertTone}'

## CRITICAL REQUIREMENTS
✓ Alert tweet must be 5-7 lines, readable in 3 seconds
✓ Must end alert with "Full breakdown below ↓"
✓ Include: peak %, current %, ATM age, market cap, volume trend
✓ Use ${alertEmoji} emoji for ${alertTone} tone
✓ Every acronym explained
✓ At least one analogy (pizza, pie, coffee)
✓ Both bear AND bull scenarios in thread
✓ "Traders get trapped when..." insight
✓ No financial advice — pattern spotting only
✓ Risk framing: "elevated risk profile", "not advice"

Respond ONLY with valid JSON.`;
}

function calculateRiskScore(context) {
  let score = 50; // Base score
  
  // Filing recency (fresher = higher risk)
  if (context.daysSinceFiling <= 3) score += 20;
  else if (context.daysSinceFiling <= 7) score += 15;
  else if (context.daysSinceFiling <= 14) score += 10;
  
  // Peak gain (higher spike = more dilution incentive)
  if (context.peakGain > 200) score += 15;
  else if (context.peakGain > 100) score += 10;
  else if (context.peakGain > 50) score += 5;
  
  // Pullback (bigger pullback = dilution may already be happening)
  if (context.pullbackFromPeak > 50) score += 10;
  else if (context.pullbackFromPeak > 30) score += 5;
  
  // Market cap (smaller = more vulnerable)
  if (context.marketCap < 50000000) score += 10;
  else if (context.marketCap < 100000000) score += 5;
  
  return Math.min(score, 100);
}

async function generateContent(context) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(context) }
    ],
    temperature: 0.7,
    max_tokens: 2000
  });
  
  let content = response.choices[0].message.content;
  if (content.includes('```')) {
    content = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  }
  
  const parsed = JSON.parse(content);
  
  // Map new field names to expected structure
  // tweetAlert -> hook (the fast alert)
  // tweetBreakdown -> breakdown (the thread)
  return {
    hook: parsed.tweetAlert || parsed.tweetHook,
    breakdown: parsed.tweetBreakdown,
    chartAnnotations: parsed.chartAnnotations,
    hashtags: parsed.hashtags,
    sentiment: parsed.sentiment,
    riskCategory: parsed.riskCategory || (calculateRiskScore(context) >= 65 ? 'HIGH RISK ALERT' : 'WATCH'),
    rationale: parsed.rationale
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH TICKER DATA
// ═══════════════════════════════════════════════════════════════════════════════

async function getTickerData(symbol) {
  // Get quote
  const quoteRes = await fetch(`${FMP_BASE}/quote?symbol=${symbol}&apikey=${FMP_KEY}`);
  const quoteData = await quoteRes.json();
  const quote = quoteData[0];
  
  if (!quote) throw new Error(`No quote data for ${symbol}`);
  
  // Get candles for peak calculation
  const candles = await fetchCandles(symbol, 14);
  const window = candles.slice(-7); // Last 7 days
  
  const startPrice = window[0].open;
  const currentPrice = window[window.length - 1].close;
  const peakHigh = Math.max(...window.map(c => c.high));
  
  const peakGain = ((peakHigh - startPrice) / startPrice) * 100;
  const currentGain = ((currentPrice - startPrice) / startPrice) * 100;
  const pullback = peakGain - currentGain;
  const peakDayIdx = window.findIndex(c => c.high === peakHigh);
  const peakDay = peakDayIdx + 1;
  
  // Detect SAME-DAY spike+crash scenario
  const peakCandle = window[peakDayIdx];
  const peakIntraday = ((peakCandle.high - peakCandle.open) / peakCandle.open) * 100;
  const peakCandleBody = ((peakCandle.close - peakCandle.open) / peakCandle.open) * 100;
  const isSameDaySpikeCrash = peakIntraday > 50 && peakCandleBody < peakIntraday * 0.3;
  
  // Count ramp-up days before peak
  let rampDays = 0;
  for (let i = peakDayIdx - 1; i >= 0; i--) {
    if (window[i].close > window[i].open) rampDays++;
    else break;
  }
  
  return {
    ticker: symbol,
    companyName: quote.name || symbol,
    price: quote.price,
    marketCap: quote.marketCap,
    peakGain,
    currentGain,
    pullback,
    peakDay,
    isSameDaySpikeCrash,
    rampDays,
    // These would come from SEC lookup, hardcoded for now
    fileDate: '2025-11-13',
    form: '424B5',
    daysSinceFiling: 14,
    candles
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function runPipeline(ticker, options = {}) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  DILUTIONHUNTER CONTENT PIPELINE                                              ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get ticker data
  console.log(`📊 Step 1: Fetching data for ${ticker}...`);
  const tickerData = await getTickerData(ticker);
  
  // Override with passed filing date if available
  if (options.fileDate) {
    tickerData.fileDate = options.fileDate;
    tickerData.daysSinceFiling = options.daysSinceFiling || Math.floor((Date.now() - new Date(options.fileDate).getTime()) / (24 * 60 * 60 * 1000));
  }
  
  console.log(`   ✓ Price: $${tickerData.price.toFixed(2)}`);
  console.log(`   ✓ Peak Gain (7d): +${tickerData.peakGain.toFixed(1)}%`);
  console.log(`   ✓ Current: ${tickerData.currentGain >= 0 ? '+' : ''}${tickerData.currentGain.toFixed(1)}%`);
  console.log(`   ✓ Pullback: -${tickerData.pullback.toFixed(1)}%`);
  console.log(`   ✓ Filing Date: ${tickerData.fileDate} (${tickerData.daysSinceFiling} days ago)`);
  
  // Step 2: Classify
  console.log(`\n🏷️  Step 2: Classifying...`);
  const classification = classifyTicker(tickerData);
  const tweetDecision = shouldTweet(tickerData, classification);
  console.log(`   ✓ Bucket: ${classification.emoji} ${classification.bucket}`);
  console.log(`   ✓ Reason: ${classification.reason}`);
  console.log(`   ✓ Quality: ${classification.quality || 'N/A'} - ${classification.qualityNote || ''}`);
  console.log(`   ✓ Should tweet: ${tweetDecision.shouldTweet ? 'YES' : 'NO'} (${tweetDecision.reason})`);
  
  // Check quality for educational value
  if (classification.quality === 'POOR' && !options.force) {
    console.log(`\n⚠️  QUALITY WARNING: ${classification.qualityNote}`);
    console.log(`   This pattern may not be ideal for educational content.`);
    console.log(`   Use --force to generate anyway.\n`);
    return null;
  }
  
  if (!tweetDecision.shouldTweet && !options.force) {
    console.log(`\n⚠️  Skipping — already tweeted or doesn't meet criteria.`);
    console.log(`   Use --force to generate anyway.\n`);
    return null;
  }
  
  // Step 3: Generate content via OpenAI
  console.log(`\n🤖 Step 3: Generating content via OpenAI...`);
  const context = generateGPTContext(tickerData, classification, tweetDecision);
  const generated = await generateContent(context);
  const riskScore = calculateRiskScore(context);
  console.log(`   ✓ Risk Score: ${riskScore}% (${generated.riskCategory})`);
  console.log(`   ✓ Alert: "${generated.hook.slice(0, 50)}..."`);
  console.log(`   ✓ Thread: ${generated.breakdown?.length || 0} tweets`);
  console.log(`   ✓ Chart annotations: ${generated.chartAnnotations?.arrows?.length || 0} arrows`);
  
  // Step 4: Generate chart
  console.log(`\n📈 Step 4: Generating chart...`);
  const chartPath = await generateChart(
    ticker,
    tickerData.candles,
    generated.chartAnnotations,
    { 
      bucket: classification.bucket,
      peakGain: tickerData.peakGain,
      currentGain: tickerData.currentGain,
      pullback: tickerData.pullback,
      filingDate: tickerData.fileDate
    }
  );
  
  // Step 5: Save output
  console.log(`\n💾 Step 5: Saving output...`);
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const outputData = {
    ticker: tickerData.ticker,
    generatedAt: new Date().toISOString(),
    classification: {
      bucket: classification.bucket,
      reason: classification.reason,
      riskScore: calculateRiskScore(context),
      riskCategory: generated.riskCategory
    },
    tweets: {
      hook: generated.hook,  // The fast alert tweet
      breakdown: generated.breakdown, // Array of thread tweets
      hashtags: generated.hashtags
    },
    chartPath,
    chartAnnotations: generated.chartAnnotations,
    tickerData: {
      price: tickerData.price,
      marketCap: tickerData.marketCap,
      peakGain: tickerData.peakGain,
      currentGain: tickerData.currentGain,
      pullback: tickerData.pullback
    },
    rationale: generated.rationale
  };
  
  const outputPath = path.join(OUTPUT_DIR, `${ticker}_${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`   ✓ Saved: ${outputPath}`);
  
  // Format breakdown tweets for display
  const breakdownTweets = Array.isArray(generated.breakdown) 
    ? generated.breakdown 
    : [generated.breakdown];
  
  const breakdownDisplay = breakdownTweets.map((tweet, i) => {
    return `📱 THREAD ${i + 1}/${breakdownTweets.length}:
────────────────────────────────────────────────────────────────────────────────
${tweet}
────────────────────────────────────────────────────────────────────────────────
[${tweet.length}/280 chars]`;
  }).join('\n\n');
  
  // Summary
  console.log(`
${'═'.repeat(80)}
✅ PIPELINE COMPLETE — ${generated.riskCategory}
${'═'.repeat(80)}

🚨 ALERT TWEET (Hook + Image):
────────────────────────────────────────────────────────────────────────────────
${generated.hook}
────────────────────────────────────────────────────────────────────────────────
[${generated.hook.length}/280 chars]
📎 Attach image: ${chartPath}

📝 BREAKDOWN THREAD:
${breakdownDisplay}

🏷️  Hashtags: ${generated.hashtags?.join(' ') || 'None'}
💡 Rationale: ${generated.rationale || 'N/A'}

📊 Chart saved: ${chartPath}
📄 Full data: ${outputPath}
${'═'.repeat(80)}
`);

  // Record in history
  if (options.record) {
    recordTweet(tickerData, classification.bucket, 'Generated via pipeline');
    console.log(`📝 Recorded in tweet history.\n`);
  }

  return outputData;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

// Only run CLI if this file is executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.endsWith('contentPipeline.js');

if (isMainModule && !process.argv[1]?.includes('dailyRun') && !process.argv[1]?.includes('dailySelector')) {
  const args = process.argv.slice(2);
  const ticker = args.find(a => !a.startsWith('--'))?.toUpperCase();
  const force = args.includes('--force');
  const record = args.includes('--record');

  if (!ticker) {
    console.log(`
Usage: node src/contentPipeline.js <TICKER> [options]

Options:
  --force    Generate even if already tweeted
  --record   Record in tweet history after generation

Examples:
  node src/contentPipeline.js INHD
  node src/contentPipeline.js INHD --force --record
`);
    process.exit(1);
  }

  try {
    await runPipeline(ticker, { force, record });
  } catch (err) {
    console.error(`\n❌ Pipeline error: ${err.message}\n`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}
