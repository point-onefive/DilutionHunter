/**
 * OUTCOME PROBABILITY ENGINE
 * 
 * Takes bankruptcy scanner metrics and estimates probability of three outcomes:
 * 1. Dilution Event — ATM, offering, PIPE, etc.
 * 2. Debt Restructuring / Reverse Split — covenant breach, debt-for-equity swap
 * 3. Bankruptcy / Insolvency — Chapter 11, liquidation, receivership
 * 
 * Returns normalized probabilities that sum to ~100%
 */

export function estimateOutcomes(metrics) {
  const {
    runwayMonths,
    debtToCashMultiple,
    revenueChangePct,
    interestCoverage,
    cash,
    totalDebt,
    monthlyBurn,
    negativeIncomeCount,
    ocfNegativeCount
  } = metrics;

  // ═══════════════════════════════════════════════════════════════════════════
  // BASE PROBABILITIES (raw points, will be normalized)
  // ═══════════════════════════════════════════════════════════════════════════
  
  let dilution = 0;
  let restructure = 0;
  let bankruptcy = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // RUNWAY-BASED SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Liquidity death spiral — runway determines urgency
  if (runwayMonths !== null && runwayMonths !== undefined) {
    if (runwayMonths < 1) {
      bankruptcy += 35;
      dilution += 20;  // Desperate dilution attempt likely first
    } else if (runwayMonths < 3) {
      bankruptcy += 20;
      dilution += 25;  // Dilution more likely than immediate bankruptcy
    } else if (runwayMonths < 6) {
      bankruptcy += 10;
      dilution += 20;
    } else if (runwayMonths < 12) {
      dilution += 10;  // Proactive raise possible
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBT BURDEN SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Massive debt imbalance implies restructuring or dilution
  if (debtToCashMultiple !== null && debtToCashMultiple !== undefined) {
    if (debtToCashMultiple > 50) {
      restructure += 30;
      bankruptcy += 15;
    } else if (debtToCashMultiple > 20) {
      restructure += 20;
      bankruptcy += 10;
    } else if (debtToCashMultiple > 10) {
      restructure += 15;
    } else if (debtToCashMultiple > 5) {
      restructure += 10;
    }
  }

  // Cash as % of debt — if <5%, bankruptcy spikes
  if (cash && totalDebt && totalDebt > 0) {
    const cashDebtPct = cash / totalDebt;
    if (cashDebtPct < 0.02) {
      bankruptcy += 25;
    } else if (cashDebtPct < 0.05) {
      bankruptcy += 15;
    } else if (cashDebtPct < 0.10) {
      restructure += 10;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEREST COVERAGE SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Negative interest coverage = debt is compounding the problem
  if (interestCoverage !== null && interestCoverage !== undefined) {
    if (interestCoverage < 0) {
      restructure += 20;
      bankruptcy += 10;
    } else if (interestCoverage < 1) {
      restructure += 15;
      bankruptcy += 5;
    } else if (interestCoverage < 2) {
      restructure += 10;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATING PERFORMANCE SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Revenue shrinking fast — adds probability across the board
  if (revenueChangePct !== null && revenueChangePct !== undefined) {
    if (revenueChangePct < -50) {
      dilution += 15;
      restructure += 15;
      bankruptcy += 15;
    } else if (revenueChangePct < -30) {
      dilution += 10;
      restructure += 10;
      bankruptcy += 10;
    } else if (revenueChangePct < -10) {
      dilution += 5;
      restructure += 5;
    }
  }

  // Consistent losses
  if (negativeIncomeCount >= 4) {
    dilution += 10;
    restructure += 5;
  } else if (negativeIncomeCount >= 3) {
    dilution += 5;
  }

  // OCF consistently negative
  if (ocfNegativeCount >= 4) {
    dilution += 10;
    bankruptcy += 5;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BURN RATE SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // High burn with low runway = dilution incoming
  if (monthlyBurn && monthlyBurn > 0 && runwayMonths < 4) {
    dilution += 15;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALIZE TO 100%
  // ═══════════════════════════════════════════════════════════════════════════
  
  const total = dilution + restructure + bankruptcy;
  
  if (total === 0) {
    return {
      dilution: 0,
      restructure: 0,
      bankruptcy: 0,
      primaryOutcome: 'STABLE',
      confidence: 'LOW'
    };
  }

  const dilutionPct = Math.round((dilution / total) * 100);
  const restructurePct = Math.round((restructure / total) * 100);
  const bankruptcyPct = Math.round((bankruptcy / total) * 100);

  // Determine primary outcome
  let primaryOutcome = 'DILUTION';
  let maxPct = dilutionPct;
  
  if (restructurePct > maxPct) {
    primaryOutcome = 'RESTRUCTURING';
    maxPct = restructurePct;
  }
  if (bankruptcyPct > maxPct) {
    primaryOutcome = 'BANKRUPTCY';
    maxPct = bankruptcyPct;
  }

  // Confidence based on total raw points (higher = more signals firing)
  let confidence = 'LOW';
  if (total >= 80) confidence = 'HIGH';
  else if (total >= 50) confidence = 'MEDIUM';

  return {
    dilution: dilutionPct,
    restructure: restructurePct,
    bankruptcy: bankruptcyPct,
    primaryOutcome,
    confidence,
    rawTotal: total
  };
}

/**
 * Generate human-readable outcome summary
 */
export function formatOutcomeSummary(outcomes) {
  const { dilution, restructure, bankruptcy, primaryOutcome, confidence } = outcomes;

  let summary = '';
  
  if (primaryOutcome === 'BANKRUPTCY' && bankruptcy >= 40) {
    summary = `High probability of insolvency proceedings. Math favors failure without immediate intervention.`;
  } else if (primaryOutcome === 'DILUTION' && dilution >= 40) {
    summary = `Base case: emergency dilution incoming. Expect ATM, offering, or PIPE to buy time.`;
  } else if (primaryOutcome === 'RESTRUCTURING' && restructure >= 40) {
    summary = `Debt restructuring likely. Watch for reverse split, debt-for-equity swap, or covenant breach.`;
  } else if (bankruptcy >= 30 && dilution >= 30) {
    summary = `Dual risk: dilution attempt likely, but bankruptcy still on the table if it fails.`;
  } else {
    summary = `Multiple distress signals present. Outcome depends on management's next move.`;
  }

  return summary;
}

export default { estimateOutcomes, formatOutcomeSummary };
