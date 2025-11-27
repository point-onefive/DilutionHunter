/**
 * DAILY RUN - Complete end-to-end content generation and posting
 * 
 * This is the main entry point for daily operations:
 *   1. Scan for ATM filings
 *   2. Select best candidates (max 2 posts)
 *   3. Generate tweets + charts via OpenAI
 *   4. Post to Twitter (or dry-run preview)
 * 
 * Usage:
 *   node src/dailyRun.js              # Dry run - show what would be posted
 *   node src/dailyRun.js --live       # Actually post to Twitter
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getAllCandidates, selectDailyPosts } from './dailySelector.js';
import { runPipeline } from './contentPipeline.js';
import { postAlertThread } from './twitterPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// ═══════════════════════════════════════════════════════════════════════════════
// DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function displayHeader() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toLocaleTimeString('en-US', { hour12: true });
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  🔍 DILUTIONHUNTER - DAILY RUN                                               ║
║  ${dateStr} @ ${timeStr}                                                 ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
}

function displayTweetPreview(content, postNumber) {
  const { ticker, bucket, tweets, chartPath, classification, tickerData, rationale } = content;
  
  const bucketEmoji = {
    'CASE_STUDY': '📚',
    'WATCH_LIST': '👀',
    'ACTIONABLE': '🎯'
  };
  
  const emoji = bucketEmoji[bucket] || '📊';
  
  // Get stats from tickerData or classification
  const peakGain = tickerData?.peakGain || classification?.peakGain;
  const currentGain = tickerData?.currentGain || classification?.currentGain;
  const pullback = tickerData?.pullback || classification?.pullback || classification?.pullbackFromPeak;
  
  // Format breakdown tweets (now an array)
  const breakdownTweets = Array.isArray(tweets.breakdown) 
    ? tweets.breakdown 
    : [tweets.breakdown];
  
  const breakdownDisplay = breakdownTweets.map((tweet, i) => {
    return `💬 TWEET ${i + 2} (THREAD ${i + 1}/${breakdownTweets.length})
${'─'.repeat(40)}
${tweet}
[${tweet.length}/280 chars]`;
  }).join('\n\n');
  
  console.log(`
${'═'.repeat(80)}
📱 POST ${postNumber}: ${emoji} ${bucket} - $${ticker}
${'═'.repeat(80)}

📈 STATS
${'─'.repeat(40)}
   Peak Gain:    +${peakGain?.toFixed(0) || 'N/A'}%
   Current:      ${currentGain >= 0 ? '+' : ''}${currentGain?.toFixed(0) || 'N/A'}%
   Pullback:     -${pullback?.toFixed(0) || 'N/A'}%
   Quality:      ${classification?.quality || 'N/A'}
   Reason:       ${classification?.reason || 'N/A'}

🐦 TWEET 1 (HOOK + IMAGE)
${'─'.repeat(40)}
${tweets.hook}
[${tweets.hook.length}/280 chars]

${breakdownDisplay}

${'─'.repeat(40)}
${tweets.hashtags?.length ? `#️⃣ Hashtags: ${tweets.hashtags.join(' ')}` : ''}
${rationale ? `\n💡 Why This Matters: ${rationale}` : ''}

🖼️  Chart: ${chartPath}
${'═'.repeat(80)}
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN RUN
// ═══════════════════════════════════════════════════════════════════════════════

async function dailyRun(options = {}) {
  const { live = false, noCache = false } = options;
  
  displayHeader();
  
  console.log(`Mode: ${live ? '🔴 LIVE POSTING' : '🟢 DRY RUN (preview only)'}`);
  if (noCache) console.log(`Cache: ❌ DISABLED (forcing fresh API calls)`);
  console.log('');
  
  // Step 1: Get all candidates
  console.log('━'.repeat(60));
  console.log('STEP 1: Scanning for ATM filings...');
  console.log('━'.repeat(60));
  
  const candidates = await getAllCandidates(30, { noCache });
  console.log(`✓ Found ${candidates.length} enriched tickers\n`);
  
  // Step 2: Select best posts
  console.log('━'.repeat(60));
  console.log('STEP 2: Selecting daily posts...');
  console.log('━'.repeat(60));
  
  const selected = selectDailyPosts(candidates, 2);
  
  // Summary by bucket
  const summary = {
    ACTIONABLE: candidates.filter(c => c.classification.bucket === 'ACTIONABLE'),
    WATCH_LIST: candidates.filter(c => c.classification.bucket === 'WATCH_LIST'),
    CASE_STUDY: candidates.filter(c => c.classification.bucket === 'CASE_STUDY')
  };
  
  const tweetable = {
    ACTIONABLE: summary.ACTIONABLE.filter(c => c.tweetDecision.shouldTweet && c.classification.quality === 'GOOD'),
    WATCH_LIST: summary.WATCH_LIST.filter(c => c.tweetDecision.shouldTweet && c.classification.quality === 'GOOD'),
    CASE_STUDY: summary.CASE_STUDY.filter(c => c.tweetDecision.shouldTweet && c.classification.quality === 'GOOD')
  };
  
  console.log(`
📊 CANDIDATE BREAKDOWN
${'─'.repeat(40)}
🎯 ACTIONABLE:  ${summary.ACTIONABLE.length} total, ${tweetable.ACTIONABLE.length} tweetable
👀 WATCH_LIST:  ${summary.WATCH_LIST.length} total, ${tweetable.WATCH_LIST.length} tweetable
📚 CASE_STUDY:  ${summary.CASE_STUDY.length} total, ${tweetable.CASE_STUDY.length} tweetable
`);
  
  if (selected.length === 0) {
    console.log(`\n⚠️  NO POSTS TODAY - No quality candidates available`);
    console.log(`   This could mean:`);
    console.log(`   - No strong price action on ATM filers`);
    console.log(`   - All candidates filtered out (same-day spikes, etc.)`);
    console.log(`   - Already tweeted today's best options\n`);
    return { success: true, postsGenerated: 0, posts: [] };
  }
  
  console.log(`✓ Selected ${selected.length} posts for today\n`);
  
  // Step 3: Generate content
  console.log('━'.repeat(60));
  console.log('STEP 3: Generating content (OpenAI + Charts)...');
  console.log('━'.repeat(60));
  
  const generatedContent = [];
  
  for (const post of selected) {
    console.log(`\n📝 Generating content for $${post.ticker}...`);
    
    try {
      const content = await runPipeline(post.ticker, { 
        force: true,
        classification: post.classification,
        fileDate: post.fileDate,
        daysSinceFiling: post.daysSinceFiling
      });
      
      if (content) {
        generatedContent.push({
          ...content,
          postNumber: post.postNumber,
          bucket: post.classification.bucket
        });
        console.log(`   ✓ Content generated for $${post.ticker}`);
      }
    } catch (err) {
      console.error(`   ❌ Failed to generate content for $${post.ticker}: ${err.message}`);
    }
  }
  
  if (generatedContent.length === 0) {
    console.log(`\n⚠️  No content generated successfully`);
    return { success: false, postsGenerated: 0, posts: [] };
  }
  
  // Step 4: Display/Post
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`STEP 4: ${live ? 'Posting to Twitter' : 'Preview (DRY RUN)'}...`);
  console.log('━'.repeat(60));
  
  const results = [];
  
  for (const content of generatedContent) {
    displayTweetPreview(content, content.postNumber);
    
    if (live) {
      try {
        const result = await postAlertThread(
          content.tweets.hook,
          content.tweets.breakdown,
          content.chartPath
        );
        results.push({ ticker: content.ticker, ...result });
      } catch (err) {
        console.error(`❌ Failed to post $${content.ticker}: ${err.message}`);
        results.push({ ticker: content.ticker, error: err.message });
      }
    } else {
      results.push({ ticker: content.ticker, dryRun: true });
    }
  }
  
  // Final summary
  console.log(`
${'═'.repeat(80)}
📋 SUMMARY
${'═'.repeat(80)}
   Mode:             ${live ? '🔴 LIVE' : '🟢 DRY RUN'}
   Posts Generated:  ${generatedContent.length}
   Posts:            ${generatedContent.map(c => `$${c.ticker}`).join(', ')}
   
${live ? '   Check Twitter for live posts!' : '   Run with --live to actually post to Twitter'}
${'═'.repeat(80)}
`);
  
  return {
    success: true,
    postsGenerated: generatedContent.length,
    posts: generatedContent
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const noCache = args.includes('--no-cache');
  
  if (live) {
    console.log('\n⚠️  LIVE MODE - This will post to Twitter!');
    console.log('   Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(r => setTimeout(r, 5000));
  }
  
  try {
    const result = await dailyRun({ live, noCache });
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }
}

export { dailyRun };

main();