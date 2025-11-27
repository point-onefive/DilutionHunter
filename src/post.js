#!/usr/bin/env node
/**
 * POST.JS - Manual Twitter posting for approved tickers
 * 
 * Usage:
 *   node src/post.js ANVS           # Post pre-generated content for ANVS
 *   node src/post.js ANVS --preview # Preview only, don't post
 *   node src/post.js --list         # List available pending posts
 * 
 * Flow:
 *   1. Run dailyRun.js first (generates content to /output/)
 *   2. Review the output
 *   3. Run this command to post approved tickers
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { postAlertThread, validateTwitterConfig } from './twitterPoster.js';
import { recordTweet } from './contentManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function findLatestOutput(ticker) {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith(`${ticker}_`) && f.endsWith('.json'))
    .sort()
    .reverse();
  
  if (files.length === 0) return null;
  
  const latestFile = path.join(OUTPUT_DIR, files[0]);
  return JSON.parse(fs.readFileSync(latestFile, 'utf-8'));
}

function listPendingPosts() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.log('No output directory found. Run dailyRun.js first.');
    return [];
  }
  
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('history'))
    .sort()
    .reverse();
  
  // Group by ticker, get latest only
  const tickerMap = new Map();
  for (const file of files) {
    const ticker = file.split('_')[0];
    if (!tickerMap.has(ticker)) {
      const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
      tickerMap.set(ticker, {
        file,
        data,
        generatedAt: data.generatedAt
      });
    }
  }
  
  return Array.from(tickerMap.entries());
}

function displayPreview(data) {
  const { ticker, classification, tweets, chartPath, tickerData } = data;
  
  console.log(`
${'═'.repeat(80)}
📱 PREVIEW: $${ticker}
${'═'.repeat(80)}

🏷️  Bucket: ${classification.bucket}
📊 Peak: +${tickerData?.peakGain?.toFixed(0) || 'N/A'}% → Current: ${tickerData?.currentGain >= 0 ? '+' : ''}${tickerData?.currentGain?.toFixed(0) || 'N/A'}%

🐦 TWEET 1 (HOOK + IMAGE):
${'─'.repeat(40)}
${tweets.hook}
[${tweets.hook.length}/280 chars]
`);

  const breakdownTweets = Array.isArray(tweets.breakdown) ? tweets.breakdown : [tweets.breakdown];
  breakdownTweets.forEach((tweet, i) => {
    console.log(`
💬 TWEET ${i + 2} (THREAD ${i + 1}/${breakdownTweets.length}):
${'─'.repeat(40)}
${tweet}
[${tweet.length}/280 chars]`);
  });

  console.log(`
${'─'.repeat(40)}
#️⃣  Hashtags: ${tweets.hashtags?.join(' ') || 'None'}
🖼️  Chart: ${chartPath}
${'═'.repeat(80)}
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  
  // List mode
  if (args.includes('--list') || args.length === 0) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  📋 PENDING POSTS                                                             ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
    
    const pending = listPendingPosts();
    
    if (pending.length === 0) {
      console.log('No pending posts found. Run dailyRun.js first to generate content.\n');
      return;
    }
    
    console.log(`Found ${pending.length} ticker(s) with generated content:\n`);
    
    for (const [ticker, info] of pending) {
      const { data } = info;
      const time = new Date(data.generatedAt).toLocaleString();
      console.log(`  $${ticker.padEnd(6)} | ${data.classification?.bucket?.padEnd(12) || 'N/A'} | Generated: ${time}`);
    }
    
    console.log(`
${'─'.repeat(60)}
Usage:
  node src/post.js <TICKER>           Post ticker to Twitter
  node src/post.js <TICKER> --preview Preview only
  
Example:
  node src/post.js ANVS
`);
    return;
  }
  
  // Get ticker
  const ticker = args.find(a => !a.startsWith('--'))?.toUpperCase();
  const previewOnly = args.includes('--preview');
  const liveMode = args.includes('--live');
  
  // Override DRY_RUN if --live flag is passed
  if (liveMode) {
    process.env.DRY_RUN = 'false';
  }
  
  if (!ticker) {
    console.log('Usage: node src/post.js <TICKER> [--preview] [--live]');
    console.log('  --preview  Show content without posting');
    console.log('  --live     Actually post to Twitter (overrides DRY_RUN)');
    return;
  }
  
  // Find content
  const data = findLatestOutput(ticker);
  
  if (!data) {
    console.log(`❌ No generated content found for $${ticker}`);
    console.log(`   Run: node src/contentPipeline.js ${ticker} --force`);
    return;
  }
  
  // Preview
  displayPreview(data);
  
  if (previewOnly) {
    console.log('Preview mode - not posting.\n');
    return;
  }
  
  // Validate Twitter config
  if (!validateTwitterConfig()) {
    console.log('\n❌ Twitter credentials not configured. Set them in .env');
    return;
  }
  
  // Confirm
  console.log('⚠️  Ready to post to Twitter.');
  console.log('   Press Ctrl+C within 3 seconds to cancel...\n');
  await new Promise(r => setTimeout(r, 3000));
  
  // Post!
  console.log('🚀 Posting to Twitter...\n');
  
  try {
    const breakdownTweets = Array.isArray(data.tweets.breakdown) 
      ? data.tweets.breakdown 
      : [data.tweets.breakdown];
    
    const result = await postAlertThread(
      data.tweets.hook,
      breakdownTweets,
      data.chartPath
    );
    
    console.log(`\n✅ Successfully posted thread for $${ticker}!`);
    console.log(`   ${result.tweets.length} tweets posted.`);
    
    // Record in history
    recordTweet({
      ticker,
      peakGain: data.tickerData?.peakGain,
      currentGain: data.tickerData?.currentGain
    }, data.classification?.bucket, 'Posted via post.js');
    
    console.log(`   Recorded in tweet history.\n`);
    
  } catch (error) {
    console.error(`\n❌ Failed to post: ${error.message}`);
    if (process.env.DEBUG) console.error(error.stack);
  }
}

main().catch(console.error);
