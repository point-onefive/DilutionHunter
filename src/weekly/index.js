/**
 * WEEKLY LEADERBOARDS — Main Entry Point
 * 
 * Three independent leaderboard systems:
 *   1. Dilution Leaderboard (Mon) — ATM filings from SEC EDGAR
 *   2. Bankruptcy Leaderboard (Tue) — 3-stage filtered distress scan
 *   3. Shelf Offering Radar (Wed) — S-3/shelf registrations (dilution armed)
 * 
 * Each produces ONE consolidated tweet.
 * 
 * Usage:
 *   node src/weekly/index.js dilution             # Preview dilution leaderboard
 *   node src/weekly/index.js dilution --post      # Post dilution tweet
 *   node src/weekly/index.js bankruptcy           # Preview bankruptcy leaderboard
 *   node src/weekly/index.js bankruptcy --post    # Post bankruptcy tweet
 *   node src/weekly/index.js shelf                # Preview shelf offering radar
 *   node src/weekly/index.js shelf --post         # Post shelf tweet
 *   node src/weekly/index.js all                  # Preview all
 *   node src/weekly/index.js all --post           # Post all (with delays)
 */

import { runDilutionLeaderboard } from './dilutionLeaderboard.js';
import { runBankruptcyLeaderboard } from './bankruptcyLeaderboard.js';
import { runShelfLeaderboard } from './shelfLeaderboard.js';

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0]?.toLowerCase();
  const post = args.includes('--post');
  const greetingArg = args.find(a => a.startsWith('--greeting='));
  const greeting = greetingArg ? greetingArg.split('=')[1] : null;
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 7;

  if (!mode || !['dilution', 'bankruptcy', 'shelf', 'all', 'both'].includes(mode)) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  WEEKLY LEADERBOARDS                                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝

Usage:
  node src/weekly/index.js <mode> [options]

Modes:
  dilution     SEC EDGAR ATM filings → DSS scoring → Tweet (Monday)
  bankruptcy   3-stage distress filter → VIS scoring → Tweet (Tuesday)
  shelf        S-3/shelf filings → SDR scoring → Tweet (Wednesday)
  all          Run all three leaderboards

Options:
  --post              Post to Twitter (otherwise preview only)
  --greeting="GM!"    Add greeting to tweet
  --days=7            Lookback days for scans (default: 7)

Examples:
  node src/weekly/index.js dilution
  node src/weekly/index.js shelf --post
  node src/weekly/index.js all --post --greeting="GM"
`);
    process.exit(0);
  }

  const options = { post, greeting, days };

  if (mode === 'dilution' || mode === 'all' || mode === 'both') {
    console.log('\n🔎 Running DILUTION LEADERBOARD...\n');
    await runDilutionLeaderboard(options);
  }

  if ((mode === 'all' || mode === 'both') && (mode === 'dilution' || mode === 'all')) {
    console.log('\n\n' + '═'.repeat(70));
    console.log('Waiting 30s before next post...');
    console.log('═'.repeat(70) + '\n');
    await new Promise(r => setTimeout(r, 30000));
  }

  if (mode === 'bankruptcy' || mode === 'all' || mode === 'both') {
    console.log('\n⚠️ Running BANKRUPTCY LEADERBOARD...\n');
    await runBankruptcyLeaderboard(options);
  }

  if (mode === 'all' && mode !== 'both') {
    console.log('\n\n' + '═'.repeat(70));
    console.log('Waiting 30s before next post...');
    console.log('═'.repeat(70) + '\n');
    await new Promise(r => setTimeout(r, 30000));
  }

  if (mode === 'shelf' || mode === 'all') {
    console.log('\n📋 Running SHELF OFFERING RADAR...\n');
    await runShelfLeaderboard(options);
  }

  console.log('\n✅ Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
