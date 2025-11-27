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

Your style:
- Professional analyst tone, but accessible to retail traders
- Data-driven with MULTIPLE dimensions (not just price)
- Balanced — show both bull and bear cases
- Actionable — tell people what to WATCH for next
- Educational — explain every term in plain English

CRITICAL LANGUAGE RULES:
1. NEVER use an acronym without explaining it in plain English
2. ATM = "At-The-Market offering (company can sell new shares directly into the market anytime)"
3. Use analogies: ice cream cones melting, pizza slices, watered-down coffee
4. Assume reader has ZERO finance knowledge
5. Sound like a professional analyst, not a hype account

You don't give financial advice — you spot patterns and explain the mechanics.`;

function buildPrompt(context) {
  // Calculate additional metrics for richer analysis
  const marketCapSize = context.marketCap < 50000000 ? 'micro-cap (extremely vulnerable)' :
                        context.marketCap < 100000000 ? 'tiny (very vulnerable)' :
                        context.marketCap < 300000000 ? 'small (vulnerable)' :
                        context.marketCap < 1000000000 ? 'mid-small (moderate risk)' : 'larger (lower risk)';
  
  const dilutionUrgency = context.daysSinceFiling <= 7 ? 'very fresh - high alert' :
                          context.daysSinceFiling <= 14 ? 'recent - elevated risk' :
                          context.daysSinceFiling <= 21 ? 'within window - watching' : 'aging - may have already acted';
  
  const spikeIntensity = context.peakGain > 200 ? 'massive spike - extreme dilution incentive' :
                         context.peakGain > 100 ? 'major spike - strong dilution incentive' :
                         context.peakGain > 50 ? 'significant spike - notable incentive' : 'moderate move';

  return `Generate a PROFESSIONAL Twitter thread for this ${context.bucket} ticker.

## TICKER DATA
- Symbol: ${context.ticker}
- Company: ${context.companyName}
- Current Price: $${context.price?.toFixed(2) || 'N/A'}
- Market Cap: $${((context.marketCap || 0) / 1e6).toFixed(1)}M — ${marketCapSize}

## THE FILING
- Form: 424B5 (SEC permission slip to sell new shares into the market)
- Filing Date: ${context.filingDate}
- Days Since Filing: ${context.daysSinceFiling} — ${dilutionUrgency}

## PRICE ACTION (7-day window)
- Peak Gain: +${context.peakGain?.toFixed(1)}% — ${spikeIntensity}
- Current Gain: ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(1)}%
- Pullback from Peak: -${context.pullbackFromPeak?.toFixed(1)}%
- Peak Day: Day ${context.peakDay} of 7

## CLASSIFICATION
- Bucket: ${context.bucket}
- Reason: ${context.reason}

## GENERATE A 6-TWEET PROFESSIONAL THREAD

Return JSON with:

1. **tweetHook** (max 280 chars): Lead with the punchline + numbers. Make it punchy.
   Example: "$ANVS up +65% after a +75% peak — but an ATM filing 14 days ago makes this move *fragile.* This is how dilution traps form. 🧵"

2. **tweetBreakdown**: Array of 5 tweets (each max 280 chars). FOLLOW THIS EXACT STRUCTURE:

   **Tweet 1 — What ATM means (plain English)**
   - Define ATM in simple terms
   - Use a memorable analogy (ice cream cones, pizza slices, etc.)
   - Example: "ATM = At-The-Market offering. Company can sell new shares anytime → more supply → weaker price. Like splitting a pizza into more slices — same pie, smaller pieces. 🍕"
   
   **Tweet 2 — The Setup (bullet points with SPECIFIC numbers)**
   Format exactly like this:
   "Why this caught my eye:
   • Market cap: $${((context.marketCap || 0) / 1e6).toFixed(0)}M (tiny = vulnerable)
   • ATM filed: ${context.filingDate} (${context.daysSinceFiling} days ago)
   • Price spiked +${context.peakGain?.toFixed(0)}% → now ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(0)}%
   High price + likely cash need = prime dilution setup"
   
   **Tweet 3 — Supporting Signals (extra dimensions with numbers)**
   Format exactly like this:
   "Additional context:
   • Volume fading — early signs of distribution
   • Small float → dilution hits harder per share
   • ${context.pullbackFromPeak?.toFixed(0)}% off highs — first cracks visible
   Likely motive: company may need funding soon."
   
   **Tweet 4 — What I'm Watching (bear vs bull + trader insight)**
   Format exactly like this:
   "Bear thesis builds if:
   • Heavy red candle with elevated sell volume
   • Price fails to reclaim highs
   • ATM usage confirmed
   
   Bull case: strong volume breakout → ATM may pause.
   Traders get trapped when dilution lands during pullbacks — not the run."
   
   **Tweet 5 — Takeaway (memorable closer with CTA)**
   Format exactly like this:
   "This isn't advice — just pattern recognition.
   
   Big spike + small cap + fresh ATM = elevated risk profile.
   
   Watch how it reacts to selling pressure — that's where dilution becomes visible. 🦅"

3. **chartAnnotations**: Instructions for the chart:
   - highlightZones: Array of { type: 'entry'|'danger'|'watch', startDay: 1-14, endDay: 1-14, label: string }
   - arrows: Array of { day: 1-14, direction: 'up'|'down', label: string }
   - circles: Array of { day: 1-14, target: 'high'|'low'|'close', label: string }
   - volumeNote: String describing volume pattern
   - overallStyle: 'bullish_warning'|'bearish_confirmed'|'neutral_watch'

4. **hashtags**: Array of 3-4 accessible hashtags

5. **sentiment**: 'bearish'|'cautious'|'neutral'

6. **rationale**: One plain-English sentence for someone who knows nothing about stocks.

## QUALITY CHECKLIST (follow these)
✓ INCLUDE THE ACTUAL FILING DATE (e.g., "Filed 11/13")
✓ Every acronym explained on first use
✓ At least 4 specific numbers in the thread
✓ One memorable analogy (pizza, ice cream, coffee)
✓ Bull AND bear scenarios mentioned
✓ "Traders get trapped when..." insight line
✓ Clear "what to watch next" trigger
✓ Professional but accessible tone
✓ No financial advice — just pattern spotting
✓ End with observational CTA (watch, monitor, track)

Respond ONLY with valid JSON.`;
}

async function generateContent(context) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(context) }
    ],
    temperature: 0.7,
    max_tokens: 1500
  });
  
  let content = response.choices[0].message.content;
  if (content.includes('```')) {
    content = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  }
  return JSON.parse(content);
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
  console.log(`   ✓ Hook: "${generated.tweetHook.slice(0, 50)}..."`);
  console.log(`   ✓ Breakdown: "${generated.tweetBreakdown.slice(0, 50)}..."`);
  console.log(`   ✓ Chart annotations: ${generated.chartAnnotations?.arrows?.length || 0} arrows, ${generated.chartAnnotations?.circles?.length || 0} circles`);
  
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
      reason: classification.reason
    },
    tweets: {
      hook: generated.tweetHook,
      breakdown: generated.tweetBreakdown, // Now an array of tweets
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
  const breakdownTweets = Array.isArray(generated.tweetBreakdown) 
    ? generated.tweetBreakdown 
    : [generated.tweetBreakdown];
  
  const breakdownDisplay = breakdownTweets.map((tweet, i) => {
    return `📱 TWEET ${i + 2} (Reply ${i + 1}):
────────────────────────────────────────────────────────────────────────────────
${tweet}
────────────────────────────────────────────────────────────────────────────────
[${tweet.length}/280 chars]`;
  }).join('\n\n');
  
  // Summary
  console.log(`
${'═'.repeat(80)}
✅ PIPELINE COMPLETE
${'═'.repeat(80)}

📱 TWEET 1 (Hook + Image):
────────────────────────────────────────────────────────────────────────────────
${generated.tweetHook}
────────────────────────────────────────────────────────────────────────────────
[${generated.tweetHook.length}/280 chars]
📎 Attach image: ${chartPath}

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
