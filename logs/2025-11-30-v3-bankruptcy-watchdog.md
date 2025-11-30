# v3.0 Bankruptcy Watchdog Scanner

**Date:** 2025-11-30  
**Status:** Production Ready  

---

## Overview

New bankruptcy/insolvency detection scanner with **Viral Insolvency Score (VIS)** prioritization. Identifies companies at risk of distress AND likely to move markets.

---

## Key Concept: VIS (Viral Insolvency Score)

```
VIS = (0.6 × Bankruptcy Risk) + (0.4 × Virality Score)
```

**Why VIS matters:**
- Bankruptcy Risk alone finds distressed companies
- Virality Score alone finds popular tickers
- **VIS finds distressed companies that people are watching** — where big moves happen

### VIS Thresholds

| VIS Score | Classification | Action |
|-----------|---------------|--------|
| ≥75 | PRIME_ALERT | Auto-post immediately |
| 60-74 | WATCHLIST | Auto-post as watchlist |
| <60 | STORE_ONLY | Save data, don't post |

---

## Bankruptcy Risk Score (0-100)

Weighted scoring across 7 factors:

| Factor | Max Points | What It Measures |
|--------|-----------|------------------|
| Cash Runway | 25 | Months until cash runs out |
| Debt Burden | 20 | Debt-to-cash ratio |
| Interest Coverage | 15 | Can they afford debt payments? |
| Operating Cash Flow | 15 | Cash flow trend |
| Revenue/Profit | 10 | Sales and income trends |
| Altman Z-Score | 10 | Academic distress predictor |
| Insider Selling | 5 | Management confidence |

### Classification Thresholds

| Score | Classification | Meaning |
|-------|---------------|---------|
| ≥70 | INSOLVENCY_ALERT | High probability of distress |
| 50-69 | DISTRESS_WATCHLIST | Elevated risk, monitoring |
| 30-49 | CAUTION | Some warning signs |
| <30 | HEALTHY_IGNORE | Not distressed |

---

## Virality Score (0-100)

Measures market attention:

| Factor | Max Points | Logic |
|--------|-----------|-------|
| Volume | 35 | Higher avg volume = more attention |
| Market Cap | 25 | Small caps (retail favorites) score higher |
| News Activity | 20 | Recent news articles |
| Options Activity | 20 | Has options = institutional interest |

---

## Outcome Probability Model

Estimates likely resolution path:

```javascript
{
  dilution: 32%,      // Equity raise most likely if cash-starved
  restructure: 53%,   // Debt restructuring if debt-heavy
  bankruptcy: 16%,    // Ch11 filing if severe
  primaryOutcome: "Restructuring",
  confidence: "MEDIUM"
}
```

Factors driving estimates:
- **Dilution weighted by:** Low cash, high burn, >50 score
- **Restructure weighted by:** Heavy debt, coverage issues, <70 score
- **Bankruptcy weighted by:** Extreme debt, negative coverage, >70 score

---

## Thread Format (Compressed 6-Tweet)

Optimized for retention (7→6 tweets):

| Tweet | Content | Purpose |
|-------|---------|---------|
| 1️⃣ | Hook | Urgency + runway stat |
| 2️⃣ | Metaphor | Visual tension (car/fuel light) |
| 3️⃣ | VIS | Why THIS ticker matters |
| 4️⃣ | Briefing | Combined metrics + probabilities |
| 5️⃣ | Reaction | Market repricing thesis + scenarios |
| 6️⃣ | Final | Watch trigger + disclaimer |

### Example Hook:
```
🚨 $BYND is burning cash fast — only 9.1 months of runway left.
If financing doesn't arrive, the market won't ignore this. 🧵
```

### Example Market Reaction (NEW):
```
If financing fails, liquidity gaps widen fast.
Distress events don't sell off slowly — they reprice suddenly.

Bear confirms if burn accelerates.
Bull invalidates if cash flow stabilizes.
```

---

## Anti-Duplication System

- Tracks posted tickers in `bankruptcy_posted.json`
- **30-day cooldown** before re-posting same ticker
- Automatically skips to next ticker if top pick on cooldown
- `--force` flag bypasses cooldown
- `--status` command shows cooldown status

---

## Daily Radar Dashboard

Single tweet summarizing all tracked distress tickers:

```
🧭 Bankruptcy Radar — Sun, Nov 30

1. $BYND — VIS 68  ⚠️ Watch
2. $MULN — VIS 75  🔥 Alert
3. $CVNA — VIS 63  ⚠️ Watch

VIS = Risk × Attention
High VIS = distress that markets will price.

Full threads on alerts. 🧵
```

---

## CLI Commands

```bash
# Scan universe (preview)
node src/bankruptcy/bankruptcyScan.js

# Scan + post top alert
node src/bankruptcy/bankruptcyScan.js --post

# Single ticker
node src/bankruptcy/bankruptcyScan.js --ticker=BYND

# Refresh universe from screener
node src/bankruptcy/bankruptcyScan.js --refresh

# Force post (bypass VIS threshold + cooldown)
node src/bankruptcy/bankruptcyScan.js --ticker=BYND --force --post

# Show posting history & cooldowns
node src/bankruptcy/bankruptcyScan.js --status

# Daily radar dashboard
node src/bankruptcy/bankruptcyRadar.js
node src/bankruptcy/bankruptcyRadar.js --post
```

---

## Files Added/Modified

| File | Purpose |
|------|---------|
| `src/bankruptcy/bankruptcyScan.js` | Main orchestrator |
| `src/bankruptcy/bankruptcyScoreEngine.js` | Risk scoring + VIS |
| `src/bankruptcy/bankruptcyThesis.js` | OpenAI thread generation |
| `src/bankruptcy/fmpBankruptcy.js` | FMP data fetching |
| `src/bankruptcy/viralityEngine.js` | Virality scoring |
| `src/bankruptcy/outcomeModel.js` | Probability estimates |
| `src/bankruptcy/bankruptcyRadar.js` | Daily dashboard |
| `data/bankruptcy_signals.json` | Scan results |
| `data/bankruptcy_posted.json` | Posted tracker |
| `data/bankruptcy_universe.json` | Ticker universe |

---

## Data Flow

```
Universe (500 tickers)
       ↓
   FMP API (financials + virality)
       ↓
   Bankruptcy Score (0-100)
       ↓
   Virality Score (0-100)
       ↓
   VIS = 0.6×Risk + 0.4×Viral
       ↓
   ≥75: ALERT | 60-74: WATCHLIST | <60: STORE
       ↓
   Cooldown Check (30 days)
       ↓
   OpenAI Thread Generation
       ↓
   Twitter Post
```

---

## First Production Post

**$BYND** — 2025-11-30
- VIS: 68 (WATCHLIST)
- Bankruptcy Risk: 57/100
- Virality: 85/100
- Runway: 9.1 months
- Outcome: Restructuring (53%)

Thread: https://x.com/point_onefive/status/1995032496493207682

---

## Next Steps

- [ ] GitHub Actions for Tuesday scheduling
- [ ] Chart generation for bankruptcy threads
- [ ] Performance tracking (outcome accuracy)
- [ ] Multi-week trend analysis
