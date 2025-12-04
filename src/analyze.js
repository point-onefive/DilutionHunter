/**
 * TICKER ANALYZER — Quick Health Check
 * 
 * Analyze any ticker(s) for dilution and bankruptcy risk.
 * 
 * Usage:
 *   node src/analyze.js ET DOC MULN     # Analyze multiple tickers
 *   node src/analyze.js FFIE            # Analyze single ticker
 */

import 'dotenv/config';
import { fetchBankruptcyInputs, fetchViralityInputs } from './bankruptcy/fmpBankruptcy.js';
import { scoreWithVIS } from './bankruptcy/bankruptcyScoreEngine.js';
import { getRecentATMFilings } from './atmScanner.js';

const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';

async function fmpGet(endpoint) {
  const url = `${FMP_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function analyzeTicker(ticker) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 ANALYZING $${ticker}`);
  console.log('═'.repeat(70));

  // Fetch all data in parallel
  const [profile, quote, bankruptcyData, viralityData] = await Promise.all([
    fmpGet(`/profile?symbol=${ticker}`),
    fmpGet(`/quote?symbol=${ticker}`),
    fetchBankruptcyInputs(ticker),
    fetchViralityInputs(ticker)
  ]);

  const p = Array.isArray(profile) ? profile[0] : profile;
  const q = Array.isArray(quote) ? quote[0] : quote;

  if (!p || !q) {
    console.log(`\n❌ Could not fetch data for ${ticker}`);
    return null;
  }

  // Basic info
  console.log(`\n📋 COMPANY INFO`);
  console.log(`   Name: ${p.companyName || 'N/A'}`);
  console.log(`   Sector: ${p.sector || 'N/A'}`);
  console.log(`   Industry: ${p.industry || 'N/A'}`);
  console.log(`   Exchange: ${p.exchangeShortName || 'N/A'}`);

  // Price & Market
  console.log(`\n💰 MARKET DATA`);
  console.log(`   Price: $${q.price?.toFixed(2) || 'N/A'}`);
  console.log(`   Market Cap: $${(q.marketCap / 1e9)?.toFixed(2)}B`);
  console.log(`   Avg Volume: ${((q.avgVolume || 0) / 1e6)?.toFixed(2)}M`);
  console.log(`   52W High: $${q.yearHigh?.toFixed(2) || 'N/A'}`);
  console.log(`   52W Low: $${q.yearLow?.toFixed(2) || 'N/A'}`);
  const offHigh = q.yearHigh ? ((q.price - q.yearHigh) / q.yearHigh * 100).toFixed(1) : 'N/A';
  console.log(`   Off 52W High: ${offHigh}%`);

  // Financial Health
  console.log(`\n🏦 FINANCIAL HEALTH`);
  if (bankruptcyData) {
    const cash = bankruptcyData.cash || 0;
    const debt = bankruptcyData.totalDebt || 0;
    const ocf = bankruptcyData.operatingCashFlow || 0;
    const monthlyBurn = bankruptcyData.monthlyBurn || 0;
    const runway = bankruptcyData.runwayMonths || 0;
    
    console.log(`   Cash: $${(cash / 1e6)?.toFixed(1)}M`);
    console.log(`   Total Debt: $${(debt / 1e6)?.toFixed(1)}M`);
    console.log(`   Debt/Cash Ratio: ${cash > 0 ? (debt / cash).toFixed(2) : 'N/A'}x`);
    console.log(`   Operating Cash Flow: $${(ocf / 1e6)?.toFixed(1)}M`);
    console.log(`   Monthly Burn: $${(monthlyBurn / 1e6)?.toFixed(2)}M/mo`);
    console.log(`   Cash Runway: ${runway > 24 ? '24+' : runway.toFixed(1)} months`);
    console.log(`   Quick Ratio: ${bankruptcyData.quickRatio?.toFixed(2) || 'N/A'}`);
    console.log(`   Current Ratio: ${bankruptcyData.currentRatio?.toFixed(2) || 'N/A'}`);
  } else {
    console.log(`   ⚠️ Could not fetch financial data`);
  }

  // Bankruptcy Risk Score
  console.log(`\n💀 BANKRUPTCY RISK ANALYSIS`);
  if (bankruptcyData) {
    try {
      // Merge with defaults for missing virality data
      const combined = {
        ...bankruptcyData,
        avgVolume: viralityData?.avgVolume || q?.avgVolume || 0,
        volume: viralityData?.volume || q?.volume || 0,
        marketCap: viralityData?.marketCap || q?.marketCap || 0,
        newsCount: viralityData?.newsCount || 0,
        socialMentions: viralityData?.socialMentions || 0
      };
      const visResult = scoreWithVIS(combined);
      console.log(`   Bankruptcy Risk Score: ${visResult.bankruptcyScore}/100`);
      console.log(`   Virality Score: ${visResult.viralityScore}/100`);
      console.log(`   VIS (Combined): ${visResult.vis}/100`);
      
      let riskLevel = 'LOW';
      let riskEmoji = '✅';
      if (visResult.bankruptcyScore >= 70) { riskLevel = 'CRITICAL'; riskEmoji = '🔴'; }
      else if (visResult.bankruptcyScore >= 50) { riskLevel = 'HIGH'; riskEmoji = '🟠'; }
      else if (visResult.bankruptcyScore >= 30) { riskLevel = 'MODERATE'; riskEmoji = '🟡'; }
      
      console.log(`   Risk Level: ${riskEmoji} ${riskLevel}`);
      
      // Breakdown
      if (visResult.breakdown) {
        console.log(`\n   Risk Factors:`);
        const b = visResult.breakdown;
        if (b.burnRisk) console.log(`   • Burn Rate Risk: ${b.burnRisk}/20`);
        if (b.runwayRisk) console.log(`   • Runway Risk: ${b.runwayRisk}/25`);
        if (b.debtRisk) console.log(`   • Debt Risk: ${b.debtRisk}/20`);
        if (b.liquidityRisk) console.log(`   • Liquidity Risk: ${b.liquidityRisk}/15`);
        if (b.ocfRisk) console.log(`   • Cash Flow Risk: ${b.ocfRisk}/10`);
        if (b.marketCapRisk) console.log(`   • Market Cap Risk: ${b.marketCapRisk}/10`);
      }
    } catch (e) {
      console.log(`   ⚠️ Error calculating risk: ${e.message}`);
    }
  } else {
    console.log(`   ⚠️ Could not calculate bankruptcy risk`);
  }

  // Check for ATM filings
  console.log(`\n🔫 DILUTION CHECK (ATM Filings)`);
  const atmFilings = await getRecentATMFilings(90);
  const tickerFilings = atmFilings.filter(f => f.ticker === ticker);
  
  if (tickerFilings.length > 0) {
    console.log(`   ⚠️ ACTIVE ATM FOUND`);
    tickerFilings.forEach(f => {
      console.log(`   • Filed: ${f.filedAt}`);
      console.log(`     Form: ${f.formType}`);
      console.log(`     Days ago: ${f.daysSinceFiling || 'N/A'}`);
    });
  } else {
    console.log(`   ✅ No ATM filings in last 90 days`);
  }

  // Overall Verdict
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📋 VERDICT FOR $${ticker}`);
  
  const issues = [];
  if (bankruptcyData) {
    try {
      const combined = {
        ...bankruptcyData,
        avgVolume: viralityData?.avgVolume || q?.avgVolume || 0,
        volume: viralityData?.volume || q?.volume || 0,
        marketCap: viralityData?.marketCap || q?.marketCap || 0,
        newsCount: viralityData?.newsCount || 0,
        socialMentions: viralityData?.socialMentions || 0
      };
      const visResult = scoreWithVIS(combined);
      if (visResult.bankruptcyScore >= 50) issues.push(`High bankruptcy risk (${visResult.bankruptcyScore}/100)`);
    } catch (e) { /* ignore scoring errors */ }
    if (bankruptcyData.runwayMonths && bankruptcyData.runwayMonths < 6) issues.push(`Low cash runway (${bankruptcyData.runwayMonths?.toFixed(1)}mo)`);
    if (bankruptcyData.totalDebt && bankruptcyData.cash && bankruptcyData.totalDebt > bankruptcyData.cash * 5) issues.push(`High debt/cash ratio`);
  }
  if (tickerFilings.length > 0) issues.push(`Active ATM filing (dilution risk)`);
  
  if (issues.length === 0) {
    console.log(`   ✅ NO MAJOR RED FLAGS DETECTED`);
    console.log(`   This ticker does not show significant dilution or bankruptcy risk.`);
  } else {
    console.log(`   ⚠️ RED FLAGS DETECTED:`);
    issues.forEach(i => console.log(`   • ${i}`));
  }

  return {
    ticker,
    companyName: p.companyName,
    price: q.price,
    marketCap: q.marketCap,
    bankruptcyData,
    viralityData,
    atmFilings: tickerFilings,
    issues
  };
}

async function main() {
  const tickers = process.argv.slice(2).map(t => t.toUpperCase().replace('$', ''));
  
  if (tickers.length === 0) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  TICKER ANALYZER — Quick Health Check                                         ║
╚═══════════════════════════════════════════════════════════════════════════════╝

Usage:
  node src/analyze.js <TICKER> [TICKER2] [TICKER3] ...

Examples:
  node src/analyze.js FFIE           # Single ticker
  node src/analyze.js ET DOC MULN    # Multiple tickers

Checks:
  • Company info & market data
  • Financial health (cash, debt, burn rate, runway)
  • Bankruptcy risk score (0-100)
  • ATM filings (dilution risk)
  • Overall verdict
`);
    process.exit(0);
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  TICKER ANALYZER — Quick Health Check                                         ║
║  ${new Date().toISOString()}                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝`);

  console.log(`\n🎯 Analyzing ${tickers.length} ticker(s): ${tickers.join(', ')}`);

  for (const ticker of tickers) {
    await analyzeTicker(ticker);
    if (tickers.length > 1) {
      await new Promise(r => setTimeout(r, 500)); // Rate limit between tickers
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`✅ Analysis complete`);
}

main().catch(e => { console.error(e); process.exit(1); });
