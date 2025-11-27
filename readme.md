# DilutionHunter 🦅

**Automated ATM dilution risk detection and Twitter content pipeline**

Scans SEC EDGAR for At-The-Market (ATM) offerings, analyzes post-filing price action, generates professional analyst-grade Twitter threads, and posts educational content about dilution risk patterns.

---

## Features

- 🔍 **ATM Filing Detection** — Scans SEC EDGAR for recent 424B5 ATM filings
- 📊 **Price Analysis** — Tracks peak gains, pullbacks, and current performance post-filing
- 🎯 **Smart Classification** — 3-bucket system (Actionable, Watch List, Case Study)
- 🚫 **Quality Filtering** — Skips same-day pump & dump patterns
- 🧵 **Professional Threads** — 5-6 tweet threads with education, metrics, bull/bear framing
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
node src/dailyRun.js
```

This will:
- Scan recent ATM filings from SEC EDGAR
- Enrich with FMP price data
- Select top 2 candidates
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
# Preview mode (respects DRY_RUN)
node src/post.js ANVS

# Live posting
node src/post.js ANVS --live
```

---

## Output Examples

### Tweet Thread Structure

```
Tweet 1: Hook + Setup
$ANVS up +65% after a +75% peak — but an ATM filing on Nov 13 makes this move *fragile.* 🧵

Tweet 2: Education
ATM = At-The-Market offering. Company can sell new shares anytime → more supply → weaker price. 🍕

Tweet 3: Key Signals
• Market cap: $97M (tiny = vulnerable)
• ATM filed: 2025-11-13 (14 days ago)
• Price spiked +75% → now +65%

Tweet 4: Additional Context
• Volume fading — early signs of distribution
• Small float → dilution hits harder

Tweet 5: Bull/Bear Framing
Bear thesis: Heavy red candle, fails to reclaim highs
Bull case: Strong volume breakout → ATM may pause

Tweet 6: CTA + Disclaimer
This isn't advice — just pattern recognition. 🦅
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
