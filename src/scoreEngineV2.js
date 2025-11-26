/**
 * Score Engine V2 - Enhanced Dilution Detection
 * 
 * NEW SCORING MODEL (0-1 scale):
 * - percent_gain_7d      * 0.30  (parabolic explosion)
 * - red_candle_flag      * 0.15  (reversal signal)
 * - volume_fade_factor   * 0.10  (exhaustion)
 * - runway_factor        * 0.15  (survival window)
 * - offering_impact      * 0.20  (dilution force)
 * - float_fragility      * 0.10  (structural weakness)
 * 
 * TRIGGER CONDITIONS:
 * - score >= 0.65
 * - AND offering_impact_ratio > 10%
 * - AND weekly_gain > 150%
 */

import { VERBOSE } from './config.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION - Adjustable thresholds
// ═══════════════════════════════════════════════════════════════════════════

export const DILUTION_THRESHOLDS = {
  // Price movement
  minWeeklyGainPct: 150,        // Minimum 7-day gain to consider
  extremeGainPct: 300,          // Bonus points threshold
  
  // Float sensitivity
  fragileFloatPct: 20,          // Float < 20% = extremely fragile
  sensitiveFloatPct: 40,        // Float < 40% = reactive to dilution
  
  // Cash runway
  criticalRunwayMonths: 2,      // Imminent dilution
  dangerRunwayMonths: 3,        // High probability
  warningRunwayMonths: 6,       // Yellow flag
  
  // Offering impact
  meaningfulOfferingPct: 10,    // >10% of market cap = meaningful
  highOfferingPct: 25,          // >25% = high dilution probability
  nuclearOfferingPct: 50,       // >50% = nuclear event
  
  // Volume capitulation
  volumeFadeThreshold: 0.7,     // <70% = buyers disappearing
  capitulationThreshold: 0.5,   // <50% = confirmed capitulation
  
  // Final trigger
  minScoreToTrigger: 0.65
};

// ═══════════════════════════════════════════════════════════════════════════
// FACTOR CALCULATIONS (each returns 0-1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate 7-day gain percentage from candles
 */
export function calculate7DayGain(candles) {
  if (!candles || candles.length < 7) return 0;
  
  const latest = candles[candles.length - 1];
  const sevenDaysAgo = candles[candles.length - 7];
  
  if (!sevenDaysAgo?.close || sevenDaysAgo.close === 0) return 0;
  
  return ((latest.close - sevenDaysAgo.close) / sevenDaysAgo.close) * 100;
}

/**
 * Calculate gain factor (0-1 scale)
 * Maps gain percentage to a 0-1 factor
 */
export function calculateGainFactor(gainPct) {
  if (gainPct < DILUTION_THRESHOLDS.minWeeklyGainPct) return 0;
  
  // Linear scale from threshold to 500%
  const normalized = (gainPct - DILUTION_THRESHOLDS.minWeeklyGainPct) / 
                     (500 - DILUTION_THRESHOLDS.minWeeklyGainPct);
  
  return Math.min(normalized + 0.5, 1); // Base 0.5 for meeting threshold, up to 1.0
}

/**
 * Check for red candle (close < open)
 */
export function isRedCandle(candles) {
  if (!candles || candles.length === 0) return false;
  const latest = candles[candles.length - 1];
  return latest.close < latest.open;
}

/**
 * Calculate red candle factor
 * Extra points for first red after green streak
 */
export function calculateRedCandleFactor(candles) {
  if (!candles || candles.length < 2) return 0;
  
  const latest = candles[candles.length - 1];
  if (latest.close >= latest.open) return 0; // Not red
  
  // Check for green streak before
  let greenCount = 0;
  for (let i = candles.length - 2; i >= 0 && greenCount < 5; i--) {
    if (candles[i].close > candles[i].open) {
      greenCount++;
    } else {
      break;
    }
  }
  
  // Score based on streak length
  if (greenCount >= 4) return 1.0;  // Perfect setup
  if (greenCount >= 3) return 0.8;
  if (greenCount >= 2) return 0.6;
  return 0.4; // Just a red day
}

/**
 * Calculate volume fade factor (0-1)
 * Compares recent 5-day avg vs prior 5-day avg
 */
export function calculateVolumeFadeFactor(candles) {
  if (!candles || candles.length < 10) return 0;
  
  const recent5 = candles.slice(-5);
  const prior5 = candles.slice(-10, -5);
  
  const recentAvg = recent5.reduce((sum, c) => sum + c.volume, 0) / 5;
  const priorAvg = prior5.reduce((sum, c) => sum + c.volume, 0) / 5;
  
  if (priorAvg === 0) return 0;
  
  const ratio = recentAvg / priorAvg;
  
  // Score based on fade intensity
  if (ratio <= DILUTION_THRESHOLDS.capitulationThreshold) return 1.0;  // Full capitulation
  if (ratio <= DILUTION_THRESHOLDS.volumeFadeThreshold) return 0.7;   // Buyers disappearing
  if (ratio <= 0.85) return 0.4;                                        // Mild fade
  return 0; // No fade
}

/**
 * Calculate cash runway factor (0-1)
 * Based on months of runway
 */
export function calculateRunwayFactor(runwayData) {
  if (!runwayData) return 0;
  
  const { runwayMonths, status } = runwayData;
  
  // Profitable companies = no runway pressure
  if (status === 'PROFITABLE' || runwayMonths === Infinity) return 0;
  
  // Score based on runway length
  if (runwayMonths <= DILUTION_THRESHOLDS.criticalRunwayMonths) return 1.0;
  if (runwayMonths <= DILUTION_THRESHOLDS.dangerRunwayMonths) return 0.85;
  if (runwayMonths <= DILUTION_THRESHOLDS.warningRunwayMonths) return 0.5;
  if (runwayMonths <= 12) return 0.25;
  return 0;
}

/**
 * Calculate offering impact factor (0-1)
 * THE SECRET SAUCE - offering size vs market cap
 */
export function calculateOfferingImpactFactor(offeringData, marketCap) {
  if (!offeringData || !offeringData.hasRecentOfferings) return 0;
  if (!marketCap || marketCap === 0) return 0;
  
  const { totalAmountRemaining, impactRatio } = offeringData;
  
  // Use pre-calculated impact ratio if available
  const ratio = impactRatio || (totalAmountRemaining / marketCap);
  
  // Score based on impact
  if (ratio >= DILUTION_THRESHOLDS.nuclearOfferingPct / 100) return 1.0;   // Nuclear
  if (ratio >= DILUTION_THRESHOLDS.highOfferingPct / 100) return 0.8;      // High impact
  if (ratio >= DILUTION_THRESHOLDS.meaningfulOfferingPct / 100) return 0.5; // Meaningful
  if (ratio > 0) return 0.2; // Has offering but small
  return 0;
}

/**
 * Calculate float fragility factor (0-1)
 * Small float = more sensitive to dilution
 */
export function calculateFloatFragilityFactor(floatData) {
  if (!floatData) return 0.3; // Unknown float = assume some risk
  
  const { floatRatio, freeFloat } = floatData;
  const floatPct = (floatRatio || freeFloat / 100) * 100;
  
  // Score based on float size
  if (floatPct <= DILUTION_THRESHOLDS.fragileFloatPct) return 1.0;   // Extremely fragile
  if (floatPct <= DILUTION_THRESHOLDS.sensitiveFloatPct) return 0.6; // Reactive
  if (floatPct <= 60) return 0.3;
  return 0; // Large float = resilient
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCORING FUNCTION V2
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhanced signal evaluation with new scoring model
 * 
 * @param {Object} params
 * @param {string} params.ticker
 * @param {Array} params.candles - OHLCV data (30+ days)
 * @param {Object} params.quote - Current quote with price/marketCap
 * @param {Object} params.floatData - From getSharesFloat()
 * @param {Object} params.runwayData - From getCashRunway()
 * @param {Object} params.offeringData - From getDilutionAnalysis()
 * @returns {Object} Decision with score, factors, and trigger status
 */
export function evaluateSignalV2({ 
  ticker, 
  candles, 
  quote,
  floatData,
  runwayData,
  offeringData 
}) {
  
  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE ALL FACTORS
  // ─────────────────────────────────────────────────────────────────────────
  
  const gainPct = calculate7DayGain(candles);
  const gainFactor = calculateGainFactor(gainPct);
  
  const redCandleFactor = calculateRedCandleFactor(candles);
  const volumeFadeFactor = calculateVolumeFadeFactor(candles);
  const runwayFactor = calculateRunwayFactor(runwayData);
  const offeringImpactFactor = calculateOfferingImpactFactor(offeringData, quote?.marketCap);
  const floatFragilityFactor = calculateFloatFragilityFactor(floatData);
  
  // ─────────────────────────────────────────────────────────────────────────
  // WEIGHTED SCORE CALCULATION
  // ─────────────────────────────────────────────────────────────────────────
  
  const weights = {
    gain: 0.30,
    redCandle: 0.15,
    volumeFade: 0.10,
    runway: 0.15,
    offeringImpact: 0.20,
    floatFragility: 0.10
  };
  
  const score = (
    (gainFactor * weights.gain) +
    (redCandleFactor * weights.redCandle) +
    (volumeFadeFactor * weights.volumeFade) +
    (runwayFactor * weights.runway) +
    (offeringImpactFactor * weights.offeringImpact) +
    (floatFragilityFactor * weights.floatFragility)
  );
  
  // ─────────────────────────────────────────────────────────────────────────
  // TRIGGER CONDITIONS (all must be true)
  // ─────────────────────────────────────────────────────────────────────────
  
  const offeringImpactRatio = offeringData?.impactRatio || 0;
  
  const triggerConditions = {
    scoreThreshold: score >= DILUTION_THRESHOLDS.minScoreToTrigger,
    hasSignificantOffering: offeringImpactRatio >= (DILUTION_THRESHOLDS.meaningfulOfferingPct / 100),
    hasParabolicRun: gainPct >= DILUTION_THRESHOLDS.minWeeklyGainPct
  };
  
  const shouldTrigger = 
    triggerConditions.scoreThreshold &&
    triggerConditions.hasSignificantOffering &&
    triggerConditions.hasParabolicRun;
  
  // ─────────────────────────────────────────────────────────────────────────
  // BUILD REASONS LIST
  // ─────────────────────────────────────────────────────────────────────────
  
  const reasons = [];
  
  if (gainPct >= DILUTION_THRESHOLDS.extremeGainPct) {
    reasons.push(`🔥 EXTREME parabolic run (+${gainPct.toFixed(0)}% in 7 days)`);
  } else if (gainPct >= DILUTION_THRESHOLDS.minWeeklyGainPct) {
    reasons.push(`📈 Parabolic move (+${gainPct.toFixed(0)}% in 7 days)`);
  }
  
  if (redCandleFactor >= 0.8) {
    reasons.push('🔴 First red candle after strong green streak');
  } else if (redCandleFactor > 0) {
    reasons.push('🔴 Red candle reversal');
  }
  
  if (volumeFadeFactor >= 0.7) {
    reasons.push('📉 Volume capitulation (buyers exhausted)');
  } else if (volumeFadeFactor > 0) {
    reasons.push('📉 Volume fading');
  }
  
  if (runwayFactor >= 0.85) {
    reasons.push(`⚠️ CRITICAL: Cash runway < 3 months`);
  } else if (runwayFactor >= 0.5) {
    reasons.push(`⚠️ Low cash runway (< 6 months)`);
  }
  
  if (offeringImpactFactor >= 0.8) {
    reasons.push(`💸 HIGH dilution impact: offering > 25% of market cap`);
  } else if (offeringImpactFactor >= 0.5) {
    reasons.push(`💸 Meaningful offering: > 10% of market cap`);
  } else if (offeringImpactFactor > 0) {
    reasons.push(`💸 Active equity offering detected`);
  }
  
  if (floatFragilityFactor >= 0.6) {
    reasons.push(`🎯 Small float (< 40%) - highly sensitive to dilution`);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // VERBOSE LOGGING
  // ─────────────────────────────────────────────────────────────────────────
  
  if (VERBOSE) {
    console.log(`\n   📊 ${ticker} Score Breakdown (V2):`);
    console.log(`      ├─ Gain Factor:      ${gainFactor.toFixed(3)} × 0.30 = ${(gainFactor * 0.30).toFixed(3)}`);
    console.log(`      ├─ Red Candle:       ${redCandleFactor.toFixed(3)} × 0.15 = ${(redCandleFactor * 0.15).toFixed(3)}`);
    console.log(`      ├─ Volume Fade:      ${volumeFadeFactor.toFixed(3)} × 0.10 = ${(volumeFadeFactor * 0.10).toFixed(3)}`);
    console.log(`      ├─ Runway:           ${runwayFactor.toFixed(3)} × 0.15 = ${(runwayFactor * 0.15).toFixed(3)}`);
    console.log(`      ├─ Offering Impact:  ${offeringImpactFactor.toFixed(3)} × 0.20 = ${(offeringImpactFactor * 0.20).toFixed(3)}`);
    console.log(`      └─ Float Fragility:  ${floatFragilityFactor.toFixed(3)} × 0.10 = ${(floatFragilityFactor * 0.10).toFixed(3)}`);
    console.log(`      ══════════════════════════════════════════`);
    console.log(`      TOTAL SCORE: ${score.toFixed(3)} (threshold: ${DILUTION_THRESHOLDS.minScoreToTrigger})`);
    console.log(`      Trigger conditions: ${JSON.stringify(triggerConditions)}`);
    console.log(`      SHOULD TRIGGER: ${shouldTrigger ? '🚨 YES' : '❌ NO'}`);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // RETURN COMPLETE ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────
  
  return {
    ticker,
    timestamp: new Date().toISOString(),
    
    // Core decision
    score,
    shouldTrigger,
    reasons,
    
    // Entry data
    entryPrice: candles?.[candles.length - 1]?.close || quote?.price || 0,
    marketCap: quote?.marketCap || 0,
    
    // Raw metrics
    metrics: {
      gainPct,
      isRedCandle: redCandleFactor > 0,
      volumeFadeRatio: volumeFadeFactor > 0 ? calculateVolumeRatio(candles) : null,
      runwayMonths: runwayData?.runwayMonths || null,
      offeringImpactRatio,
      floatRatio: floatData?.floatRatio || null
    },
    
    // Factor scores (0-1)
    factors: {
      gainFactor,
      redCandleFactor,
      volumeFadeFactor,
      runwayFactor,
      offeringImpactFactor,
      floatFragilityFactor
    },
    
    // Trigger conditions breakdown
    triggerConditions,
    
    // Raw data references
    _raw: {
      floatData,
      runwayData,
      offeringData
    }
  };
}

/**
 * Helper: Calculate actual volume ratio for reporting
 */
function calculateVolumeRatio(candles) {
  if (!candles || candles.length < 10) return null;
  
  const recent5 = candles.slice(-5);
  const prior5 = candles.slice(-10, -5);
  
  const recentAvg = recent5.reduce((sum, c) => sum + c.volume, 0) / 5;
  const priorAvg = prior5.reduce((sum, c) => sum + c.volume, 0) / 5;
  
  return priorAvg > 0 ? recentAvg / priorAvg : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // Main function
  evaluateSignalV2,
  
  // Factor calculations
  calculate7DayGain,
  calculateGainFactor,
  calculateRedCandleFactor,
  calculateVolumeFadeFactor,
  calculateRunwayFactor,
  calculateOfferingImpactFactor,
  calculateFloatFragilityFactor,
  
  // Thresholds
  DILUTION_THRESHOLDS
};
