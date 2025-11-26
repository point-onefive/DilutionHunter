# DilutionHunter — Technical Specification & Architecture Review

**Date:** November 26, 2025  
**Status:** MVP Complete  
**Version:** 1.0  

---

## Executive Summary

DilutionHunter is an automated stock dilution risk detection system that monitors equity markets for high-probability dilution events, generates AI-powered analysis reports, and posts alerts to Twitter/X. The system is designed to identify stocks exhibiting the classic "pump before dump" pattern commonly seen before equity offerings.

**Current Status:** MVP Complete, DRY_RUN mode enabled, pending FMP tier upgrade for full ticker coverage.

---

## 1. System Architecture

### 1.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DAILY EXECUTION FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │  SCANNER │────▶│ ANALYZER │────▶│  SCORER  │────▶│ THRESHOLD│────▶│  OUTPUT  │
  │          │     │          │     │          │     │  CHECK   │     │          │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
       │                │                │                │                │
       ▼                ▼                ▼                ▼                ▼
   Ticker List      FMP API         8 Risk          Score < 65%      Score ≥ 65%
   (watchlist)      ~8-10 calls     Metrics         → Exit           → Continue
                    per ticker      Weighted                              │
                                                                          ▼
                                                              ┌──────────────────┐
                                                              │   OpenAI API     │
                                                              │   Thesis Gen     │
                                                              └────────┬─────────┘
                                                                       │
                                                              ┌────────▼─────────┐
                                                              │  Chart Renderer  │
                                                              │  (Canvas PNG)    │
                                                              └────────┬─────────┘
                                                                       │
                                                              ┌────────▼─────────┐
                                                              │  Twitter Poster  │
                                                              │  (Thread + Media)│
                                                              └──────────────────┘
```

### 1.2 File Structure

```
DilutionHunter/
├── src/
│   ├── pipeline.js          # Main orchestrator - entry point
│   ├── analystBrief.js      # Core analysis engine (FMP data collection + scoring)
│   ├── batchScan.js         # Multi-ticker scanner with summary
│   ├── openaiThesis.js      # GPT-4o-mini thesis generation
│   ├── chartRenderer.js     # Canvas-based PNG chart generation
│   ├── twitterPoster.js     # Twitter API v2 posting with OAuth 1.0a
│   ├── testTickers.js       # Curated watchlist by category
│   ├── config.js            # Central configuration
│   ├── scoreEngine.js       # Legacy scoring (deprecated)
│   ├── scoreEngineV2.js     # Updated scoring (integrated into analystBrief)
│   ├── scanner.js           # Legacy scanner module
│   ├── storage.js           # JSON file persistence
│   ├── postTweet.js         # Legacy tweet module
│   ├── updatePerformance.js # Performance tracking (future)
│   └── vendors/
│       └── fmp.js           # FMP API wrapper
├── test/
│   ├── phase1-*.js          # API endpoint validation tests
│   ├── phase2-*.js          # Pipeline validation tests
│   ├── phase3-*.js          # Core analysis tests
│   └── phase4-*.js          # Complete analysis tests
├── data/
│   ├── active_signals.json  # Currently tracked alerts
│   ├── daily_log.json       # Execution history
│   └── performance_history.json # P&L tracking (future)
├── output/                  # Generated chart PNGs
├── logs/                    # Technical logs and specs
├── docs/
│   └── architecture.md      # Architecture documentation
├── .github/
│   └── workflows/
│       └── scan.yml         # GitHub Actions scheduled workflow
├── .env.example             # Environment template
├── .gitignore
├── package.json
└── readme.md
```

---

## 2. Core Components — Detailed Breakdown

### 2.1 Analysis Engine (`src/analystBrief.js`)

**Purpose:** Collects all financial data for a ticker and computes a risk score.

**API Calls Per Ticker:** 8-10 calls to FMP

| Endpoint | Data Retrieved | API Calls |
|----------|---------------|-----------|
| `/stable/quote` | Current price, market cap, 52-week range | 1 |
| `/stable/shares-float` | Float shares, outstanding shares | 1 |
| `/stable/historical-price-eod/full` | 30 days OHLCV candles | 1 |
| `/stable/balance-sheet-statement` | Cash, debt, assets (4 quarters) | 1 |
| `/stable/cash-flow-statement` | Operating cash flow, burn rate (4 quarters) | 1 |
| `/stable/insider-trading/search` | Recent insider transactions | 1 |
| `/stable/fundraising-search` | Offerings by company name | 1 |
| `/stable/fundraising` | Offering details by CIK (conditional) | 0-1 |

**Computed Metrics:**

| Category | Metrics | Calculation |
|----------|---------|-------------|
| **Price Action** | `gain3d`, `gain7d`, `gain30d` | % change over period |
| | `atrPercent` | 14-day ATR / current price |
| | `gapPercent` | (today open - yesterday close) / yesterday close |
| | `isRedCandle` | close < open |
| **Volume** | `todayVolumeVsAvg` | today volume / 30-day avg |
| | `peakVolumeVsAvg` | max 7-day volume / 30-day avg |
| | `isVolumeFading` | last 3 days avg < peak 7-day |
| **Float** | `floatRatio` | float shares / outstanding |
| | `isLowFloat` | floatRatio < 0.3 |
| **Financials** | `cash`, `totalDebt` | From balance sheet |
| | `cashDebtRatio` | cash / debt |
| | `quarterlyBurn` | Negative operating cash flow |
| | `runwayMonths` | cash / monthly burn |
| **Offerings** | `offeringSize`, `offeringsSold`, `offeringsRemaining` | From fundraising data |
| | `offeringImpactRatio` | remaining / market cap |
| | `hasActiveATM` | Recent filing + remaining > 0 |
| | `isSerialDiluter` | 3+ offerings in 3 years |
| **Insiders** | `netInsiderFlow` | Sum of buy - sell values (90 days) |
| | `insiderSellCount` | Count of sell transactions |

**Scoring Algorithm:**

```javascript
const weights = {
  momentum: 0.25,        // 7-day gain magnitude
  blowoffStrength: 0.10, // Volume spike during run
  reversalSignal: 0.15,  // Red candle + volume fade
  financialStress: 0.15, // Cash/debt ratio
  runwayUrgency: 0.15,   // Months of cash remaining
  dilutionImpact: 0.10,  // Offering size vs market cap
  floatFragility: 0.05,  // Low float amplifier
  insiderFlight: 0.05    // Net insider selling
};

// Each component scored 0-1, then weighted sum
finalScore = Σ(component × weight)

// Trigger threshold
ALERT if finalScore ≥ 0.65 (65%)
```

**Output:** Returns structured object with all metrics + score for downstream use.

**Error Handling:**
- Returns `null` if quote fetch fails (symbol unavailable)
- Gracefully handles missing data (offerings, insiders may be empty)
- No retry logic currently — fails fast

---

### 2.2 Batch Scanner (`src/batchScan.js`)

**Purpose:** Scan multiple tickers efficiently with summary output.

**Features:**
- Configurable max tickers per run (API conservation)
- Tracks blocked vs successful scans
- Sorts results by risk score
- Highlights alerts (≥65%) and watchlist (40-64%)
- 500ms delay between tickers to avoid rate limiting

**Usage:**
```bash
node src/batchScan.js 10  # Scan up to 10 tickers
```

**Output Format:**
```
TICKER  SCORE   VERDICT     7D-GAIN   RUNWAY    OFFERING
────────────────────────────────────────────────────────
NIO     22%     ✅ PASS      -8.7%     N/A       None
PLTR    15%     ✅ PASS      -0.9%     N/A       None
...

🚨 ALERTS TRIGGERED: (none in this batch)
👀 WATCHLIST: NIO (22%)
```

**Scalability Considerations:**
- Current: Sequential execution (safe, predictable API usage)
- Future: Could parallelize with rate limiter for higher throughput
- FMP Free Tier: 250 calls/day ÷ 10 calls/ticker = ~25 tickers/day max

---

### 2.3 OpenAI Thesis Generator (`src/openaiThesis.js`)

**Purpose:** Generate human-readable investment thesis from raw metrics.

**Model:** `gpt-4o-mini-2024-07-18` (cost-effective, fast)

**Functions:**

| Function | Purpose | Output |
|----------|---------|--------|
| `generateTweetThesis(analysis)` | Main tweet content | ~280 char tweet with TLDR + key stats |
| `generateStatsBlock(analysis)` | Reply thread stats | Formatted stats block (no API call) |

**Prompt Engineering:**
```
System: You are a sharp, witty financial analyst specializing in 
detecting stock dilution risks. Your tone is direct, slightly 
irreverent, and data-driven.

User: [Full analysis data as JSON]

Generate a tweet (max 280 chars) that:
1. Starts with attention-grabbing hook
2. Includes TLDR thesis
3. Lists 3-5 key stats
4. Ends with risk warning
```

**Token Usage:** ~600-800 tokens per thesis (~$0.0003 per call)

**Error Handling:**
- Returns `null` on API failure
- Logs error details for debugging
- No retry logic — fails fast

---

### 2.4 Chart Renderer (`src/chartRenderer.js`)

**Purpose:** Generate Twitter-optimized PNG charts showing the dilution setup.

**Technology:** Node.js `canvas` library (Cairo-based, no browser needed)

**Output Specs:**
- Dimensions: 1200 × 675 px (Twitter 16:9 optimal)
- Format: PNG
- File size: ~50-100KB

**Visual Elements:**

| Element | Description |
|---------|-------------|
| **Header** | Ticker symbol, price, market cap |
| **Risk Badge** | Large score display (green/yellow/red based on threshold) |
| **Candlestick Chart** | Last 20 days OHLCV with wicks |
| **Volume Bars** | Below candlesticks, color-coded |
| **Reversal Highlight** | Dashed box around last candle if red |
| **Stats Panel** | Key metrics on right side |
| **Footer** | Disclaimer + date |

**Color Scheme:**
```javascript
colors: {
  background: '#0d1117',    // GitHub dark
  greenCandle: '#3fb950',
  redCandle: '#f85149',
  text: '#c9d1d9',
  alertRed: '#f85149',
  alertYellow: '#d29922',
}
```

**Error Handling:**
- Creates output directory if missing
- Gracefully handles missing candle data (shows placeholder)

---

### 2.5 Twitter Poster (`src/twitterPoster.js`)

**Purpose:** Post alert threads to Twitter/X with media attachments.

**API Version:** Twitter API v2 + v1.1 (media upload still requires v1.1)

**Authentication:** OAuth 1.0a User Context (requires all 4 credentials)

**Required Credentials:**
```env
TWITTER_API_KEY=xxx
TWITTER_API_SECRET=xxx
TWITTER_ACCESS_TOKEN=xxx
TWITTER_ACCESS_SECRET=xxx
```

**Functions:**

| Function | Purpose |
|----------|---------|
| `uploadMedia(imagePath)` | Upload PNG to Twitter, returns media_id |
| `postTweet(text, options)` | Post single tweet (with optional media/reply) |
| `postAlertThread(thesis, stats, chartPath)` | Post main tweet + stats reply |
| `validateTwitterConfig()` | Check if credentials are set |

**Thread Structure:**
```
Tweet 1 (Main):
  - Thesis text from OpenAI
  - Chart PNG attached

Tweet 2 (Reply):
  - Stats block
  - No media
```

**DRY_RUN Mode:**
- When `DRY_RUN=true` (default): Prints what would be posted, no actual API calls
- When `DRY_RUN=false`: Actually posts to Twitter

**Error Handling:**
- Throws on API failure with status code + error body
- No retry logic
- Media upload failure blocks tweet posting

---

### 2.6 Pipeline Orchestrator (`src/pipeline.js`)

**Purpose:** Main entry point that ties all components together.

**Usage:**
```bash
node src/pipeline.js TICKER         # Analyze real ticker
node src/pipeline.js TICKER --force # Force thesis generation even if score < 65
node src/pipeline.js --mock         # Test with mock data (no FMP API calls)
```

**Execution Flow:**

```
1. Parse CLI arguments
2. STEP 1: Analysis
   - Mock mode: Use hardcoded high-risk data
   - Live mode: Call analyzeSymbol(ticker)
   - Check score against threshold (65%)
   - If below threshold and no --force: Exit early
   
3. STEP 2: OpenAI Thesis
   - Call generateTweetThesis(analysis)
   - Log token usage
   
4. STEP 3: Stats Block
   - Call generateStatsBlock(analysis) [no API call]
   
5. STEP 4: Chart Rendering
   - Call renderChart(analysis, outputPath)
   - Save to ./output/{TICKER}-alert-{timestamp}.png
   
6. STEP 5: Twitter Posting
   - If DRY_RUN: Log what would be posted
   - If !DRY_RUN: Call postAlertThread()
   
7. Output Summary
   - Print thesis, stats, chart path
```

**Mock Mode:**
- Uses hardcoded "FFIE" data simulating a 78% risk score
- Generates realistic pump-pattern candles
- Useful for testing OpenAI + Chart + Twitter without FMP calls

---

## 3. Data Flow & API Usage

### 3.1 External API Dependencies

| Service | Tier | Limits | Cost | Current Usage |
|---------|------|--------|------|---------------|
| **FMP** | Free | 250 calls/day | $0 | ~165/250 used today |
| **OpenAI** | Pay-as-you-go | None | ~$0.0003/thesis | Minimal |
| **Twitter** | Pro | TBD | ~$200/mo | Not connected |

### 3.2 FMP API Call Budget

**Per Ticker Analysis:** ~8-10 calls

**Daily Capacity (Free Tier):**
- 250 calls ÷ 10 calls/ticker = **25 tickers/day max**
- With safety margin: **20 tickers/day recommended**

**Scaling Options:**
| Tier | Calls/Day | Tickers/Day | Cost |
|------|-----------|-------------|------|
| Free | 250 | 25 | $0 |
| Starter | 1,500 | 150 | $29/mo |
| Professional | 15,000 | 1,500 | $99/mo |

### 3.3 Blocked Tickers (Free Tier)

The following popular tickers are **blocked on FMP Free tier**:
- FFIE, GME, AMC, MARA, GFAI, SNDL, PLUG, CLOV, WISH, BB

**Working Tickers (confirmed):**
- RIOT, SOFI, LCID, RIVN, NIO, PLTR, NOK, TLRY

---

## 4. Configuration & Environment

### 4.1 Environment Variables (`.env`)

```env
# Financial Modeling Prep API
FMP_API_KEY=your_fmp_key_here

# OpenAI API
OPENAI_API_KEY=your_openai_key_here

# Twitter/X API (OAuth 1.0a)
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_SECRET=your_access_secret

# Safety Mode (default: true)
DRY_RUN=true
```

### 4.2 Configuration Constants

**In `src/config.js`:**
```javascript
export default {
  DRY_RUN: process.env.DRY_RUN !== 'false',
  SCORE_THRESHOLD: 65,
  MAX_TICKERS_PER_SCAN: 20,
  API_DELAY_MS: 500,
};
```

**In `src/analystBrief.js`:**
```javascript
const TRIGGER_THRESHOLD = 65;  // Score must be >= this to fire
```

---

## 5. Error Handling & Edge Cases

### 5.1 Current Error Handling

| Scenario | Current Behavior | Risk Level |
|----------|------------------|------------|
| FMP API returns 403 (blocked ticker) | Returns `null`, logs error | Low — graceful |
| FMP API timeout | Uncaught, crashes | **Medium** |
| OpenAI API failure | Returns `null`, logs error | Low — graceful |
| Twitter API failure | Throws, crashes | **Medium** |
| Missing env variables | Undefined behavior | **High** |
| Invalid JSON from API | Uncaught JSON.parse error | **Medium** |
| Rate limiting (429) | No handling, crashes | **High** |

### 5.2 Recommended Improvements

**Priority 1 — Critical:**
```javascript
// Add retry logic with exponential backoff
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      return res;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await sleep(1000);
    }
  }
}
```

**Priority 2 — Important:**
```javascript
// Validate env vars at startup
function validateEnv() {
  const required = ['FMP_API_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('Missing required env vars:', missing);
    process.exit(1);
  }
}
```

**Priority 3 — Nice to Have:**
- Circuit breaker pattern for external APIs
- Dead letter queue for failed tweets
- Alerting on repeated failures (Slack/Discord webhook)

---

## 6. Testing Strategy

### 6.1 Existing Tests

| File | Purpose | API Calls |
|------|---------|-----------|
| `test/phase1-single-call.js` | Validate FMP quote endpoint | 1 |
| `test/phase2-validate-pipeline.js` | Validate 6 FMP endpoints | 6 |
| `test/phase3-core-analysis.js` | Full analysis on test ticker | ~10 |
| `test/phase4-complete-analysis.js` | Complete flow validation | ~10 |

### 6.2 Testing Commands

```bash
# Test with mock data (no API calls)
node src/pipeline.js --mock

# Test analysis only (uses FMP)
node src/analystBrief.js RIOT

# Test batch scanner
node src/batchScan.js 5

# Test chart renderer (no API calls)
node src/chartRenderer.js

# Test OpenAI thesis (uses OpenAI, mock data)
node src/openaiThesis.js

# Test full pipeline with force
node src/pipeline.js RIOT --force
```

### 6.3 Missing Test Coverage

- [ ] Unit tests for scoring algorithm edge cases
- [ ] Integration tests with mocked APIs
- [ ] End-to-end test with actual Twitter posting
- [ ] Load testing for batch operations
- [ ] Regression tests for chart rendering

---

## 7. Deployment & Scheduling

### 7.1 GitHub Actions Workflow

**File:** `.github/workflows/scan.yml`

```yaml
name: Daily Scan
on:
  schedule:
    - cron: '0 14 * * 1-5'  # 9 AM ET, weekdays
  workflow_dispatch:        # Manual trigger

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: node src/pipeline.js --scan-watchlist
        env:
          FMP_API_KEY: ${{ secrets.FMP_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          TWITTER_API_KEY: ${{ secrets.TWITTER_API_KEY }}
          # ... other secrets
```

### 7.2 Required GitHub Secrets

```
FMP_API_KEY
OPENAI_API_KEY
TWITTER_API_KEY
TWITTER_API_SECRET
TWITTER_ACCESS_TOKEN
TWITTER_ACCESS_SECRET
DRY_RUN (set to 'false' for production)
```

### 7.3 Recommended Schedule

| Time (ET) | Action | Purpose |
|-----------|--------|---------|
| 9:00 AM | Full scan | Catch pre-market movers |
| 12:00 PM | Optional rescan | Mid-day check |
| 4:30 PM | Performance update | Track post-market moves |

---

## 8. Scalability Assessment

### 8.1 Current Limitations

| Constraint | Current Limit | Bottleneck |
|------------|---------------|------------|
| Tickers/day | ~25 | FMP Free tier (250 calls) |
| Concurrent scans | 1 | Sequential execution |
| Tweet frequency | Unlimited | DRY_RUN enabled |
| Chart generation | ~1/sec | CPU-bound canvas |

### 8.2 Scaling Path

**Phase 1 — Current (Free Tier):**
- 25 tickers/day
- Manual watchlist curation
- Single daily run

**Phase 2 — Starter Tier ($29/mo):**
- 150 tickers/day
- Broader universe scanning
- Multiple daily runs

**Phase 3 — Professional ($99/mo):**
- 1,500 tickers/day
- Full market coverage
- Real-time monitoring possible

**Phase 4 — Enterprise:**
- Redis caching for repeated queries
- PostgreSQL for historical data
- Worker queue for parallel processing
- Kubernetes for horizontal scaling

---

## 9. Security Considerations

### 9.1 Credential Management

| Item | Current State | Recommendation |
|------|---------------|----------------|
| API keys in `.env` | ✅ Gitignored | Use secrets manager in prod |
| `.env.example` provided | ✅ Yes | Document all required vars |
| Twitter OAuth tokens | Stored in plain text | Rotate quarterly |
| FMP API key | Shared quota | Consider dedicated key |

### 9.2 Rate Limiting Protection

- **FMP:** No client-side rate limiting — relies on API rejection
- **Twitter:** No rate limit handling — will fail on 429
- **OpenAI:** No rate limit handling — unlikely to hit limits

**Recommendation:** Implement token bucket rate limiter:
```javascript
import Bottleneck from 'bottleneck';

const fmpLimiter = new Bottleneck({
  reservoir: 250,           // 250 calls
  reservoirRefreshAmount: 250,
  reservoirRefreshInterval: 24 * 60 * 60 * 1000, // per day
  maxConcurrent: 1,
  minTime: 200              // 200ms between calls
});
```

---

## 10. Known Issues & Technical Debt

### 10.1 Known Issues

| Issue | Severity | Workaround |
|-------|----------|------------|
| Many tickers blocked on free FMP tier | High | Upgrade FMP or curate watchlist |
| No retry on API failures | Medium | Manual re-run |
| Console output has extra newlines | Low | Cosmetic only |
| Legacy files in src/ (scanner.js, postTweet.js) | Low | Not used, can delete |

### 10.2 Technical Debt

| Item | Effort | Priority |
|------|--------|----------|
| Consolidate legacy files | 1 hour | Low |
| Add TypeScript types | 4 hours | Medium |
| Add comprehensive error handling | 4 hours | High |
| Add unit test suite | 8 hours | Medium |
| Add logging framework (winston/pino) | 2 hours | Medium |
| Add metrics/observability | 4 hours | Low |

---

## 11. Future Roadmap

### 11.1 Short Term (1-2 weeks)

- [ ] Upgrade FMP to Starter tier
- [ ] Configure Twitter credentials
- [ ] First live tweet (manual trigger)
- [ ] Monitor and iterate on thesis quality

### 11.2 Medium Term (1 month)

- [ ] Automated daily GitHub Actions runs
- [ ] Performance tracking (did alert precede drop?)
- [ ] Expand watchlist to 50+ tickers
- [ ] Add Discord/Slack notifications

### 11.3 Long Term (3+ months)

- [ ] Historical backtesting engine
- [ ] ML-enhanced scoring model
- [ ] Multi-account Twitter support
- [ ] Premium subscriber alerts
- [ ] Web dashboard for monitoring

---

## 12. Runbook — Common Operations

### 12.1 Manual Scan

```bash
# Single ticker
node src/pipeline.js RIOT

# Force generation (even if low score)
node src/pipeline.js RIOT --force

# Mock mode (no API calls)
node src/pipeline.js --mock

# Batch scan
node src/batchScan.js 10
```

### 12.2 View Outputs

```bash
# Open latest chart
open output/*.png

# View generated files
ls -la output/
```

### 12.3 Check API Usage

```bash
# FMP dashboard
open https://site.financialmodelingprep.com/developer/docs/dashboard

# Check remaining calls (in code)
# FMP returns X-RateLimit-Remaining header
```

### 12.4 Go Live (First Real Tweet)

```bash
# 1. Ensure credentials set
cat .env | grep TWITTER

# 2. Test in DRY_RUN first
node src/pipeline.js --mock

# 3. Disable DRY_RUN
echo "DRY_RUN=false" >> .env

# 4. Run with real data
node src/pipeline.js RIOT --force

# 5. Check Twitter for post
```

---

## 13. Sign-Off Checklist

### 13.1 Functional Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| Scan tickers for dilution risk | ✅ Complete | 8 risk metrics |
| Score and threshold alerts | ✅ Complete | 65% threshold |
| Generate AI thesis | ✅ Complete | GPT-4o-mini |
| Render chart PNG | ✅ Complete | Candlesticks + stats |
| Post to Twitter | ✅ Ready | DRY_RUN mode |
| Batch scanning | ✅ Complete | Configurable count |

### 13.2 Non-Functional Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| API conservation | ✅ Complete | ~10 calls/ticker |
| Error handling | ⚠️ Partial | Needs retry logic |
| Logging | ⚠️ Basic | Console only |
| Testing | ⚠️ Partial | Manual tests only |
| Documentation | ✅ Complete | This document |
| Security | ✅ Adequate | Secrets in .env |

### 13.3 Approval Status

| Reviewer | Status | Date |
|----------|--------|------|
| Engineering | ⏳ Pending | — |
| Product | ⏳ Pending | — |
| Security | ⏳ Pending | — |

---

## 14. Appendix

### A. Sample Alert Output

**Tweet (Main):**
```
🚨 FFIE Alert: Dilution Danger Ahead! 💀

TLDR: With a market cap of $450M and 33% dilution on the horizon, 
this low-float stock is a ticking time bomb.

📉 Key Stats:
- 7D: +187% | 30D: +320%
- Runway: 2.1 months
- Float: 28%
- Shelf: $150M (33% impact)

⚠️ Risk Score: 78%
```

**Stats Reply:**
```
📊 FFIE DILUTION RISK SNAPSHOT

💰 Price: $2.45 | MCap: $450.0M
📈 7D: +187.5% | 30D: +320.0%
⏱️ Runway: 2.1 months
💥 Shelf Capacity: $150.0M (33.0% of MCap)
🔴 ACTIVE ATM — dilution can drop any day

⚠️ Risk Score: 78%
```

### B. Scoring Thresholds Reference

| Component | 0% | 30% | 50% | 70% | 100% |
|-----------|-----|-----|-----|-----|------|
| Momentum (7D gain) | <50% | 50% | 100% | 150% | ≥200% |
| Blowoff (vol spike) | <2x | 2x | 3x | 4x | ≥5x |
| Reversal | Neither | One signal | — | — | Both signals |
| Financial Stress | >1.0 | 1.0 | 0.5 | 0.25 | <0.25 |
| Runway | >12mo | 12mo | 6mo | 4mo | ≤2mo |
| Dilution Impact | <10% | 10% | 25% | 40% | ≥50% |
| Float Fragility | >40% | 40% | 30% | 20% | <20% |
| Insider Flight | Net buy | 0 | -2 | -3 | ≤-5 |

### C. Test Results Summary (November 26, 2025)

**Batch Scan Results:**
| Ticker | Score | 7D Gain | Runway | Verdict |
|--------|-------|---------|--------|---------|
| NIO | 22% | -8.7% | N/A | Pass |
| PLTR | 15% | -0.9% | N/A | Pass |
| LCID | 9% | +3.2% | 6.5mo | Pass |
| SOFI | 8% | +8.6% | N/A | Pass |
| NOK | 8% | -8.4% | N/A | Pass |
| TLRY | 8% | N/A | 592.5mo | Pass |
| RIVN | 6% | +7.9% | N/A | Pass |
| RIOT | 3% | +7.3% | 8.7mo | Pass |

**Blocked Tickers:** SNDL, PLUG, CLOV, WISH, BB (Free tier restriction)

**Pipeline Tests:**
- ✅ Mock pipeline: Working (FFIE @ 78%)
- ✅ Live pipeline: Working (RIOT @ 3%)
- ✅ Chart generation: Working
- ✅ OpenAI thesis: Working
- ✅ Twitter poster: Ready (DRY_RUN)

---

**Document Version:** 1.0  
**Last Updated:** November 26, 2025  
**Author:** DilutionHunter Engineering Team  
**Repository:** https://github.com/point-onefive/DilutionHunter
