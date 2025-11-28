/**
 * WEEKLY ATM ROUNDUP
 * 
 * Generates a simple informational tweet listing all companies that filed
 * ATM offerings in the past N days. No analysis, just awareness.
 * 
 * Usage:
 *   node src/weeklyRoundup.js                # Last 5 trading days (default)
 *   node src/weeklyRoundup.js --days=10      # Last 10 days
 *   node src/weeklyRoundup.js --post         # Actually post to Twitter
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { postAlertThread } from './twitterPoster.js';
import { getRecentATMFilings } from './atmScanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTED_FILE = path.join(__dirname, '..', 'data', 'postedRoundups.json');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ═══════════════════════════════════════════════════════════════════════════════
// TRACKING - Avoid posting same tickers twice
// ═══════════════════════════════════════════════════════════════════════════════

function loadPostedTickers() {
  try {
    if (fs.existsSync(POSTED_FILE)) {
      return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Warning: Could not load posted tickers:', err.message);
  }
  return { tickers: {} };  // { tickers: { "AMZE": "2025-11-28", ... } }
}

function savePostedTickers(data) {
  const dir = path.dirname(POSTED_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(POSTED_FILE, JSON.stringify(data, null, 2));
}

function filterNewFilings(filings, postedData) {
  return filings.filter(f => !postedData.tickers[f.ticker]);
}

function markAsPosted(filings, postedData) {
  const today = new Date().toISOString().split('T')[0];
  filings.forEach(f => {
    postedData.tickers[f.ticker] = today;
  });
  savePostedTickers(postedData);
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPENAI ROUNDUP GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

async function generateRoundupTweet(filings, days) {
  const tickerList = filings.map(f => `$${f.ticker}`).join(', ');
  const tickerCount = filings.length;
  
  const prompt = `Generate a Twitter post for a weekly ATM filing roundup.

## CONTEXT
These ${tickerCount} companies filed 424B5 ATM (At-The-Market) offerings with the SEC in the past ${days} days:

${filings.map(f => `- $${f.ticker} (${f.companyName}) — filed ${f.fileDate}`).join('\n')}

## WHAT TO INCLUDE

1. **Brief ATM definition** — Explain what an ATM filing means in plain English:
   - Company filed paperwork with SEC to sell new shares directly into the market
   - They hire a broker to sell shares at current market prices
   - They can sell whenever they want — no announcement required
   - Shareholders only find out later when share count increases
   - Companies typically sell into price strength to maximize cash raised

2. **The ticker list** — All ${tickerCount} tickers that filed

3. **Framing** — This is informational awareness, not analysis or advice. Just letting people know these filings happened.

## FORMAT
- Start with an attention-grabbing line about the week's ATM filings
- Include the ATM explanation (2-3 sentences, plain English)
- List the tickers
- End with a note that this is just awareness — no analysis, no advice

## TONE
- Informational, not alarmist
- Educational
- Neutral — we're not saying these will crash, just that the filing exists
- Professional

## OUTPUT
Return a JSON object with:
{
  "tweet": "The full tweet text with line breaks (use \\n)"
}

Keep it concise but complete. No hashtags.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a financial information account that provides neutral, educational content about SEC filings. You do not give advice.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    const parsed = JSON.parse(content);
    return parsed.tweet;
  } catch (error) {
    console.error(`❌ OpenAI generation failed: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateWeeklyRoundup(options = {}) {
  const days = options.days || 7;
  const shouldPost = options.post || false;
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  WEEKLY ATM ROUNDUP                                                           ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: Get recent ATM filings using atmScanner
  const allFilings = await getRecentATMFilings(days);
  
  if (allFilings.length === 0) {
    console.log('No ATM filings found in the specified period.');
    return null;
  }
  
  console.log(`📋 All filings found: ${allFilings.length}`);
  allFilings.forEach(f => {
    console.log(`   • $${f.ticker} — ${f.companyName} (${f.fileDate})`);
  });
  
  // Step 2: Filter out already-posted tickers
  const postedData = loadPostedTickers();
  const filings = filterNewFilings(allFilings, postedData);
  
  const skippedCount = allFilings.length - filings.length;
  if (skippedCount > 0) {
    console.log(`\n⏭️  Skipping ${skippedCount} previously posted ticker(s)`);
  }
  
  if (filings.length === 0) {
    console.log('\n✅ No new ATM filings to post (all already covered).');
    return null;
  }
  
  console.log(`\n📋 New filings to post: ${filings.length}`);
  filings.forEach(f => {
    console.log(`   • $${f.ticker} — ${f.companyName} (${f.fileDate})`);
  });
  
  // Step 3: Generate tweet via OpenAI
  console.log('\n🤖 Generating roundup tweet...');
  const tweet = await generateRoundupTweet(filings, days);
  
  if (!tweet) {
    console.log('Failed to generate tweet.');
    return null;
  }
  
  // Step 3: Display preview
  console.log(`
════════════════════════════════════════════════════════════════════════════════
📝 WEEKLY ROUNDUP TWEET
════════════════════════════════════════════════════════════════════════════════

${tweet}

════════════════════════════════════════════════════════════════════════════════
[${tweet.length} chars]
`);

  // Step 4: Post if requested
  if (shouldPost) {
    console.log('🚀 Posting to Twitter...\n');
    
    const isDryRun = process.env.DRY_RUN !== 'false';
    if (isDryRun) {
      console.log('   [DRY_RUN] Would post tweet');
      console.log('   Set DRY_RUN=false to post for real.\n');
      // Still mark as posted in dry run so we can test deduplication
      markAsPosted(filings, postedData);
      console.log(`   📝 Marked ${filings.length} ticker(s) as posted in ${POSTED_FILE}\n`);
    } else {
      try {
        const result = await postAlertThread(tweet, [], null); // Single tweet, no thread, no image
        console.log(`   ✅ Posted! Tweet ID: ${result.tweetIds?.[0]}`);
        // Mark tickers as posted only after successful post
        markAsPosted(filings, postedData);
        console.log(`   📝 Marked ${filings.length} ticker(s) as posted\n`);
      } catch (error) {
        console.error(`   ❌ Post failed: ${error.message}`);
      }
    }
  } else {
    console.log('Preview only. Use --post to publish.\n');
  }
  
  return {
    filings,
    tweet,
    tickerCount: filings.length,
    days,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);

// Parse --days=N
const daysArg = args.find(a => a.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1]) : 5;  // 5 business days = 1 trading week

// Parse --post
const shouldPost = args.includes('--post');

const result = await generateWeeklyRoundup({ days, post: shouldPost });

// Exit with code 2 if nothing new to post (allows workflow to skip commit step)
if (result === null) {
  process.exit(2);
}
