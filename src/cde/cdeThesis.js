/**
 * CDE THESIS GENERATOR - Critical Distress Event Thread
 * 
 * Generates viral Twitter threads for CDE events.
 * 
 * The CDE format is the MOST VIRAL format because it shows CONVERGENCE:
 * - Not just one red flag
 * - Multiple independent failure signals aligning
 * - A company entering financial death spiral territory
 * 
 * Format (5 tweets):
 * 1. 🔥 Hook - CDE announcement with convergence framing
 * 2. 🔫 Dilution Evidence - What mechanism is active
 * 3. 🏚  Insolvency Evidence - The financial cliff
 * 4. 📢 Market Setup - Why this will reprice violently
 * 5. 🎯 Watchlist Close - What confirms the thesis
 */

import OpenAI from 'openai';
import 'dotenv/config';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate CDE thread using OpenAI
 */
export async function generateCDEThread(cdeData) {
  const {
    symbol,
    cdeIntensity,
    bankruptcyScore,
    vis,
    viralityScore,
    dilution,
    analysis
  } = cdeData;

  const metrics = analysis?.metrics || {};
  
  const prompt = `You are a sharp financial analyst who detects when multiple failure signals converge on distressed companies. Write a 5-tweet thread about a CRITICAL DISTRESS EVENT (CDE) — where dilution risk, bankruptcy risk, and market attention ALL align at once.

TICKER: $${symbol}
COMPANY: ${metrics.companyName || symbol}

═══════════════════════════════════════════════════════════════
🔥 CDE METRICS (Convergence Signals)
═══════════════════════════════════════════════════════════════

CDE Intensity: ${cdeIntensity}/100
Bankruptcy Risk Score: ${bankruptcyScore}/100
VIS (Viral Insolvency Score): ${vis}/100
Virality Score: ${viralityScore}/100

DILUTION SIGNAL:
- Active Mechanism: ${dilution.hasActiveMechanism ? 'YES' : 'NO'}
- Recent Filings (180 days): ${dilution.recentFilings}
- Total Offerings: ${dilution.offeringCount}

INSOLVENCY SIGNAL:
- Cash: ${metrics.cashFormatted || 'N/A'}
- Monthly Burn: ${metrics.monthlyBurnFormatted || 'N/A'}
- Runway: ${metrics.runwayFormatted || 'N/A'}
- Debt: ${metrics.totalDebtFormatted || 'N/A'}
- Debt-to-Cash: ${metrics.debtToCashMultiple?.toFixed(1) || 'N/A'}x
- OCF Trend: ${metrics.ocfTrend || 'N/A'}
- Revenue Trend: ${metrics.revenueTrend || 'N/A'} (${metrics.revenueChangePct?.toFixed(1) || 0}%)

═══════════════════════════════════════════════════════════════
📝 THREAD FORMAT (5 tweets, each under 275 chars)
═══════════════════════════════════════════════════════════════

Tweet 1 - THE CDE HOOK:
Start with: "🔥 CRITICAL DISTRESS EVENT — ${metrics.companyName || symbol} $${symbol}"
MUST include BOTH company name AND ticker for search visibility
Emphasize that MULTIPLE scanners triggered (Dilution + Bankruptcy + High VIS)
Frame: "This isn't decay — it's convergence"
Make it clear this is rare (scanners don't usually align like this)

Tweet 2 - THE DILUTION EVIDENCE:
Lead with the dilution mechanism (ATM, shelf, recent filings)
Show they NEED cash (this isn't optional dilution)
Use visual metaphor: "loading the printer", "ammunition ready", etc.

Tweet 3 - THE INSOLVENCY EVIDENCE:
Lead with runway (${metrics.runwayFormatted || 'critical'})
Stack the debt/burn/cash numbers
Use visceral framing: "financial cliff", "bleeding cash", "walls closing in"
Make it tangible, not abstract

Tweet 4 - THE MARKET SETUP:
Why this reprices VIOLENTLY (not slowly)
Connect dilution + insolvency + attention = trapped holders
"Distress events don't sell off slowly — they gap down"
Reference the high VIS score (people are watching)

Tweet 5 - THE WATCHLIST CLOSE:
End with: "On the CDE watchlist. 👁️"
Include what would CONFIRM the thesis (a filing, earnings miss, another ATM)
NOT financial advice disclaimer
Keep it tight and memorable

═══════════════════════════════════════════════════════════════
🎯 STYLE REQUIREMENTS
═══════════════════════════════════════════════════════════════

- Each tweet MUST be under 275 characters
- Use emojis sparingly but effectively (🔥 🚨 📉 💀 ⚠️ 👁️)
- No hashtags
- Visceral, visual language (not corporate speak)
- Thesis-driven (show WHY this matters, not just data)
- The hook must make people STOP scrolling
- This is analysis, not advice — frame as observation

Return ONLY the 5 tweets, separated by "---" on its own line.
No tweet numbers, no explanations, just raw tweet content.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an elite financial analyst known for detecting convergence events where multiple failure signals align. Your threads go viral because you show the COLLISION of risks, not just individual red flags. Write punchy, visual, thesis-driven content. Never exceed 275 characters per tweet.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse tweets
    const tweets = content
      .split('---')
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length <= 280);

    if (tweets.length < 4) {
      console.warn('OpenAI returned fewer than expected tweets, using fallback');
      return generateFallbackCDEThread(cdeData);
    }

    return tweets;
  } catch (error) {
    console.error('OpenAI CDE thread generation failed:', error.message);
    return generateFallbackCDEThread(cdeData);
  }
}

/**
 * Fallback thread if OpenAI fails
 */
function generateFallbackCDEThread(cdeData) {
  const { symbol, bankruptcyScore, vis, dilution, analysis } = cdeData;
  const metrics = analysis?.metrics || {};
  const companyName = metrics.companyName || symbol;
  
  return [
    `🔥 CRITICAL DISTRESS EVENT — ${companyName} $${symbol}

This ticker triggered BOTH scanners:
• Dilution Hunter 🔫 (active mechanism)
• Bankruptcy Watchdog 🏚 (${bankruptcyScore}/100 risk)
• VIS ${vis}/100 → people are watching

This isn't quiet decay — this is convergence.`,

    `🔫 THE DILUTION SETUP

${companyName} $${symbol} has ${dilution.recentFilings} recent filing(s) in the last 180 days.

When a distressed company files ATM/shelf offerings, they're not planning growth.

They're loading the printer. 🖨️`,

    `🏚 THE INSOLVENCY CLIFF

• Cash: ${metrics.cashFormatted || 'Low'}
• Monthly burn: ${metrics.monthlyBurnFormatted || 'High'}
• Runway: ${metrics.runwayFormatted || 'Critical'}
• Debt: ${metrics.totalDebtFormatted || 'Heavy'}

The math doesn't work without new capital — and we know what that means.`,

    `📢 THE MARKET SETUP

VIS Score: ${vis}/100 — retail is watching.
Bankruptcy Risk: ${bankruptcyScore}/100

Distress events don't sell off slowly.
They gap down when dilution hits or guidance dies.

The convergence is the signal.`,

    `On the CDE watchlist. 👁️

What confirms: Another filing, earnings miss, or guidance cut.

This is analysis, not advice — I'm just watching where the math leads.

${companyName} $${symbol}`
  ];
}

export default { generateCDEThread };
