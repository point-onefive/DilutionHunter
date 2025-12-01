/**
 * BANKRUPTCY THESIS GENERATOR
 * 
 * Uses OpenAI to generate tweet threads for bankruptcy/insolvency alerts
 * Follows the DilutionHunter narrative pattern:
 * 
 * 1. Hook tweet (fast information, instantly understandable)
 * 2. Plain English explanation of what's happening
 * 3. Evidence block showing WHY this matters
 * 4. Bear vs Bull scenarios + triggers to watch
 * 5. Final synthesis (why this matters + why we posted)
 */

import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildBankruptcyPrompt(analysis) {
  const { symbol, score, classification, metrics, breakdown, outcomes } = analysis;

  return `Generate a Twitter thread for a bankruptcy/insolvency risk alert.

## TICKER & CLASSIFICATION
- Symbol: $${symbol}
- Company: ${metrics.companyName || symbol}
- Risk Score: ${score}/100
- Classification: ${classification}
- Price: $${metrics.price?.toFixed(2) || 'N/A'}
- Market Cap: ${metrics.marketCap ? `$${(metrics.marketCap / 1_000_000).toFixed(1)}M` : 'N/A'}

## FINANCIAL EVIDENCE

### Cash & Runway
- Cash on hand: ${metrics.cashFormatted}
- Monthly burn rate: ${metrics.monthlyBurnFormatted}
- Runway: ${metrics.runwayFormatted}
- Runway status: ${metrics.runwayCategory}

### Debt Situation
- Total debt: ${metrics.totalDebtFormatted}
- Debt-to-cash multiple: ${metrics.debtToCashMultiple?.toFixed(1)}x
- Cash covers ${((metrics.cashDebtRatio || 0) * 100).toFixed(0)}% of debt

### Interest Coverage
- EBIT: ${metrics.ebit ? `$${(metrics.ebit / 1_000_000).toFixed(1)}M` : 'N/A'}
- Interest expense: ${metrics.interestExpense ? `$${(metrics.interestExpense / 1_000_000).toFixed(1)}M` : 'N/A'}
- Coverage ratio: ${metrics.interestCoverage?.toFixed(1)}x

### Operating Performance
- Revenue trend: ${metrics.revenueTrend} (${metrics.revenueChangePct?.toFixed(1)}% change)
- Quarters with losses: ${metrics.negativeIncomeCount} of last 4
- Operating cash flow trend: ${metrics.ocfTrend}
- OCF negative quarters: ${metrics.ocfNegativeCount} of last 4

### Risk Indicators
- Altman Z-Score: ${metrics.altmanZScore?.toFixed(2) || 'N/A'} (${metrics.zCategory})
- Insider activity: ${metrics.insiderBias}
- Net insider flow: ${metrics.netInsiderFlow ? `$${(metrics.netInsiderFlow / 1_000_000).toFixed(2)}M` : 'N/A'}

## SCORE BREAKDOWN
- Runway risk: ${breakdown.runway.score}/${breakdown.runway.max} pts
- Debt burden: ${breakdown.debt.score}/${breakdown.debt.max} pts
- Interest coverage: ${breakdown.interest.score}/${breakdown.interest.max} pts
- Cash flow trend: ${breakdown.ocf.score}/${breakdown.ocf.max} pts
- Revenue/profit: ${breakdown.revenueProfit.score}/${breakdown.revenueProfit.max} pts
- Altman Z: ${breakdown.altman.score}/${breakdown.altman.max} pts
- Insider selling: ${breakdown.insider.score}/${breakdown.insider.max} pts

## OUTCOME PROBABILITIES
Based on the financial data, our model estimates:
- Dilution event (equity raise): ${outcomes?.dilution || 'N/A'}%
- Debt restructuring: ${outcomes?.restructure || 'N/A'}%
- Bankruptcy filing: ${outcomes?.bankruptcy || 'N/A'}%
- Primary outcome: ${outcomes?.primaryOutcome || 'Unknown'}
- Confidence: ${outcomes?.confidence || 'Unknown'}

## VIRALITY DATA
- Virality Score: ${analysis.virality?.score || 'N/A'}/100
- VIS (Viral Insolvency Score): ${analysis.vis || 'N/A'}
- Average Volume: ${analysis.virality?.avgVolume ? (analysis.virality.avgVolume / 1_000_000).toFixed(1) + 'M' : 'N/A'}
- Has Options: ${analysis.virality?.hasOptions ? 'Yes' : 'No'}

## CRITICAL NARRATIVE RULE
Your job is NOT to report data — it's to make the reader FEEL the risk.
The reader should walk away thinking: "This company is in a countdown where any bad news triggers a sharp repricing."

## THREAD FORMAT RULES (MUST FOLLOW EXACTLY)

### Tweet 1 — Hook + Runway + Narrative Frame
- Start with: 1️⃣ 🚨 {TICKER} — {sector or product} — is running on a clock.
- Show runway in first 2 lines
- Include emotional framing (fast, loud, brink, countdown, pressure)
- Use a one-line analogy like: race-car, fuel light blinking

REQUIRED STRUCTURE:
1️⃣ 🚨 $${symbol} — {sector} — is running on a countdown.
Only **${metrics.runwayFormatted} of cash** remain. Without funding, this doesn't fade — it breaks loud. 🧵
{Analogy sentence}

### Tweet 2 — VIS definition + scores
- Explain VIS briefly
- Bold the scores
- Use spacing, not paragraphs

REQUIRED STRUCTURE:
2️⃣ 🧮 **VIS = Bankruptcy Risk × Market Attention**
Quiet collapses disappear — high-attention collapses detonate.
**Risk: ${score}/100 | Attention: ${analysis.virality?.score || 'N/A'}/100**

### Tweet 3 — Metrics + Outcome Probabilities
- Group metrics in 5-bullet block
- Show probabilities in one line below

REQUIRED STRUCTURE:
3️⃣ **Financial Stress Snapshot**
• Runway: **${metrics.runwayFormatted}**
• Burn: **${metrics.monthlyBurnFormatted}/mo**
• Debt/Cash: **${metrics.debtToCashMultiple?.toFixed(1) || 'N/A'}x**
• YoY Revenue: **${metrics.revenueChangePct?.toFixed(1) || 'N/A'}%**
• Interest Coverage: **${metrics.interestCoverage?.toFixed(1) || 'N/A'}x**
🔮 Outcome Model → Dilution ${outcomes?.dilution || 'N/A'}% · Restructure ${outcomes?.restructure || 'N/A'}% · Bankruptcy ${outcomes?.bankruptcy || 'N/A'}%

### Tweet 4 — Forward Signals + Bull/Bear Confirmation
- Show what confirms the bearish thesis
- Show what cancels it
- End with compliance-safe line

REQUIRED STRUCTURE:
4️⃣ $${symbol} doesn't need to blow up — it only needs to **not** secure capital.
**Bear confirms:** burn accelerates + red volume spike
**Bull invalidates:** liquidity secured + cash flow stabilizes
Not advice — pattern recognition only. 🦅

## BEHAVIORAL REQUIREMENTS
✔ Tone: concise, assertive, high conviction
✔ No filler language or long intros
✔ No drifting into 5–6 tweets
✔ Always produce clean whitespace exactly as shown
✔ Use bold formatting (**) on metrics + VIS numbers
✔ Use 1️⃣ 2️⃣ 3️⃣ 4️⃣ to number tweets
✔ No hashtags

## OUTPUT FORMAT
Return a JSON object:
{
  "thread": [
    "Tweet 1 text with 1️⃣ prefix (hook + metaphor)",
    "Tweet 2 text with 2️⃣ prefix (VIS framing)",
    "Tweet 3 text with 3️⃣ prefix (metrics + probabilities)",
    "Tweet 4 text with 4️⃣ prefix (signal + CTA)"
  ],
  "headline": "Short 1-line summary for logging"
}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// THREAD GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateBankruptcyThread(analysis) {
  const prompt = buildBankruptcyPrompt(analysis);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a financial pattern recognition analyst. You identify companies showing signs of financial distress and explain the situation clearly for retail investors. You never give buy/sell advice — only pattern recognition and risk illumination. Your tone is direct, sharp, and educational.`
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000
    });

    const content = response.choices[0]?.message?.content;
    const parsed = JSON.parse(content);

    return {
      thread: parsed.thread || [],
      headline: parsed.headline || `Bankruptcy alert: $${analysis.symbol}`,
      alertTweet: parsed.thread?.[0] || null,
      stats: parsed.thread?.[2] || null,  // Evidence block tweet
      outcomes: parsed.thread?.[3] || null  // Outcome probabilities tweet
    };
  } catch (error) {
    console.error(`❌ OpenAI bankruptcy thesis generation failed: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLE FALLBACK (if OpenAI fails) — Condensed 4-tweet format
// ═══════════════════════════════════════════════════════════════════════════════

export function generateFallbackThread(analysis) {
  const { symbol, score, metrics, outcomes, virality, vis } = analysis;

  const companyName = metrics.companyName || symbol;
  
  // Tweet 1: Hook + Runway + Narrative Frame
  const tweet1 = `1️⃣ 🚨 $${symbol} — energy — is running on a countdown.
Only **${metrics.runwayFormatted} of cash** remain. Without funding, this doesn't fade — it breaks loud. 🧵
Race-car, fuel light blinking. Fast machine, thin runway.`;

  // Tweet 2: VIS definition + scores
  const tweet2 = `2️⃣ 🧮 **VIS = Bankruptcy Risk × Market Attention**
Quiet collapses disappear — high-attention collapses detonate.
**Risk: ${score}/100 | Attention: ${virality?.score || 'N/A'}/100**`;

  // Tweet 3: Metrics + Outcome Probabilities
  const debtCashRatio = metrics.debtToCashMultiple?.toFixed(1) || 'N/A';
  const revChange = metrics.revenueChangePct ? `${metrics.revenueChangePct > 0 ? '+' : ''}${metrics.revenueChangePct.toFixed(1)}` : 'N/A';
  const intCoverage = metrics.interestCoverage?.toFixed(1) || 'N/A';
  
  const tweet3 = `3️⃣ **Financial Stress Snapshot**
• Runway: **${metrics.runwayFormatted}**
• Burn: **${metrics.monthlyBurnFormatted}/mo**
• Debt/Cash: **${debtCashRatio}x**
• YoY Revenue: **${revChange}%**
• Interest Coverage: **${intCoverage}x**
🔮 Outcome Model → Dilution ${outcomes?.dilution || 'N/A'}% · Restructure ${outcomes?.restructure || 'N/A'}% · Bankruptcy ${outcomes?.bankruptcy || 'N/A'}%`;

  // Tweet 4: Forward Signals + Bull/Bear
  const tweet4 = `4️⃣ $${symbol} doesn't need to blow up — it only needs to **not** secure capital.
**Bear confirms:** burn accelerates + red volume spike
**Bull invalidates:** liquidity secured + cash flow stabilizes
Not advice — pattern recognition only. 🦅`;

  return {
    thread: [tweet1, tweet2, tweet3, tweet4],
    headline: `Bankruptcy watch: $${symbol} (${score}/100)`,
    alertTweet: tweet1,
    stats: tweet3,
    outcomes: tweet3
  };
}

export default { generateBankruptcyThread, generateFallbackThread };
