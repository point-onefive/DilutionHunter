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

## THREAD STRUCTURE (6 tweets) — Compressed for retention

### Tweet 1: HOOK (Market Impact Framing)
- Start with 🚨 
- MUST include both TICKER ($${symbol}) AND COMPANY NAME (${metrics.companyName || symbol}) for search visibility
- Frame WHY THIS MATTERS TO TRADERS, not just the company
- Include key stat (runway) and market reaction framing
- End with 🧵

GOOD EXAMPLES:
- "🚨 Beyond Meat $BYND is burning cash fast — only 9.1 months of runway left. If financing doesn't arrive, the market won't ignore this. 🧵"
- "🚨 Beyond Meat $BYND has less than one year of oxygen left. If financing fails, this doesn't fade quietly — it snaps. 🧵"

BAD: "Company is on our watchlist" (too passive, no stakes)

### Tweet 2: VISUAL METAPHOR
- ONE vivid analogy that creates tension
- Make the reader FEEL the urgency, not just understand it
- Short, punchy, visceral

GOOD EXAMPLE:
"Think of a car at high speed with the fuel light flashing. Debt is heavy, cash is thin, and the distance left is short."

BAD: "The company has financial difficulties" (boring, no imagery)

### Tweet 3: VIS EXPLANATION (WHY THIS TICKER MATTERS)
This tweet explains why we're flagging THIS specific ticker. Frame toward trader reward:

"🧮 VIS = Bankruptcy risk × Market attention

Quiet failures don't matter — loud ones move markets.

Risk Score: ${score}/100
Attention Score: ${analysis.virality?.score || 'N/A'}/100"

The point: High risk + high attention = where big moves happen.

### Tweet 4: COMBINED BRIEFING (Evidence + Probabilities)
COMBINE metrics and outcome probabilities into ONE tweet for better pacing:

"📊 Key Stressors:
• Runway: X months
• Burn: $X/month  
• Debt/Cash: Xx
• Revenue: X%
• Interest coverage: Xx

🔮 Probabilities:
• Restructure: X%
• Dilution: X%
• Bankruptcy: X%"

This is the DATA tweet. Keep it tight — no explanations here.

### Tweet 5: MARKET REACTION THESIS
Explain what happens price-wise if distress escalates. This translates macro → trade psychology:

"If financing fails, liquidity gaps and spreads widen fast.
Distress events don't sell off slowly — they reprice suddenly.

Bear confirms if burn accelerates.
Bull invalidates if cash flow stabilizes."

This is your EDGE — very few accounts explain WHY the move matters.

### Tweet 6: FINAL READ + WATCH TRIGGER
- One-sentence synthesis: high-attention, high-risk distress story
- Add a watch trigger line (actionable insight without being advice)
- End with: "Not advice — pattern recognition only."

EXAMPLE:
"$BYND remains a high-attention, high-risk distress story.
Watching for: heavy red day + volume spike. That's when distress gets priced.
Not advice — pattern recognition only."

## FORMATTING RULES
- Use 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ to number tweets
- No hashtags
- No character limit concerns
- Be direct and sharp, not hype-y
- This is risk illumination, not a call to action

## OUTPUT FORMAT
Return a JSON object:
{
  "thread": [
    "Tweet 1 text with 1️⃣ prefix (hook)",
    "Tweet 2 text with 2️⃣ prefix (metaphor)",
    "Tweet 3 text with 3️⃣ prefix (VIS explanation)",
    "Tweet 4 text with 4️⃣ prefix (combined briefing: metrics + probabilities)",
    "Tweet 5 text with 5️⃣ prefix (market reaction thesis + scenarios)",
    "Tweet 6 text with 6️⃣ prefix (final read + watch trigger)"
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
// SIMPLE FALLBACK (if OpenAI fails) — Compressed 6-tweet format
// ═══════════════════════════════════════════════════════════════════════════════

export function generateFallbackThread(analysis) {
  const { symbol, score, metrics, outcomes, virality, vis } = analysis;

  const companyName = metrics.companyName || symbol;
  const tweet1 = `1️⃣ 🚨 ${companyName} $${symbol} is burning cash fast — only ${metrics.runwayFormatted} of runway left.
If financing doesn't arrive, the market won't ignore this. 🧵`;

  const tweet2 = `2️⃣ Think of a car at high speed with the fuel light flashing.
Debt is heavy, cash is thin, and the distance left is short.`;

  const tweet3 = `3️⃣ 🧮 VIS = Bankruptcy risk × Market attention

Quiet failures don't matter — loud ones move markets.

Risk Score: ${score}/100
Attention Score: ${virality?.score || 'N/A'}/100`;

  // Combined briefing: metrics + probabilities
  const tweet4 = `4️⃣ 📊 Key Stressors:
• Runway: ${metrics.runwayFormatted}
• Burn: ${metrics.monthlyBurnFormatted}/month
• Debt/Cash: ${metrics.debtToCashMultiple?.toFixed(1)}x
• Revenue: ${metrics.revenueChangePct ? `${metrics.revenueChangePct > 0 ? '+' : ''}${metrics.revenueChangePct?.toFixed(1)}%` : 'N/A'}
• Interest coverage: ${metrics.interestCoverage?.toFixed(1)}x

🔮 Probabilities:
• Restructure: ${outcomes?.restructure || 'N/A'}%
• Dilution: ${outcomes?.dilution || 'N/A'}%
• Bankruptcy: ${outcomes?.bankruptcy || 'N/A'}%`;

  // Market reaction thesis + scenarios
  const tweet5 = `5️⃣ If financing fails, liquidity gaps widen fast.
Distress events don't sell off slowly — they reprice suddenly.

Bear confirms if burn accelerates.
Bull invalidates if cash flow stabilizes.`;

  const tweet6 = `6️⃣ ${companyName} $${symbol} remains a high-attention, high-risk distress story.
Watching for: heavy red day + volume spike. That's when distress gets priced.
Not advice — pattern recognition only.`;

  return {
    thread: [tweet1, tweet2, tweet3, tweet4, tweet5, tweet6],
    headline: `Bankruptcy watch: $${symbol} (${score}/100)`,
    alertTweet: tweet1,
    stats: tweet4,
    outcomes: tweet4
  };
}

export default { generateBankruptcyThread, generateFallbackThread };
