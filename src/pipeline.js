/**
 * DilutionHunter - Full Pipeline Orchestrator
 * 
 * The main entry point that runs the complete flow:
 * 1. Scan ticker(s) for dilution risk
 * 2. If triggered → Generate OpenAI thesis
 * 3. Render chart PNG
 * 4. Post to Twitter (when DRY_RUN=false)
 * 
 * Usage:
 *   node src/pipeline.js                    # Show usage
 *   node src/pipeline.js RIOT               # Scan single ticker
 *   node src/pipeline.js RIOT --force       # Force generate even if score < 65
 *   node src/pipeline.js --mock             # Run with mock high-risk data (no API calls)
 */

import 'dotenv/config';
import { analyzeSymbol } from './analystBrief.js';
import { generateTweetThesis, generateStatsBlock } from './openaiThesis.js';
import { renderChart } from './chartRenderer.js';
import { postAlertThread, validateTwitterConfig } from './twitterPoster.js';
import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const DRY_RUN = process.env.DRY_RUN !== 'false';
const TRIGGER_THRESHOLD = 65; // Score must be >= this to fire

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA (for testing without API calls)
// ═══════════════════════════════════════════════════════════════════════════════

function getMockAnalysis() {
  return {
    symbol: 'FFIE',
    score: 78,
    triggered: true,
    quote: { price: 2.45, marketCap: 450000000, fiftyTwoWeekHigh: 3.20, fiftyTwoWeekLow: 0.42 },
    priceAction: {
      threeDayReturn: 45.2,
      sevenDayReturn: 187.5,
      thirtyDayReturn: 320,
      atrPercent: 18.5,
      isRedCandle: true
    },
    float: { floatShares: 126000000, floatRatio: 0.28 },
    financials: { cash: 45000000, debt: 280000000, cashDebtRatio: 0.16 },
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
    insiders: { netFlow: -5200000, sellCount: 8 },
    data: { candles: generateMockPumpCandles() }
  };
}

function generateMockPumpCandles() {
  const candles = [];
  let price = 0.85;
  const baseVolume = 5000000;
  
  for (let i = 0; i < 20; i++) {
    let change;
    if (i < 10) change = 0.02 + Math.random() * 0.05;
    else if (i < 17) change = 0.10 + Math.random() * 0.15;
    else if (i < 19) change = -0.05 + Math.random() * 0.08;
    else change = -0.12;
    
    const open = price;
    price = price * (1 + change);
    const close = price;
    const high = Math.max(open, close) * (1 + Math.random() * 0.03);
    const low = Math.min(open, close) * (1 - Math.random() * 0.03);
    
    let volMultiplier = 1;
    if (i >= 12 && i <= 17) volMultiplier = 3 + Math.random() * 2;
    if (i === 19) volMultiplier = 4;
    
    candles.push({
      date: new Date(Date.now() - (19 - i) * 86400000).toISOString().split('T')[0],
      open, high, low, close,
      volume: Math.round(baseVolume * volMultiplier * (0.8 + Math.random() * 0.4))
    });
  }
  return candles;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

async function runPipeline(options = {}) {
  const { symbol, force = false, mock = false } = options;
  
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║            🎯 DILUTIONHUNTER PIPELINE                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`  Mode: ${mock ? '🧪 MOCK DATA' : '📡 LIVE API'}`);
  console.log(`  DRY_RUN: ${DRY_RUN}`);
  console.log(`  Symbol: ${symbol || 'MOCK'}`);
  console.log(`  Force: ${force}`);
  console.log('═'.repeat(70) + '\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: ANALYZE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('📊 STEP 1: Analysis');
  console.log('─'.repeat(50));
  
  let analysis;
  
  if (mock) {
    console.log('  Using mock high-risk data (no API calls)');
    analysis = getMockAnalysis();
  } else {
    console.log(`  Analyzing ${symbol}...`);
    analysis = await analyzeSymbol(symbol, { silent: true });
    
    if (!analysis) {
      console.log('  ❌ Analysis failed (symbol unavailable on free tier)');
      return null;
    }
  }
  
  console.log(`  ✅ Score: ${analysis.score}%`);
  console.log(`  ✅ Triggered: ${analysis.score >= TRIGGER_THRESHOLD ? '🚨 YES' : '❌ NO'}`);
  
  // Check threshold
  const shouldProceed = analysis.score >= TRIGGER_THRESHOLD || force;
  
  if (!shouldProceed) {
    console.log(`\n⚠️  Score ${analysis.score}% is below threshold (${TRIGGER_THRESHOLD}%).`);
    console.log('   Use --force to generate thesis anyway.');
    console.log('\n📊 Quick Stats:');
    console.log(generateStatsBlock(analysis));
    return { analysis, triggered: false };
  }
  
  console.log(`\n🚨 THRESHOLD MET — Proceeding to thesis generation...\n`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: GENERATE OPENAI THESIS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('🤖 STEP 2: OpenAI Thesis Generation');
  console.log('─'.repeat(50));
  
  const thesis = await generateTweetThesis(analysis);
  
  if (!thesis) {
    console.log('  ❌ OpenAI generation failed');
    return { analysis, triggered: true, thesis: null };
  }
  
  console.log('  ✅ Generated!');
  console.log(`  [Tokens: ${thesis.usage?.total_tokens || 'N/A'} | Model: ${thesis.model}]`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: GENERATE STATS BLOCK
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n📈 STEP 3: Stats Block');
  console.log('─'.repeat(50));
  
  const statsBlock = generateStatsBlock(analysis);
  console.log('  ✅ Generated!');

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: RENDER CHART
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n📉 STEP 4: Chart Rendering');
  console.log('─'.repeat(50));
  
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  const chartPath = path.join(outputDir, `${analysis.symbol}-alert-${Date.now()}.png`);
  renderChart(analysis, chartPath);
  console.log(`  ✅ Saved: ${chartPath}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5: POST TO TWITTER (DRY_RUN safe)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n🐦 STEP 5: Twitter Posting');
  console.log('─'.repeat(50));
  
  if (DRY_RUN) {
    console.log('  [DRY_RUN mode — not posting to Twitter]');
  } else {
    if (!validateTwitterConfig()) {
      console.log('  ⚠️  Twitter credentials not configured');
    } else {
      await postAlertThread(thesis.tweet, statsBlock, chartPath);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OUTPUT SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    📋 PIPELINE OUTPUT                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  
  console.log('\n🐦 TWEET (Main):');
  console.log('─'.repeat(60));
  console.log(thesis.tweet);
  console.log('─'.repeat(60));
  
  console.log('\n📊 STATS (Reply):');
  console.log('─'.repeat(60));
  console.log(statsBlock);
  console.log('─'.repeat(60));
  
  console.log('\n📉 CHART:', chartPath);
  
  console.log('\n═'.repeat(70));
  console.log('  ✅ PIPELINE COMPLETE');
  if (DRY_RUN) {
    console.log('  📝 Set DRY_RUN=false in .env to actually post to Twitter');
  }
  console.log('═'.repeat(70) + '\n');

  return {
    analysis,
    triggered: true,
    thesis: thesis.tweet,
    statsBlock,
    chartPath
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const symbol = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');
const mock = args.includes('--mock');

if (mock) {
  runPipeline({ mock: true, force: true }).catch(console.error);
} else if (symbol) {
  runPipeline({ symbol, force }).catch(console.error);
} else {
  console.log('Usage:');
  console.log('  node src/pipeline.js TICKER         # Analyze real ticker');
  console.log('  node src/pipeline.js TICKER --force # Force thesis generation');
  console.log('  node src/pipeline.js --mock         # Test with mock data (no API calls)');
}
