/**
 * ACTIVE SCANNER - Momentum-First Dilution Hunter
 * 
 * Philosophy: Start from the PUMP, work backwards.
 * If it's not running hard, it's not a setup.
 * 
 * Tiers:
 *   🔴 TIER 1: 300%+ weekly  (extreme blowoff)
 *   🟠 TIER 2: 200%+ weekly  (major run)
 *   🟡 TIER 3: 100%+ weekly  (solid momentum)
 * 
 * Usage:
 *   node src/activeScanner.js           # Scan all tiers
 *   node src/activeScanner.js --tier=1  # Only 300%+ runners
 *   node src/activeScanner.js --tier=2  # Only 200%+ runners
 *   node src/activeScanner.js --full    # Full analysis on triggers
 */

import 'dotenv/config';
import { analyzeSymbol } from './analystBrief.js';

const FMP_KEY = process.env.FMP_API_KEY;
const BASE_URL = 'https://financialmodelingprep.com/stable';

// Tier thresholds (weekly % gain)
const TIERS = {
  1: { min: 300, emoji: '🔴', label: 'EXTREME BLOWOFF' },
  2: { min: 200, emoji: '🟠', label: 'MAJOR RUN' },
  3: { min: 100, emoji: '🟡', label: 'SOLID MOMENTUM' }
};

const TRIGGER_THRESHOLD = 65; // Risk score to flag

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getBiggestGainers() {
  const url = `${BASE_URL}/biggest-gainers?apikey=${FMP_KEY}`;
  return fetchJSON(url);
}

async function getPriceChange(symbol) {
  const url = `${BASE_URL}/stock-price-change?symbol=${symbol}&apikey=${FMP_KEY}`;
  const data = await fetchJSON(url);
  return data[0] || null;
}

async function getQuote(symbol) {
  const url = `${BASE_URL}/quote?symbol=${symbol}&apikey=${FMP_KEY}`;
  const data = await fetchJSON(url);
  return data[0] || null;
}

function classifyTier(weeklyPct) {
  if (weeklyPct >= 300) return 1;
  if (weeklyPct >= 200) return 2;
  if (weeklyPct >= 100) return 3;
  return 0; // Below threshold
}

function formatNumber(num) {
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

async function scanForRunners(minTier = 3) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  DILUTIONHUNTER ACTIVE SCANNER                                    ║
║  ${new Date().toISOString().split('T')[0]}                                             ║
╚═══════════════════════════════════════════════════════════════════╝
`);

  const minPct = TIERS[minTier]?.min || 100;
  console.log(`🎯 Scanning for ${minPct}%+ weekly runners (Tier ${minTier}+)\n`);

  // Step 1: Get today's biggest gainers as starting pool
  console.log('📡 Fetching biggest gainers...');
  const gainers = await getBiggestGainers();
  console.log(`   Found ${gainers.length} daily gainers\n`);

  // Step 2: Get weekly performance for each
  console.log('📊 Calculating weekly momentum...');
  const runners = [];
  
  for (const stock of gainers) {
    try {
      const priceChange = await getPriceChange(stock.symbol);
      if (!priceChange) continue;
      
      // Use 5D as proxy for weekly (FMP doesn't have exact 7D)
      const weeklyPct = priceChange['5D'] || 0;
      const tier = classifyTier(weeklyPct);
      
      if (tier > 0 && tier <= minTier) {
        const quote = await getQuote(stock.symbol);
        runners.push({
          symbol: stock.symbol,
          price: stock.price,
          dayPct: stock.changesPercentage,
          weeklyPct,
          monthPct: priceChange['1M'] || 0,
          marketCap: quote?.marketCap || 0,
          volume: quote?.volume || 0,
          avgVolume: quote?.avgVolume || 0,
          tier
        });
        
        const tierInfo = TIERS[tier];
        process.stdout.write(`   ${tierInfo.emoji} ${stock.symbol}: +${weeklyPct.toFixed(0)}% (5D)\n`);
      }
      
      // Small delay to be nice to API
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      // Skip failed lookups silently
    }
  }

  // Sort by weekly performance descending
  runners.sort((a, b) => b.weeklyPct - a.weeklyPct);

  // Step 3: Display results by tier
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📈 RUNNERS FOUND: ${runners.length}`);
  console.log(`${'═'.repeat(70)}\n`);

  for (let t = 1; t <= 3; t++) {
    const tierRunners = runners.filter(r => r.tier === t);
    if (tierRunners.length === 0) continue;
    
    const tierInfo = TIERS[t];
    console.log(`${tierInfo.emoji} TIER ${t}: ${tierInfo.label} (${tierInfo.min}%+)`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`${'Symbol'.padEnd(8)} ${'Price'.padEnd(10)} ${'Day'.padEnd(10)} ${'Week'.padEnd(10)} ${'Month'.padEnd(10)} ${'MCap'.padEnd(12)}`);
    console.log(`${'─'.repeat(70)}`);
    
    for (const r of tierRunners) {
      const dayStr = (r.dayPct >= 0 ? '+' : '') + r.dayPct.toFixed(1) + '%';
      const weekStr = (r.weeklyPct >= 0 ? '+' : '') + r.weeklyPct.toFixed(0) + '%';
      const monthStr = (r.monthPct >= 0 ? '+' : '') + r.monthPct.toFixed(0) + '%';
      
      console.log(
        `${r.symbol.padEnd(8)} ` +
        `$${r.price.toFixed(2).padEnd(9)} ` +
        `${dayStr.padEnd(10)} ` +
        `${weekStr.padEnd(10)} ` +
        `${monthStr.padEnd(10)} ` +
        `${formatNumber(r.marketCap).padEnd(12)}`
      );
    }
    console.log();
  }

  return runners;
}

async function analyzeRunners(runners, fullAnalysis = false) {
  if (runners.length === 0) {
    console.log('⚠️  No runners found meeting criteria\n');
    return [];
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🔬 DILUTION RISK ANALYSIS`);
  console.log(`${'═'.repeat(70)}\n`);

  const results = [];
  
  for (const runner of runners) {
    try {
      console.log(`\n📋 Analyzing ${runner.symbol}...`);
      
      const brief = await analyzeSymbol(runner.symbol, { silent: true });
      
      if (!brief) {
        console.log(`   ⚠️  Could not analyze ${runner.symbol}`);
        continue;
      }

      const score = brief.score || 0;
      const runway = brief.cashFlow?.runwayMonths;
      const hasATM = brief.offerings?.hasActiveATM;
      const distressed = brief.financials?.cashDebtRatio < 0.5;
      
      let verdict = '✅ PASS';
      if (score >= TRIGGER_THRESHOLD) verdict = '🚨 TRIGGER';
      else if (score >= 50) verdict = '⚠️  WATCH';
      else if (score >= 35) verdict = '👀 MONITOR';

      const runwayStr = runway !== null && runway !== undefined 
        ? `${runway.toFixed(1)}mo` 
        : 'N/A';

      console.log(`   Score: ${score}% ${verdict}`);
      console.log(`   Runway: ${runwayStr} | ATM: ${hasATM ? '🔴 YES' : '⚪ No'} | Distressed: ${distressed ? '🚨 YES' : '⚪ No'}`);

      results.push({
        ...runner,
        score,
        runway,
        hasATM,
        distressed,
        verdict,
        brief
      });

      // If trigger found and full analysis requested, print the full brief
      if (score >= TRIGGER_THRESHOLD && fullAnalysis) {
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`🚨 TRIGGER FOUND: ${runner.symbol}`);
        console.log(`${'═'.repeat(70)}`);
        // Run full analysis (non-silent)
        await analyzeSymbol(runner.symbol, { silent: false });
      }

      // Delay between analyses
      await new Promise(r => setTimeout(r, 500));
      
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 SCAN SUMMARY`);
  console.log(`${'═'.repeat(70)}\n`);

  const triggers = results.filter(r => r.score >= TRIGGER_THRESHOLD);
  const watches = results.filter(r => r.score >= 50 && r.score < TRIGGER_THRESHOLD);
  const monitors = results.filter(r => r.score >= 35 && r.score < 50);

  console.log(`🚨 TRIGGERS (${TRIGGER_THRESHOLD}%+):  ${triggers.length}`);
  triggers.forEach(r => console.log(`   ${r.symbol}: ${r.score}%`));
  
  console.log(`⚠️  WATCHLIST (50-64%): ${watches.length}`);
  watches.forEach(r => console.log(`   ${r.symbol}: ${r.score}%`));
  
  console.log(`👀 MONITOR (35-49%):   ${monitors.length}`);
  monitors.forEach(r => console.log(`   ${r.symbol}: ${r.score}%`));

  console.log(`\n✅ PASSED:            ${results.filter(r => r.score < 35).length}`);

  // Sort final results by score
  results.sort((a, b) => b.score - a.score);

  return results;
}

// Main execution
const args = process.argv.slice(2);
const tierArg = args.find(a => a.startsWith('--tier='));
const minTier = tierArg ? parseInt(tierArg.split('=')[1]) : 3;
const fullAnalysis = args.includes('--full');

try {
  const runners = await scanForRunners(minTier);
  await analyzeRunners(runners, fullAnalysis);
} catch (err) {
  console.error('❌ Scanner error:', err.message);
  process.exit(1);
}
