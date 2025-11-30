/**
 * BANKRUPTCY RADAR — Daily Dashboard Post
 * 
 * Generates a single summary tweet showing all tracked distress tickers.
 * Designed to build brand recognition through consistent daily updates.
 * 
 * Usage:
 *   node src/bankruptcy/bankruptcyRadar.js                 # Preview radar
 *   node src/bankruptcy/bankruptcyRadar.js --post          # Post to Twitter
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { postAlertThread } from '../twitterPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SIGNALS_FILE = path.join(DATA_DIR, 'bankruptcy_signals.json');

const DRY_RUN = process.env.DRY_RUN !== 'false';

// ═══════════════════════════════════════════════════════════════════════════════
// RADAR GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

function loadSignals() {
  try {
    const data = fs.readFileSync(SIGNALS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function getVISEmoji(vis) {
  if (vis >= 75) return '🔥';  // PRIME_ALERT
  if (vis >= 60) return '⚠️';   // WATCHLIST
  return '📊';                  // STORE_ONLY
}

function getVISLabel(vis) {
  if (vis >= 75) return 'Alert';
  if (vis >= 60) return 'Watch';
  return 'Monitor';
}

export function generateRadarTweet() {
  const signals = loadSignals();
  
  if (!signals) {
    return { error: 'No signals file found. Run bankruptcyScan.js first.' };
  }

  const { primeAlerts = [], watchlist = [], storeOnly = [], scannedAt } = signals;
  
  // Combine and sort by VIS
  const allTickers = [
    ...primeAlerts.map(t => ({ ...t, tier: 'ALERT' })),
    ...watchlist.map(t => ({ ...t, tier: 'WATCHLIST' }))
  ].sort((a, b) => b.vis - a.vis);

  if (allTickers.length === 0) {
    return { 
      tweet: `🧭 Bankruptcy Radar — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}

No high-VIS distress signals today.

Quiet markets = healthy rotation.
We're watching so you don't have to.`,
      tickerCount: 0
    };
  }

  // Build the radar list (max 8 tickers to fit tweet)
  const radarLines = allTickers.slice(0, 8).map((t, i) => {
    const emoji = getVISEmoji(t.vis);
    const label = getVISLabel(t.vis);
    return `${i + 1}. $${t.symbol} — VIS ${t.vis}  ${emoji} ${label}`;
  });

  const dateStr = new Date().toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });

  const tweet = `🧭 Bankruptcy Radar — ${dateStr}

${radarLines.join('\n')}

VIS = Risk × Attention
High VIS = distress that markets will price.

Full threads on alerts. 🧵`;

  return {
    tweet,
    tickerCount: allTickers.length,
    tickers: allTickers.map(t => t.symbol),
    scannedAt
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const shouldPost = args.includes('--post');

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  BANKRUPTCY RADAR — Daily Dashboard                                           ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  const result = generateRadarTweet();

  if (result.error) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }

  console.log('📡 RADAR TWEET:\n');
  console.log('────────────────────────────────────────');
  console.log(result.tweet);
  console.log('────────────────────────────────────────');
  console.log(`\nTickers: ${result.tickerCount}`);
  console.log(`Last scan: ${result.scannedAt || 'Unknown'}`);

  if (shouldPost) {
    if (DRY_RUN) {
      console.log('\n[DRY_RUN] Would post radar. Set DRY_RUN=false to post.');
    } else {
      console.log('\n🚀 Posting to Twitter...');
      try {
        const posted = await postAlertThread(result.tweet, [], null);
        console.log(`✅ Posted! Tweet ID: ${posted.tweetIds?.[0]}`);
      } catch (error) {
        console.error(`❌ Post failed: ${error.message}`);
      }
    }
  } else {
    console.log('\nUse --post to publish this radar.');
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}

export default { generateRadarTweet };
