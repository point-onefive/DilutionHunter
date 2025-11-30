/**
 * BANKRUPTCY SCORE ENGINE
 * 
 * Composite 0-100 scoring model for insolvency/distress risk
 * 
 * Score Components (100 pts total):
 * - Runway / Liquidity: 25 pts
 * - Debt vs Cash: 15 pts  
 * - Interest Coverage: 15 pts
 * - Operating CF Trend: 15 pts
 * - Revenue & Profit Trend: 10 pts
 * - Altman Z-Score: 10 pts
 * - Insider Selling: 5 pts
 * - Dilution/Share Growth: 5 pts
 * 
 * Classifications:
 * - INSOLVENCY_ALERT: score >= 70
 * - DISTRESS_WATCHLIST: score 50-69
 * - HEALTHY_IGNORE: score < 50
 * 
 * Viral Insolvency Score (VIS):
 * - Combines bankruptcy score (60%) with virality score (40%)
 * - VIS >= 75: PRIME_ALERT (auto-post)
 * - VIS 60-74: WATCHLIST (auto-post)
 * - VIS < 60: STORE_ONLY
 */

import { estimateOutcomes, formatOutcomeSummary } from './outcomeModel.js';
import { calculateViralityScore, calculateVIS } from './viralityEngine.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function formatCurrency(value) {
  if (value === null || value === undefined) return 'N/A';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatMonths(months) {
  if (months === null || months === undefined) return 'N/A';
  if (months >= 24) return '24+ months';
  if (months < 1) return '<1 month';
  return `${months.toFixed(1)} months`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// METRIC CALCULATORS
// ═══════════════════════════════════════════════════════════════════════════════

function calculateRunway(balanceSheet, cashFlow) {
  const q0 = balanceSheet[0];
  const cf0 = cashFlow[0];
  
  if (!q0 || !cf0) return { runwayMonths: null, cash: null, monthlyBurn: null };

  const cash = q0.cashAndCashEquivalents ?? q0.cashAndShortTermInvestments ?? 0;
  const operatingCF = cf0.netCashProvidedByOperatingActivities ?? cf0.operatingCashFlow ?? 0;
  
  // If operating CF is negative, company is burning cash
  const monthlyBurn = operatingCF < 0 ? Math.abs(operatingCF) / 3 : 0; // quarter → month
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : 24; // 24 = comfortable

  return {
    cash,
    operatingCF,
    monthlyBurn,
    runwayMonths: Math.min(runwayMonths, 24), // cap at 24
    runwayCategory: runwayMonths <= 3 ? 'CRITICAL' 
      : runwayMonths <= 6 ? 'SHORT'
      : runwayMonths <= 12 ? 'OK'
      : 'COMFORTABLE'
  };
}

function calculateDebtMetrics(balanceSheet) {
  const q0 = balanceSheet[0];
  if (!q0) return { totalDebt: null, debtToCashMultiple: null, cashDebtRatio: null };

  const cash = q0.cashAndCashEquivalents ?? q0.cashAndShortTermInvestments ?? 0;
  const shortTermDebt = q0.shortTermDebt ?? 0;
  const longTermDebt = q0.longTermDebt ?? 0;
  const totalDebt = q0.totalDebt ?? (shortTermDebt + longTermDebt);

  const debtToCashMultiple = totalDebt / Math.max(1, cash);
  const cashDebtRatio = cash / Math.max(1, totalDebt);

  return {
    cash,
    shortTermDebt,
    longTermDebt,
    totalDebt,
    debtToCashMultiple,
    cashDebtRatio
  };
}

function calculateInterestCoverage(income) {
  const q0 = income[0];
  if (!q0) return { interestCoverage: null, ebit: null, interestExpense: null };

  const ebit = q0.ebitda ?? q0.operatingIncome ?? 0; // Use EBITDA or operating income
  const interestExpense = Math.abs(q0.interestExpense ?? 0);

  const interestCoverage = interestExpense > 0 ? ebit / interestExpense : 10; // 10 = very safe

  return {
    ebit,
    interestExpense,
    interestCoverage
  };
}

function calculateRevenueTrend(income) {
  if (!income || income.length < 2) {
    return { revenueChangePct: null, negativeIncomeCount: 0 };
  }

  const q0 = income[0];
  const qOldest = income[Math.min(3, income.length - 1)]; // q3 or oldest available

  const revenueChangePct = qOldest?.revenue 
    ? ((q0.revenue - qOldest.revenue) / Math.abs(qOldest.revenue)) * 100
    : 0;

  const negativeIncomeCount = income.slice(0, 4).filter(q => (q.netIncome ?? 0) < 0).length;

  return {
    currentRevenue: q0?.revenue,
    oldRevenue: qOldest?.revenue,
    revenueChangePct,
    negativeIncomeCount,
    revenueTrend: revenueChangePct > 10 ? 'GROWING' 
      : revenueChangePct > -10 ? 'FLAT'
      : 'DECLINING'
  };
}

function calculateOCFTrend(cashFlow) {
  if (!cashFlow || cashFlow.length < 2) {
    return { ocfNegativeCount: 0, ocfWorsening: false };
  }

  const ocfValues = cashFlow.slice(0, 4).map(cf => 
    cf.netCashProvidedByOperatingActivities ?? cf.operatingCashFlow ?? 0
  );

  const ocfNegativeCount = ocfValues.filter(v => v < 0).length;
  const ocfWorsening = ocfValues.length >= 2 && ocfValues[0] < ocfValues[1]; // more negative

  return {
    ocfValues,
    ocfNegativeCount,
    ocfWorsening,
    ocfTrend: ocfWorsening ? 'DETERIORATING' : ocfNegativeCount >= 3 ? 'POOR' : 'STABLE'
  };
}

function calculateAltmanZ(keyMetrics) {
  const km0 = keyMetrics?.[0];
  // FMP may have different field names
  const zScore = km0?.altmanZScore ?? km0?.grahamNumber ?? null;
  
  return {
    altmanZScore: zScore,
    zCategory: zScore === null ? 'UNKNOWN'
      : zScore < 1.2 ? 'DISTRESS'
      : zScore < 1.8 ? 'GREY_ZONE'
      : zScore < 3.0 ? 'CAUTION'
      : 'SAFE'
  };
}

function calculateInsiderFlow(insiders) {
  if (!insiders || !Array.isArray(insiders)) {
    return { totalBuyValue: 0, totalSellValue: 0, netInsiderFlow: 0, insiderBias: 'UNKNOWN' };
  }

  let totalBuyValue = 0;
  let totalSellValue = 0;

  for (const trade of insiders) {
    const value = Math.abs((trade.securitiesTransacted ?? 0) * (trade.price ?? 0));
    const type = (trade.transactionType ?? '').toLowerCase();
    
    if (type.includes('buy') || type.includes('purchase') || type.includes('p-purchase')) {
      totalBuyValue += value;
    } else if (type.includes('sell') || type.includes('sale') || type.includes('s-sale')) {
      totalSellValue += value;
    }
  }

  const netInsiderFlow = totalBuyValue - totalSellValue;

  return {
    totalBuyValue,
    totalSellValue,
    netInsiderFlow,
    insiderBias: totalSellValue > totalBuyValue * 3 ? 'HEAVY_SELLING'
      : totalSellValue > totalBuyValue * 1.5 ? 'NET_SELLING'
      : totalBuyValue > totalSellValue * 1.5 ? 'NET_BUYING'
      : 'BALANCED'
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS (each returns 0 to max points)
// ═══════════════════════════════════════════════════════════════════════════════

function scoreRunway(runwayMonths) {
  // Max 25 points
  if (runwayMonths === null) return 0;
  if (runwayMonths <= 2) return 25;
  if (runwayMonths <= 4) return 20;
  if (runwayMonths <= 6) return 15;
  if (runwayMonths <= 12) return 5;
  return 0;
}

function scoreDebt(debtToCashMultiple, cashDebtRatio) {
  // Max 15 points
  if (debtToCashMultiple === null) return 0;
  if (debtToCashMultiple >= 5 || cashDebtRatio <= 0.2) return 15;
  if (debtToCashMultiple >= 3 || cashDebtRatio <= 0.33) return 10;
  if (debtToCashMultiple >= 2 || cashDebtRatio <= 0.5) return 5;
  return 0;
}

function scoreInterestCoverage(coverage) {
  // Max 15 points
  if (coverage === null) return 0;
  if (coverage < 0) return 15;  // EBIT negative
  if (coverage < 1) return 12;  // Can't cover interest
  if (coverage < 2) return 8;   // Fragile
  if (coverage < 3) return 4;   // Tight
  return 0;
}

function scoreOCFTrend(ocfNegativeCount, ocfWorsening) {
  // Max 15 points
  if (ocfNegativeCount === 4 && ocfWorsening) return 15;
  if (ocfNegativeCount >= 3) return 10;
  if (ocfNegativeCount === 2) return 5;
  return 0;
}

function scoreRevenueProft(revenueChangePct, negativeIncomeCount) {
  // Max 10 points
  if (revenueChangePct === null) return 0;
  if (revenueChangePct < -20 && negativeIncomeCount >= 3) return 10;
  if (revenueChangePct <= 0 && negativeIncomeCount >= 2) return 7;
  if (negativeIncomeCount >= 2) return 5;
  return 0;
}

function scoreAltmanZ(zScore) {
  // Max 10 points
  if (zScore === null) return 0;
  if (zScore < 1.2) return 10;
  if (zScore < 1.8) return 7;
  if (zScore < 3.0) return 3;
  return 0;
}

function scoreInsiders(totalSellValue, totalBuyValue, netFlow) {
  // Max 5 points
  if (totalSellValue > totalBuyValue * 3 && netFlow < -1_000_000) return 5;
  if (totalSellValue > totalBuyValue * 2) return 3;
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCORING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export function scoreBankruptcyRisk(inputs) {
  const { symbol, quote, balanceSheet, cashFlow, income, keyMetrics, insiders } = inputs;

  // Check for minimum required data
  if (!balanceSheet?.length || !cashFlow?.length || !income?.length) {
    return {
      symbol,
      score: 0,
      classification: 'INSUFFICIENT_DATA',
      metrics: {},
      breakdown: {},
      narrative: 'Insufficient financial data available for analysis.'
    };
  }

  // Calculate all metrics
  const runway = calculateRunway(balanceSheet, cashFlow);
  const debt = calculateDebtMetrics(balanceSheet);
  const interest = calculateInterestCoverage(income);
  const revenue = calculateRevenueTrend(income);
  const ocf = calculateOCFTrend(cashFlow);
  const altman = calculateAltmanZ(keyMetrics);
  const insider = calculateInsiderFlow(insiders);

  // Calculate component scores
  const runwayScore = scoreRunway(runway.runwayMonths);
  const debtScore = scoreDebt(debt.debtToCashMultiple, debt.cashDebtRatio);
  const interestScore = scoreInterestCoverage(interest.interestCoverage);
  const ocfScore = scoreOCFTrend(ocf.ocfNegativeCount, ocf.ocfWorsening);
  const revProfitScore = scoreRevenueProft(revenue.revenueChangePct, revenue.negativeIncomeCount);
  const altmanScore = scoreAltmanZ(altman.altmanZScore);
  const insiderScore = scoreInsiders(insider.totalSellValue, insider.totalBuyValue, insider.netInsiderFlow);

  // Total score
  const totalScore = runwayScore + debtScore + interestScore + ocfScore + revProfitScore + altmanScore + insiderScore;

  // Classification
  let classification = 'HEALTHY_IGNORE';
  if (totalScore >= 70) classification = 'INSOLVENCY_ALERT';
  else if (totalScore >= 50) classification = 'DISTRESS_WATCHLIST';

  // Build result
  return {
    symbol,
    score: totalScore,
    classification,
    
    // All calculated metrics for display/narrative
    metrics: {
      // Quote data
      price: quote?.price,
      marketCap: quote?.mktCap,
      companyName: quote?.companyName,
      
      // Runway
      cash: runway.cash,
      cashFormatted: formatCurrency(runway.cash),
      monthlyBurn: runway.monthlyBurn,
      monthlyBurnFormatted: formatCurrency(runway.monthlyBurn),
      runwayMonths: runway.runwayMonths,
      runwayFormatted: formatMonths(runway.runwayMonths),
      runwayCategory: runway.runwayCategory,
      
      // Debt
      totalDebt: debt.totalDebt,
      totalDebtFormatted: formatCurrency(debt.totalDebt),
      debtToCashMultiple: debt.debtToCashMultiple,
      cashDebtRatio: debt.cashDebtRatio,
      
      // Interest
      ebit: interest.ebit,
      interestExpense: interest.interestExpense,
      interestCoverage: interest.interestCoverage,
      
      // Revenue/Profit
      revenueChangePct: revenue.revenueChangePct,
      revenueTrend: revenue.revenueTrend,
      negativeIncomeCount: revenue.negativeIncomeCount,
      
      // OCF
      ocfNegativeCount: ocf.ocfNegativeCount,
      ocfWorsening: ocf.ocfWorsening,
      ocfTrend: ocf.ocfTrend,
      
      // Altman
      altmanZScore: altman.altmanZScore,
      zCategory: altman.zCategory,
      
      // Insider
      netInsiderFlow: insider.netInsiderFlow,
      insiderBias: insider.insiderBias,
      totalSellValue: insider.totalSellValue,
      totalBuyValue: insider.totalBuyValue
    },

    // Score breakdown for transparency
    breakdown: {
      runway: { score: runwayScore, max: 25 },
      debt: { score: debtScore, max: 15 },
      interest: { score: interestScore, max: 15 },
      ocf: { score: ocfScore, max: 15 },
      revenueProfit: { score: revProfitScore, max: 10 },
      altman: { score: altmanScore, max: 10 },
      insider: { score: insiderScore, max: 5 }
    },

    // Outcome probabilities
    outcomes: estimateOutcomes({
      runwayMonths: runway.runwayMonths,
      debtToCashMultiple: debt.debtToCashMultiple,
      revenueChangePct: revenue.revenueChangePct,
      interestCoverage: interest.interestCoverage,
      cash: runway.cash,
      totalDebt: debt.totalDebt,
      monthlyBurn: runway.monthlyBurn,
      negativeIncomeCount: revenue.negativeIncomeCount,
      ocfNegativeCount: ocf.ocfNegativeCount
    }),

    // Human-readable outcome summary
    get outcomeSummary() {
      return formatOutcomeSummary(this.outcomes);
    }
  };
}

/**
 * Score with Viral Insolvency Score (VIS) integration
 * Combines bankruptcy risk (60%) with virality potential (40%)
 * 
 * @param {Object} financialInputs - Data from fetchBankruptcyInputs
 * @param {Object} viralityInputs - Data from fetchViralityInputs
 * @returns {Object} Full analysis with VIS ranking
 */
export function scoreWithVIS(financialInputs, viralityInputs) {
  // Get base bankruptcy score
  const bankruptcyAnalysis = scoreBankruptcyRisk(financialInputs);
  
  // Calculate virality score
  const virality = calculateViralityScore({
    avgVolume: viralityInputs.avgVolume,
    marketCap: viralityInputs.marketCap,
    newsCount: viralityInputs.newsCount,
    hasOptions: viralityInputs.hasOptions
  });

  // Calculate Viral Insolvency Score
  const visData = calculateVIS(bankruptcyAnalysis.score, virality.score);

  // Combine everything
  return {
    ...bankruptcyAnalysis,
    
    // Virality data
    virality: {
      score: virality.score,
      tier: virality.tier,
      breakdown: virality.breakdown,
      avgVolume: viralityInputs.avgVolume,
      newsCount: viralityInputs.newsCount,
      hasOptions: viralityInputs.hasOptions,
      recentNews: viralityInputs.recentNews
    },

    // VIS = the magic number
    vis: visData.vis,
    visClassification: visData.classification,
    shouldPost: visData.shouldPost,
    postType: visData.postType,
    visComponents: visData.components,

    // Override priority with VIS
    priority: visData.vis,

    // Summary for logging
    visSummary: `VIS: ${visData.vis} (Bankruptcy: ${bankruptcyAnalysis.score} × 0.6 + Virality: ${virality.score} × 0.4) → ${visData.classification}`
  };
}

export default { scoreBankruptcyRisk, scoreWithVIS };
