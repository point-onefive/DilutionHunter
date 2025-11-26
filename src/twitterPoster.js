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

const DRY_RUN = process.env.DRY_RUN !== 'false';

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
// MEDIA UPLOAD (v1.1 endpoint - still required for media)
// ═══════════════════════════════════════════════════════════════════════════════

async function uploadMedia(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  const imageData = fs.readFileSync(imagePath);
  const base64Image = imageData.toString('base64');
  const mediaType = 'image/png';

  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  
  const params = {
    media_data: base64Image,
  };

  const authHeader = generateOAuthHeader('POST', uploadUrl, params);

  const formBody = new URLSearchParams();
  formBody.append('media_data', base64Image);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Media upload failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.media_id_string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST TWEET (v2 endpoint)
// ═══════════════════════════════════════════════════════════════════════════════

async function postTweet(text, options = {}) {
  const { mediaIds = [], replyToId = null } = options;
  
  if (DRY_RUN) {
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

export async function postAlertThread(thesis, statsBlock, chartPath) {
  console.log('\n🐦 POSTING ALERT THREAD...');
  console.log(`   DRY_RUN: ${DRY_RUN}`);
  
  const results = { tweets: [], mediaId: null };
  
  try {
    // Step 1: Upload chart image
    if (chartPath && fs.existsSync(chartPath)) {
      console.log('   📤 Uploading chart...');
      if (!DRY_RUN) {
        results.mediaId = await uploadMedia(chartPath);
        console.log(`   ✅ Media ID: ${results.mediaId}`);
      } else {
        console.log('   [DRY_RUN] Would upload:', chartPath);
        results.mediaId = 'dry-run-media-id';
      }
    }
    
    // Step 2: Post main tweet with chart
    console.log('   📝 Posting main tweet...');
    const mainTweet = await postTweet(thesis, {
      mediaIds: results.mediaId ? [results.mediaId] : []
    });
    results.tweets.push(mainTweet);
    console.log(`   ✅ Main tweet: ${mainTweet.id}`);
    
    // Step 3: Post stats reply
    if (statsBlock) {
      console.log('   📝 Posting stats reply...');
      const replyTweet = await postTweet(statsBlock, {
        replyToId: mainTweet.id
      });
      results.tweets.push(replyTweet);
      console.log(`   ✅ Reply tweet: ${replyTweet.id}`);
    }
    
    console.log('\n✅ THREAD POSTED SUCCESSFULLY');
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
  console.log(`DRY_RUN: ${DRY_RUN}`);
  
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
