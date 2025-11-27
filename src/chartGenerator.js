/**
 * CHART GENERATOR - Creates annotated candlestick charts for Twitter
 * 
 * Takes:
 *   - Ticker symbol (fetches real candle data from FMP)
 *   - Chart annotations from OpenAI (zones, arrows, circles, labels)
 * 
 * Outputs:
 *   - PNG image saved to ./output/charts/
 * 
 * Style: Dark mode, clean, professional
 * 
 * Usage:
 *   import { generateChart } from './chartGenerator.js';
 *   await generateChart(ticker, candles, annotations, options);
 */

import 'dotenv/config';
import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output', 'charts');

const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR PALETTE - Dark Mode Professional
// ═══════════════════════════════════════════════════════════════════════════════

const COLORS = {
  // Background
  bg: '#0d1117',
  bgCard: '#161b22',
  bgSubtle: '#21262d',
  
  // Text
  textPrimary: '#e6edf3',
  textSecondary: '#8b949e',
  textMuted: '#484f58',
  
  // Candles
  bullish: '#3fb950',      // Green
  bearish: '#f85149',      // Red
  wick: '#8b949e',
  
  // Annotations
  entryZone: 'rgba(63, 185, 80, 0.15)',      // Green tint
  dangerZone: 'rgba(248, 81, 73, 0.15)',     // Red tint
  watchZone: 'rgba(136, 146, 157, 0.15)',    // Gray tint
  
  arrowUp: '#3fb950',
  arrowDown: '#f85149',
  
  circleEntry: '#3fb950',
  circleDanger: '#f85149',
  circleNeutral: '#58a6ff',
  
  // Volume
  volumeBullish: 'rgba(63, 185, 80, 0.4)',
  volumeBearish: 'rgba(248, 81, 73, 0.4)',
  
  // Grid
  grid: '#21262d',
  
  // Accent
  accent: '#58a6ff',
  warning: '#d29922',
};

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH CANDLE DATA
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchCandles(symbol, days = 14) {
  const url = `${FMP_BASE}/historical-price-eod/full?symbol=${symbol}&apikey=${FMP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch candles for ${symbol}`);
  
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No candle data for ${symbol}`);
  }
  
  // FMP returns newest first, take last N days and reverse to oldest-first
  return data.slice(0, days).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHART RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Generate an annotated candlestick chart
 * 
 * @param {string} ticker - Stock symbol
 * @param {Array} candles - Array of { date, open, high, low, close, volume }
 * @param {Object} annotations - From OpenAI: { highlightZones, arrows, circles, volumeNote, overallStyle }
 * @param {Object} options - { title, subtitle, bucket }
 */
export async function generateChart(ticker, candles, annotations = {}, options = {}) {
  ensureOutputDir();
  
  const width = 1200;
  const height = 675; // 16:9 aspect ratio, good for Twitter
  const padding = { top: 80, right: 60, bottom: 100, left: 80 };
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Chart area dimensions
  const chartWidth = width - padding.left - padding.right;
  const priceChartHeight = (height - padding.top - padding.bottom) * 0.7;
  const volumeChartHeight = (height - padding.top - padding.bottom) * 0.25;
  const gapHeight = (height - padding.top - padding.bottom) * 0.05;
  
  // Calculate price range
  const prices = candles.flatMap(c => [c.high, c.low]);
  const minPrice = Math.min(...prices) * 0.98;
  const maxPrice = Math.max(...prices) * 1.02;
  const priceRange = maxPrice - minPrice;
  
  // Calculate volume range
  const volumes = candles.map(c => c.volume);
  const maxVolume = Math.max(...volumes) * 1.1;
  
  // Helper functions
  const xScale = (i) => padding.left + (i + 0.5) * (chartWidth / candles.length);
  const yPriceScale = (price) => padding.top + priceChartHeight - ((price - minPrice) / priceRange) * priceChartHeight;
  const yVolumeScale = (vol) => padding.top + priceChartHeight + gapHeight + volumeChartHeight - (vol / maxVolume) * volumeChartHeight;
  const candleWidth = Math.max(4, (chartWidth / candles.length) * 0.6);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BACKGROUND
  // ─────────────────────────────────────────────────────────────────────────────
  
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  
  // Card background for chart area
  ctx.fillStyle = COLORS.bgCard;
  roundRect(ctx, padding.left - 10, padding.top - 10, chartWidth + 20, priceChartHeight + gapHeight + volumeChartHeight + 20, 8);
  ctx.fill();
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HIGHLIGHT ZONES (before candles so they're behind)
  // ─────────────────────────────────────────────────────────────────────────────
  
  if (annotations.highlightZones) {
    for (const zone of annotations.highlightZones) {
      const startIdx = Math.max(0, zone.startDay - 1);
      const endIdx = Math.min(candles.length - 1, zone.endDay - 1);
      
      const x1 = xScale(startIdx) - candleWidth;
      const x2 = xScale(endIdx) + candleWidth;
      
      let color;
      if (zone.type === 'entry') color = COLORS.entryZone;
      else if (zone.type === 'danger') color = COLORS.dangerZone;
      else color = COLORS.watchZone;
      
      ctx.fillStyle = color;
      ctx.fillRect(x1, padding.top, x2 - x1, priceChartHeight);
      
      // Zone label at top
      ctx.fillStyle = COLORS.textSecondary;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(zone.label, (x1 + x2) / 2, padding.top + 15);
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // GRID LINES
  // ─────────────────────────────────────────────────────────────────────────────
  
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  
  // Horizontal price grid
  const priceStep = priceRange / 4;
  for (let i = 0; i <= 4; i++) {
    const price = minPrice + priceStep * i;
    const y = yPriceScale(price);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
    
    // Price label
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`$${price.toFixed(2)}`, padding.left - 10, y + 4);
  }
  
  ctx.setLineDash([]);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // VOLUME BARS
  // ─────────────────────────────────────────────────────────────────────────────
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const x = xScale(i);
    const isBullish = candle.close >= candle.open;
    
    ctx.fillStyle = isBullish ? COLORS.volumeBullish : COLORS.volumeBearish;
    const barHeight = (candle.volume / maxVolume) * volumeChartHeight;
    ctx.fillRect(
      x - candleWidth / 2,
      padding.top + priceChartHeight + gapHeight + volumeChartHeight - barHeight,
      candleWidth,
      barHeight
    );
  }
  
  // Volume label
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('VOLUME', padding.left, padding.top + priceChartHeight + gapHeight + 12);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CANDLESTICKS
  // ─────────────────────────────────────────────────────────────────────────────
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const x = xScale(i);
    const isBullish = candle.close >= candle.open;
    
    const color = isBullish ? COLORS.bullish : COLORS.bearish;
    
    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yPriceScale(candle.high));
    ctx.lineTo(x, yPriceScale(candle.low));
    ctx.stroke();
    
    // Body
    const bodyTop = yPriceScale(Math.max(candle.open, candle.close));
    const bodyBottom = yPriceScale(Math.min(candle.open, candle.close));
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
    
    ctx.fillStyle = color;
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DATE LABELS
  // ─────────────────────────────────────────────────────────────────────────────
  
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  
  // Show every Nth label to avoid crowding
  const labelInterval = Math.ceil(candles.length / 7);
  for (let i = 0; i < candles.length; i += labelInterval) {
    const date = new Date(candles[i].date);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    ctx.fillText(label, xScale(i), height - padding.bottom + 45);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ARROWS
  // ─────────────────────────────────────────────────────────────────────────────
  
  if (annotations.arrows) {
    for (const arrow of annotations.arrows) {
      const idx = Math.min(candles.length - 1, Math.max(0, arrow.day - 1));
      const candle = candles[idx];
      const x = xScale(idx);
      
      if (arrow.direction === 'up') {
        const y = yPriceScale(candle.high) - 25;
        drawArrow(ctx, x, y + 20, x, y, COLORS.arrowUp);
        
        ctx.fillStyle = COLORS.arrowUp;
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(arrow.label, x, y - 5);
      } else {
        const y = yPriceScale(candle.low) + 25;
        drawArrow(ctx, x, y - 20, x, y, COLORS.arrowDown);
        
        ctx.fillStyle = COLORS.arrowDown;
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(arrow.label, x, y + 18);
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CIRCLES
  // ─────────────────────────────────────────────────────────────────────────────
  
  if (annotations.circles) {
    for (const circle of annotations.circles) {
      const idx = Math.min(candles.length - 1, Math.max(0, circle.day - 1));
      const candle = candles[idx];
      const x = xScale(idx);
      
      let price;
      if (circle.target === 'high') price = candle.high;
      else if (circle.target === 'low') price = candle.low;
      else price = candle.close;
      
      const y = yPriceScale(price);
      
      // Determine color based on context
      let color = COLORS.circleNeutral;
      if (circle.label.toLowerCase().includes('peak') || circle.label.toLowerCase().includes('entry')) {
        color = COLORS.circleEntry;
      } else if (circle.label.toLowerCase().includes('crash') || circle.label.toLowerCase().includes('low') || circle.label.toLowerCase().includes('danger')) {
        color = COLORS.circleDanger;
      }
      
      // Draw circle
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.stroke();
      
      // Label
      ctx.fillStyle = color;
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      const labelY = circle.target === 'low' ? y + 28 : y - 22;
      ctx.fillText(circle.label, x, labelY);
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HEADER
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Ticker
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`$${ticker}`, padding.left, 45);
  
  // Subtitle / classification
  const bucketEmoji = options.bucket === 'CASE_STUDY' ? '📚' : options.bucket === 'WATCH_LIST' ? '👀' : '🎯';
  const bucketLabel = options.bucket === 'CASE_STUDY' ? 'Case Study' : options.bucket === 'WATCH_LIST' ? 'Watch List' : 'Actionable';
  
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(`${bucketEmoji} ${bucketLabel}`, padding.left + 120, 45);
  
  // Price info on right
  const lastCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const totalChange = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
  
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(`$${lastCandle.close.toFixed(2)}`, width - padding.right, 38);
  
  ctx.fillStyle = totalChange >= 0 ? COLORS.bullish : COLORS.bearish;
  ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(`${totalChange >= 0 ? '+' : ''}${totalChange.toFixed(1)}%`, width - padding.right, 55);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FOOTER - Volume note and branding
  // ─────────────────────────────────────────────────────────────────────────────
  
  if (annotations.volumeNote) {
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = 'italic 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`📊 ${annotations.volumeNote}`, padding.left, height - 20);
  }
  
  // Branding
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('DilutionHunter', width - padding.right, height - 20);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SAVE
  // ─────────────────────────────────────────────────────────────────────────────
  
  const filename = `${ticker}_${Date.now()}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filepath, buffer);
  
  console.log(`📊 Chart saved: ${filepath}`);
  
  return filepath;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawArrow(ctx, fromX, fromY, toX, toY, color) {
  const headLength = 8;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  
  // Line
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI - Test standalone
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const ticker = process.argv[2]?.toUpperCase() || 'INHD';
  
  console.log(`\n📈 Generating chart for ${ticker}...\n`);
  
  // Fetch candles
  const candles = await fetchCandles(ticker, 14);
  console.log(`   Fetched ${candles.length} candles`);
  
  // Sample annotations (normally from OpenAI)
  const annotations = {
    highlightZones: [
      { type: 'entry', startDay: 1, endDay: 5, label: 'Pump Zone' },
      { type: 'danger', startDay: 6, endDay: 7, label: 'Dilution Crash' }
    ],
    arrows: [
      { day: 5, direction: 'up', label: 'Peak' },
      { day: 7, direction: 'down', label: 'Crash' }
    ],
    circles: [
      { day: 5, target: 'high', label: 'Peak Gain' },
      { day: 7, target: 'low', label: 'Post-Dilution Low' }
    ],
    volumeNote: 'Notice the volume spike as shares are sold into the market.',
    overallStyle: 'bearish_confirmed'
  };
  
  const filepath = await generateChart(ticker, candles, annotations, {
    bucket: 'CASE_STUDY'
  });
  
  console.log(`\n✅ Done! Open: ${filepath}\n`);
}

// Run if called directly
if (process.argv[1]?.includes('chartGenerator')) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { fetchCandles };
