/**
 * Storage Module
 * 
 * Handles all JSON file operations for signals and tracking data.
 * No database needed - just flat JSON files committed to repo.
 */

import fs from 'fs';
import path from 'path';
import { DATA_PATHS, VERBOSE } from './config.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Ensure directory exists
// ═══════════════════════════════════════════════════════════════════════════

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Safe JSON read/write
// ═══════════════════════════════════════════════════════════════════════════

function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`⚠️  Could not read ${filePath}: ${error.message}`);
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  try {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    if (VERBOSE) console.log(`💾 Saved: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`❌ Could not write ${filePath}: ${error.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE SIGNALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load all active signals being tracked
 * @returns {Array} Array of signal objects
 */
export function loadSignals() {
  return readJSON(DATA_PATHS.activeSignals, []);
}

/**
 * Save active signals list
 * @param {Array} signals - Array of signal objects
 */
export function saveSignals(signals) {
  return writeJSON(DATA_PATHS.activeSignals, signals);
}

/**
 * Add a new signal (if not already tracking)
 * @param {Object} signal - Signal object to add
 * @returns {boolean} True if added, false if already exists
 */
export function addSignal(signal) {
  const signals = loadSignals();
  
  // Check if already tracking this ticker
  if (signals.some(s => s.ticker === signal.ticker)) {
    if (VERBOSE) console.log(`⏭️  ${signal.ticker} already being tracked`);
    return false;
  }
  
  signals.push(signal);
  saveSignals(signals);
  return true;
}

/**
 * Remove a signal by ticker
 * @param {string} ticker
 * @returns {boolean} True if removed
 */
export function removeSignal(ticker) {
  const signals = loadSignals();
  const filtered = signals.filter(s => s.ticker !== ticker);
  
  if (filtered.length === signals.length) {
    return false; // not found
  }
  
  saveSignals(filtered);
  return true;
}

/**
 * Update an existing signal
 * @param {string} ticker
 * @param {Object} updates - Fields to update
 */
export function updateSignal(ticker, updates) {
  const signals = loadSignals();
  const idx = signals.findIndex(s => s.ticker === ticker);
  
  if (idx === -1) {
    return false;
  }
  
  signals[idx] = { ...signals[idx], ...updates };
  saveSignals(signals);
  return true;
}

/**
 * Get a single signal by ticker
 * @param {string} ticker
 */
export function getSignal(ticker) {
  const signals = loadSignals();
  return signals.find(s => s.ticker === ticker) || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load performance history for all tracked tickers
 * Structure: { "TICKER": [ {date, close}, ... ], ... }
 * @returns {Object}
 */
export function loadPerformanceHistory() {
  return readJSON(DATA_PATHS.performanceHistory, {});
}

/**
 * Save performance history
 * @param {Object} history
 */
export function savePerformanceHistory(history) {
  return writeJSON(DATA_PATHS.performanceHistory, history);
}

/**
 * Add a daily price update for a ticker
 * @param {string} ticker
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {number} close - Closing price
 */
export function addPerformanceEntry(ticker, date, close) {
  const history = loadPerformanceHistory();
  
  if (!history[ticker]) {
    history[ticker] = [];
  }
  
  // Don't add duplicate dates
  if (history[ticker].some(e => e.date === date)) {
    return false;
  }
  
  history[ticker].push({ date, close });
  
  // Keep sorted by date
  history[ticker].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  savePerformanceHistory(history);
  return true;
}

/**
 * Get performance data for a single ticker
 * @param {string} ticker
 */
export function getPerformance(ticker) {
  const history = loadPerformanceHistory();
  return history[ticker] || [];
}

/**
 * Calculate P/L for a signal based on history
 * @param {Object} signal - Signal object with entry_price
 * @returns {Object} P/L data
 */
export function calculatePL(signal) {
  const history = getPerformance(signal.ticker);
  
  if (history.length === 0) {
    return { 
      currentPrice: signal.entry_price,
      plPercent: 0,
      plDollars: 0,
      daysTracked: 0,
      highSinceEntry: signal.entry_price,
      lowSinceEntry: signal.entry_price
    };
  }
  
  const latestClose = history[history.length - 1].close;
  const plDollars = signal.entry_price - latestClose; // We're short, so profit = entry - current
  const plPercent = (plDollars / signal.entry_price) * 100;
  
  const closes = history.map(h => h.close);
  const highSinceEntry = Math.max(signal.entry_price, ...closes);
  const lowSinceEntry = Math.min(signal.entry_price, ...closes);
  
  return {
    currentPrice: latestClose,
    plPercent,
    plDollars,
    daysTracked: history.length,
    highSinceEntry,
    lowSinceEntry
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY LOG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load daily operation log (API calls, tweets sent, etc.)
 */
export function loadDailyLog() {
  return readJSON(DATA_PATHS.dailyLog, {
    runs: [],
    signals: [],
    tweets: []
  });
}

/**
 * Save daily log
 */
export function saveDailyLog(log) {
  return writeJSON(DATA_PATHS.dailyLog, log);
}

/**
 * Log a tweet that was sent
 */
export function logTweet(ticker, tweetId, type = 'new_signal') {
  const log = loadDailyLog();
  const today = new Date().toISOString().split('T')[0];
  
  log.tweets = log.tweets || [];
  log.tweets.push({
    date: today,
    timestamp: new Date().toISOString(),
    ticker,
    tweetId,
    type
  });
  
  saveDailyLog(log);
}

/**
 * Get count of tweets sent today
 */
export function getTodaysTweetCount() {
  const log = loadDailyLog();
  const today = new Date().toISOString().split('T')[0];
  return (log.tweets || []).filter(t => t.date === today).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP / ARCHIVAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Archive old signals (e.g., after 30 days)
 * Moves them from active_signals to a separate archive
 */
export function archiveOldSignals(maxAgeDays = 30) {
  const signals = loadSignals();
  const now = new Date();
  
  const active = [];
  const archived = [];
  
  for (const signal of signals) {
    const triggerDate = new Date(signal.trigger_date);
    const ageDays = (now - triggerDate) / (1000 * 60 * 60 * 24);
    
    if (ageDays > maxAgeDays) {
      archived.push(signal);
    } else {
      active.push(signal);
    }
  }
  
  if (archived.length > 0) {
    // Save archived signals
    const archivePath = DATA_PATHS.activeSignals.replace('.json', '_archive.json');
    const existingArchive = readJSON(archivePath, []);
    writeJSON(archivePath, [...existingArchive, ...archived]);
    
    // Update active signals
    saveSignals(active);
    
    console.log(`📦 Archived ${archived.length} signals older than ${maxAgeDays} days`);
  }
  
  return { active: active.length, archived: archived.length };
}

/**
 * Prune performance history (keep only last N entries per ticker)
 */
export function prunePerformanceHistory(maxEntriesPerTicker = 90) {
  const history = loadPerformanceHistory();
  let pruned = 0;
  
  for (const ticker of Object.keys(history)) {
    if (history[ticker].length > maxEntriesPerTicker) {
      const excess = history[ticker].length - maxEntriesPerTicker;
      history[ticker] = history[ticker].slice(excess);
      pruned += excess;
    }
  }
  
  if (pruned > 0) {
    savePerformanceHistory(history);
    console.log(`🧹 Pruned ${pruned} old performance entries`);
  }
  
  return pruned;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // Signals
  loadSignals,
  saveSignals,
  addSignal,
  removeSignal,
  updateSignal,
  getSignal,
  
  // Performance
  loadPerformanceHistory,
  savePerformanceHistory,
  addPerformanceEntry,
  getPerformance,
  calculatePL,
  
  // Daily log
  loadDailyLog,
  saveDailyLog,
  logTweet,
  getTodaysTweetCount,
  
  // Maintenance
  archiveOldSignals,
  prunePerformanceHistory
};
