# DilutionHunter System — Weekly Consolidation Mode

**Version:** 4.0  
**Date:** December 1, 2025  
**Status:** Production Ready

---

## Overview

Both scanners (DilutionHunter + BankruptcyWatchdog) now output **ONE weekly tweet** in leaderboard format instead of multi-tweet threads.

### Before vs After

| Scanner | Previously | Now |
|---------|-----------|-----|
| Dilution Hunter | 5-6 tweet analysis threads | → 1 weekly leaderboard tweet |
| Bankruptcy Watchdog | 4-6 tweet breakdown threads | → 1 weekly leaderboard tweet |
| Output Style | Dense, educational | → Scannable, viral-optimized |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WEEKLY CONSOLIDATION FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
  │  DILUTION DATA   │     │  BANKRUPTCY DATA │     │   UNIFIED        │
  │  candidates_cache│────▶│  bankruptcy_     │────▶│   SCORING        │
  │  .json           │     │  signals.json    │     │                  │
  └──────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────┐
                                                   │  LEADERBOARD     │
                                                   │  RANKING         │
                                                   │  (top 3-10)      │
                                                   └────────┬─────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────┐
                                                   │  OpenAI API      │
                                                   │  Tweet Gen       │
                                                   └────────┬─────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────┐
                                                   │  ONE TWEET       │
                                                   │  Posted Weekly   │
                                                   └──────────────────┘
```

---

## Unified Scoring Model

### Inputs

**Dilution Scanner metrics:**
- peakGain, currentGain, pullback
- daysSinceFiling
- marketCap, cash, monthlyBurn
- offeringImpact (ATM size ÷ market cap)
- distressLevel

**Bankruptcy Scanner metrics:**
- runwayMonths
- debtToCashMultiple
- monthlyBurn
- revenueChangePct
- interestCoverage
- VIS (Viral Insolvency Score)
- outcomeProbabilities

### Scoring Formula

```javascript
MomentumRisk    = f(dilution metrics)     // 0-100
InsolvencyRisk  = f(bankruptcy metrics)   // 0-100

FINAL_SCORE = max(MomentumRisk, InsolvencyRisk)
```

**Why max() not average?**  
Whichever danger is larger should drive ranking. A ticker with 90 insolvency risk and 20 momentum risk is still extremely risky.

### Thresholds

| Score | Action |
|-------|--------|
| ≥60 | Include in leaderboard |
| <60 | Exclude (not risky enough) |

---

## Weekly Output Rules

1. Scan new tickers from both scanners
2. Score using unified model
3. Filter to FINAL_SCORE ≥ 60
4. Sort by score descending
5. Return TOP 3-10 names
6. Generate ONE tweet via OpenAI

**NO THREADS unless explicitly requested.**

---

## Tweet Format

```
🚨 Weekly Risk Leaderboard

1) $TICK — 91 (3.2mo runway)
2) $ABC — 84 (Debt 5.8x cash)
3) $XYZ — 78 (ATM 5d ago)

High score = distress + attention.
Not advice — pattern recognition only.
```

### Format Rules
- Numbered leaderboard (1, 2, 3...)
- Ticker + score + ONE key risk factor per line
- One-sentence interpretation at end
- No hashtags
- 🚨 emoji at start

---

## File Structure

```
src/weekly/
├── unifiedScoring.js      # MomentumRisk + InsolvencyRisk → FINAL_SCORE
├── weeklyConsolidator.js  # Gathers data, applies scoring, ranks output
└── weeklyDigest.js        # OpenAI tweet generation + posting
```

---

## CLI Commands

```bash
# Preview weekly digest (dry run)
node src/weekly/weeklyDigest.js

# Post weekly digest
DRY_RUN=false node src/weekly/weeklyDigest.js --post

# With greeting
node src/weekly/weeklyDigest.js --post --greeting='GM!'

# Adjust thresholds
node src/weekly/weeklyDigest.js --min=50 --max=10
```

---

## OpenAI Prompt Structure

The system passes this JSON to OpenAI:

```json
{
  "rank": 1,
  "ticker": "PLUG",
  "score": 62,
  "primaryRisk": "INSOLVENCY",
  "riskSummary": "5.5mo runway",
  "hasDilution": false,
  "hasBankruptcy": true,
  "metrics": {
    "runway": "5.5 months",
    "burn": "$29.9M/mo",
    "debtCash": "6.0",
    "vis": 74
  }
}
```

OpenAI returns a single tweet in leaderboard format.

---

## What This Achieves

✅ Collects → scores → ranks  
✅ ONE high-signal tweet per week  
✅ Uses OpenAI API consistently  
✅ No over-explaining, no reader fatigue  
✅ Viral-optimized, scannable format  

---

## Future Enhancements (NOT NOW)

- 🟩 Build leaderboard visual to pair with tweet
- 🟩 Add crossover priority (ATM + insolvency same ticker)
- 🟩 Expand scoring model once foundation proven
