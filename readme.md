# DilutionHunter 🦅

**Automated dilution risk detection + bankruptcy watchdog for Twitter**

## Scanner Systems

| System | Purpose | Output |
|--------|---------|--------|
| **Weekly Leaderboards** | Consolidated top-10 rankings | 1 tweet per module |
| **ATM Scanner** | Detects At-The-Market offerings from SEC EDGAR | Thread per ticker |
| **Bankruptcy Watchdog** | Identifies companies at risk of insolvency | Thread per ticker |
| **CDE Detector** | Critical Distress Events where multiple signals converge | Thread per ticker |

---

## 📅 Weekly Leaderboards (NEW)

Production schedule: **One leaderboard per day**

| Day | Module | Score | Command |
|-----|--------|-------|---------|
| **Monday** | Dilution Leaderboard | DSS | `node src/weekly/index.js dilution --post` |
| **Tuesday** | Bankruptcy Watchlist | VIS | `node src/weekly/index.js bankruptcy --post` |
| Wednesday | *(Future)* | — | TBD |
| Thursday | *(Future)* | — | TBD |
| Friday | *(Future)* | — | TBD |
| Saturday | *(Future)* | — | TBD |
| Sunday | *(Future)* | — | TBD |

### Quick Commands

```bash
# Preview (no posting)
node src/weekly/index.js dilution
node src/weekly/index.js bankruptcy
node src/weekly/index.js both

# Post to Twitter
node src/weekly/index.js dilution --post
node src/weekly/index.js bankruptcy --post
node src/weekly/index.js both --post          # Posts both with 30s delay
```

### Scoring Systems

**DSS (Dilution Severity Score)** = dilution pressure × distress level
- 40% Distress (runway, burn, debt)
- 40% ATM Impact (pullback, recency, peak gain)
- 20% Attention (volume, market cap)

**VIS (Viral Insolvency Score)** = bankruptcy risk × market attention
- 60% Bankruptcy Risk (7-factor score)
- 40% Virality (volume, social attention)

### Tweet Format

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

### Cooldown System

- **30-day cooldown** per ticker after posting
- Prevents same ticker appearing week after week
- Configurable via `DILUTION_COOLDOWN_DAYS` and `BANKRUPTCY_LB_COOLDOWN_DAYS`

---

## Features

### ATM Dilution Scanner
- 🔍 **ATM Filing Detection** — Scans SEC EDGAR for recent 424B5 ATM filings
- 📊 **Price Analysis** — Tracks peak gains, pullbacks, and current performance post-filing
- 💰 **Financial Health** — Fetches cash, debt, burn rate, months of cash left from balance sheets
- 🎯 **Smart Classification** — 3-bucket system (Actionable, Watch List, Case Study)
- 🚫 **Quality Filtering** — Skips same-day pump & dump patterns

### Bankruptcy Watchdog
- 💀 **Insolvency Detection** — 0-100 bankruptcy risk score across 7 factors
- 📈 **VIS Prioritization** — Viral Insolvency Score = Risk × Attention
- 🔮 **Outcome Probabilities** — Dilution / Restructuring / Bankruptcy estimates
- 🧭 **Daily Radar** — Summary tweet of all tracked distress tickers
- ⏳ **Anti-Duplication** — 30-day cooldown prevents repeat posts

### CDE Detector (NEW)
- 🔥 **Convergence Detection** — Finds tickers where Dilution + Bankruptcy + Attention align
- 🎯 **Multi-Scanner Crossover** — Only triggers when ALL THREE signals present
- 💀 **Death Spiral Alert** — These are the loud failures that reprice violently
- 📊 **Intensity Scoring** — Measures how strongly signals converge

### All Systems
- 🧵 **Professional Threads** — AI-generated analyst-grade content
- 📈 **Chart Generation** — Candlestick charts with markers
- ✅ **Manual Approval** — Review before posting to Twitter

---

## Quick Start

### Prerequisites

- Node.js 18+
- FMP API key (Starter tier: $29/mo)
- OpenAI API key
- Twitter API credentials (Pro tier)

### Installation

```bash
git clone https://github.com/point-onefive/DilutionHunter.git
cd DilutionHunter
npm install
```

### Configuration

Create `.env` file:

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

# Safety Mode (default: true)
DRY_RUN=true
```

---

## Usage

### ATM Dilution Scanner

#### 1. Daily Scan (Dry Run)

Scan for ATM candidates and generate content:

```bash
node src/dailyRun.js              # Uses cache (fast, no API calls if recent)
node src/dailyRun.js --no-cache   # Force fresh API calls
```

#### 2. Post to Twitter

```bash
node src/post.js MNDR             # Preview mode
node src/post.js MNDR --live      # Live posting
```

### Bankruptcy Watchdog

#### 1. Scan for Distress

```bash
node src/bankruptcy/bankruptcyScan.js                  # Scan universe, preview
node src/bankruptcy/bankruptcyScan.js --post           # Scan + post top alert
node src/bankruptcy/bankruptcyScan.js --ticker=BYND    # Single ticker
node src/bankruptcy/bankruptcyScan.js --refresh        # Refresh universe
node src/bankruptcy/bankruptcyScan.js --status         # Show cooldowns
```

#### 2. Daily Radar

```bash
node src/bankruptcy/bankruptcyRadar.js                 # Preview radar
node src/bankruptcy/bankruptcyRadar.js --post          # Post radar tweet
```

#### 3. VIS Thresholds

| VIS Score | Classification | Action |
|-----------|---------------|--------|
| ≥75 | PRIME_ALERT | Auto-post immediately |
| 60-74 | WATCHLIST | Auto-post as watchlist |
| <60 | STORE_ONLY | Save data, don't post |

### CDE Detector (Critical Distress Events)

#### 1. Scan for CDEs

```bash
node src/cde/cdeDetector.js                    # Scan from existing signals
node src/cde/cdeDetector.js --ticker=AMZE      # Check single ticker
node src/cde/cdeDetector.js --ticker=AMZE --post  # Post CDE thread
```

#### 2. CDE Criteria

All three must be true:

| Signal | Scanner | Threshold |
|--------|---------|-----------|
| 🔫 Dilution Active | Dilution Hunter | ATM/shelf detected |
| 🏚 Bankruptcy Risk | Bankruptcy Watchdog | Risk ≥ 50/100 |
| 📢 Market Attention | VIS Score | VIS ≥ 60/100 |

When all three converge → **Critical Distress Event**

---

## Output Examples

### Tweet Thread Structure

```
Alert Tweet (with chart):
🚨 $AMZE dilution watch

+91% spike off lows, now holding +47%
ATM filed 2025-11-13
$2.8M cap with < 1 month of cash left

Company has ~$300K cash vs ~$2.0M monthly burn, so the ATM is survival, not optional.

🧵 Full breakdown below

Thread:
1️⃣ What's an ATM? Company files paperwork to sell new shares at market price through a broker. They usually sell into strength to maximize cash raised.

2️⃣ The setup on $AMZE:
• Market cap: ~$2.8M
• ATM filed: 2025-11-13
• Price: ran +91% → now +47%
• Cash: $300K | Burn: $2.0M/mo | < 1 month of cash left

3️⃣ What I'm watching:
• Heavy red candle with volume
• Selling pressure growing
• Support breaks that don't bounce
Motive clear: critical distress level

4️⃣ Scenarios:
Bear builds if: large red day, can't reclaim highs, ATM usage shows up
Bull invalidation: strong volume breakout that holds
Traders get trapped when dilution hits during pullbacks, not the run.

5️⃣ Takeaway: Fresh ATM, sub-$3M cap, < 1 month of cash, and a spike already fading. This is a watch setup, not an action setup.
Not advice — pattern recognition only. 🦅
```

### Chart Features

- 60-day candlestick history
- Orange dashed line marking ATM filing date
- Sidebar with bucket classification and metrics
- Volume bars with color coding

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  ATM SCANNER │────▶│    DAILY     │────▶│   CONTENT    │────▶│   MANUAL     │
│  (SEC EDGAR) │     │   SELECTOR   │     │  GENERATOR   │     │   APPROVAL   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| **Weekly Leaderboards** | |
| `src/weekly/index.js` | CLI entry point for weekly modules |
| `src/weekly/dilutionLeaderboard.js` | ATM filings → DSS scoring → top 10 tweet |
| `src/weekly/bankruptcyLeaderboard.js` | 3-stage filter → VIS scoring → top 10 tweet |
| **ATM Scanner** | |
| `src/dailyRun.js` | Main entry point — daily orchestrator |
| `src/post.js` | Manual posting with preview/confirmation |
| `src/atmScanner.js` | SEC EDGAR filing detection |
| `src/dailySelector.js` | Quality filter + post selection |
| `src/contentPipeline.js` | OpenAI thread generation |
| `src/chartGenerator.js` | Canvas chart rendering |
| `src/twitterPoster.js` | Twitter API posting |
| **Bankruptcy Watchdog** | |
| `src/bankruptcy/bankruptcyScan.js` | Main orchestrator + CLI |
| `src/bankruptcy/bankruptcyScoreEngine.js` | Risk scoring (0-100) + VIS |
| `src/bankruptcy/bankruptcyThesis.js` | OpenAI thread generation |
| `src/bankruptcy/fmpBankruptcy.js` | FMP data fetching |
| `src/bankruptcy/viralityEngine.js` | Virality scoring |
| `src/bankruptcy/outcomeModel.js` | Probability estimates |
| `src/bankruptcy/bankruptcyRadar.js` | Daily dashboard |
| **CDE Detector** | |
| `src/cde/cdeDetector.js` | Multi-scanner convergence detection |
| `src/cde/cdeThesis.js` | CDE thread generation |

---

## Content Classification

| Bucket | Criteria | Priority |
|--------|----------|----------|
| **ACTIONABLE** | Peak gain >30%, pullback >10% | Highest |
| **WATCH_LIST** | Peak gain >20%, pullback <10% | Medium |
| **CASE_STUDY** | Any ATM filing with price data | Lowest |

Quality grades:
- **GOOD** — Normal patterns, safe to post
- **POOR** — Same-day pump & dump detected, skip

---

## API Dependencies

| Service | Purpose | Tier Required |
|---------|---------|---------------|
| SEC EDGAR | ATM filing detection | Free |
| FMP | Price data | Starter ($29/mo) |
| OpenAI | Thread generation | Pay-as-you-go |
| Twitter | Posting | Pro (~$100/mo) |

---

## Development

### Project Structure

```
DilutionHunter/
├── src/                 # Source code
├── output/              # Generated content
│   ├── charts/          # PNG chart images
│   └── *.json           # Tweet content
├── logs/                # Technical documentation
├── test/                # Test files
└── docs/                # Architecture docs
```

### Running Tests

```bash
# Test ATM scanner
node src/atmScanner.js

# Test chart generation
node src/chartGenerator.js
```

---

## Documentation

- [Weekly Leaderboards](logs/2025-12-01-weekly-leaderboards.md) — DSS/VIS scoring, AI one-liners, production schedule
- [CDE System](logs/2025-11-30-cde-system.md) — Critical Distress Events, dynamic universe, company names
- [v3.0 Bankruptcy Watchdog](logs/2025-11-30-v3-bankruptcy-watchdog.md) — VIS system, outcome model, compressed threads
- [v2.2 Updates](logs/2025-11-28-v2.2-updates.md) — Financial health data, narrative generation, formatting
- [v2 Architecture](logs/2025-11-27-v2-architecture.md) — Current system design
- [v1 Technical Spec](logs/2025-11-26-technical-spec.md) — Legacy scoring system

---

## Roadmap

- [x] Bankruptcy Watchdog with VIS prioritization
- [x] Outcome probability model
- [x] Anti-duplication (30-day cooldown)
- [x] Daily radar dashboard
- [x] CDE (Critical Distress Event) detection
- [x] Dynamic universe refresh from FMP market movers
- [x] Weekly Leaderboards (Dilution + Bankruptcy)
- [x] AI-generated one-liners with varied clauses
- [ ] 5 additional weekly modules (earnings, short squeeze, momentum, insider, options)
- [ ] Automated GitHub Actions scheduling
- [ ] Discord webhook alerts
- [ ] Performance tracking (post-alert price drops)
- [ ] Web dashboard for candidate review
- [ ] Historical backtesting

---

## License

MIT

---

**Built for pattern recognition, not financial advice.** 🦅
