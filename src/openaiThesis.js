/**
 * DilutionHunter - OpenAI Thesis Generator
 * 
 * Takes structured analysis data and generates:
 * 1. Executive TLDR (2-3 sentences)
 * 2. Key bullet points (concise, punchy)
 * 3. Full nerdy stats block
 * 4. Tweet-ready format with all metrics
 * 
 * Uses GPT-4o-mini to keep costs low.
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE TWEET THESIS
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateTweetThesis(analysisResult) {
  const { symbol, score, quote, priceAction, float, financials, cashFlow, offerings, insiders } = analysisResult;
  
  // Build context for GPT
  const context = buildContextBlock(analysisResult);
  
  const prompt = `You are a sharp, sardonic financial analyst who specializes in spotting dilution traps. 
Your style is punchy, data-driven, and slightly irreverent — like a fintwit veteran who's seen too many retail traders get rugged.

Given this analysis data for ${symbol}, generate a tweet alert that includes:

1. A hook (attention-grabbing opener, 1 line)
2. TLDR thesis (2-3 sentences explaining the setup)
3. Key stats (3-5 bullet points, each with a specific number)
4. Risk warning (1 line)

FORMAT RULES:
- Use 🚨 🔥 💀 📉 💸 emojis sparingly but effectively
- Numbers should be specific (e.g., "87% gain in 7 days" not "huge gain")
- Keep total under 2000 characters (leave room for chart attachment)
- Sound confident but not reckless
- The tone should make readers want to dig deeper

ANALYSIS DATA:
${context}

Generate the tweet now:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a financial analyst specializing in equity dilution events. Output ONLY the tweet content, no explanations.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const tweet = response.choices[0].message.content.trim();
    
    return {
      tweet,
      usage: response.usage,
      model: response.model
    };
  } catch (err) {
    console.error('OpenAI Error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE FULL REPORT (for thread or blog)
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateFullReport(analysisResult) {
  const { symbol, score } = analysisResult;
  const context = buildContextBlock(analysisResult);
  
  const prompt = `You are a hedge fund analyst writing a brief on ${symbol} for your trading desk.
Write a concise but comprehensive dilution risk report.

Structure:
1. EXECUTIVE SUMMARY (3 sentences max)
2. THE SETUP (what's happening with price action)
3. THE CATALYST (why dilution is likely)
4. RISK FACTORS (what could go wrong with the short thesis)
5. TRADE PARAMETERS (entry, invalidation, target)

Keep it under 1500 words. Be specific with numbers.

ANALYSIS DATA:
${context}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a hedge fund analyst. Write in professional but accessible language.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 1500
    });

    return {
      report: response.choices[0].message.content.trim(),
      usage: response.usage,
      model: response.model
    };
  } catch (err) {
    console.error('OpenAI Error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD CONTEXT BLOCK
// ═══════════════════════════════════════════════════════════════════════════════

function buildContextBlock(result) {
  const { symbol, score, quote, priceAction, float, financials, cashFlow, offerings, insiders } = result;
  
  const lines = [
    `SYMBOL: ${symbol}`,
    `RISK SCORE: ${score}% (threshold: 65% to trigger)`,
    '',
    '=== PRICE ACTION ===',
    `Current Price: $${quote?.price?.toFixed(2) || 'N/A'}`,
    `Market Cap: $${formatNumber(quote?.marketCap)}`,
    `52W High: $${quote?.fiftyTwoWeekHigh?.toFixed(2) || 'N/A'}`,
    `52W Low: $${quote?.fiftyTwoWeekLow?.toFixed(2) || 'N/A'}`,
    `3-Day Return: ${formatPercent(priceAction?.threeDayReturn)}`,
    `7-Day Return: ${formatPercent(priceAction?.sevenDayReturn)}`,
    `30-Day Return: ${formatPercent(priceAction?.thirtyDayReturn)}`,
    `Daily Volatility (ATR%): ${priceAction?.atrPercent?.toFixed(1) || 'N/A'}%`,
    `Today: ${priceAction?.isRedCandle ? 'RED CANDLE' : 'GREEN CANDLE'}`,
    '',
    '=== FLOAT ===',
    `Float Shares: ${formatNumber(float?.floatShares)}`,
    `Float Ratio: ${float?.floatRatio ? (float.floatRatio * 100).toFixed(0) + '%' : 'N/A'}`,
    `Float Assessment: ${float?.floatRatio < 0.3 ? 'LOW FLOAT - FRAGILE' : float?.floatRatio < 0.6 ? 'MODERATE FLOAT' : 'HIGH FLOAT'}`,
    '',
    '=== FINANCIAL HEALTH ===',
    `Cash: $${formatNumber(financials?.cash)}`,
    `Total Debt: $${formatNumber(financials?.debt)}`,
    `Cash/Debt Ratio: ${financials?.cashDebtRatio?.toFixed(2) || 'N/A'}`,
    `Monthly Burn Rate: $${formatNumber(cashFlow?.monthlyBurn)}`,
    `Runway: ${cashFlow?.runwayMonths?.toFixed(1) || 'N/A'} months`,
    `Cash Flow Status: ${cashFlow?.isPositive ? 'POSITIVE (not burning)' : 'NEGATIVE (burning cash)'}`,
    '',
    '=== DILUTION RISK ===',
    `Latest Offering Date: ${offerings?.latestDate || 'None found'}`,
    `Total Offering Size: $${formatNumber(offerings?.totalSize)}`,
    `Already Sold: $${formatNumber(offerings?.amountSold)}`,
    `REMAINING CAPACITY: $${formatNumber(offerings?.remainingCapacity)}`,
    `Impact on Market Cap: ${offerings?.marketCapRatio ? (offerings.marketCapRatio * 100).toFixed(1) + '%' : 'N/A'}`,
    `Active ATM: ${offerings?.hasActiveATM ? 'YES - CAN SELL ANY DAY' : 'No'}`,
    `Serial Diluter: ${offerings?.isSerialDiluter ? 'YES' : 'No'}`,
    '',
    '=== INSIDER ACTIVITY ===',
    `Net Flow (90d): ${insiders?.netFlow || 0} (positive = buying, negative = selling)`,
    `Sell Count: ${insiders?.sellCount || 0}`,
  ];
  
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function formatNumber(num) {
  if (!num) return 'N/A';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(0);
}

function formatPercent(val) {
  if (val === undefined || val === null) return 'N/A';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE STATS BLOCK (for embedding in tweets)
// ═══════════════════════════════════════════════════════════════════════════════

export function generateStatsBlock(result) {
  const { symbol, score, quote, priceAction, cashFlow, offerings } = result;
  
  const lines = [
    `📊 ${symbol} DILUTION RISK SNAPSHOT`,
    ``,
    `💰 Price: $${quote?.price?.toFixed(2)} | MCap: $${formatNumber(quote?.marketCap)}`,
    `📈 7D: ${formatPercent(priceAction?.sevenDayReturn)} | 30D: ${formatPercent(priceAction?.thirtyDayReturn)}`,
  ];
  
  if (cashFlow?.runwayMonths && cashFlow.runwayMonths < 24) {
    lines.push(`⏱️ Runway: ${cashFlow.runwayMonths.toFixed(1)} months`);
  }
  
  if (offerings?.remainingCapacity && offerings.remainingCapacity > 0) {
    lines.push(`💥 Shelf Capacity: $${formatNumber(offerings.remainingCapacity)} (${(offerings.marketCapRatio * 100).toFixed(1)}% of MCap)`);
  }
  
  if (offerings?.hasActiveATM) {
    lines.push(`🔴 ACTIVE ATM — dilution can drop any day`);
  }
  
  lines.push(``, `⚠️ Risk Score: ${score}%`);
  
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST / CLI
// ═══════════════════════════════════════════════════════════════════════════════

async function testGenerator() {
  // Mock high-risk analysis result for testing
  const mockResult = {
    symbol: 'FFIE',
    score: 78,
    triggered: true,
    quote: {
      price: 2.45,
      marketCap: 450000000,
      fiftyTwoWeekHigh: 8.50,
      fiftyTwoWeekLow: 0.45
    },
    priceAction: {
      threeDayReturn: 45.2,
      sevenDayReturn: 187.5,
      thirtyDayReturn: 320.0,
      atrPercent: 18.5,
      isRedCandle: true
    },
    float: {
      floatShares: 85000000,
      floatRatio: 0.28
    },
    financials: {
      cash: 45000000,
      debt: 280000000,
      cashDebtRatio: 0.16
    },
    cashFlow: {
      quarterlyBurn: 65000000,
      monthlyBurn: 21700000,
      runwayMonths: 2.1,
      isPositive: false
    },
    offerings: {
      latestDate: '2024-11-15',
      totalSize: 200000000,
      amountSold: 50000000,
      remainingCapacity: 150000000,
      marketCapRatio: 0.33,
      hasActiveATM: true,
      isSerialDiluter: true
    },
    insiders: {
      netFlow: -8,
      sellCount: 12
    }
  };
  
  console.log('\n' + '═'.repeat(70));
  console.log('  OPENAI THESIS GENERATOR TEST');
  console.log('═'.repeat(70));
  
  console.log('\n📊 Stats Block (no API call):');
  console.log('─'.repeat(50));
  console.log(generateStatsBlock(mockResult));
  
  console.log('\n🐦 Generating Tweet Thesis...');
  console.log('─'.repeat(50));
  
  const tweetResult = await generateTweetThesis(mockResult);
  if (tweetResult) {
    console.log(tweetResult.tweet);
    console.log('\n[Tokens used:', tweetResult.usage?.total_tokens, '| Model:', tweetResult.model, ']');
  } else {
    console.log('❌ Failed to generate tweet (check OPENAI_API_KEY)');
  }
  
  console.log('\n' + '═'.repeat(70));
}

// Run test if called directly
const isMainModule = process.argv[1]?.includes('openaiThesis');
if (isMainModule) {
  testGenerator().catch(console.error);
}
