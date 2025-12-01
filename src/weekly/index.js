/**
 * WEEKLY LEADERBOARDS — Main Entry Point
 * 
 * Two independent leaderboard systems:
 *   1. Dilution Leaderboard — ATM filings from SEC EDGAR
 *   2. Bankruptcy Leaderboard — 3-stage filtered distress scan
 * 
 * Each produces ONE consolidated tweet.
 * 
 * Usage:
 *   node src/weekly/index.js dilution             # Preview dilution leaderboard
 *   node src/weekly/index.js dilution --post      # Post dilution tweet
 *   node src/weekly/index.js bankruptcy           # Preview bankruptcy leaderboard
 *   node src/weekly/index.js bankruptcy --post    # Post bankruptcy tweet
 *   node src/weekly/index.js both                 # Preview both
 *   node src/weekly/index.js both --post          # Post both (with delay)
 */

import { runDilutionLeaderboard } from './dilutionLeaderboard.js';
import { runBankruptcyLeaderboard } from './bankruptcyLeaderboard.js';

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0]?.toLowerCase();
  const post = args.includes('--post');
  const greetingArg = args.find(a => a.startsWith('--greeting='));
  const greeting = greetingArg ? greetingArg.split('=')[1] : null;
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 7;

  if (!mode || !['dilution', 'bankruptcy', 'both'].includes(mode)) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  WEEKLY LEADERBOARDS                                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝

Usage:
  node src/weekly/index.js <mode> [options]

Modes:
  dilution     SEC EDGAR ATM filings → Dilution Severity Score → Tweet
  bankruptcy   3-stage distress filter → VIS scoring → Tweet
  both         Run both leaderboards

Options:
  --post              Post to Twitter (otherwise preview only)
  --greeting="GM!"    Add greeting to tweet
  --days=7            Lookback days for dilution scan (default: 7)

Examples:
  node src/weekly/index.js dilution
  node src/weekly/index.js bankruptcy --post
  node src/weekly/index.js both --post --greeting="GM!"
`);
    process.exit(0);
  }

  const options = { post, greeting, days };

  if (mode === 'dilution' || mode === 'both') {
    console.log('\n🔎 Running DILUTION LEADERBOARD...\n');
    await runDilutionLeaderboard(options);
  }

  if (mode === 'both') {
    console.log('\n\n' + '═'.repeat(70));
    console.log('Waiting 30s before next post...');
    console.log('═'.repeat(70) + '\n');
    await new Promise(r => setTimeout(r, 30000));
  }

  if (mode === 'bankruptcy' || mode === 'both') {
    console.log('\n⚠️ Running BANKRUPTCY LEADERBOARD...\n');
    await runBankruptcyLeaderboard(options);
  }

  console.log('\n✅ Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
