/**
 * TWEET GENERATOR - Uses OpenAI to generate tweets + chart annotations
 * 
 * Input: Classified ticker data from contentManager
 * Output: 
 *   - Tweet thread (hook + breakdown)
 *   - Chart annotation instructions (arrows, circles, highlights)
 * 
 * Usage:
 *   node src/tweetGenerator.js INHD
 *   node src/tweetGenerator.js INHD --bucket=CASE_STUDY
 */

import 'dotenv/config';
import OpenAI from 'openai';
import { classifyTicker, generateGPTContext, shouldTweet, loadHistory } from './contentManager.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are DilutionHunter, a sharp-eyed analyst who spots dilution patterns in small-cap stocks. Your style is:
- Direct, no fluff
- Data-driven but accessible
- Slightly edgy, calls out predatory dilution
- Uses trading terminology naturally
- Engages retail traders who want to learn

You generate Twitter content about ATM (At-The-Market) dilution plays. These are stocks where:
1. Company has an ATM shelf registration (allows selling shares directly into the market)
2. Stock pumps (retail FOMO, promoters, etc.)
3. Company sells shares into the pump (dilution)
4. Stock crashes as supply overwhelms demand

Your job is to create educational and actionable content about these patterns.`;

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT GENERATION PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

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
${context.isFollowUp ? '- THIS IS A FOLLOW-UP: We previously alerted this ticker, now showing outcome' : ''}
${context.isUpgrade ? '- THIS IS AN UPGRADE: Previously on watch list, now actionable' : ''}

## CONTENT GUIDELINES
- Tone: ${context.contentGuidelines?.tone || 'Educational'}
- Goal: ${context.contentGuidelines?.goal || 'Inform'}
- Structure: ${context.contentGuidelines?.structure || 'Standard'}
- CTA: ${context.contentGuidelines?.cta || 'Follow for more'}

## YOUR TASK
Generate a JSON response with:

1. **tweetHook**: The first tweet (max 280 chars). This is the scroll-stopper.
   
   ⚠️ CRITICAL: Lead with the punchline! The hook must contain the most dramatic number/fact FIRST.
   
   Examples of GOOD hooks (lead with the highlight):
   - "INHD ran +400% then crashed -467% in 7 days. Here's the dilution pattern that killed it 🧵"
   - "+215% to +54% in 3 days. $MNDR is getting dumped via ATM dilution. Breakdown:"
   - "This $1.7M microcap pumped 400% while insiders filed to sell shares. Classic ATM trap."
   
   Examples of BAD hooks (bury the lead):
   - "Let's talk about $INHD and what happened with their ATM filing..."
   - "Here's an interesting case study about dilution..."
   - "I've been watching this stock and noticed something..."
   
   For CASE_STUDY: Lead with the dramatic gain AND crash percentage
   For WATCH_LIST: Lead with the current gain and what could happen
   For ACTIONABLE: Lead with the setup percentage and urgency

2. **tweetBreakdown**: The reply tweet with details (max 280 chars). Numbers, filing info, key insight.

3. **chartAnnotations**: Instructions for chart generation. Include:
   - highlightZones: Array of { type: 'entry'|'exit'|'danger', startDay: 1-7, endDay: 1-7, label: string }
   - arrows: Array of { day: 1-7, direction: 'up'|'down', label: string }
   - circles: Array of { day: 1-7, target: 'high'|'low'|'close', label: string }
   - volumeNote: String describing volume pattern to highlight (or null)
   - overallStyle: 'bullish_warning'|'bearish_confirmed'|'neutral_watch'

4. **hashtags**: Array of relevant hashtags (3-5)

5. **sentiment**: 'bearish'|'cautious'|'neutral' - overall tone for visual styling

Respond ONLY with valid JSON, no markdown code blocks.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPENAI CALL
// ═══════════════════════════════════════════════════════════════════════════════

async function generateTweetContent(context) {
  const prompt = buildPrompt(context);
  
  console.log('\n🤖 Calling OpenAI...\n');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 1000
  });
  
  const content = response.choices[0].message.content;
  
  // Parse JSON response
  try {
    // Handle potential markdown code blocks
    let jsonStr = content;
    if (content.includes('```')) {
      jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('Failed to parse OpenAI response as JSON:');
    console.error(content);
    throw new Error('OpenAI did not return valid JSON');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════

function displayResult(ticker, classification, tweetDecision, generated) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  GENERATED CONTENT FOR ${ticker.ticker.padEnd(6)}                                        ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  console.log(`📊 Classification: ${classification.emoji} ${classification.bucket}`);
  console.log(`   ${classification.reason}\n`);
  
  console.log(`📱 TWEET THREAD`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`\n🔹 HOOK (Tweet 1):\n`);
  console.log(`   "${generated.tweetHook}"`);
  console.log(`   [${generated.tweetHook.length}/280 chars]\n`);
  
  console.log(`🔹 BREAKDOWN (Tweet 2 - Reply):\n`);
  console.log(`   "${generated.tweetBreakdown}"`);
  console.log(`   [${generated.tweetBreakdown.length}/280 chars]\n`);
  
  console.log(`🏷️  Hashtags: ${generated.hashtags?.join(' ') || 'None'}\n`);
  
  console.log(`📈 CHART ANNOTATIONS`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`   Style: ${generated.chartAnnotations?.overallStyle || 'default'}`);
  console.log(`   Sentiment: ${generated.sentiment || 'neutral'}\n`);
  
  if (generated.chartAnnotations?.highlightZones?.length > 0) {
    console.log(`   Highlight Zones:`);
    generated.chartAnnotations.highlightZones.forEach(z => {
      console.log(`      - ${z.type.toUpperCase()}: Day ${z.startDay}-${z.endDay} "${z.label}"`);
    });
  }
  
  if (generated.chartAnnotations?.arrows?.length > 0) {
    console.log(`   Arrows:`);
    generated.chartAnnotations.arrows.forEach(a => {
      console.log(`      - Day ${a.day} ${a.direction === 'up' ? '↑' : '↓'} "${a.label}"`);
    });
  }
  
  if (generated.chartAnnotations?.circles?.length > 0) {
    console.log(`   Circles:`);
    generated.chartAnnotations.circles.forEach(c => {
      console.log(`      - Day ${c.day} (${c.target}) "${c.label}"`);
    });
  }
  
  if (generated.chartAnnotations?.volumeNote) {
    console.log(`   Volume Note: "${generated.chartAnnotations.volumeNote}"`);
  }
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`✅ Ready to post!`);
  console.log(`   - Tweet decision: ${tweetDecision.shouldTweet ? 'YES' : 'NO'} (${tweetDecision.reason})`);
  
  return generated;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN / CLI
// ═══════════════════════════════════════════════════════════════════════════════

async function generateForTicker(tickerData) {
  // Classify
  const classification = classifyTicker(tickerData);
  const tweetDecision = shouldTweet(tickerData, classification);
  
  // Generate GPT context
  const context = generateGPTContext(tickerData, classification, tweetDecision);
  
  // Call OpenAI
  const generated = await generateTweetContent(context);
  
  // Display
  displayResult(tickerData, classification, tweetDecision, generated);
  
  return {
    ticker: tickerData,
    classification,
    tweetDecision,
    generated
  };
}

// CLI
const args = process.argv.slice(2);
const tickerArg = args.find(a => !a.startsWith('--'));

if (!tickerArg) {
  console.log('Usage: node src/tweetGenerator.js <TICKER>');
  console.log('Example: node src/tweetGenerator.js INHD');
  process.exit(1);
}

// For now, use hardcoded sample data (later this will come from atmScanner)
const sampleData = {
  INHD: { 
    ticker: 'INHD', 
    companyName: 'INNO Holdings Inc', 
    peakGain: 399.5, 
    currentGain: -67.4, 
    pullback: 466.8, 
    peakDay: 5, 
    fileDate: '2025-11-13', 
    form: '424B5',
    price: 0.23, 
    marketCap: 1700000,
    daysSinceFiling: 14
  },
  MNDR: { 
    ticker: 'MNDR', 
    companyName: 'Mobile-health Network Solutions', 
    peakGain: 215.1, 
    currentGain: 54.1, 
    pullback: 161.0, 
    peakDay: 4, 
    fileDate: '2025-11-24', 
    form: '424B5',
    price: 2.65, 
    marketCap: 2300000,
    daysSinceFiling: 3
  },
  ANVS: { 
    ticker: 'ANVS', 
    companyName: 'Annovis Bio Inc', 
    peakGain: 76.2, 
    currentGain: 65.1, 
    pullback: 11.1, 
    peakDay: 7, 
    fileDate: '2025-10-28', 
    form: '424B5',
    price: 4.92, 
    marketCap: 96800000,
    daysSinceFiling: 30
  },
  GPUS: { 
    ticker: 'GPUS', 
    companyName: 'Hyperscale Data Inc', 
    peakGain: 72.5, 
    currentGain: 66.5, 
    pullback: 6.0, 
    peakDay: 7, 
    fileDate: '2025-11-04', 
    form: '424B5',
    price: 0.33, 
    marketCap: 36400000,
    daysSinceFiling: 23
  }
};

const ticker = tickerArg.toUpperCase();
const tickerData = sampleData[ticker];

if (!tickerData) {
  console.log(`Unknown ticker: ${ticker}`);
  console.log(`Available: ${Object.keys(sampleData).join(', ')}`);
  process.exit(1);
}

try {
  await generateForTicker(tickerData);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
