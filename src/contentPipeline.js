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
// FINANCIAL HEALTH DATA (Balance Sheet + Cash Flow)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch financial health indicators: cash, debt, burn rate, runway
 */
async function fetchFinancialHealth(ticker) {
  try {
    // Fetch balance sheet and cash flow in parallel
    const [balanceRes, cashFlowRes] = await Promise.all([
      fetch(`${FMP_BASE}/balance-sheet-statement?symbol=${ticker}&period=quarter&limit=1&apikey=${FMP_KEY}`),
      fetch(`${FMP_BASE}/cash-flow-statement?symbol=${ticker}&period=quarter&limit=2&apikey=${FMP_KEY}`)
    ]);
    
    const balanceSheet = await balanceRes.json();
    const cashFlow = await cashFlowRes.json();
    
    if (!balanceSheet?.length || !cashFlow?.length) {
      console.log(`   ⚠️  No financial data available for ${ticker}`);
      return null;
    }
    
    const bs = balanceSheet[0];
    const cf = cashFlow[0]; // Most recent quarter
    const cfPrev = cashFlow[1]; // Previous quarter (for trend)
    
    // Extract key metrics
    const cash = bs.cashAndCashEquivalents || 0;
    const totalDebt = bs.totalDebt || (bs.shortTermDebt || 0) + (bs.longTermDebt || 0);
    const operatingCashFlow = cf.operatingCashFlow || cf.netCashProvidedByOperatingActivities || 0;
    const quarterlyBurn = operatingCashFlow < 0 ? Math.abs(operatingCashFlow) : 0;
    const monthlyBurn = quarterlyBurn / 3;
    
    // Calculate runway (months of cash left at current burn rate)
    const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : null;
    
    // Previous quarter burn for trend
    const prevOperatingCF = cfPrev?.operatingCashFlow || cfPrev?.netCashProvidedByOperatingActivities || 0;
    const prevQuarterlyBurn = prevOperatingCF < 0 ? Math.abs(prevOperatingCF) : 0;
    const burnTrend = quarterlyBurn > prevQuarterlyBurn ? 'accelerating' : 
                      quarterlyBurn < prevQuarterlyBurn * 0.8 ? 'improving' : 'stable';
    
    // Recent stock issuance (signs of active dilution)
    const recentStockIssuance = cf.commonStockIssuance || cf.netCommonStockIssuance || 0;
    
    return {
      // Cash position
      cash,
      cashFormatted: formatMoney(cash),
      
      // Debt
      totalDebt,
      debtFormatted: formatMoney(totalDebt),
      
      // Burn rate
      quarterlyBurn,
      monthlyBurn,
      monthlyBurnFormatted: formatMoney(monthlyBurn),
      burnTrend,
      
      // Runway (months of cash left at current burn rate)
      runwayMonths,
      runwayFormatted: runwayMonths !== null ? 
        (runwayMonths < 1 ? '< 1 month of cash left' : 
         runwayMonths < 12 ? `~${Math.round(runwayMonths)} months of cash left` : 
         `~${Math.round(runwayMonths / 12)} years of cash`) : 'N/A',
      
      // Dilution signals
      recentStockIssuance,
      hasRecentDilution: recentStockIssuance > 0,
      
      // Report date
      reportDate: bs.date,
      reportPeriod: bs.period,
      
      // Distress indicators
      isDistressed: (runwayMonths !== null && runwayMonths < 6) || (totalDebt > cash * 5),
      distressLevel: runwayMonths !== null && runwayMonths < 3 ? 'critical' :
                     runwayMonths !== null && runwayMonths < 6 ? 'severe' :
                     runwayMonths !== null && runwayMonths < 12 ? 'moderate' : 'low'
    };
  } catch (error) {
    console.log(`   ⚠️  Failed to fetch financials: ${error.message}`);
    return null;
  }
}

function formatMoney(amount) {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPENAI TWEET GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are DilutionHunter, a sharp-eyed analyst who spots dilution patterns in small-cap stocks.

Your communication style:
- Short-form, direct, punchy, zero jargon
- Feels like a trader whispering what's about to break
- Sounds like a signal, not a research paper
- Risk awareness framing, never trade suggestions

Two-layer communication:
1. Fast alert tweet — short, clear, unmistakably bearish
2. Full breakdown thread — narrative + metrics + thesis

Language rules:
- Plain English, no analogies or metaphors (no pizza, pie, coffee references)
- Explain mechanics directly: "company sells shares → more supply → price drops"
- Include framing: "not advice — pattern recognition", "elevated risk profile"

You don't give financial advice — you spot patterns and explain mechanics.`;

// ATM explanation variations (rotate to avoid repetition)
const ATM_EXPLANATIONS = [
  "ATM = At-The-Market offering. Company hired a broker to sell new shares directly into the open market at current prices. They can sell whenever they want — you won't know until it's done.",
  "ATM filing means the company got SEC approval to sell shares directly into the market. No announcement, no discount — just quiet selling into any buying pressure.",
  "What's an ATM? Company files paperwork letting them sell new shares at market price through a broker. They typically sell into pumps to maximize cash raised.",
  "ATM = permission to print shares. Company can now sell stock directly into the market whenever they need cash. More shares = each share worth less.",
  "The ATM filing: company lined up a broker to drip-sell new shares into the market. They don't announce when — you find out later when the share count increases.",
];

function getATMExplanation() {
  // Rotate based on day of year to vary explanations
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return ATM_EXPLANATIONS[dayOfYear % ATM_EXPLANATIONS.length];
}

function buildPrompt(context) {
  // Calculate risk score for categorization
  const riskScore = calculateRiskScore(context);
  const alertTone = riskScore >= 65 ? 'HIGH RISK ALERT' : 'WATCH';
  const alertEmoji = riskScore >= 65 ? '🚨' : '🟡';
  
  // Get today's ATM explanation variation
  const atmExplanation = getATMExplanation();
  
  // Calculate additional metrics
  const marketCapSize = context.marketCap < 50000000 ? 'micro-cap (extremely vulnerable)' :
                        context.marketCap < 100000000 ? 'tiny (very vulnerable)' :
                        context.marketCap < 300000000 ? 'small (vulnerable)' :
                        context.marketCap < 1000000000 ? 'mid-small (moderate risk)' : 'larger (lower risk)';
  
  const filingAge = context.daysSinceFiling <= 3 ? 'just filed' :
                    context.daysSinceFiling <= 7 ? 'very fresh' :
                    context.daysSinceFiling <= 14 ? 'recent' : 'within window';

  // Build financial health section if available
  const fh = context.financialHealth;
  const financialHealthSection = fh ? `
## FINANCIAL HEALTH (Why They Need Cash)
- Cash on Hand: ${fh.cashFormatted}
- Total Debt: ${fh.debtFormatted}
- Monthly Burn Rate: ${fh.monthlyBurnFormatted}/month
- How Long Cash Lasts: ${fh.runwayFormatted}
- Distress Level: ${fh.distressLevel.toUpperCase()}
- Burn Trend: ${fh.burnTrend}
- Report Date: ${fh.reportDate} (${fh.reportPeriod})
${fh.hasRecentDilution ? `- ⚠️ Already diluted $${(fh.recentStockIssuance / 1e6).toFixed(1)}M last quarter via stock issuance` : ''}

THIS IS THE "WHY": ${
  fh.runwayMonths !== null && fh.runwayMonths < 3 ? `With only ${fh.runwayFormatted}, this company is running on fumes. The ATM isn't optional — it's survival.` :
  fh.runwayMonths !== null && fh.runwayMonths < 6 ? `At ${fh.cashFormatted} cash with ${fh.monthlyBurnFormatted}/month burn, they have ${fh.runwayFormatted}. The ATM is their lifeline.` :
  fh.runwayMonths !== null && fh.runwayMonths < 12 ? `Burning ${fh.monthlyBurnFormatted}/month with ${fh.cashFormatted} cash = ~${Math.round(fh.runwayMonths)} months runway. They'll likely tap this ATM soon.` :
  fh.totalDebt > fh.cash * 3 ? `Debt (${fh.debtFormatted}) is crushing their ${fh.cashFormatted} cash position. ATM dilution likely to shore up balance sheet.` :
  `Balance sheet isn't critical yet, but the ATM gives them a loaded gun for dilution whenever they want.`
}` : `
## FINANCIAL HEALTH
- Data not available for this ticker
- Default assumption: Small-cap with ATM filing = likely burning cash`;

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
${financialHealthSection}

## RISK ASSESSMENT
- Score: ${riskScore}%
- Category: ${alertTone}
- Bucket: ${context.bucket}

## OUTPUT STRUCTURE — GENERATE EXACTLY THIS:

Return JSON with these fields:

### 1. tweetAlert — THE FAST ALERT
This is the HOOK. Write it like a trader's quick heads-up — punchy, direct, delivers value fast. Not an essay, but complete enough to understand the setup.

FORMAT WITH LINE BREAKS for visual clarity (use \\n in JSON):
${alertEmoji} [Hook line about ticker]

[Key stats - spike, current level, ATM date]
[Financial context - cash/runway if critical]

[ONE-SENTENCE NARRATIVE — see below]

🧵 Full breakdown below

**THE NARRATIVE SENTENCE IS CRITICAL.** Based on the bucket and this ticker's specific metrics, write ONE sentence that answers: "What story is the data telling, and why should the reader care?"

BUCKET: ${context.bucket}
${context.bucket === 'ACTIONABLE' ? `
ACTIONABLE NARRATIVE GUIDANCE:
This setup has LIVE dilution risk. Use the specific metrics (${fh ? `${fh.runwayFormatted}, ${fh.cashFormatted} cash, ${fh.monthlyBurnFormatted}/mo burn` : 'cash-strapped balance sheet'}, +${context.peakGain?.toFixed(0)}% spike, ATM filed ${context.filingDate}) to explain WHY this is urgent.
Example angles:
- "With ${fh?.runwayFormatted || 'almost no cash left'} and a ${filingAge} ATM, the ingredients for dilution are live."
- "This has the markers historically seen before dilution events — risk is developing now."
Goal: communicate urgency + ongoing threat using THIS company's numbers.
` : context.bucket === 'WATCH_LIST' ? `
WATCH_LIST NARRATIVE GUIDANCE:
Conditions are forming but not confirmed. Use the specific metrics (${fh ? `${fh.runwayFormatted}` : 'unknown financials'}, +${context.peakGain?.toFixed(0)}% spike, ${context.pullbackFromPeak?.toFixed(0)}% pullback) to explain what's developing.
Example angles:
- "Conditions forming that often precede dilution — not confirmed, but tracking."
- "+${context.peakGain?.toFixed(0)}% run with ATM overhead — watching for breakdown signals."
Goal: signal interest, not action. Use THIS company's situation.
` : `
CASE_STUDY NARRATIVE GUIDANCE:
The dilution already played out. Use the metrics (+${context.peakGain?.toFixed(0)}% peak → now ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(0)}%, ${context.pullbackFromPeak?.toFixed(0)}% crash) to frame the educational lesson.
Example angles:
- "This chart shows how dilution unfolded — useful blueprint for future setups."
- "From +${context.peakGain?.toFixed(0)}% to ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(0)}% — textbook ATM dilution pattern."
Goal: turn this specific outcome into pattern recognition education.
`}

MUST include these elements:
- ${alertEmoji} emoji at start
- The ticker ($${context.ticker})
- Key stats (spike, current level, ATM date, cash situation if relevant)
- ONE-SENTENCE NARRATIVE tailored to this ticker's bucket + metrics
- End with "🧵 Full breakdown below"

VARY the structure. The narrative sentence should feel specific to THIS company, not generic.

### 2. tweetBreakdown — Array of 5 tweets (keep each punchy but complete)

Use NUMBER EMOJIS instead of "1/" "2/" etc. Use: 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣

**Thread Tweet 1 — ATM Explainer (NO analogies, direct explanation)**
Start with "1️⃣" then the content. Use this explanation (or rephrase slightly): "${atmExplanation}"

**Thread Tweet 2 — The Setup + WHY They Need Cash**
Start with "2️⃣". Combine price action with financial evidence:
• Market cap: $${((context.marketCap || 0) / 1e6).toFixed(0)}M
• ATM filed: ${context.filingDate}
• Spiked +${context.peakGain?.toFixed(0)}% → now ${context.currentGain >= 0 ? '+' : ''}${context.currentGain?.toFixed(0)}%
${fh ? `• Cash: ${fh.cashFormatted} | Burn: ${fh.monthlyBurnFormatted}/mo | ${fh.runwayFormatted}` : '• Financials: Typical small-cap cash crunch'}
High price + cash need = dilution setup

**Thread Tweet 3 — Confirming Signals**
Start with "3️⃣". What to watch for:
• Heavy red candle with volume
• Selling pressure expanding
• Support break without recovery
• ${context.pullbackFromPeak?.toFixed(0)}% off highs already
${fh && fh.distressLevel !== 'low' ? `Motive clear: ${fh.distressLevel} distress level` : 'Company has motive to raise cash'}

**Thread Tweet 4 — Bear vs Bull Scenarios**
Start with "4️⃣". Bear thesis builds if:
• Red candle + sell volume spike
• Price fails to reclaim highs
• ATM usage confirmed

Bull invalidation: strong volume breakout

Traders get trapped when dilution lands during pullbacks — not the run.

**Thread Tweet 5 — Final Takeaway**
Start with "5️⃣". Reinforce the narrative from the alert tweet. Reference THIS company's specific situation:
${context.bucket === 'ACTIONABLE' ? `- Summarize why the risk is LIVE (use their cash/runway/burn numbers)
- "The setup is in motion" framing` : context.bucket === 'WATCH_LIST' ? `- Summarize what you're watching for (specific to their metrics)
- "Tracking, not acting yet" framing` : `- Summarize the lesson learned from this specific outcome
- "Blueprint for next time" framing`}
End with: "Not advice — pattern recognition only. 🦅"

### 3. chartAnnotations
- highlightZones: Array of { type: 'entry'|'danger'|'watch', startDay, endDay, label }
- arrows: Array of { day, direction: 'up'|'down', label }
- overallStyle: 'bearish_confirmed'|'cautious_watch'|'neutral_watch'

### 4. sentiment — 'bearish'|'cautious'|'neutral'

### 5. riskCategory — '${alertTone}'

## CRITICAL REQUIREMENTS
✓ Alert tweet: punchy but complete — include ONE-SENTENCE NARRATIVE specific to this ticker's bucket + metrics
✓ Alert must end with "🧵 Full breakdown below"
✓ Include financial evidence (cash, burn, runway) in Thread Tweet 2
✓ Use ${alertEmoji} emoji for ${alertTone} tone
✓ NO ANALOGIES — explain mechanics directly
✓ Both bear AND bull scenarios in thread
✓ "Traders get trapped when..." insight
✓ No financial advice — pattern spotting only
✓ NO HASHTAGS — do not include any hashtags
✓ Keep tweets punchy and scannable — not essays, but complete thoughts

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
    model: 'gpt-5.1',  // Upgraded from gpt-4o
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(context) }
    ],
    temperature: 0.7,
    max_completion_tokens: 2000  // GPT-5+ uses max_completion_tokens instead of max_tokens
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
  
  // Step 2.5: Fetch financial health data
  console.log(`\n💰 Step 2.5: Fetching financial health...`);
  const financialHealth = await fetchFinancialHealth(ticker);
  if (financialHealth) {
    console.log(`   ✓ Cash: ${financialHealth.cashFormatted}`);
    console.log(`   ✓ Debt: ${financialHealth.debtFormatted}`);
    console.log(`   ✓ Monthly Burn: ${financialHealth.monthlyBurnFormatted}`);
    console.log(`   ✓ Runway: ${financialHealth.runwayFormatted}`);
    console.log(`   ✓ Distress Level: ${financialHealth.distressLevel}`);
  } else {
    console.log(`   ⚠️  No financial data available`);
  }
  
  // Step 3: Generate content via OpenAI
  console.log(`\n🤖 Step 3: Generating content via OpenAI...`);
  const context = generateGPTContext(tickerData, classification, tweetDecision);
  // Add financial health to context
  context.financialHealth = financialHealth;
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
