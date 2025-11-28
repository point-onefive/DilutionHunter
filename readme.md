# DilutionHunter 🦅

**Automated ATM dilution risk detection and Twitter content pipeline**

Scans SEC EDGAR for At-The-Market (ATM) offerings, analyzes post-filing price action, fetches financial health data (cash, burn rate, debt), generates professional analyst-grade Twitter threads, and posts educational content about dilution risk patterns.

---

## Features

- 🔍 **ATM Filing Detection** — Scans SEC EDGAR for recent 424B5 ATM filings
- 📊 **Price Analysis** — Tracks peak gains, pullbacks, and current performance post-filing
- 💰 **Financial Health** — Fetches cash, debt, burn rate, months of cash left from balance sheets
- 🎯 **Smart Classification** — 3-bucket system (Actionable, Watch List, Case Study)
- 🚫 **Quality Filtering** — Skips same-day pump & dump patterns
- 🧵 **Professional Threads** — 6-tweet threads with education, metrics, bull/bear framing
- 📈 **Chart Generation** — Candlestick charts with ATM filing date marker
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

### 1. Daily Scan (Dry Run)

Scan for ATM candidates and generate content:

```bash
node src/dailyRun.js              # Uses cache (fast, no API calls if recent)
node src/dailyRun.js --no-cache   # Force fresh API calls
```

This will:
- Scan recent ATM filings from SEC EDGAR
- Enrich with FMP price data (cached for 1 hour)
- Select top 2 candidates (fresher filings prioritized)
- Generate tweet threads + charts
- Save to `/output/` folder

### 2. Review Output

```bash
# View generated content
cat output/TICKER_*.json

# Open chart image
open output/charts/TICKER_*.png
```

### 3. Post to Twitter

After reviewing, manually post approved tickers:

```bash
# Preview mode (respects DRY_RUN in .env)
node src/post.js MNDR

# Live posting (overrides DRY_RUN)
node src/post.js MNDR --live
```

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
| `src/dailyRun.js` | Main entry point — daily orchestrator |
| `src/post.js` | Manual posting with preview/confirmation |
| `src/atmScanner.js` | SEC EDGAR filing detection |
| `src/dailySelector.js` | Quality filter + post selection |
| `src/contentPipeline.js` | OpenAI thread generation |
| `src/chartGenerator.js` | Canvas chart rendering |
| `src/twitterPoster.js` | Twitter API posting |

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

- [v2.2 Updates](logs/2025-11-28-v2.2-updates.md) — Financial health data, narrative generation, formatting
- [v2 Architecture](logs/2025-11-27-v2-architecture.md) — Current system design
- [v1 Technical Spec](logs/2025-11-26-technical-spec.md) — Legacy scoring system

---

## Roadmap

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
