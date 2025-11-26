# DilutionHunter Architecture

## Overview

DilutionHunter is a serverless, GitHub Actions-powered stock scanner that:
1. Scans for parabolic small-cap runners
2. Evaluates dilution risk based on financials + offerings
3. Generates AI-written tweet threads
4. Posts to Twitter/X automatically
5. Tracks performance over time

**No servers. No databases. Just JSON files + cron jobs.**

---

## System Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         GITHUB ACTIONS CRON                               │
│                      (3x/day on weekdays)                                │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           scanner.js                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                  │
│  │ getSymbols() │──▶│  getOHLCV()  │──▶│getFinancials │                  │
│  │ (test list)  │   │  (30 days)   │   │  (cash/debt) │                  │
│  └──────────────┘   └──────────────┘   └──────────────┘                  │
│         │                  │                  │                           │
│         └──────────────────┴──────────────────┘                           │
│                            │                                              │
│                            ▼                                              │
│                   ┌─────────────────┐                                     │
│                   │  scoreEngine.js │                                     │
│                   │                 │                                     │
│                   │ • Weekly gain % │                                     │
│                   │ • Red day check │                                     │
│                   │ • Volume fade   │                                     │
│                   │ • Cash vs debt  │                                     │
│                   │ • Offering risk │                                     │
│                   └────────┬────────┘                                     │
│                            │                                              │
│                   Score >= 0.6?                                           │
│                       │                                                   │
│              ┌────────┴────────┐                                          │
│              ▼                 ▼                                          │
│         NO: Skip         YES: TRIGGER                                     │
│                                │                                          │
└────────────────────────────────┼──────────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          postTweet.js                                     │
│                                                                           │
│     ┌──────────────┐        ┌──────────────┐        ┌──────────────┐     │
│     │   OpenAI     │───────▶│   Generate   │───────▶│   Twitter    │     │
│     │  GPT-4o-mini │        │    Thread    │        │   Post (X)   │     │
│     └──────────────┘        └──────────────┘        └──────────────┘     │
│                                                                           │
│                         (respects DRY_RUN)                               │
└──────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          storage.js                                       │
│                                                                           │
│     ┌────────────────────┐        ┌────────────────────┐                 │
│     │ active_signals.json │        │ performance_history│                 │
│     │                    │        │       .json        │                 │
│     │ [{ticker, score,   │        │ {TICKER: [{date,   │                 │
│     │   entry_price...}] │        │   close}, ...]}    │                 │
│     └────────────────────┘        └────────────────────┘                 │
│                                                                           │
│                    Committed back to repository                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
DilutionHunter/
├── src/
│   ├── config.js           # All settings, thresholds, API keys
│   ├── scanner.js          # Main entry: orchestrates the scan
│   ├── scoreEngine.js      # Signal evaluation + scoring logic
│   ├── storage.js          # JSON file read/write operations
│   ├── postTweet.js        # OpenAI generation + Twitter posting
│   ├── updatePerformance.js# Daily P/L tracking for active signals
│   └── vendors/
│       └── fmp.js          # FMP API wrapper (modular, swap-ready)
│
├── data/
│   ├── active_signals.json     # Currently tracked signals
│   ├── performance_history.json# Historical close prices by ticker
│   ├── daily_log.json          # API usage, tweets sent, run stats
│   └── mock/                   # Cached API responses (for testing)
│
├── .github/workflows/
│   └── scan.yml            # GitHub Actions: scheduled scans
│
├── docs/
│   └── architecture.md     # This file
│
├── .env.example            # Template for environment variables
├── .gitignore              # Ignores .env, node_modules, etc.
├── package.json            # Node.js project config
└── readme.md               # Project overview
```

---

## Key Design Decisions

### 1. API Conservation (FMP Free Tier)

**Problem:** FMP free tier = 250 calls/day. Full US market = 8,000+ symbols.

**Solution:**
- `TEST_TICKERS` array in config (40 symbols for development)
- `getSymbols()` function returns this list by default
- When upgrading FMP tier, just swap `getSymbols()` to call `getScreenedSymbols()` or `getFullUniverse()`
- All other code stays the same

### 2. DRY_RUN Mode

**Problem:** Need to test without burning Twitter quota or making accidental posts.

**Solution:**
- `DRY_RUN=true` (default) prevents all external side effects
- Logs exactly what *would* be posted
- `MOCK_FMP=true` adds additional caching for FMP responses

### 3. Stateless with JSON Persistence

**Problem:** GitHub Actions is stateless, but we need to track signals over time.

**Solution:**
- All state stored in JSON files under `/data/`
- Workflow commits changes back to repo after each run
- No database needed

### 4. Modular FMP Wrapper

**Problem:** Need to easily upgrade from free tier to paid without rewriting code.

**Solution:**
- All FMP calls go through `src/vendors/fmp.js`
- Functions are designed for easy swap:
  - `getSymbols()` → `getScreenedSymbols()` or `getFullUniverse()`
  - Bulk endpoints ready when available
- API call tracking built-in (`getApiCallCount()`)

---

## Scoring System

The `scoreEngine.js` evaluates each ticker across multiple factors:

| Factor | Weight | Trigger |
|--------|--------|---------|
| Parabolic Move | 20% | Weekly gain >= 200% |
| First Red Day | 15% | Red candle after 3+ green days |
| Volume Fade | 15% | Today's volume < 70% of yesterday |
| Blow-off Top | 10% | Volume spike + declining follow-through |
| Weak Cash | 15% | Cash < 50% of debt |
| Burning Cash | 10% | Negative free cash flow |
| Offering Risk | 15% | SEC filing for S-3, S-1, 424B |

**Minimum score to trigger: 0.60 (60%)**

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FMP_API_KEY` | Yes | Financial Modeling Prep API key |
| `OPENAI_API_KEY` | No* | For AI-generated tweets (falls back to templates) |
| `TWITTER_API_KEY` | No** | Twitter/X API credentials |
| `TWITTER_API_SECRET` | No** | |
| `TWITTER_ACCESS_TOKEN` | No** | |
| `TWITTER_ACCESS_SECRET` | No** | |
| `DRY_RUN` | No | `true` (default) or `false` |
| `MOCK_FMP` | No | `true` or `false` (default) |
| `VERBOSE` | No | `true` or `false` (default) |

\* Without OpenAI key, uses fallback tweet templates
\** Without Twitter keys, just generates tweets without posting

---

## GitHub Actions Workflow

**Schedule:** 3x/day on weekdays (9am, 1pm, 5pm ET)

**Jobs:**
1. `scan` - Runs `scanner.js`, commits signal changes
2. `performance_update` - Runs `updatePerformance.js` at end of day

**Manual Trigger:** Workflow can be run manually with DRY_RUN toggle.

**Required Secrets:**
- `FMP_API_KEY`
- `OPENAI_API_KEY`
- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_SECRET`

---

## Upgrade Path

### Phase 1: Current (Free Tier)
- 40 test tickers
- DRY_RUN mode
- Validate scanner logic

### Phase 2: FMP Starter ($15/mo)
- Switch to `getScreenedSymbols()` for filtered universe
- ~500-2000 symbols based on screener params
- Still conservative API usage

### Phase 3: FMP Growth+
- Full US market scan
- Use bulk endpoints
- Higher daily limits

---

## Future Enhancements

1. **Chart Images** - Generate candlestick charts to attach to tweets
2. **Discord/Slack Alerts** - Multi-channel notifications
3. **Backtesting Mode** - Run scanner on historical data
4. **Web Dashboard** - Visualize signals and performance
5. **Options Flow Integration** - Correlate with unusual options activity
