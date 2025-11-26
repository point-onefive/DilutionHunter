/**
 * Tweet Generator & Poster
 * 
 * Uses OpenAI to generate human-like tweet threads about dilution signals,
 * then posts to Twitter/X (respects DRY_RUN mode).
 */

import { 
  DRY_RUN, 
  VERBOSE, 
  OPENAI_CONFIG, 
  TWITTER_CONFIG 
} from './config.js';
import { logTweet, getTodaysTweetCount } from './storage.js';

// ═══════════════════════════════════════════════════════════════════════════
// OPENAI INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate tweet content using OpenAI
 */
async function generateTweetContent(signal, type = 'new_signal') {
  if (!OPENAI_CONFIG.apiKey) {
    console.warn('⚠️  No OpenAI API key - using fallback template');
    return generateFallbackTweet(signal, type);
  }
  
  const prompt = buildPrompt(signal, type);
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_CONFIG.model,
        messages: [
          {
            role: 'system',
            content: `You are a sharp, irreverent financial analyst who spots dilution risk in small-cap stocks. You write engaging, slightly sarcastic Twitter threads that are informative but entertaining. Use emojis sparingly but effectively. Never give financial advice - just share observations. Keep it punchy and under 280 chars per tweet.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: OPENAI_CONFIG.maxTokens,
        temperature: OPENAI_CONFIG.temperature
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }
    
    // Parse into thread (split by newlines or numbers)
    const tweets = parseTweetThread(content);
    
    return tweets;
    
  } catch (error) {
    console.error(`❌ OpenAI error: ${error.message}`);
    return generateFallbackTweet(signal, type);
  }
}

/**
 * Build the prompt for OpenAI based on signal type
 */
function buildPrompt(signal, type) {
  if (type === 'new_signal') {
    return `
Write a 2-3 tweet thread about this potential dilution setup:

Stock: $${signal.ticker}
Weekly Gain: ${signal.weekly_gain_pct?.toFixed(0) || '???'}%
Entry Price: $${signal.entry_price?.toFixed(2) || '???'}
Cash Position: $${formatNumber(signal.cash)}
Total Debt: $${formatNumber(signal.debt)}
Market Cap: $${formatNumber(signal.market_cap)}
Offering Detected: ${signal.offering_detected ? 'YES' : 'Maybe'}
Dilution Score: ${(signal.dilution_risk_score * 100).toFixed(0)}%
Signals: ${signal.reason}

Write a punchy thread explaining:
1. Why this stock just ran (momentum/hype)
2. Why it might be a dilution candidate (financials + offering)
3. What to watch for next

Don't give financial advice. Just observations. Be engaging but not reckless.
Format: Each tweet on its own line, numbered 1/, 2/, 3/
    `.trim();
  }
  
  if (type === 'performance_update') {
    const plEmoji = signal.pl.plPercent > 0 ? '🎯' : '📉';
    const direction = signal.pl.plPercent > 0 ? 'dropped' : 'bounced';
    
    return `
Write a single follow-up tweet about this position:

Stock: $${signal.ticker}
Entry Price: $${signal.entry_price?.toFixed(2)}
Current Price: $${signal.currentPrice?.toFixed(2)}
P/L: ${signal.pl.plPercent >= 0 ? '+' : ''}${signal.pl.plPercent?.toFixed(1)}%
Days Tracked: ${signal.pl.daysTracked}

The stock has ${direction} since our dilution alert. Write a brief, engaging update (1 tweet max).
Include the P/L %. Be humble if it went against us.
    `.trim();
  }
  
  return `Write a brief tweet about $${signal.ticker}`;
}

/**
 * Parse OpenAI response into array of tweets
 */
function parseTweetThread(content) {
  // Try to split by numbered format (1/, 2/, etc.)
  const numbered = content.split(/\d+\//).filter(t => t.trim());
  if (numbered.length > 1) {
    return numbered.map(t => t.trim()).filter(t => t.length > 0 && t.length <= 280);
  }
  
  // Try to split by double newlines
  const paragraphs = content.split(/\n\n+/).filter(t => t.trim());
  if (paragraphs.length > 1) {
    return paragraphs.map(t => t.trim()).filter(t => t.length > 0 && t.length <= 280);
  }
  
  // Single tweet - truncate if needed
  const single = content.trim();
  if (single.length <= 280) {
    return [single];
  }
  
  // Truncate to 280
  return [single.slice(0, 277) + '...'];
}

/**
 * Generate fallback tweet without AI
 */
function generateFallbackTweet(signal, type) {
  if (type === 'new_signal') {
    return [
      `🔫 Dilution Watch: $${signal.ticker}

📈 ${signal.weekly_gain_pct?.toFixed(0) || '???'}% weekly run
💰 Cash: $${formatNumber(signal.cash)} vs Debt: $${formatNumber(signal.debt)}
⚠️ Score: ${(signal.dilution_risk_score * 100).toFixed(0)}%

${signal.offering_detected ? '📋 Offering detected' : 'Watching for offering'}

Not financial advice. Just pattern recognition. 🎯`
    ];
  }
  
  if (type === 'performance_update') {
    const plStr = `${signal.pl.plPercent >= 0 ? '+' : ''}${signal.pl.plPercent?.toFixed(1)}%`;
    const emoji = signal.pl.plPercent > 0 ? '✅' : '❌';
    
    return [
      `${emoji} $${signal.ticker} Update

Entry: $${signal.entry_price?.toFixed(2)}
Now: $${signal.currentPrice?.toFixed(2)}
P/L: ${plStr}

${signal.pl.plPercent > 0 ? 'Thesis playing out.' : 'Not cooperating yet.'}`
    ];
  }
  
  return [`$${signal.ticker} 👀`];
}

// ═══════════════════════════════════════════════════════════════════════════
// TWITTER POSTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Post a tweet or thread to Twitter
 * Returns the tweet ID(s)
 */
async function postToTwitter(tweets) {
  if (!TWITTER_CONFIG.apiKey || !TWITTER_CONFIG.accessToken) {
    throw new Error('Twitter API credentials not configured');
  }
  
  // Twitter OAuth 1.0a is complex - we'll use a simplified approach
  // In production, you'd want to use a library like 'twitter-api-v2'
  
  const tweetIds = [];
  let previousTweetId = null;
  
  for (const tweet of tweets) {
    const body = {
      text: tweet
    };
    
    // If this is a reply in a thread
    if (previousTweetId) {
      body.reply = { in_reply_to_tweet_id: previousTweetId };
    }
    
    try {
      // This is a simplified version - real implementation needs OAuth signing
      const response = await twitterApiRequest('POST', '/2/tweets', body);
      
      if (response.data?.id) {
        tweetIds.push(response.data.id);
        previousTweetId = response.data.id;
      }
      
      // Small delay between tweets in a thread
      if (tweets.length > 1) {
        await sleep(500);
      }
      
    } catch (error) {
      console.error(`❌ Twitter post error: ${error.message}`);
      throw error;
    }
  }
  
  return tweetIds;
}

/**
 * Make a request to Twitter API
 * Note: This is a placeholder - real implementation needs proper OAuth 1.0a signing
 */
async function twitterApiRequest(method, endpoint, body = null) {
  // In production, use twitter-api-v2 package or implement OAuth 1.0a signing
  // For now, this serves as the interface
  
  const baseUrl = 'https://api.twitter.com';
  const url = `${baseUrl}${endpoint}`;
  
  // This would need proper OAuth signing in production
  // For now, we'll throw an error indicating setup is needed
  
  throw new Error(
    'Twitter API requires OAuth 1.0a signing. ' +
    'Install twitter-api-v2 package and update this function. ' +
    'See: https://github.com/PLhery/node-twitter-api-v2'
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: Generate and Post
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main function: Generate AI tweet and post to Twitter
 * Respects DRY_RUN mode
 */
export async function generateAndPostTweet(signal, type = 'new_signal') {
  console.log(`\n🐦 Generating tweet for ${signal.ticker} (${type})...`);
  
  // Check daily limits
  const todaysTweets = getTodaysTweetCount();
  if (todaysTweets >= TWITTER_CONFIG.maxTweetsPerDay) {
    console.log(`⚠️  Daily tweet limit reached (${todaysTweets}/${TWITTER_CONFIG.maxTweetsPerDay})`);
    return { success: false, reason: 'daily_limit' };
  }
  
  // Generate content
  const tweets = await generateTweetContent(signal, type);
  
  console.log(`   Generated ${tweets.length} tweet(s):`);
  tweets.forEach((t, i) => {
    console.log(`   ${i + 1}/ ${t.slice(0, 50)}${t.length > 50 ? '...' : ''}`);
  });
  
  // DRY RUN - don't actually post
  if (DRY_RUN) {
    console.log(`\n   📝 DRY RUN - Would post:`);
    tweets.forEach((t, i) => {
      console.log(`   ─────────────────────────────────────`);
      console.log(`   ${t}`);
    });
    console.log(`   ─────────────────────────────────────\n`);
    
    return { 
      success: true, 
      dryRun: true, 
      tweets,
      tweetId: `dry-run-${Date.now()}`
    };
  }
  
  // Actually post to Twitter
  try {
    const tweetIds = await postToTwitter(tweets);
    
    // Log the tweet
    logTweet(signal.ticker, tweetIds[0], type);
    
    console.log(`   ✅ Posted! Tweet ID: ${tweetIds[0]}`);
    
    return {
      success: true,
      tweetId: tweetIds[0],
      allTweetIds: tweetIds,
      tweets
    };
    
  } catch (error) {
    console.error(`   ❌ Failed to post: ${error.message}`);
    return {
      success: false,
      error: error.message,
      tweets // still return the generated content
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════

function formatNumber(num) {
  if (!num || num === 0) return '???';
  
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toFixed(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  generateAndPostTweet,
  generateTweetContent
};
