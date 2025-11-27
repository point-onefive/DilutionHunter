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

  // Step 2: APPEND (send the actual data using multipart/form-data)
  const base64Image = imageData.toString('base64');
  
  // For APPEND with multipart, we need to build form data manually
  // OAuth signature should NOT include body params for multipart
  const appendAuth = generateOAuthHeader('POST', uploadUrl, {});
  
  // Build multipart form data
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const formParts = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="command"',
    '',
    'APPEND',
    `--${boundary}`,
    'Content-Disposition: form-data; name="media_id"',
    '',
    mediaId,
    `--${boundary}`,
    'Content-Disposition: form-data; name="segment_index"',
    '',
    '0',
    `--${boundary}`,
    'Content-Disposition: form-data; name="media_data"',
    '',
    base64Image,
    `--${boundary}--`,
  ].join('\r\n');
  
  const appendResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': appendAuth,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: formParts,
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
 * @param {Object} options - { skipPreflight: boolean, preflightMediaId: string }
 * @returns {Object} Results with tweet IDs
 */
export async function postAlertThread(hook, breakdown, chartPath, options = {}) {
  console.log('\n🐦 POSTING ALERT THREAD...');
  console.log(`   DRY_RUN: ${isDryRun()}`);
  
  // Normalize breakdown to array
  const breakdownTweets = Array.isArray(breakdown) ? breakdown : [breakdown];
  
  const results = { tweets: [], mediaId: null };
  
  // In DRY_RUN mode, just simulate
  if (isDryRun()) {
    if (chartPath && fs.existsSync(chartPath)) {
      console.log('   [DRY_RUN] Would upload:', chartPath);
      results.mediaId = 'dry-run-media-id';
    }
  } else {
    // LIVE MODE: Run preflight check first
    const preflight = await preflightCheck(chartPath);
    if (!preflight.success) {
      throw new Error('Preflight check failed - aborting post');
    }
    // Use the already-uploaded media from preflight
    results.mediaId = preflight.mediaId;
  }
  
  try {
    // Step 1: Post main tweet with chart (media already uploaded in preflight)
    console.log(`   📝 Posting hook tweet (1/${breakdownTweets.length + 1})...`);
    const mainTweet = await postTweet(hook, {
      mediaIds: results.mediaId ? [results.mediaId] : []
    });
    results.tweets.push(mainTweet);
    console.log(`   ✅ Tweet 1: ${mainTweet.id}`);
    
    // Step 2: Post breakdown tweets as thread
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
// PREFLIGHT CHECK - Validate 100% before posting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run comprehensive preflight checks before posting
 * Tests: credentials, account access, media upload capability
 * @param {string} chartPath - Path to chart image to test upload
 * @returns {Object} { success: boolean, mediaId: string|null, checks: Object }
 */
export async function preflightCheck(chartPath) {
  console.log('\n🔍 PREFLIGHT CHECK - Validating before posting...\n');
  
  const checks = {
    credentials: false,
    accountAccess: false,
    mediaUpload: false,
  };
  
  let mediaId = null;
  
  // Check 1: Credentials present
  console.log('   [1/3] Checking credentials...');
  if (!validateTwitterConfig()) {
    console.log('   ❌ Credentials missing\n');
    return { success: false, mediaId: null, checks };
  }
  checks.credentials = true;
  console.log('   ✅ Credentials present');
  
  // Check 2: Account access (verify_credentials endpoint)
  console.log('   [2/3] Verifying account access...');
  try {
    const verifyUrl = `${API_BASE}/1.1/account/verify_credentials.json`;
    const authHeader = generateOAuthHeader('GET', verifyUrl);
    
    const response = await fetch(verifyUrl, {
      method: 'GET',
      headers: { 'Authorization': authHeader },
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.log(`   ❌ Account verification failed: ${response.status}`);
      console.log(`      ${error}`);
      return { success: false, mediaId: null, checks };
    }
    
    const userData = await response.json();
    checks.accountAccess = true;
    console.log(`   ✅ Account verified: @${userData.screen_name}`);
    
  } catch (error) {
    console.log(`   ❌ Account verification error: ${error.message}`);
    return { success: false, mediaId: null, checks };
  }
  
  // Check 3: Media upload capability
  console.log('   [3/3] Testing media upload...');
  if (!chartPath || !fs.existsSync(chartPath)) {
    console.log(`   ⚠️  No chart found at: ${chartPath}`);
    console.log('   ⚠️  Skipping media upload test (will post without image)');
  } else {
    try {
      mediaId = await uploadMedia(chartPath);
      checks.mediaUpload = true;
      console.log(`   ✅ Media upload successful: ${mediaId}`);
      console.log('   ℹ️  Media will be attached to first tweet');
    } catch (error) {
      console.log(`   ❌ Media upload failed: ${error.message}`);
      console.log('   ⚠️  Will attempt to post without image');
      // Don't fail entirely - we can post without media
    }
  }
  
  // Summary
  const allPassed = checks.credentials && checks.accountAccess;
  console.log('\n   ─────────────────────────────────');
  console.log(`   PREFLIGHT: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (checks.mediaUpload) {
    console.log('   MEDIA: ✅ Ready (will attach to tweet)');
  } else {
    console.log('   MEDIA: ⚠️  Not available (posting text-only)');
  }
  console.log('   ─────────────────────────────────\n');
  
  return { success: allPassed, mediaId, checks };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI - Run preflight check directly
// ═══════════════════════════════════════════════════════════════════════════════

const isMainModule = process.argv[1]?.includes('twitterPoster');
if (isMainModule) {
  const args = process.argv.slice(2);
  const chartPath = args.find(a => a.endsWith('.png')) || './output/charts/latest.png';
  
  console.log('🐦 Twitter Preflight Check\n');
  
  // Just run preflight - no posting
  preflightCheck(chartPath)
    .then(result => {
      if (result.success) {
        console.log('🎯 Ready to post! Run: node src/post.js <TICKER> --live');
        if (result.mediaId) {
          console.log(`   Media ID ${result.mediaId} will expire in ~24h`);
        }
      } else {
        console.log('❌ Fix issues above before posting.');
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('❌ Preflight error:', err.message);
      process.exit(1);
    });
}
