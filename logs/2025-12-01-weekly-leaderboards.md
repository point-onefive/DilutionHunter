# 2025-12-01 — Weekly Leaderboard System

## Summary

Built two **Weekly Leaderboard** modules that produce consolidated, viral-optimized tweets ranking the top 10 tickers by proprietary scores. These replace ad-hoc daily alerts with structured, repeatable weekly content.

This marks the transition from **manual testing** to **production weekly schedule**.

---

## 🆕 New Modules

### 1. Dilution Leaderboard (`src/weekly/dilutionLeaderboard.js`)

**Purpose:** Weekly scan of SEC EDGAR ATM filings → rank by Dilution Severity Score (DSS)

**Pipeline:**
1. Fetch ATM filings from SEC EDGAR (past 7 days)
2. Enrich each ticker with FMP data (price, cash, debt, burn rate)
3. Calculate DSS (Dilution Severity Score) 0-100
4. Filter out tickers on 30-day cooldown
5. Generate AI one-liners via OpenAI
6. Build consolidated leaderboard tweet

**DSS Scoring Formula (0-100):**
- **40% Distress:** Cash runway, burn rate, debt-to-cash ratio
- **40% ATM Impact:** Pullback from peak, filing recency, peak gain magnitude
- **20% Attention:** Volume ratio, market cap sweet spot

**Output Format:**
```
🔎 WEEKLY ATM DILUTION LEADERBOARD
(DSS = dilution pressure × distress level)

#1 $FTEL — DSS: 77
→ 0.7mo runway · -49% off peak → rally unwinding

#2 $WOK — DSS: 72
→ -31% off peak · debt 13.1x cash → dilution overhang severe
...

Not advice — pattern recognition only.
```

---

### 2. Bankruptcy Leaderboard (`src/weekly/bankruptcyLeaderboard.js`)

**Purpose:** 3-stage filtered distress scan → rank by Viral Insolvency Score (VIS)

**Pipeline:**
1. **Stage 1:** Cheap distress filter (500+ tickers → ~200)
   - Uses FMP screener + known distress list
   - Filters by market cap, price, exchange
2. **Stage 2:** Attention filter (~200 → ~60)
   - Volume > 50K, retail interest indicators
3. **Stage 3:** Full bankruptcy analysis (~60 → ranked top 10)
   - 8-10 API calls per ticker
   - VIS scoring via existing bankruptcyScoreEngine

**VIS Scoring Formula (0-100):**
- **60% Bankruptcy Risk:** 7-factor risk score
- **40% Virality:** Volume, market cap, social attention

**Output Format:**
```
⚠️ WEEKLY BANKRUPTCY WATCHLIST
(VIS = bankruptcy risk × market attention)

#1 $SNBR — VIS: 67
→ 0.6mo runway · debt 744x cash → extreme insolvency pressure

#2 $AMC — VIS: 62
→ 24.0mo runway · debt 19.7x cash → long-term burn unsustainable
...

Not advice — pattern recognition only.
```

---

### 3. Weekly Entry Point (`src/weekly/index.js`)

**Purpose:** CLI orchestrator for running leaderboards individually or together

**Commands:**
```bash
# Preview dilution leaderboard (no posting)
node src/weekly/index.js dilution

# Preview bankruptcy leaderboard
node src/weekly/index.js bankruptcy

# Preview both (dilution first, then bankruptcy)
node src/weekly/index.js both

# Post dilution leaderboard to Twitter
node src/weekly/index.js dilution --post

# Post both leaderboards (30s delay between)
node src/weekly/index.js both --post

# Add custom greeting
node src/weekly/index.js dilution --post --greeting="GM!"

# Custom lookback for ATM filings (default: 7 days)
node src/weekly/index.js dilution --days=14
```

---

## 🤖 AI One-Liner Generation

Both leaderboards use OpenAI (gpt-4o) to generate varied, non-repetitive one-liners.

### Format Standard
```
metric1 · metric2 → meaning clause
```

**Example:**
```
0.7mo runway · -49% off peak → rally unwinding
```

### Metric Options (Dilution)
- `Xmo runway` — Cash runway in months
- `-X% off peak` — Pullback from recent high
- `+X% spike` — Peak gain from filing
- `ATM filed Xd ago` — Days since ATM filing
- `debt Xx cash` — Debt-to-cash ratio
- `$XM cap` — Market cap (for small caps)

### Metric Options (Bankruptcy)
- `Xmo runway` — Cash runway in months
- `debt Xx cash` — Debt-to-cash ratio
- `$XM/mo burn` — Monthly cash burn

### Meaning Clause Vocabulary
**Dilution:** rally unwinding, fading after spike, spike losing momentum, momentum reversed, dilution overhang building, dilution overhang severe, heavy dilution pressure, pressure to raise high, cash position collapsing, cash almost gone, likely raise into weakness, distressed setup, reversal forming

**Bankruptcy:** extreme insolvency pressure, severe insolvency pressure, cash nearly exhausted, debt burden overwhelming liquidity, solvency risk building, solvency risk growing, liquidity deteriorating, liquidity tightening, pressure rising, burn rate unsustainable, long-term burn unsustainable, financial distress deepening

### Anomaly Handling
When a ticker has **long runway (>12mo) but high VIS score**, the AI explains why:
- "attention-driven distress signal"
- "long-term burn unsustainable"
- "deteriorating fundamentals"

This prevents reader confusion when metrics seem contradictory.

---

## ⏳ Cooldown / Dedupe System

**Problem:** Weekly leaderboards should not repeat the same tickers week after week.

**Solution:** 30-day cooldown per ticker after posting.

### Implementation
| Setting | Value | Env Override |
|---------|-------|--------------|
| Dilution cooldown | 30 days | `DILUTION_COOLDOWN_DAYS` |
| Bankruptcy cooldown | 30 days | `BANKRUPTCY_LB_COOLDOWN_DAYS` |

### History Files
- `data/dilution_posted.json` — Dilution leaderboard post history
- `data/bankruptcy_lb_posted.json` — Bankruptcy leaderboard post history

### Behavior
1. Before ranking, filter out any ticker posted within cooldown window
2. Show skipped tickers in console output
3. After successful `--post`, mark all 10 leaderboard tickers with today's date
4. Next run will skip those tickers until cooldown expires

**Example Console Output:**
```
⏳ Skipped 3 on cooldown: MULN, FFIE, AMC...
```

---

## 📅 Production Schedule

The system is designed for **one leaderboard per day** across a 7-day week.

### Weekly Schedule (Production)

| Day | Module | Command |
|-----|--------|---------|
| **Monday** | Dilution Leaderboard | `node src/weekly/index.js dilution --post` |
| **Tuesday** | Bankruptcy Watchlist | `node src/weekly/index.js bankruptcy --post` |
| **Wednesday** | *(Future Module 3)* | TBD |
| **Thursday** | *(Future Module 4)* | TBD |
| **Friday** | *(Future Module 5)* | TBD |
| **Saturday** | *(Future Module 6)* | TBD |
| **Sunday** | *(Future Module 7)* | TBD |

### Future Modules (Planned)
5 additional weekly modules to be built:
1. **Earnings Disaster Watchlist** — Companies reporting with high miss probability
2. **Short Squeeze Candidates** — High SI% + catalyst alignment
3. **Momentum Reversal Scan** — Overbought stocks showing distribution
4. **Insider Selling Leaderboard** — Concentrated insider dumps
5. **Options Flow Anomalies** — Unusual put/call activity

---

## 🔧 Configuration

### Environment Variables

```env
# Cooldown overrides (default: 30 days)
DILUTION_COOLDOWN_DAYS=30
BANKRUPTCY_LB_COOLDOWN_DAYS=30

# Safety mode (set to false for live posting)
DRY_RUN=true

# API Keys (required)
FMP_API_KEY=xxx
OPENAI_API_KEY=xxx
TWITTER_API_KEY=xxx
TWITTER_API_SECRET=xxx
TWITTER_ACCESS_TOKEN=xxx
TWITTER_ACCESS_SECRET=xxx
```

### DRY_RUN Mode
When `DRY_RUN=true` (default), the system will:
- Generate full leaderboard and tweet
- Show preview in console
- **NOT** post to Twitter
- **NOT** mark tickers as posted

Set `DRY_RUN=false` in `.env` for production posting.

---

## 📁 Files Added/Modified

### New Files
| File | Purpose |
|------|---------|
| `src/weekly/index.js` | CLI entry point for weekly modules |
| `src/weekly/dilutionLeaderboard.js` | Dilution leaderboard generator |
| `src/weekly/bankruptcyLeaderboard.js` | Bankruptcy leaderboard generator |
| `data/dilution_posted.json` | Cooldown history (created on first post) |
| `data/bankruptcy_lb_posted.json` | Cooldown history (created on first post) |

### Cache Files (Auto-Generated)
| File | Purpose |
|------|---------|
| `data/dilution_leaderboard.json` | Last run's dilution results |
| `data/bankruptcy_leaderboard.json` | Last run's bankruptcy results |

---

## 🧪 Testing vs Production

### During Testing
- Run commands without `--post` flag
- Results shown in console only
- No cooldowns applied
- Safe to run repeatedly

### In Production
- Add `--post` flag to publish to Twitter
- Tickers get marked with 30-day cooldown
- Run once per week per module
- Schedule via cron or GitHub Actions

---

## 📊 API Usage

### Per Dilution Leaderboard Run
| API | Calls | Notes |
|-----|-------|-------|
| SEC EDGAR | 1 | Fetch ATM filings |
| FMP | ~20-50 | Quote + balance sheet + cash flow per ticker |
| OpenAI | 1 | Generate 10 one-liners |

### Per Bankruptcy Leaderboard Run
| API | Calls | Notes |
|-----|-------|-------|
| FMP | ~200-300 | Stage 1-2 filtering |
| FMP | ~400-500 | Stage 3 full analysis (8-10 per ticker) |
| OpenAI | 1 | Generate 10 one-liners |

**Estimated FMP usage:** ~500-800 calls per full bankruptcy scan

---

## ✅ Quality Standards

### Tweet Format Requirements
1. **Named score** — DSS or VIS with formula explainer
2. **2 quantitative metrics** — Always data · data → meaning
3. **Varied meaning clauses** — No clause repeated >2x across 10 tickers
4. **No jargon** — Plain language only
5. **Anomaly explained** — Long runway + high score must clarify why
6. **Disclaimer** — "Not advice — pattern recognition only."

### Character Limit
Tweets are optimized to stay under 1000 characters (well within Twitter limit).

---

## 🚀 Next Steps

1. **Test both leaderboards** with `--post` flag in production
2. **Monitor cooldown behavior** across multiple weeks
3. **Build remaining 5 weekly modules** for full 7-day coverage
4. **Set up GitHub Actions** for automated scheduling
5. **Add performance tracking** to measure post-alert price moves
