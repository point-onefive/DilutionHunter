Perfect — so here's what I'll do:

### 🔥 I’ll give you BOTH:

1. **A fully expanded Copilot prompt**
   (that you paste into your repo or Cursor side panel — the “master instruction set” for the entire build)

2. **Starter code + file structure**
   so Copilot has scaffolding and context to generate the REST automatically

You will literally be able to paste this into your repository **TODAY** and GitHub + Copilot can build iteratively from it.

---

# 📌 **STEP 1 — MASTER PROMPT FOR COPILOT**

Paste this in **README.md** AND as a **/docs/system.md** so Copilot *always remembers the objective.*

---

### **🔷 Copilot — System Build Instructions 🔷**

```
You are assisting in building a full automated stock dilution risk scanner + X/Twitter posting engine.

Goal:
Run a job 1–3 times per day (GitHub Actions CRON). 
Scan the entire US market for parabolic movers (small-cap/microcap preferred), detect dilution offering risk, generate human-like tweet threads via OpenAI, store only tickers that trigger signals, then track their performance daily and post updates.

Data Source: Financial Modeling Prep (FMP API)
Required endpoints:
  1. Full symbol list (NYSE, NASDAQ, AMEX, microcaps)
  2. OHLCV historical candles (daily)
  3. Weekly % change
  4. Balance sheet: cash, total debt
  5. Cashflow: burn rate
  6. Equity Offerings API: ATM, shelf, deal size, date filed

Trigger Criteria (all must be true for a stock to be flagged):
  - 200–300%+ increase in 7 days (configurable threshold)
  - Volume blow-off top followed by decline
  - Bearish candle or first red day after parabolic move
  - Low cash vs debt OR negative cashflow runway
  - Equity offering present — preferably large relative to market cap

When triggered:
  - Create or update `active_signals.json` file
  - Store: ticker, trigger_date, trigger_price, offering_amount, cash, debt,
    reason, confidence_score, and relevant supporting details
  - Call OpenAI API to generate a tweet thread summary
  - Auto-post to Twitter/X using Premium X API credentials
  - Add ticker to `performance_history.json` for follow-up tracking

Daily follow-ups:
  - For each tracked ticker, fetch latest close price
  - Update performance log in `performance_history.json`
  - Generate follow-up tweet summarizing P/L progression

Architecture Requirements:
  - No database required — store JSON local and commit back to repository
  - Two tracking buckets:
        1. active_signals.json (tickers currently monitored)
        2. performance_history.json (progress after trigger)
  - GitHub Actions runs scanner + follow-up scripts
  - Everything must run headless, stateless except JSON persistence
  - Code must be modular + expandable

Deliverables Copilot must produce:
  ✔ `/src/scanner.js` — pull universe + detect triggers
  ✔ `/src/scoreEngine.js` — logic for qualification + scoring
  ✔ `/src/storage.js` — reads/writes JSON state
  ✔ `/src/postTweet.js` — calls OpenAI → generates thread → posts to X
  ✔ `/src/updatePerformance.js` — updates tracked tickers daily
  ✔ `/.github/workflows/scan.yml` — scheduled scan job
  ✔ `/docs/architecture.md` — summary of system decisions

Everything must be built iteratively.
Copilot should ask for clarification when needed.
```

---

# 📌 STEP 2 — FOLDER STRUCTURE TO CREATE NOW

Create these empty files so Copilot can fill them:

```
/src/scanner.js
/src/scoreEngine.js
/src/postTweet.js
/src/storage.js
/src/updatePerformance.js

/data/active_signals.json
/data/performance_history.json

/docs/architecture.md
README.md

/.github/workflows/scan.yml
/.env (ignored)
```

Add this to `.gitignore`:

```
.env
node_modules
```

---

# 📌 STEP 3 — Here’s Your **Starter Code** to Seed Copilot

### `/src/scanner.js` (Copilot will expand this aggressively)

```js
import { getSymbols, getWeeklyChange, getFinancials, getOfferings, getOHLCV } from "./vendors/fmp.js";
import { evaluateSignal } from "./scoreEngine.js";
import { loadSignals, saveSignals } from "./storage.js";
import { postTweet } from "./postTweet.js";

export async function runScan() {
  const activeSignals = loadSignals();
  const universe = await getSymbols();   // all US tickers

  for (const ticker of universe) {
    const metrics = await getWeeklyChange(ticker);
    if (metrics.weeklyChange < 200) continue;

    const fundamentals = await getFinancials(ticker);
    const offerings = await getOfferings(ticker);
    const candles = await getOHLCV(ticker, 30);

    const decision = evaluateSignal({ticker, metrics, fundamentals, offerings, candles});
    if (!decision.shouldTrigger) continue;

    activeSignals.push(decision);
    await postTweet(decision);  // ⭐ AI formatted thread
  }

  saveSignals(activeSignals);
}

runScan();
```

---

### `/src/scoreEngine.js`

```js
export function evaluateSignal({ticker, metrics, fundamentals, offerings, candles}) {
  const redDay = candles[candles.length-1].close < candles[candles.length-1].open;
  const volumeDrop = candles[candles.length-1].volume < candles[candles.length-2].volume;
  const lowCash = fundamentals.cash < fundamentals.debt;

  const hasOffering = offerings && offerings.size > 0;

  const shouldTrigger =
    metrics.weeklyChange > 250 &&
    redDay &&
    volumeDrop &&
    lowCash &&
    hasOffering;

  return {
    ticker,
    shouldTrigger,
    fundamentals,
    offerings,
    metrics,
    score: Number(shouldTrigger),
    timestamp: Date.now()
  };
}
```

---

### `/src/storage.js`

```js
import fs from "fs";

export function loadSignals() {
  try { return JSON.parse(fs.readFileSync("./data/active_signals.json")); }
  catch { return []; }
}

export function saveSignals(list) {
  fs.writeFileSync("./data/active_signals.json", JSON.stringify(list,null,2));
}
```

---

# Next Step

Perfect — **DilutionHunter** is a killer name.

Below is everything you can append directly to your **README.md** so the repo is instantly useful, well-structured, and clear to anyone (and Copilot).

This includes:

* Summary introduction
* Features list
* Architecture diagram
* GitHub Actions workflows
* Next steps

You can paste **as-is**.

---

## 🚀 **DilutionHunter**

Automated market-wide scanner that detects parabolic runners at risk of equity dilution, generates AI-written thesis threads, and posts signals + performance tracking updates to X (Twitter).

---

## 🔥 What It Does

✔ Scans entire U.S. stock market 1–3x/day via GitHub Actions
✔ Filters for 200–300%+ weekly runners (**momentum blowout signals**)
✔ Detects *first red day*, volume fade, exhaustion candles
✔ Pulls balance sheet data (cash vs debt) → evaluates need to raise capital
✔ Monitors SEC/FMP offering data to identify probable dilution events
✔ Auto-generates a tweet thread summarizing thesis via OpenAI
✔ Posts breakdown to X automatically using Premium X API
✔ Stores only actionable tickers for tracking (**no full DB needed**)
✔ Each day → updates performance + tweets results

No servers. No hosting bill.
Just GitHub Actions + JSON state files + API keys.

---

## 🧠 Concept Overview

```
US Market → Filter Parabolic Runners → Check Cash/Debt → 
Look For Equity Offering → Confirm Red Candle Signal → 
Auto-Tweet Thesis → Track P/L Daily
```

**If all conditions fire → it's a dilution short candidate.**

---

## 📂 Project Structure

```bash
DilutionHunter/
│
├─ /src/
│   ├─ scanner.js              # scans entire market, finds setups
│   ├─ scoreEngine.js          # evaluation logic + signal scoring
│   ├─ storage.js              # read/write JSON state
│   ├─ postTweet.js            # AI analysis + threading to X
│   ├─ updatePerformance.js    # daily follow-up tracking
│   └─ vendors/fmp.js          # FMP API wrappers (data fetchers)
│
├─ /data/
│   ├─ active_signals.json         # only stores tickers we are tracking
│   └─ performance_history.json    # daily price logs for triggered setups
│
├─ /docs/
│   ├─ architecture.md
│   └─ system.md (Copilot Master Prompt)
│
└─ /.github/workflows/scan.yml     # GitHub Actions automation
```

---

## ⚙ `.github/workflows/scan.yml`

Paste & start running immediately:

```yaml
name: DilutionHunter Scan

on:
  schedule:
    - cron: "0 */8 * * *"  # every 8 hours — 3 scans/day
  workflow_dispatch: {}    # manual run button

jobs:
  run_scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Node
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install Dependencies
        run: npm install

      - name: Run Scanner
        run: node src/scanner.js

      - name: Commit Updates
        run: |
          git config --global user.name "DilutionHunter Bot"
          git config --global user.email "bot@dilutionhunter"
          git add data/*.json
          git commit -m "update signals/performance [CI]" || echo "no changes"
          git push
```

---

## 🔑 Required ENV Variables

Create a `.env` (and *never commit it*):

```
FMP_API_KEY=
OPENAI_API_KEY=
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
```

Add this to `.gitignore`:

```
.env
data/*.backup.json
```

---

## 🏁 TODO: Next Implementation Steps

| Step                              | Status                            |
| --------------------------------- | --------------------------------- |
| FMP integration for scanning      | ⏳ Next to implement               |
| Trigger scoring + filtering logic | ⏳ Add red-day + volume fade rules |
| AI-generated threads              | ⏳ via `postTweet.js`              |
| Chart image generator             | 🔥 optional but recommended       |
| Daily P/L follow-ups              | 🔥 completes the system           |

---

### Data Output Contract — Must Follow This Shape
These structures tell Copilot exactly how data must be formatted and stored.

#### `active_signals.json`
Stores all currently active dilution candidates that have triggered the scanner.
Each new setup is appended as one full object in this structure.
{
  "ticker": "TTOO",
  "trigger_date": "2025-02-14",
  "entry_price": 4.72,
  "weekly_gain_pct": 312,
  "first_red_day": true,
  "volume_fade": true,
  "cash": 1200000,
  "debt": 7500000,
  "offering_size_estimated": "20-40M ATM",
  "offering_source": "FMP-equity-offering-by-cik",
  "dilution_risk_score": 0.88,
  "reason": "parabolic run + low cash + offering active",
  "tweet_id": null,
  "notes": {}
}
→ Represents one stock that meets criteria and should be tracked going forward.

#### `performance_history.json`
Tracks the price performance of previously triggered tickers daily.
Used to generate follow-up tweets to show if thesis plays out.
{
  "TTOO": [
    { "date": "2025-02-15", "close": 4.11 },
    { "date": "2025-02-16", "close": 3.29 },
    { "date": "2025-02-17", "close": 2.44 }
  ]
}
→ Keys = tickers, values = list of daily closes for P/L tracking.

### Performance Scoring Formula Reference
Used to rank conviction and reduce false signals before tweeting.
dilution_risk_score = weighted(
  weekly_gain_pct,
  cash_vs_debt_ratio,
  offering_size_relative_to_mcap,
  volume_drop_strength,
  candle_reversal_strength
)
// scale: 0–1
→ 1.00 = extremely high dilution risk / short candidate.
→ 0.20 = weak or no thesis, don’t tweet.

### Security Notice
🚨 IMPORTANT — DO NOT COMMIT `.env` OR API KEYS  
If `.env` is ever committed publicly → revoke keys immediately.
→ This keeps your repo safe to make public and protects your API access.
