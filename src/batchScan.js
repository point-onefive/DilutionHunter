/**
 * Batch Scanner
 * 
 * Scans multiple tickers and returns summary results.
 * Optimized for API conservation — stops on errors, tracks call count.
 */

import 'dotenv/config';
import { runAnalystBrief } from './analystBrief.js';

// Tickers that work on FREE tier (tested)
const FREE_TIER_TICKERS = [
  // Known working
  'RIOT', 'SOFI',
  // Try these - various sectors
  'SNDL', 'PLUG', 'LCID', 'RIVN', 'NIO', 'PLTR',
  'CLOV', 'WISH', 'BB', 'NOK', 'TLRY',
  'OPEN', 'UPST', 'AFRM', 'HOOD',
  // Biotech/small cap attempts
  'NVAX', 'MRNA', 'BNTX',
  // Energy
  'FCEL', 'BE', 'CHPT',
];

async function batchScan(tickers, maxTickers = 5) {
  console.log('\n' + '═'.repeat(70));
  console.log('  DILUTIONHUNTER BATCH SCANNER');
  console.log('  Scanning up to', maxTickers, 'tickers');
  console.log('═'.repeat(70) + '\n');

  const results = [];
  let scanned = 0;
  let blocked = 0;

  for (const ticker of tickers) {
    if (scanned >= maxTickers) {
      console.log(`\n⚠️  Reached max tickers (${maxTickers}). Stopping to conserve API calls.\n`);
      break;
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Scanning ${ticker}... (${scanned + 1}/${maxTickers})`);
    console.log('─'.repeat(50));

    try {
      const result = await runAnalystBrief(ticker, { silent: true });
      
      if (result && result.score !== undefined) {
        scanned++;
        results.push({
          ticker,
          score: result.score,
          price: result.quote?.price,
          marketCap: result.quote?.marketCap,
          sevenDayGain: result.priceAction?.sevenDayReturn,
          runway: result.cashFlow?.runwayMonths,
          offeringRemaining: result.offerings?.remainingCapacity,
          verdict: result.score >= 65 ? '🚨 ALERT' : '✅ PASS'
        });
        
        console.log(`  Score: ${result.score}% ${result.score >= 65 ? '🚨 ALERT!' : '✅'}`);
      } else {
        blocked++;
        console.log(`  ❌ Blocked on free tier`);
      }
    } catch (err) {
      blocked++;
      console.log(`  ❌ Error: ${err.message}`);
    }

    // Small delay between tickers
    await new Promise(r => setTimeout(r, 500));
  }

  // Print summary
  console.log('\n\n' + '═'.repeat(70));
  console.log('  SCAN COMPLETE');
  console.log('═'.repeat(70));
  console.log(`  Scanned: ${scanned}  |  Blocked: ${blocked}`);
  console.log('─'.repeat(70));

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  console.log('\n  RESULTS (sorted by risk score):\n');
  console.log('  ' + '─'.repeat(66));
  console.log('  ' + 'TICKER'.padEnd(8) + 'SCORE'.padEnd(8) + 'VERDICT'.padEnd(12) + '7D-GAIN'.padEnd(10) + 'RUNWAY'.padEnd(10) + 'OFFERING');
  console.log('  ' + '─'.repeat(66));

  for (const r of results) {
    const sevenDay = r.sevenDayGain ? `${r.sevenDayGain > 0 ? '+' : ''}${r.sevenDayGain.toFixed(1)}%` : 'N/A';
    const runway = r.runway ? `${r.runway.toFixed(1)}mo` : 'N/A';
    const offering = r.offeringRemaining ? `$${(r.offeringRemaining / 1e6).toFixed(1)}M` : 'None';
    
    console.log('  ' + 
      r.ticker.padEnd(8) + 
      `${r.score}%`.padEnd(8) + 
      r.verdict.padEnd(12) + 
      sevenDay.padEnd(10) + 
      runway.padEnd(10) + 
      offering
    );
  }

  console.log('  ' + '─'.repeat(66));

  // Highlight alerts
  const alerts = results.filter(r => r.score >= 65);
  if (alerts.length > 0) {
    console.log('\n  🚨 ALERTS TRIGGERED:');
    for (const a of alerts) {
      console.log(`     → ${a.ticker} (${a.score}%)`);
    }
  } else {
    console.log('\n  ✅ No alerts triggered in this batch.');
  }

  // High potential (50-64)
  const watchlist = results.filter(r => r.score >= 40 && r.score < 65);
  if (watchlist.length > 0) {
    console.log('\n  👀 WATCHLIST (40-64% — monitor closely):');
    for (const w of watchlist) {
      console.log(`     → ${w.ticker} (${w.score}%)`);
    }
  }

  console.log('\n' + '═'.repeat(70) + '\n');

  return results;
}

// Run if called directly
const args = process.argv.slice(2);
const maxTickers = args[0] ? parseInt(args[0]) : 5;

batchScan(FREE_TIER_TICKERS, maxTickers);
