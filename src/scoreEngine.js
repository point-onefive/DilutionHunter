/**
 * Score Engine
 * 
 * Evaluates potential dilution signals and assigns a confidence score.
 * All trigger logic lives here for easy tuning.
 */

import { SCANNER_THRESHOLDS, VERBOSE } from './config.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Calculate weekly % change from candles
// ═══════════════════════════════════════════════════════════════════════════

export function calculateWeeklyChange(candles) {
  if (!candles || candles.length < 7) return 0;
  
  // Get price from 7 days ago vs latest
  const latest = candles[candles.length - 1];
  const weekAgo = candles[candles.length - 7] || candles[0];
  
  if (!weekAgo.close || weekAgo.close === 0) return 0;
  
  return ((latest.close - weekAgo.close) / weekAgo.close) * 100;
}

/**
 * Calculate 5-day change
 */
export function calculate5DayChange(candles) {
  if (!candles || candles.length < 5) return 0;
  
  const latest = candles[candles.length - 1];
  const fiveDaysAgo = candles[candles.length - 5] || candles[0];
  
  if (!fiveDaysAgo.close || fiveDaysAgo.close === 0) return 0;
  
  return ((latest.close - fiveDaysAgo.close) / fiveDaysAgo.close) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANDLE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect if the latest candle is a red (bearish) day
 */
export function isRedDay(candles) {
  if (!candles || candles.length === 0) return false;
  const latest = candles[candles.length - 1];
  return latest.close < latest.open;
}

/**
 * Detect if we just had first red day after green streak
 */
export function isFirstRedDayAfterGreenStreak(candles, minGreenDays = 3) {
  if (!candles || candles.length < minGreenDays + 1) return false;
  
  const latest = candles[candles.length - 1];
  const isLatestRed = latest.close < latest.open;
  
  if (!isLatestRed) return false;
  
  // Check if previous days were green
  let greenCount = 0;
  for (let i = candles.length - 2; i >= 0 && greenCount < minGreenDays; i--) {
    const candle = candles[i];
    if (candle.close > candle.open) {
      greenCount++;
    } else {
      break; // streak broken
    }
  }
  
  return greenCount >= minGreenDays;
}

/**
 * Detect volume fade (today's volume < yesterday's)
 */
export function hasVolumeFade(candles, threshold = SCANNER_THRESHOLDS.volumeFadeRatio) {
  if (!candles || candles.length < 2) return false;
  
  const today = candles[candles.length - 1];
  const yesterday = candles[candles.length - 2];
  
  if (!yesterday.volume || yesterday.volume === 0) return false;
  
  const volumeRatio = today.volume / yesterday.volume;
  return volumeRatio < threshold;
}

/**
 * Detect blow-off top pattern
 * (Huge volume spike followed by declining volume on weaker price action)
 */
export function hasBlowOffTop(candles) {
  if (!candles || candles.length < 5) return false;
  
  // Find max volume in last 10 days
  const recentCandles = candles.slice(-10);
  const maxVolumeIdx = recentCandles.reduce((maxIdx, c, idx, arr) => 
    c.volume > arr[maxIdx].volume ? idx : maxIdx, 0);
  
  // Check if volume is declining after the peak
  if (maxVolumeIdx >= recentCandles.length - 2) return false; // peak too recent
  
  let declining = true;
  for (let i = maxVolumeIdx + 1; i < recentCandles.length; i++) {
    if (recentCandles[i].volume > recentCandles[i - 1].volume * 1.1) {
      declining = false;
      break;
    }
  }
  
  // Also check if price is weakening
  const peakClose = recentCandles[maxVolumeIdx].close;
  const latestClose = recentCandles[recentCandles.length - 1].close;
  const priceWeakening = latestClose < peakClose;
  
  return declining && priceWeakening;
}

/**
 * Calculate average volume
 */
export function getAverageVolume(candles, days = 20) {
  if (!candles || candles.length === 0) return 0;
  
  const relevantCandles = candles.slice(-days);
  const totalVolume = relevantCandles.reduce((sum, c) => sum + (c.volume || 0), 0);
  return totalVolume / relevantCandles.length;
}

/**
 * Detect bearish engulfing pattern
 */
export function hasBearishEngulfing(candles) {
  if (!candles || candles.length < 2) return false;
  
  const today = candles[candles.length - 1];
  const yesterday = candles[candles.length - 2];
  
  // Yesterday was green, today is red
  const yesterdayGreen = yesterday.close > yesterday.open;
  const todayRed = today.close < today.open;
  
  // Today's body engulfs yesterday's
  const engulfs = today.open > yesterday.close && today.close < yesterday.open;
  
  return yesterdayGreen && todayRed && engulfs;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNDAMENTAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if company has weak cash position relative to debt
 */
export function hasWeakCashPosition(fundamentals) {
  const { cash, totalDebt } = fundamentals;
  
  if (!cash && !totalDebt) return false;
  if (!totalDebt || totalDebt === 0) return false; // no debt = ok
  
  const ratio = cash / totalDebt;
  return ratio < SCANNER_THRESHOLDS.cashDebtRatioThreshold;
}

/**
 * Check if company is burning cash
 */
export function isBurningCash(fundamentals) {
  return fundamentals.freeCashFlow < 0;
}

/**
 * Calculate months of cash runway
 */
export function getCashRunwayMonths(fundamentals) {
  const { cash, freeCashFlow } = fundamentals;
  
  if (!cash || !freeCashFlow || freeCashFlow >= 0) {
    return Infinity; // not burning or can't calculate
  }
  
  const monthlyBurn = Math.abs(freeCashFlow) / 12;
  return cash / monthlyBurn;
}

// ═══════════════════════════════════════════════════════════════════════════
// OFFERING ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate offering risk
 */
export function evaluateOfferingRisk(offerings, marketCap) {
  if (!offerings || !offerings.hasOfferings) {
    return { risk: 0, hasOffering: false, details: null };
  }
  
  // Has recent offering filings = higher risk
  let risk = 0.3; // base risk for having any offering
  
  // More recent filings = higher risk
  if (offerings.count > 0) {
    risk += Math.min(offerings.count * 0.1, 0.3);
  }
  
  // TODO: When FMP provides offering size data, calculate relative to mcap
  // if (offerings.size && marketCap) {
  //   const sizeRatio = offerings.size / marketCap;
  //   if (sizeRatio > 0.2) risk += 0.3; // >20% of mcap = big dilution
  //   else if (sizeRatio > 0.1) risk += 0.2;
  // }
  
  return {
    risk: Math.min(risk, 1),
    hasOffering: true,
    details: offerings.recentFilings?.slice(0, 3) || []
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCORING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a potential signal and return decision + score
 * 
 * @param {Object} params
 * @param {string} params.ticker
 * @param {Array} params.candles - OHLCV data
 * @param {number} params.weeklyChange - % change over 7 days
 * @param {Object} params.fundamentals - Cash, debt, etc.
 * @param {Object} params.offerings - Offering data
 * @returns {Object} Decision object with score, shouldTrigger, reasons
 */
export function evaluateSignal({ ticker, candles, weeklyChange, fundamentals, offerings }) {
  const reasons = [];
  const flags = {
    candle: {},
    fundamental: {},
    offering: {}
  };
  
  // Weights for scoring (sum = 1.0)
  const weights = {
    parabolicMove: 0.20,
    firstRedDay: 0.15,
    volumeFade: 0.15,
    blowOffTop: 0.10,
    weakCash: 0.15,
    burningCash: 0.10,
    hasOffering: 0.15
  };
  
  let score = 0;
  
  // ─────────────────────────────────────────────────────────────────────────
  // PRICE/VOLUME SIGNALS
  // ─────────────────────────────────────────────────────────────────────────
  
  // Parabolic move (already pre-filtered, but add to score)
  if (weeklyChange >= SCANNER_THRESHOLDS.minWeeklyGainPct) {
    score += weights.parabolicMove;
    
    // Bonus for extreme moves
    if (weeklyChange >= 300) {
      score += 0.05;
      reasons.push(`Extreme parabolic (${weeklyChange.toFixed(0)}%)`);
    } else {
      reasons.push(`Parabolic move (${weeklyChange.toFixed(0)}% weekly)`);
    }
    flags.candle.parabolicMove = weeklyChange;
  }
  
  // First red day after green streak
  const firstRedDay = isFirstRedDayAfterGreenStreak(candles, 3);
  if (firstRedDay) {
    score += weights.firstRedDay;
    reasons.push('First red day after green streak');
    flags.candle.firstRedDay = true;
  } else if (isRedDay(candles)) {
    score += weights.firstRedDay * 0.5; // partial credit for any red day
    flags.candle.redDay = true;
  }
  
  // Volume fade
  const volumeFade = hasVolumeFade(candles);
  if (volumeFade) {
    score += weights.volumeFade;
    reasons.push('Volume fading');
    flags.candle.volumeFade = true;
  }
  
  // Blow-off top pattern
  const blowOff = hasBlowOffTop(candles);
  if (blowOff) {
    score += weights.blowOffTop;
    reasons.push('Blow-off top pattern');
    flags.candle.blowOffTop = true;
  }
  
  // Bearish engulfing (bonus)
  if (hasBearishEngulfing(candles)) {
    score += 0.05;
    reasons.push('Bearish engulfing candle');
    flags.candle.bearishEngulfing = true;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FUNDAMENTAL SIGNALS
  // ─────────────────────────────────────────────────────────────────────────
  
  // Weak cash position
  const weakCash = hasWeakCashPosition(fundamentals);
  if (weakCash) {
    score += weights.weakCash;
    reasons.push('Weak cash vs debt');
    flags.fundamental.weakCash = true;
  }
  
  // Burning cash
  const burningCash = isBurningCash(fundamentals);
  if (burningCash) {
    score += weights.burningCash;
    reasons.push('Negative cash flow');
    flags.fundamental.burningCash = true;
    
    // Check runway
    const runway = getCashRunwayMonths(fundamentals);
    if (runway < 12) {
      score += 0.05;
      reasons.push(`Short runway (${runway.toFixed(0)} months)`);
      flags.fundamental.shortRunway = runway;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // OFFERING SIGNALS
  // ─────────────────────────────────────────────────────────────────────────
  
  const offeringRisk = evaluateOfferingRisk(offerings, fundamentals.marketCap);
  if (offeringRisk.hasOffering) {
    score += weights.hasOffering * (offeringRisk.risk / 0.6); // normalize
    reasons.push('Equity offering detected');
    flags.offering = offeringRisk;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FINAL DECISION
  // ─────────────────────────────────────────────────────────────────────────
  
  // Normalize score to 0-1
  score = Math.min(Math.max(score, 0), 1);
  
  // Must meet minimum score threshold
  const shouldTrigger = score >= SCANNER_THRESHOLDS.minScoreToTrigger;
  
  // Get entry price (latest close)
  const entryPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  
  if (VERBOSE) {
    console.log(`   📊 ${ticker} Score Breakdown:`);
    console.log(`      Raw score: ${score.toFixed(3)}`);
    console.log(`      Threshold: ${SCANNER_THRESHOLDS.minScoreToTrigger}`);
    console.log(`      Flags: ${JSON.stringify(flags, null, 2)}`);
  }
  
  return {
    ticker,
    score,
    shouldTrigger,
    reasons,
    entryPrice,
    firstRedDay,
    volumeFade,
    fundamentalFlags: flags.fundamental,
    candleFlags: flags.candle,
    offeringFlags: flags.offering,
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  evaluateSignal,
  calculateWeeklyChange,
  calculate5DayChange,
  isRedDay,
  isFirstRedDayAfterGreenStreak,
  hasVolumeFade,
  hasBlowOffTop,
  hasBearishEngulfing,
  hasWeakCashPosition,
  isBurningCash,
  getCashRunwayMonths,
  evaluateOfferingRisk
};
