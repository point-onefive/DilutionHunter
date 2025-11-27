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

const SYSTEM_PROMPT = `You are DilutionHunter, a sharp-eyed analyst who spots dilution patterns in small-cap stocks. Your style is:
- Direct, no fluff
- Data-driven but accessible
- Slightly edgy, calls out predatory dilution
- Uses trading terminology naturally
- Engages retail traders who want to learn

You generate Twitter content about ATM (At-The-Market) dilution plays.`;

function buildPrompt(context) {
  return `Generate Twitter content for this ${context.bucket} ticker.

## TICKER DATA
- Symbol: ${context.ticker}
- Company: ${context.companyName}
- Current Price: $${context.price?.toFixed(2) || 'N/A'}
- Market Cap: $${((context.marketCap || 0) / 1e6).toFixed(1)}M

## ATM FILING
- Form: 424B5 (Prospectus Supplement = ATM sale)
- Filing Date: ${context.filingDate}
- Days Since Filing: ${context.daysSinceFiling}

## PRICE ACTION (7-day window)
- Peak Gain: +${context.peakGain?.toFixed(1)}% (highest point vs 7 days ago)
- Current Gain: ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(1)}%
- Pullback from Peak: -${context.pullbackFromPeak?.toFixed(1)}%
- Peak Day: Day ${context.peakDay} of 7

## CLASSIFICATION
- Bucket: ${context.bucket}
- Reason: ${context.reason}

## YOUR TASK
Generate a JSON response with:

1. **tweetHook**: First tweet (max 280 chars). LEAD WITH THE PUNCHLINE!
   - For CASE_STUDY: Lead with dramatic gain AND crash percentage
   - For WATCH_LIST: Lead with current gain and what could happen
   - For ACTIONABLE: Lead with the setup percentage and urgency
   
   Good: "INHD ran +400% then crashed -467% in 7 days. Here's the dilution pattern 🧵"
   Bad: "Let's talk about $INHD and what happened..."

2. **tweetBreakdown**: Reply tweet with details (max 280 chars). Numbers, filing info, insight.

3. **chartAnnotations**: Instructions for the chart. Use this structure:
   - highlightZones: Array of { type: 'entry'|'danger'|'watch', startDay: 1-14, endDay: 1-14, label: string }
   - arrows: Array of { day: 1-14, direction: 'up'|'down', label: string }
   - circles: Array of { day: 1-14, target: 'high'|'low'|'close', label: string }
   - volumeNote: String describing volume pattern (or null)
   - overallStyle: 'bullish_warning'|'bearish_confirmed'|'neutral_watch'
   
   For CASE_STUDY: Highlight where entry would have been, mark the crash
   For WATCH_LIST: Highlight current position, mark what to watch for
   For ACTIONABLE: Highlight the setup, mark entry zone

4. **hashtags**: Array of 3-5 relevant hashtags

5. **sentiment**: 'bearish'|'cautious'|'neutral'

6. **rationale**: A 1-2 sentence plain English explanation of WHY we track this pattern.
   This helps educate readers who are new to trading. Example:
   "We track ATM stocks because companies can sell new shares directly into price spikes. When retail buys the hype, the company dumps shares—creating predictable crashes."
   
   Keep it simple for someone who's never traded. Explain the cause and effect.

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
    max_tokens: 1000
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

async function runPipeline(ticker, options = {}) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  DILUTIONHUNTER CONTENT PIPELINE                                              ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get ticker data
  console.log(`📊 Step 1: Fetching data for ${ticker}...`);
  const tickerData = await getTickerData(ticker);
  console.log(`   ✓ Price: $${tickerData.price.toFixed(2)}`);
  console.log(`   ✓ Peak Gain (7d): +${tickerData.peakGain.toFixed(1)}%`);
  console.log(`   ✓ Current: ${tickerData.currentGain >= 0 ? '+' : ''}${tickerData.currentGain.toFixed(1)}%`);
  console.log(`   ✓ Pullback: -${tickerData.pullback.toFixed(1)}%`);
  
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
      pullback: tickerData.pullback
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
      breakdown: generated.tweetBreakdown,
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
    }
  };
  
  const outputPath = path.join(OUTPUT_DIR, `${ticker}_${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`   ✓ Saved: ${outputPath}`);
  
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

📱 TWEET 2 (Reply to above):
────────────────────────────────────────────────────────────────────────────────
${generated.tweetBreakdown}
────────────────────────────────────────────────────────────────────────────────
[${generated.tweetBreakdown.length}/280 chars]

🏷️  Hashtags: ${generated.hashtags?.join(' ') || 'None'}

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
