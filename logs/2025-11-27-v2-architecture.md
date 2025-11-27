# DilutionHunter v2 — ATM Content Pipeline Architecture

**Date:** November 27, 2025  
**Status:** Production Ready (Manual Approval Mode)  
**Version:** 2.0  

---

## Executive Summary

DilutionHunter v2 is a complete rebuild focused on **ATM (At-The-Market) offerings** detected via SEC EDGAR filings, replacing the previous FMP-based scoring approach. The system now generates professional analyst-grade Twitter threads with educational content, chart analysis, and bull/bear framing.

**Key Changes from v1:**
- SEC EDGAR for ATM filing detection (free, unlimited)
- 3-bucket content classification (Case Study, Watch List, Actionable)
- Quality filtering (same-day pump & dump detection)
- Professional 5-6 tweet thread format
- Manual approval workflow before posting
- ATM filing date visualization on charts

---

## 1. System Architecture

### 1.1 High-Level Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DAILY CONTENT PIPELINE                               │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │  ATM SCANNER │────▶│    DAILY     │────▶│   CONTENT    │────▶│   MANUAL     │
  │  (SEC EDGAR) │     │   SELECTOR   │     │  GENERATOR   │     │   APPROVAL   │
  └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       │                     │                     │                     │
       ▼                     ▼                     ▼                     ▼
  Recent 424B5         Max 2 posts/day       5-6 Tweet Thread      Review → Post
  filings + FMP        Priority ordered      + Chart PNG           via post.js
  price data           by bucket & score
```

### 1.2 File Structure (Active Modules)

```
DilutionHunter/
├── src/
│   ├── dailyRun.js          # 🔥 MAIN ENTRY - Daily orchestrator
│   ├── post.js              # 🔥 MANUAL POSTING - Approve & post
│   ├── atmScanner.js        # SEC EDGAR ATM filing detection
│   ├── dailySelector.js     # Quality filter + post selection
│   ├── contentPipeline.js   # OpenAI thread generation
│   ├── chartGenerator.js    # Canvas chart with ATM filing line
│   ├── twitterPoster.js     # Twitter API v2 posting
│   ├── contentManager.js    # Content classification (3 buckets)
│   ├── config.js            # Central configuration
│   └── vendors/
│       └── fmp.js           # FMP API wrapper
├── output/
│   ├── charts/              # Generated PNG charts
│   └── *.json               # Tweet content JSON files
├── logs/                    # Technical documentation
├── .env                     # API credentials
└── package.json
```

### 1.3 Legacy Files (Not Used in v2)

These remain for reference but are not part of the active pipeline:
- `analystBrief.js`, `scoreEngine.js`, `scoreEngineV2.js` — Old scoring system
- `pipeline.js`, `batchScan.js` — Old entry points
- `scanner.js`, `activeScanner.js` — Old scanning approaches
- `openaiThesis.js`, `tweetGenerator.js` — Old content generation
- `chartRenderer.js` — Replaced by chartGenerator.js

---

## 2. Core Components

### 2.1 ATM Scanner (`src/atmScanner.js`)

**Purpose:** Detect recent ATM filings via SEC EDGAR and enrich with FMP price data.

**Data Sources:**
| Source | Endpoint | Data Retrieved |
|--------|----------|----------------|
| SEC EDGAR EFTS | `efts.sec.gov/LATEST/search-index` | 424B5 filings with "at the market" |
| FMP API | `/stable/historical-price-eod/full` | Daily OHLCV candles |

**Key Functions:**
- `searchRecentATMFilings(days)` — Query SEC for recent 424B5 filings
- `getPriceHistory(ticker, days)` — Get candles from FMP
- `analyzePostFilingPerformance(ticker, filingDate)` — Calculate gains/drawdowns

**Output Metrics Per Ticker:**
```javascript
{
  ticker: "ANVS",
  filingDate: "2025-11-13",
  daysSinceFiling: 14,
  peakGain: 75.2,      // % gain at highest point post-filing
  currentGain: 65.1,   // % gain at current price
  pullback: 10.1,      // % drop from peak
  marketCap: 97000000,
  candles: [...]       // Last 60 days OHLCV
}
```

### 2.2 Content Manager (`src/contentManager.js`)

**Purpose:** Classify tickers into 3 content buckets based on price action.

**Classification Rules:**

| Bucket | Criteria | Priority |
|--------|----------|----------|
| **ACTIONABLE** | peakGain > 30% AND pullback > 10% | 1 (Highest) |
| **WATCH_LIST** | peakGain > 20% AND pullback < 10% | 2 |
| **CASE_STUDY** | Filing exists, any performance | 3 (Lowest) |

**Quality Filtering:**
- `isSameDaySpikeCrash()` — Detects same-day pump & dump (>50% up then reversal)
- `calculateRampDays()` — Days of consecutive gains leading to peak

Tickers flagged as POOR quality are skipped.

### 2.3 Daily Selector (`src/dailySelector.js`)

**Purpose:** Select up to 2 posts per day with priority ordering.

**Selection Logic:**
1. Get all ATM candidates from scanner
2. Classify each into bucket + quality grade
3. Sort by: bucket priority (ACTIONABLE first) → peakGain descending
4. Return top 2 GOOD quality candidates

**Output:**
```javascript
[
  { ticker: "ANVS", bucket: "ACTIONABLE", quality: "GOOD", peakGain: 75.2, ... },
  { ticker: "MNDR", bucket: "WATCH_LIST", quality: "GOOD", peakGain: 45.8, ... }
]
```

### 2.4 Content Pipeline (`src/contentPipeline.js`)

**Purpose:** Generate professional analyst-grade tweet threads using OpenAI.

**Model:** `gpt-4o` (upgraded from gpt-4o-mini for quality)

**Thread Structure (5-6 Tweets):**

| Tweet | Content |
|-------|---------|
| **1. Setup** | Hook with ticker, gains, ATM context, filing date |
| **2. Education** | ATM explanation in plain English with analogy |
| **3. Signals** | Market cap, filing date, price action bullets |
| **4. Context** | Additional signals: volume, float, momentum |
| **5. Bull/Bear** | Scenarios with invalidation conditions |
| **6. CTA** | Pattern recognition insight, risk reminder |

**Prompt Engineering Highlights:**
- Explain ATM and 424B5 in accessible terms
- Include filing date prominently
- Multi-dimensional analysis (supply, demand, timing)
- Professional but educational tone
- Clear invalidation conditions for both sides

**Output:**
```javascript
{
  tweets: ["Tweet 1...", "Tweet 2...", ...],
  chartPath: "/output/charts/ANVS_1234567890.png"
}
```

### 2.5 Chart Generator (`src/chartGenerator.js`)

**Purpose:** Render Twitter-optimized PNG charts with ATM filing date line.

**Technology:** Node.js `canvas` library

**Output Specs:**
- Dimensions: 1200 × 675 px
- Format: PNG (~50-80KB)

**Visual Elements:**
| Element | Description |
|---------|-------------|
| Candlestick chart | 60 days OHLCV with wicks |
| Volume bars | Below candles, color-coded |
| ATM filing line | Orange dashed vertical line at filing date |
| Sidebar stats | Bucket, peak gain, current gain, pullback |
| Header | Ticker symbol |
| Footer | Disclaimer |

**ATM Filing Date Handling:**
- If filing date is within chart range: Vertical dashed orange line with label
- If filing date is before chart range: Arrow indicator at left edge

### 2.6 Twitter Poster (`src/twitterPoster.js`)

**Purpose:** Post multi-tweet threads with media.

**API:** Twitter API v2 + v1.1 (media upload)

**Key Functions:**
- `postAnalysisThread(tweets, chartPath)` — Post full thread with chart on first tweet
- `uploadMedia(imagePath)` — Upload PNG, get media_id
- `postTweet(text, options)` — Single tweet with optional media/reply_to

**Thread Posting Flow:**
1. Upload chart image → get media_id
2. Post Tweet 1 with media attachment
3. Post Tweets 2-N as replies to previous

---

## 3. Operational Workflow

### 3.1 Daily Run (Dry Run)

```bash
node src/dailyRun.js
```

**What it does:**
1. Scans recent ATM filings (last 30 days)
2. Enriches with FMP price data
3. Classifies into buckets, applies quality filter
4. Selects top 2 candidates
5. Generates tweet threads + charts
6. Saves output to `/output/` (JSON + PNG)
7. Prints preview to console

**Output Files:**
- `/output/TICKER_timestamp.json` — Full tweet content + metadata
- `/output/charts/TICKER_timestamp.png` — Chart image

### 3.2 Manual Posting

```bash
# Preview and post (with confirmation)
node src/post.js ANVS

# Live posting (no dry run)
node src/post.js ANVS --live
```

**What it does:**
1. Finds most recent output JSON for ticker
2. Displays full thread preview (all tweets)
3. Shows chart path
4. Prompts for confirmation
5. Posts to Twitter (or dry run)

### 3.3 Full Workflow

```
1. Run daily scan:      node src/dailyRun.js
2. Review output:       cat output/ANVS_*.json
3. View chart:          open output/charts/ANVS_*.png
4. Approve & post:      node src/post.js ANVS --live
```

---

## 4. Configuration

### 4.1 Environment Variables

```env
# Financial Modeling Prep API
FMP_API_KEY=your_fmp_key

# OpenAI API
OPENAI_API_KEY=your_openai_key

# Twitter/X API (OAuth 1.0a)
TWITTER_API_KEY=xxx
TWITTER_API_SECRET=xxx
TWITTER_ACCESS_TOKEN=xxx
TWITTER_ACCESS_SECRET=xxx

# Safety Mode
DRY_RUN=true
```

### 4.2 Tunable Parameters

| Parameter | Location | Default | Description |
|-----------|----------|---------|-------------|
| MAX_POSTS_PER_DAY | dailySelector.js | 2 | Max posts selected per run |
| FILING_LOOKBACK_DAYS | atmScanner.js | 30 | Days to search for filings |
| PRICE_HISTORY_DAYS | atmScanner.js | 60 | Days of candles for analysis |
| ACTIONABLE_THRESHOLD | contentManager.js | 30% | Min peak gain for ACTIONABLE |
| PULLBACK_THRESHOLD | contentManager.js | 10% | Min pullback for ACTIONABLE |

---

## 5. API Usage

### 5.1 External Dependencies

| Service | Tier | Usage | Cost |
|---------|------|-------|------|
| SEC EDGAR EFTS | Free | Unlimited | $0 |
| FMP API | Starter | ~5 calls/ticker | $29/mo |
| OpenAI | Pay-as-you-go | ~2K tokens/thread | ~$0.01/thread |
| Twitter | Pro | Posting only | ~$100/mo |

### 5.2 FMP Call Budget

**Per Ticker:** ~5 calls (candles, quote, float)
**Daily Capacity (Starter):** 1,500 calls = ~300 tickers

---

## 6. Sample Output

### 6.1 Tweet Thread (ANVS)

```
Tweet 1:
$ANVS up +65% after a +75% peak — but an ATM filing on Nov 13 (14 days ago) makes 
this move *fragile.* This is how dilution traps form. 🧵

Tweet 2:
ATM = At-The-Market offering. Company can sell new shares anytime → more supply → 
weaker price. Like splitting a pizza into more slices — same pie, smaller pieces. 🍕

Tweet 3:
Why this caught my eye:
• Market cap: $97M (tiny = vulnerable)
• ATM filed: 2025-11-13 (14 days ago)
• Price spiked +75% → now +65%
High price + likely cash need = prime dilution setup

Tweet 4:
Additional context:
• Volume fading — early signs of distribution
• Small float → dilution hits harder
• 10% off highs — first cracks visible
Likely motive: company may need funding soon.

Tweet 5:
Bear thesis builds if:
• Heavy red candle with elevated sell volume
• Price fails to reclaim highs
• ATM usage confirmed
Bull case: strong volume breakout → ATM may pause.
Traders get trapped when dilution lands during pullbacks — not the run.

Tweet 6:
This isn't advice — just pattern recognition.
Big spike + small cap + fresh ATM = elevated risk profile.
Watch how it reacts to selling pressure — that's where dilution becomes visible. 🦅
```

### 6.2 Chart Features

- Orange dashed vertical line at ATM filing date
- Sidebar showing: ACTIONABLE bucket, +75% peak, +65% current, -10% pullback
- 60-day candlestick history
- Volume bars with color coding

---

## 7. Future Improvements

### 7.1 Short Term
- [ ] Add Discord webhook for alerts
- [ ] Implement scheduled GitHub Actions
- [ ] Add performance tracking (did price drop after alert?)

### 7.2 Medium Term
- [ ] Multi-account Twitter support
- [ ] Web dashboard for reviewing candidates
- [ ] Historical backtesting

### 7.3 Long Term
- [ ] ML model for ATM timing prediction
- [ ] Premium subscriber tier
- [ ] Real-time monitoring mode

---

## 8. Changelog from v1

| Area | v1 | v2 |
|------|----|----|
| Data Source | FMP fundraising API | SEC EDGAR 424B5 filings |
| Scoring | 8-metric weighted score (65% threshold) | 3-bucket classification |
| Content | Single tweet + stats reply | 5-6 tweet professional thread |
| Quality | None | Same-day spike/crash detection |
| Charts | Basic candlesticks | ATM filing date line + sidebar |
| Workflow | Auto-post | Manual approval (post.js) |
| Entry Point | pipeline.js | dailyRun.js + post.js |

---

**Document Version:** 2.0  
**Last Updated:** November 27, 2025  
**Repository:** https://github.com/point-onefive/DilutionHunter
