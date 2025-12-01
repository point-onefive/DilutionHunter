/**
 * BANKRUPTCY CARD GENERATOR v2
 * 
 * Professional financial dashboard card for bankruptcy alerts
 * Design: Bloomberg/Koyfin-grade visual hierarchy
 * 
 * Layout:
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  📉 BANKRUPTCY RISK REPORT                              [VIS: 74]   │
 * │      $PLUG · Plug Power Inc.                                        │
 * │  ─────────────────────────────────────────────────────────────────  │
 * │                                                                      │
 * │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐        │
 * │  │ ⚠️ RUNWAY       │ │ 💰 DEBT RATIO   │ │ 🔥 BURN RATE    │        │
 * │  │   5.5 months    │ │   6.0x          │ │   $29.9M/mo     │        │
 * │  │          🔴     │ │          🔴     │ │          🟠     │        │
 * │  └─────────────────┘ └─────────────────┘ └─────────────────┘        │
 * │                                                                      │
 * │  ┌─────────────────────────────────────────────────────────────┐    │
 * │  │  INSOLVENCY PROBABILITY MODEL                               │    │
 * │  │  Bankruptcy   ████████░░░░░░░░░░░░░░░░░░  25%               │    │
 * │  │  Restructure  ██████████████░░░░░░░░░░░░  35%               │    │
 * │  │  Dilution     ████████████████░░░░░░░░░░  40%  ✓ Most      │    │
 * │  └─────────────────────────────────────────────────────────────┘    │
 * │                                                                      │
 * │  ⚠️ DETERIORATING                          @DilutionHunter · NFA   │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import 'dotenv/config';
import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'output', 'cards');

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR PALETTE - Professional Financial Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

const COLORS = {
  // Backgrounds
  bg: '#0E1116',
  cardBg: '#1A1F26',
  panelBg: '#141920',
  
  // Text hierarchy
  textPrimary: '#FFFFFF',
  textSecondary: '#B8C0CC',
  textMuted: '#6B7280',
  textDim: '#4B5563',
  
  // Accent colors
  gold: '#D8AB4C',
  goldDim: '#A68A3A',
  
  // Status colors (muted, professional)
  red: '#DC4A4A',
  redBg: 'rgba(220, 74, 74, 0.15)',
  orange: '#E09040',
  orangeBg: 'rgba(224, 144, 64, 0.15)',
  yellow: '#D4A84B',
  yellowBg: 'rgba(212, 168, 75, 0.15)',
  green: '#4CAF6A',
  greenBg: 'rgba(76, 175, 106, 0.15)',
  
  // Progress bars
  barBg: '#252D38',
  barRed: '#C45050',
  barOrange: '#D4863C',
  barGreen: '#4A9E5E',
  
  // Borders
  border: '#2D3542',
  borderLight: '#3D4552',
  divider: '#252D38',
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const getRunwayStatus = (months) => {
  if (months <= 6) return { color: COLORS.red, bg: COLORS.redBg, dot: '🔴', label: 'CRITICAL' };
  if (months <= 12) return { color: COLORS.orange, bg: COLORS.orangeBg, dot: '🟠', label: 'WARNING' };
  if (months <= 18) return { color: COLORS.yellow, bg: COLORS.yellowBg, dot: '🟡', label: 'WATCH' };
  return { color: COLORS.green, bg: COLORS.greenBg, dot: '🟢', label: 'STABLE' };
};

const getDebtRatioStatus = (ratio) => {
  if (ratio >= 5) return { color: COLORS.red, bg: COLORS.redBg, dot: '🔴', label: 'CRITICAL' };
  if (ratio >= 3) return { color: COLORS.orange, bg: COLORS.orangeBg, dot: '🟠', label: 'WARNING' };
  if (ratio >= 1.5) return { color: COLORS.yellow, bg: COLORS.yellowBg, dot: '🟡', label: 'WATCH' };
  return { color: COLORS.green, bg: COLORS.greenBg, dot: '🟢', label: 'STABLE' };
};

const getBurnStatus = (burnM) => {
  if (burnM >= 25) return { color: COLORS.red, bg: COLORS.redBg, dot: '🔴', label: 'CRITICAL' };
  if (burnM >= 15) return { color: COLORS.orange, bg: COLORS.orangeBg, dot: '🟠', label: 'WARNING' };
  if (burnM >= 8) return { color: COLORS.yellow, bg: COLORS.yellowBg, dot: '🟡', label: 'WATCH' };
  return { color: COLORS.green, bg: COLORS.greenBg, dot: '🟢', label: 'STABLE' };
};

const getTrendSignal = (score) => {
  if (score >= 70) return { color: COLORS.red, bg: COLORS.redBg, label: 'CRITICAL', icon: '🚨' };
  if (score >= 50) return { color: COLORS.orange, bg: COLORS.orangeBg, label: 'DETERIORATING', icon: '⚠️' };
  if (score >= 30) return { color: COLORS.yellow, bg: COLORS.yellowBg, label: 'ELEVATED', icon: '📊' };
  return { color: COLORS.green, bg: COLORS.greenBg, label: 'STABLE', icon: '✅' };
};

// ═══════════════════════════════════════════════════════════════════════════════
// DRAWING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawProgressBar(ctx, x, y, width, height, percent, fillColor, bgColor = COLORS.barBg) {
  // Background
  ctx.fillStyle = bgColor;
  drawRoundedRect(ctx, x, y, width, height, height / 2);
  ctx.fill();
  
  // Fill with gradient
  const fillWidth = Math.max(height, Math.min(width * (percent / 100), width));
  if (fillWidth > 0) {
    const gradient = ctx.createLinearGradient(x, y, x + fillWidth, y);
    gradient.addColorStop(0, fillColor);
    gradient.addColorStop(1, fillColor + 'CC');
    ctx.fillStyle = gradient;
    drawRoundedRect(ctx, x, y, fillWidth, height, height / 2);
    ctx.fill();
  }
}

function drawMetricCard(ctx, x, y, width, height, icon, label, value, status) {
  // Card background
  ctx.fillStyle = COLORS.cardBg;
  drawRoundedRect(ctx, x, y, width, height, 12);
  ctx.fill();
  
  // Subtle border
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Status indicator bar at top
  ctx.fillStyle = status.color;
  drawRoundedRect(ctx, x, y, width, 4, [12, 12, 0, 0]);
  ctx.fill();
  
  // Icon + Label
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`${icon}  ${label}`, x + 20, y + 36);
  
  // Value
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.fillText(value, x + 20, y + 72);
  
  // Status dot (bottom right)
  ctx.fillStyle = status.color;
  ctx.font = '400 18px -apple-system';
  ctx.textAlign = 'right';
  ctx.fillText(status.dot, x + width - 16, y + height - 16);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CARD GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateBankruptcyCard(analysis) {
  ensureOutputDir();
  
  const { symbol, score, metrics, outcomes, virality, vis } = analysis;
  const companyName = metrics.companyName || symbol;
  
  // Canvas dimensions (Twitter optimal 16:9)
  const width = 1600;
  const height = 900;
  const padding = 60;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BACKGROUND
  // ─────────────────────────────────────────────────────────────────────────────
  
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HEADER SECTION
  // ─────────────────────────────────────────────────────────────────────────────
  
  let y = padding;
  
  // VIS Score Badge (top right) - prominent
  const visX = width - padding - 100;
  const visY = y;
  const visSize = 100;
  
  // VIS background circle with glow
  const visGlow = ctx.createRadialGradient(visX + visSize/2, visY + visSize/2, 0, visX + visSize/2, visY + visSize/2, visSize);
  visGlow.addColorStop(0, vis >= 75 ? COLORS.red : vis >= 60 ? COLORS.gold : COLORS.cardBg);
  visGlow.addColorStop(0.7, vis >= 75 ? COLORS.red + '80' : vis >= 60 ? COLORS.gold + '80' : COLORS.cardBg);
  visGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = visGlow;
  ctx.fillRect(visX - 20, visY - 20, visSize + 40, visSize + 40);
  
  // VIS circle
  ctx.beginPath();
  ctx.arc(visX + visSize/2, visY + visSize/2, visSize/2, 0, Math.PI * 2);
  ctx.fillStyle = vis >= 75 ? COLORS.red : vis >= 60 ? COLORS.gold : COLORS.cardBg;
  ctx.fill();
  ctx.strokeStyle = vis >= 75 ? COLORS.red : vis >= 60 ? COLORS.goldDim : COLORS.border;
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // VIS number
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '800 42px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'center';
  ctx.fillText(vis?.toString() || '--', visX + visSize/2, visY + visSize/2 + 10);
  
  // VIS label
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.fillText('VIS', visX + visSize/2, visY + visSize/2 + 32);
  
  // Title
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.fillText('📉 BANKRUPTCY RISK REPORT', padding, y + 24);
  
  // Ticker + Company
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '800 38px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.fillText(`$${symbol}`, padding, y + 72);
  
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = '400 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.fillText(`· ${companyName}`, padding + ctx.measureText(`$${symbol}`).width + 16, y + 72);
  
  // Divider
  y += 110;
  ctx.strokeStyle = COLORS.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  
  // ─────────────────────────────────────────────────────────────────────────────
  // METRIC CARDS ROW
  // ─────────────────────────────────────────────────────────────────────────────
  
  y += 50;
  
  const cardWidth = (width - padding * 2 - 40) / 3;  // 3 cards with 20px gaps
  const cardHeight = 100;
  
  // Parse values
  const runwayMonths = parseFloat(metrics.runwayFormatted) || 0;
  const debtRatio = metrics.debtToCashMultiple || 0;
  const burnM = (metrics.monthlyBurn || 0) / 1_000_000;
  
  // Card 1: Runway
  drawMetricCard(
    ctx, padding, y, cardWidth, cardHeight,
    '⏱️', 'RUNWAY',
    metrics.runwayFormatted || 'N/A',
    getRunwayStatus(runwayMonths)
  );
  
  // Card 2: Debt Ratio
  drawMetricCard(
    ctx, padding + cardWidth + 20, y, cardWidth, cardHeight,
    '💰', 'DEBT RATIO',
    `${debtRatio.toFixed(1)}x`,
    getDebtRatioStatus(debtRatio)
  );
  
  // Card 3: Burn Rate
  drawMetricCard(
    ctx, padding + (cardWidth + 20) * 2, y, cardWidth, cardHeight,
    '🔥', 'BURN RATE',
    metrics.monthlyBurnFormatted ? `-${metrics.monthlyBurnFormatted}/mo` : 'N/A',
    getBurnStatus(burnM)
  );
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PROBABILITY MODEL PANEL
  // ─────────────────────────────────────────────────────────────────────────────
  
  y += cardHeight + 50;
  
  const panelX = padding;
  const panelY = y;
  const panelWidth = width - padding * 2;
  const panelHeight = 280;
  
  // Panel background
  ctx.fillStyle = COLORS.panelBg;
  drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 16);
  ctx.fill();
  
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Panel header
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'left';
  ctx.fillText('🎲  INSOLVENCY PROBABILITY MODEL', panelX + 30, panelY + 40);
  
  // Get outcomes
  const bankruptcy = outcomes?.bankruptcy || 25;
  const restructure = outcomes?.restructure || 35;
  const dilution = outcomes?.dilution || 40;
  const maxOutcome = Math.max(bankruptcy, restructure, dilution);
  
  const barX = panelX + 180;
  const barWidth = 500;
  const barHeight = 24;
  const barSpacing = 56;
  let barY = panelY + 80;
  
  // Probability 1: Bankruptcy
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Bankruptcy', barX - 20, barY + 17);
  
  drawProgressBar(ctx, barX, barY, barWidth, barHeight, bankruptcy, COLORS.barRed);
  
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`${bankruptcy}%`, barX + barWidth + 20, barY + 18);
  
  if (bankruptcy === maxOutcome) {
    ctx.fillStyle = COLORS.gold;
    ctx.font = '600 14px -apple-system';
    ctx.fillText('✓ Most Likely', barX + barWidth + 80, barY + 18);
  }
  
  barY += barSpacing;
  
  // Probability 2: Restructure
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Restructure', barX - 20, barY + 17);
  
  drawProgressBar(ctx, barX, barY, barWidth, barHeight, restructure, COLORS.barOrange);
  
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`${restructure}%`, barX + barWidth + 20, barY + 18);
  
  if (restructure === maxOutcome) {
    ctx.fillStyle = COLORS.gold;
    ctx.font = '600 14px -apple-system';
    ctx.fillText('✓ Most Likely', barX + barWidth + 80, barY + 18);
  }
  
  barY += barSpacing;
  
  // Probability 3: Dilution
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Dilution', barX - 20, barY + 17);
  
  drawProgressBar(ctx, barX, barY, barWidth, barHeight, dilution, COLORS.barGreen);
  
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`${dilution}%`, barX + barWidth + 20, barY + 18);
  
  if (dilution === maxOutcome) {
    ctx.fillStyle = COLORS.gold;
    ctx.font = '600 14px -apple-system';
    ctx.fillText('✓ Most Likely', barX + barWidth + 80, barY + 18);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FOOTER - Trend Signal + Branding
  // ─────────────────────────────────────────────────────────────────────────────
  
  y = height - padding - 30;
  
  // Trend signal badge (left)
  const trend = getTrendSignal(score);
  
  // Badge background
  ctx.fillStyle = trend.bg;
  const badgeText = `${trend.icon}  ${trend.label}`;
  ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  const badgeWidth = ctx.measureText(badgeText).width + 32;
  drawRoundedRect(ctx, padding, y - 8, badgeWidth, 36, 8);
  ctx.fill();
  
  ctx.strokeStyle = trend.color + '40';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  ctx.fillStyle = trend.color;
  ctx.textAlign = 'left';
  ctx.fillText(badgeText, padding + 16, y + 14);
  
  // Branding (right)
  ctx.fillStyle = COLORS.textDim;
  ctx.font = '400 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'right';
  ctx.fillText('@DilutionHunter · Not financial advice', width - padding, y + 14);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SAVE
  // ─────────────────────────────────────────────────────────────────────────────
  
  const filename = `${symbol}_bankruptcy_${Date.now()}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filepath, buffer);
  
  console.log(`   📸 Bankruptcy card saved: ${filepath}`);
  return filepath;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI TEST
// ═══════════════════════════════════════════════════════════════════════════════

if (process.argv[1].includes('bankruptcyCard.js')) {
  const ticker = process.argv[2] || 'PLUG';
  
  const { fetchBankruptcyInputs, fetchViralityInputs } = await import('./fmpBankruptcy.js');
  const { scoreWithVIS } = await import('./bankruptcyScoreEngine.js');
  
  console.log(`\n🎴 Generating bankruptcy card for ${ticker}...\n`);
  
  const [financialInputs, viralityInputs] = await Promise.all([
    fetchBankruptcyInputs(ticker),
    fetchViralityInputs(ticker)
  ]);
  
  const analysis = scoreWithVIS(financialInputs, viralityInputs);
  console.log(`   Score: ${analysis.score}/100 | VIS: ${analysis.vis}/100`);
  
  const cardPath = await generateBankruptcyCard(analysis);
  console.log(`\n✅ Card generated: ${cardPath}`);
}

export default { generateBankruptcyCard };
