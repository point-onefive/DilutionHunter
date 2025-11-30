# 2025-11-30 — CDE System & Dynamic Universe

## Summary
Built the Critical Distress Event (CDE) detection system — the culmination of DilutionHunter's multi-scanner architecture. Also fixed dynamic universe refresh and added company names to tweet hooks for better search visibility.

---

## 🔥 Critical Distress Event (CDE) System

### What is a CDE?
A CDE occurs when **three independent failure signals converge**:

| Signal | Scanner | Threshold |
|--------|---------|-----------|
| 🔫 Dilution mechanism active | Dilution Hunter | ATM/shelf filing detected |
| 🏚 Bankruptcy risk | Bankruptcy Watchdog | Risk ≥ 50/100 |
| 📢 Market attention | VIS Score | VIS ≥ 60/100 |

When all three align → **CRITICAL DISTRESS EVENT**

### Why CDEs Matter
- Most distressed companies fail quietly
- Most dilution doesn't get attention
- **CDE = Loud failure where traders get trapped**
- These are the events that gap down violently

### Files Added
- `src/cde/cdeDetector.js` — CDE scanning and detection
- `src/cde/cdeThesis.js` — Thread generation for CDE events
- `data/cde_signals.json` — CDE results storage
- `data/cde_posted.json` — Cooldown tracking

### Commands
```bash
# Scan for CDEs from existing signals
node src/cde/cdeDetector.js

# Check single ticker
node src/cde/cdeDetector.js --ticker=AMZE

# Post CDE thread
node src/cde/cdeDetector.js --ticker=AMZE --post
```

### First CDE Detected: AMZE
```
Symbol: AMZE (Amaze Holdings, Inc.)
Bankruptcy Risk: 75/100
VIS Score: 63/100
Dilution: Active (manual override)
Runway: <1 month
CDE Intensity: 49
```

---

## 📡 Dynamic Universe Refresh

### Problem
FMP stock-screener endpoint requires premium tier (was returning 404).

### Solution
Now uses **working free-tier endpoints**:
- `/biggest-losers` — Stocks down big (distress candidates)
- `/most-actives` — High volume (viral candidates)  
- `/biggest-gainers` — Pump candidates

### Result
```
Fresh from FMP: 113 tickers daily
Core distress list: 46 tickers
Total unique: 154+ candidates per scan
```

### Commands
```bash
# Refresh universe and scan
node src/bankruptcy/bankruptcyScan.js --refresh --max=50
```

---

## 🏷️ Company Names in Hooks

### Problem
Tweets only showed tickers ($BYND) — poor for search discovery.

### Solution
Updated all thread generators to include company names prominently:

**Before:**
```
🚨 $BYND is burning cash fast — only 9.1 months of runway left.
```

**After:**
```
🚨 Beyond Meat $BYND is burning cash fast — only 9.1 months of runway left.
```

### Files Updated
- `src/bankruptcy/bankruptcyThesis.js`
- `src/cde/cdeThesis.js`

---

## 🔧 Rate Limit Fixes

| Change | Before | After |
|--------|--------|-------|
| Delay between tickers | 200ms | 500ms |
| 402/404 errors | Logged | Silent (for optional endpoints) |
| Screener 404 | Generic error | Clear "needs premium" message |

---

## 📊 Tweet Content Architecture

The system now has **7 distinct tweet formats**:

| Type | Format | Generator |
|------|--------|-----------|
| Weekly Roundup | 1 tweet | `weeklyRoundup.js` |
| Dilution Alert | 5-tweet thread | `contentPipeline.js` |
| Dilution Signal | 2-3 tweets | `postTweet.js` |
| Performance Update | 1 tweet | `postTweet.js` |
| Bankruptcy Alert | 6-tweet thread | `bankruptcyThesis.js` |
| CDE Report | 5-tweet thread | `cdeThesis.js` |
| Bankruptcy Radar | 1 tweet | `bankruptcyRadar.js` |

---

## 🗂️ File Structure Update

```
src/
├── bankruptcy/
│   ├── bankruptcyScan.js       # Main scanner
│   ├── bankruptcyScoreEngine.js
│   ├── bankruptcyThesis.js     # 6-tweet thread
│   ├── bankruptcyRadar.js      # Daily dashboard
│   └── fmpBankruptcy.js        # Data fetching
├── cde/                        # NEW
│   ├── cdeDetector.js          # CDE scanning
│   └── cdeThesis.js            # 5-tweet thread
└── ...

data/
├── bankruptcy_signals.json
├── bankruptcy_posted.json
├── bankruptcy_universe.json
├── cde_signals.json            # NEW
└── cde_posted.json             # NEW
```

---

## Next Steps
- [ ] Automate CDE scanning in daily run
- [ ] Add more tickers to KNOWN_DILUTION_ACTIVE list
- [ ] Consider SEC EDGAR direct scraping for dilution detection
- [ ] Build CDE intensity scoring refinements
