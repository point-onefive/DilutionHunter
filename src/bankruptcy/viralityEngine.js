/**
 * viralityEngine.js
 * 
 * Calculates virality potential for distressed tickers.
 * High virality = more eyeballs = higher engagement potential.
 * 
 * Factors:
 * - Average daily volume (liquidity = engagement)
 * - Market cap (bigger = more audience)
 * - News count (headlines = narrative fuel)
 * - Options availability (more ways to trade = more interest)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VIRALITY SCORE CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate virality score (0-100)
 * @param {Object} params
 * @param {number} params.avgVolume - Average daily trading volume
 * @param {number} params.marketCap - Market capitalization in dollars
 * @param {number} params.newsCount - Number of news articles in last 7 days
 * @param {boolean} params.hasOptions - Whether options chain exists
 * @returns {Object} { score, breakdown, tier }
 */
export function calculateViralityScore({ avgVolume = 0, marketCap = 0, newsCount = 0, hasOptions = false }) {
  const breakdown = {
    volume: { score: 0, max: 35, reason: '' },
    marketCap: { score: 0, max: 25, reason: '' },
    news: { score: 0, max: 20, reason: '' },
    options: { score: 0, max: 20, reason: '' }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // VOLUME (35 pts max) — liquidity = engagement potential
  // ─────────────────────────────────────────────────────────────────────────────
  if (avgVolume > 5_000_000) {
    breakdown.volume.score = 35;
    breakdown.volume.reason = 'Very high volume (>5M)';
  } else if (avgVolume > 1_000_000) {
    breakdown.volume.score = 25;
    breakdown.volume.reason = 'High volume (>1M)';
  } else if (avgVolume > 250_000) {
    breakdown.volume.score = 15;
    breakdown.volume.reason = 'Moderate volume (>250K)';
  } else if (avgVolume > 50_000) {
    breakdown.volume.score = 8;
    breakdown.volume.reason = 'Low volume (>50K)';
  } else {
    breakdown.volume.score = 0;
    breakdown.volume.reason = 'Very low volume (<50K)';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MARKET CAP (25 pts max) — visibility + audience size
  // ─────────────────────────────────────────────────────────────────────────────
  if (marketCap > 5_000_000_000) {
    breakdown.marketCap.score = 25;
    breakdown.marketCap.reason = 'Large cap (>$5B)';
  } else if (marketCap > 500_000_000) {
    breakdown.marketCap.score = 18;
    breakdown.marketCap.reason = 'Mid cap (>$500M)';
  } else if (marketCap > 50_000_000) {
    breakdown.marketCap.score = 10;
    breakdown.marketCap.reason = 'Small cap (>$50M)';
  } else if (marketCap > 10_000_000) {
    breakdown.marketCap.score = 5;
    breakdown.marketCap.reason = 'Micro cap (>$10M)';
  } else {
    breakdown.marketCap.score = 0;
    breakdown.marketCap.reason = 'Nano cap (<$10M)';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // NEWS COUNT (20 pts max) — headlines = narrative fuel
  // ─────────────────────────────────────────────────────────────────────────────
  const newsPoints = Math.min(newsCount * 5, 20);
  breakdown.news.score = newsPoints;
  if (newsCount >= 4) {
    breakdown.news.reason = `Heavy news coverage (${newsCount} articles)`;
  } else if (newsCount >= 2) {
    breakdown.news.reason = `Moderate news coverage (${newsCount} articles)`;
  } else if (newsCount >= 1) {
    breakdown.news.reason = `Light news coverage (${newsCount} article)`;
  } else {
    breakdown.news.reason = 'No recent news';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPTIONS CHAIN (20 pts max) — more ways to trade = more interest
  // ─────────────────────────────────────────────────────────────────────────────
  if (hasOptions) {
    breakdown.options.score = 20;
    breakdown.options.reason = 'Options available';
  } else {
    breakdown.options.score = 0;
    breakdown.options.reason = 'No options chain';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TOTAL SCORE
  // ─────────────────────────────────────────────────────────────────────────────
  const totalScore = Math.min(
    breakdown.volume.score +
    breakdown.marketCap.score +
    breakdown.news.score +
    breakdown.options.score,
    100
  );

  // Classify virality tier
  let tier;
  if (totalScore >= 70) tier = 'HIGH_VIRAL';
  else if (totalScore >= 45) tier = 'MODERATE_VIRAL';
  else tier = 'LOW_VIRAL';

  return {
    score: totalScore,
    tier,
    breakdown,
    summary: `Volume: ${breakdown.volume.score}/${breakdown.volume.max}, MCap: ${breakdown.marketCap.score}/${breakdown.marketCap.max}, News: ${breakdown.news.score}/${breakdown.news.max}, Options: ${breakdown.options.score}/${breakdown.options.max}`
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIRAL INSOLVENCY SCORE (VIS)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate Viral Insolvency Score (VIS)
 * Combines bankruptcy risk with virality potential
 * VIS = (0.6 * BankruptcyScore) + (0.4 * ViralityScore)
 * 
 * @param {number} bankruptcyScore - 0-100 bankruptcy risk score
 * @param {number} viralityScore - 0-100 virality score
 * @returns {Object} { vis, classification, shouldPost, postType }
 */
export function calculateVIS(bankruptcyScore, viralityScore) {
  const vis = Math.round((0.6 * bankruptcyScore) + (0.4 * viralityScore));

  let classification, shouldPost, postType;

  if (vis >= 75) {
    classification = 'PRIME_ALERT';
    shouldPost = true;
    postType = 'ALERT';
  } else if (vis >= 60) {
    classification = 'WATCHLIST';
    shouldPost = true;
    postType = 'WATCHLIST';
  } else {
    classification = 'STORE_ONLY';
    shouldPost = false;
    postType = null;
  }

  return {
    vis,
    classification,
    shouldPost,
    postType,
    components: {
      bankruptcyWeight: '60%',
      viralityWeight: '40%',
      bankruptcyContribution: Math.round(0.6 * bankruptcyScore),
      viralityContribution: Math.round(0.4 * viralityScore)
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function formatViralityForThread(virality, visData) {
  return `Virality: ${virality.score}% (${virality.tier.replace('_', ' ')})
VIS: ${visData.vis} → ${visData.classification.replace('_', ' ')}`;
}

export default { calculateViralityScore, calculateVIS, formatViralityForThread };
