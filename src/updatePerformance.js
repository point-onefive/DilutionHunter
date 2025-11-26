/**
 * Performance Update Module
 * 
 * Runs daily to update prices and P/L for all tracked signals.
 * Generates follow-up tweets for significant moves.
 */

import { DRY_RUN, VERBOSE, TWITTER_CONFIG, logConfig } from './config.js';
import { getQuote, getBatchQuotes, getApiCallCount, resetApiCallCount } from './vendors/fmp.js';
import { 
  loadSignals, 
  loadPerformanceHistory, 
  savePerformanceHistory,
  addPerformanceEntry,
  calculatePL,
  getTodaysTweetCount
} from './storage.js';
import { generateAndPostTweet } from './postTweet.js';

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE UPDATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update performance data for all active signals
 */
export async function updateAllPerformance() {
  console.log('\n📈 DilutionHunter Performance Update Starting...\n');
  logConfig();
  
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  
  resetApiCallCount();
  
  const signals = loadSignals();
  
  if (signals.length === 0) {
    console.log('ℹ️  No active signals to track');
    return { updated: 0, tweets: 0 };
  }
  
  console.log(`📋 Tracking ${signals.length} active signals\n`);
  
  // Get current prices efficiently with batch quote
  const tickers = signals.map(s => s.ticker);
  let quotes = [];
  
  try {
    // Batch in groups of 50 to stay efficient
    for (let i = 0; i < tickers.length; i += 50) {
      const batch = tickers.slice(i, i + 50);
      const batchQuotes = await getBatchQuotes(batch);
      quotes = quotes.concat(batchQuotes);
    }
  } catch (error) {
    console.error(`❌ Error fetching quotes: ${error.message}`);
    return { updated: 0, tweets: 0, error: error.message };
  }
  
  // Map quotes by symbol for easy lookup
  const quoteMap = {};
  for (const q of quotes) {
    if (q && q.symbol) {
      quoteMap[q.symbol] = q;
    }
  }
  
  // Track updates and significant moves
  const updates = [];
  const significantMoves = [];
  
  for (const signal of signals) {
    const quote = quoteMap[signal.ticker];
    
    if (!quote || !quote.price) {
      console.warn(`⚠️  No quote data for ${signal.ticker}`);
      continue;
    }
    
    const currentPrice = quote.price;
    
    // Add to performance history
    addPerformanceEntry(signal.ticker, today, currentPrice);
    
    // Calculate P/L
    const pl = calculatePL(signal);
    
    const update = {
      ticker: signal.ticker,
      entryPrice: signal.entry_price,
      currentPrice,
      plPercent: pl.plPercent,
      daysTracked: pl.daysTracked + 1
    };
    
    updates.push(update);
    
    // Log update
    const plEmoji = pl.plPercent > 0 ? '🟢' : (pl.plPercent < 0 ? '🔴' : '⚪');
    console.log(`   ${plEmoji} ${signal.ticker}: $${currentPrice.toFixed(2)} | P/L: ${pl.plPercent >= 0 ? '+' : ''}${pl.plPercent.toFixed(1)}% | Days: ${pl.daysTracked + 1}`);
    
    // Flag significant moves for potential tweets
    if (Math.abs(pl.plPercent) >= 20) {
      significantMoves.push({
        signal,
        pl,
        currentPrice,
        direction: pl.plPercent > 0 ? 'win' : 'loss'
      });
    }
  }
  
  // Post follow-up tweets for significant moves
  let tweetCount = 0;
  const todaysTweets = getTodaysTweetCount();
  const remainingTweets = TWITTER_CONFIG.maxTweetsPerDay - todaysTweets;
  
  if (significantMoves.length > 0 && remainingTweets > 0) {
    console.log(`\n🎯 ${significantMoves.length} significant moves detected`);
    
    for (const move of significantMoves.slice(0, remainingTweets)) {
      if (!DRY_RUN) {
        try {
          await generateAndPostTweet(
            { ...move.signal, currentPrice: move.currentPrice, pl: move.pl },
            'performance_update'
          );
          tweetCount++;
        } catch (e) {
          console.error(`❌ Tweet error for ${move.signal.ticker}: ${e.message}`);
        }
      } else {
        console.log(`   📝 DRY RUN: Would tweet ${move.direction} update for ${move.signal.ticker} (${move.pl.plPercent.toFixed(1)}%)`);
      }
    }
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 PERFORMANCE UPDATE COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`   API Calls: ${getApiCallCount()}`);
  console.log(`   Signals Updated: ${updates.length}`);
  console.log(`   Significant Moves: ${significantMoves.length}`);
  console.log(`   Tweets Posted: ${tweetCount}`);
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Print leaderboard
  if (updates.length > 0) {
    printLeaderboard(updates);
  }
  
  return { updated: updates.length, tweets: tweetCount, significantMoves };
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════

function printLeaderboard(updates) {
  // Sort by P/L (best shorts first - highest positive %)
  const sorted = [...updates].sort((a, b) => b.plPercent - a.plPercent);
  
  console.log('🏆 CURRENT LEADERBOARD (Short P/L):');
  console.log('─────────────────────────────────────');
  
  sorted.forEach((u, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
    const plStr = `${u.plPercent >= 0 ? '+' : ''}${u.plPercent.toFixed(1)}%`;
    console.log(`${medal} ${u.ticker.padEnd(6)} | Entry: $${u.entryPrice.toFixed(2).padStart(7)} | Now: $${u.currentPrice.toFixed(2).padStart(7)} | P/L: ${plStr.padStart(8)}`);
  });
  
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY SUMMARY GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a weekly summary of all signal performance
 */
export function generateWeeklySummary() {
  const signals = loadSignals();
  const history = loadPerformanceHistory();
  
  if (signals.length === 0) {
    return null;
  }
  
  let totalPL = 0;
  let winners = 0;
  let losers = 0;
  const details = [];
  
  for (const signal of signals) {
    const pl = calculatePL(signal);
    totalPL += pl.plPercent;
    
    if (pl.plPercent > 0) winners++;
    else if (pl.plPercent < 0) losers++;
    
    details.push({
      ticker: signal.ticker,
      entryDate: signal.trigger_date,
      entryPrice: signal.entry_price,
      ...pl
    });
  }
  
  const avgPL = totalPL / signals.length;
  const winRate = (winners / signals.length) * 100;
  
  return {
    totalSignals: signals.length,
    winners,
    losers,
    avgPL,
    totalPL,
    winRate,
    details,
    generatedAt: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  updateAllPerformance()
    .then(result => {
      console.log('✅ Performance update finished');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Performance update failed:', error);
      process.exit(1);
    });
}

export default {
  updateAllPerformance,
  generateWeeklySummary
};
