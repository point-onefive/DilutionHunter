/**
 * DilutionHunter - Twitter Poster
 * 
 * Posts tweets with media attachments to Twitter/X.
 * Supports thread creation for detailed analysis.
 * 
 * Requires Twitter API v2 with OAuth 1.0a User Context
 */

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

// Check DRY_RUN dynamically (allows runtime override)
function isDryRun() {
  return process.env.DRY_RUN !== 'false';
}

const TWITTER_CONFIG = {
  apiKey: process.env.TWITTER_API_KEY,
  apiSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
};

const API_BASE = 'https://api.twitter.com';

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH 1.0a SIGNATURE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

function generateOAuthHeader(method, url, params = {}) {
  const oauthParams = {
    oauth_consumer_key: TWITTER_CONFIG.apiKey,
    oauth_token: TWITTER_CONFIG.accessToken,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_version: '1.0',
  };

  // Combine all params for signature
  const allParams = { ...oauthParams, ...params };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
    .join('&');

  // Create signature base string
  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');

  // Create signing key
  const signingKey = `${encodeURIComponent(TWITTER_CONFIG.apiSecret)}&${encodeURIComponent(TWITTER_CONFIG.accessSecret)}`;

  // Generate signature
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  // Build Authorization header
  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ');

  return authHeader;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA UPLOAD (v1.1 chunked upload - more reliable)
// ═══════════════════════════════════════════════════════════════════════════════

async function uploadMedia(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  const imageData = fs.readFileSync(imagePath);
  const totalBytes = imageData.length;
  const mediaType = 'image/png';
  
  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';

  // Step 1: INIT
  const initParams = {
    command: 'INIT',
    total_bytes: totalBytes.toString(),
    media_type: mediaType,
  };
  
  const initAuth = generateOAuthHeader('POST', uploadUrl, initParams);
  const initBody = new URLSearchParams(initParams);
  
  const initResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': initAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: initBody.toString(),
  });

  if (!initResponse.ok) {
    const error = await initResponse.text();
    console.error('   INIT error:', error);
    throw new Error(`Media INIT failed: ${initResponse.status} - ${error}`);
  }

  const initData = await initResponse.json();
  const mediaId = initData.media_id_string;
  console.log(`   ✓ INIT complete, media_id: ${mediaId}`);

  // Step 2: APPEND (send the actual data)
  const base64Image = imageData.toString('base64');
  
  // For APPEND, media_data should NOT be in OAuth signature
  const appendParams = {
    command: 'APPEND',
    media_id: mediaId,
    segment_index: '0',
  };
  
  const appendAuth = generateOAuthHeader('POST', uploadUrl, appendParams);
  
  const appendBody = new URLSearchParams({
    ...appendParams,
    media_data: base64Image,
  });
  
  const appendResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': appendAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: appendBody.toString(),
  });

  if (!appendResponse.ok) {
    const error = await appendResponse.text();
    console.error('   APPEND error:', error);
    throw new Error(`Media APPEND failed: ${appendResponse.status} - ${error}`);
  }
  console.log(`   ✓ APPEND complete`);

  // Step 3: FINALIZE
  const finalizeParams = {
    command: 'FINALIZE',
    media_id: mediaId,
  };
  
  const finalizeAuth = generateOAuthHeader('POST', uploadUrl, finalizeParams);
  const finalizeBody = new URLSearchParams(finalizeParams);
  
  const finalizeResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': finalizeAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: finalizeBody.toString(),
  });

  if (!finalizeResponse.ok) {
    const error = await finalizeResponse.text();
    console.error('   FINALIZE error:', error);
    throw new Error(`Media FINALIZE failed: ${finalizeResponse.status} - ${error}`);
  }
  
  console.log(`   ✓ FINALIZE complete`);
  return mediaId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST TWEET (v2 endpoint)
// ═══════════════════════════════════════════════════════════════════════════════

async function postTweet(text, options = {}) {
  const { mediaIds = [], replyToId = null } = options;
  
  if (isDryRun()) {
    console.log('\n📝 [DRY_RUN] Would post tweet:');
    console.log('─'.repeat(50));
    console.log(text);
    console.log('─'.repeat(50));
    if (mediaIds.length) console.log(`Media IDs: ${mediaIds.join(', ')}`);
    if (replyToId) console.log(`Reply to: ${replyToId}`);
    return { id: 'dry-run-' + Date.now(), text };
  }

  const tweetUrl = `${API_BASE}/2/tweets`;
  
  const body = { text };
  
  if (mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }
  
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }

  const authHeader = generateOAuthHeader('POST', tweetUrl);

  const response = await fetch(tweetUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tweet failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST THREAD WITH MEDIA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Post an alert thread with hook + multiple breakdown replies
 * @param {string} hook - The main hook tweet
 * @param {string|string[]} breakdown - Single tweet or array of breakdown tweets  
 * @param {string} chartPath - Path to chart image
 * @returns {Object} Results with tweet IDs
 */
export async function postAlertThread(hook, breakdown, chartPath) {
  console.log('\n🐦 POSTING ALERT THREAD...');
  console.log(`   DRY_RUN: ${isDryRun()}`);
  
  // Normalize breakdown to array
  const breakdownTweets = Array.isArray(breakdown) ? breakdown : [breakdown];
  
  const results = { tweets: [], mediaId: null };
  
  try {
    // Step 1: Upload chart image (skip if fails - Free tier doesn't support media)
    if (chartPath && fs.existsSync(chartPath)) {
      console.log('   📤 Uploading chart...');
      if (!isDryRun()) {
        try {
          results.mediaId = await uploadMedia(chartPath);
          console.log(`   ✅ Media ID: ${results.mediaId}`);
        } catch (mediaErr) {
          console.log(`   ⚠️  Media upload failed: ${mediaErr.message}`);
          console.log(`   ⚠️  Posting without image (Free tier limitation)`);
          results.mediaId = null;
        }
      } else {
        console.log('   [DRY_RUN] Would upload:', chartPath);
        results.mediaId = 'dry-run-media-id';
      }
    }
    
    // Step 2: Post main tweet with chart
    console.log('   📝 Posting hook tweet (1/${breakdownTweets.length + 1})...');
    const mainTweet = await postTweet(hook, {
      mediaIds: results.mediaId ? [results.mediaId] : []
    });
    results.tweets.push(mainTweet);
    console.log(`   ✅ Tweet 1: ${mainTweet.id}`);
    
    // Step 3: Post breakdown tweets as thread
    let lastTweetId = mainTweet.id;
    for (let i = 0; i < breakdownTweets.length; i++) {
      const tweet = breakdownTweets[i];
      if (!tweet) continue;
      
      // Delay between tweets to avoid rate limits (Twitter is strict - 3 sec)
      console.log(`   ⏳ Waiting 3s to avoid rate limit...`);
      await new Promise(r => setTimeout(r, 3000));
      
      console.log(`   📝 Posting thread ${i + 2}/${breakdownTweets.length + 1}...`);
      const replyTweet = await postTweet(tweet, {
        replyToId: lastTweetId
      });
      results.tweets.push(replyTweet);
      lastTweetId = replyTweet.id;
      console.log(`   ✅ Tweet ${i + 2}: ${replyTweet.id}`);
    }
    
    console.log(`\n✅ THREAD POSTED SUCCESSFULLY (${results.tweets.length} tweets)`);
    return results;
    
  } catch (error) {
    console.error('❌ Twitter posting failed:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

export function validateTwitterConfig() {
  const required = ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'];
  const missing = required.filter(key => !TWITTER_CONFIG[key]);
  
  if (missing.length > 0) {
    console.log('⚠️  Missing Twitter credentials:', missing.join(', '));
    console.log('   Set these in .env:');
    console.log('   TWITTER_API_KEY=xxx');
    console.log('   TWITTER_API_SECRET=xxx');
    console.log('   TWITTER_ACCESS_TOKEN=xxx');
    console.log('   TWITTER_ACCESS_SECRET=xxx');
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST
// ═══════════════════════════════════════════════════════════════════════════════

const isMainModule = process.argv[1]?.includes('twitterPoster');
if (isMainModule) {
  console.log('🐦 Twitter Poster Test\n');
  console.log(`DRY_RUN: ${isDryRun()}`);
  
  if (!validateTwitterConfig()) {
    console.log('\n⚠️  Configure Twitter credentials to test posting.');
  }
  
  // Test with mock data
  const mockThesis = `🚨 FFIE Alert: Dilution Risk Detected!

With 320% gains in 30 days and only 2 months runway, the math is brutal.

$150M offering shelf (33% of market cap) is loaded and ready.

First red candle forming. Volume fading.

This is how it starts. 👀`;

  const mockStats = `📊 FFIE Key Stats:
• Price: $2.45 | MCap: $450M
• 7D: +187% | 30D: +320%
• Cash/Debt: 0.16x
• Runway: 2.1 months
• Float: 28%
• Shelf: $150M (33% impact)
• ATM Status: 🔴 ACTIVE`;

  const chartPath = './output/test-chart.png';
  
  postAlertThread(mockThesis, mockStats, chartPath)
    .then(result => {
      console.log('\n📋 Result:', JSON.stringify(result, null, 2));
    })
    .catch(console.error);
}
