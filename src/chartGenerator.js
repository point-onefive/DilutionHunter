/**
 * CHART GENERATOR - Creates annotated candlestick charts for Twitter
 * 
 * Takes:
 *   - Ticker symbol (fetches real candle data from FMP)
 *   - Chart annotations from OpenAI (simplified: just key labels)
 * 
 * Outputs:
 *   - PNG image saved to ./output/charts/
 * 
 * Style: Dark mode, clean, professional, minimal clutter
 * 
 * Key design decisions:
 *   - Only show 7 days (matches analysis window)
 *   - Auto-detect peak and current candles from data
 *   - Highlight key candles with glow effect (no circles)
 *   - Minimal text annotations
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
  
  // Text
  textPrimary: '#ffffff',
  textSecondary: '#8b949e',
  textMuted: '#6e7681',
  
  // Candles
  bullish: '#3fb950',
  bearish: '#f85149',
  
  // Zone backgrounds (vertical strips behind candles)
  zoneEntry: 'rgba(63, 185, 80, 0.12)',      // Green - buy zone
  zoneHold: 'rgba(210, 153, 34, 0.12)',      // Yellow/amber - hold/watch
  zoneDanger: 'rgba(248, 81, 73, 0.12)',     // Red - danger/crash zone
  
  // Volume
  volumeBullish: 'rgba(63, 185, 80, 0.6)',
  volumeBearish: 'rgba(248, 81, 73, 0.6)',
  
  // Grid
  grid: '#21262d',
};

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH CANDLE DATA
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchCandles(symbol, days = 7) {
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
 * Generate a clean, annotated candlestick chart
 * 
 * @param {string} ticker - Stock symbol
 * @param {Array} candles - Array of { date, open, high, low, close, volume } - should be 7 days
 * @param {Object} annotations - { peakLabel, crashLabel, volumeNote } - simplified
 * @param {Object} options - { bucket, peakGain, currentGain, pullback }
 */
export async function generateChart(ticker, candles, annotations = {}, options = {}) {
  ensureOutputDir();
  
  // Use last 7 candles only
  const chartCandles = candles.slice(-7);
  
  const width = 1200;
  const height = 675;
  // Increased right padding for annotation panel
  const padding = { top: 90, right: 180, bottom: 80, left: 100 };
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  const chartWidth = width - padding.left - padding.right;
  const priceChartHeight = (height - padding.top - padding.bottom) * 0.72;
  const volumeChartHeight = (height - padding.top - padding.bottom) * 0.22;
  const gapHeight = (height - padding.top - padding.bottom) * 0.06;
  
  // Auto-detect peak and low from data
  let peakIdx = 0;
  let peakHigh = 0;
  let lowIdx = 0;
  let lowPrice = Infinity;
  
  chartCandles.forEach((c, i) => {
    if (c.high > peakHigh) { peakHigh = c.high; peakIdx = i; }
    if (c.low < lowPrice) { lowPrice = c.low; lowIdx = i; }
  });
  
  // Calculate price range with padding
  const prices = chartCandles.flatMap(c => [c.high, c.low]);
  const dataMin = Math.min(...prices);
  const dataMax = Math.max(...prices);
  const priceBuffer = (dataMax - dataMin) * 0.15;
  const minPrice = dataMin - priceBuffer;
  const maxPrice = dataMax + priceBuffer;
  const priceRange = maxPrice - minPrice;
  
  // Volume range
  const volumes = chartCandles.map(c => c.volume);
  const maxVolume = Math.max(...volumes) * 1.1;
  
  // Scale helpers
  const xScale = (i) => padding.left + (i + 0.5) * (chartWidth / chartCandles.length);
  const yPrice = (price) => padding.top + priceChartHeight - ((price - minPrice) / priceRange) * priceChartHeight;
  const yVolume = (vol) => padding.top + priceChartHeight + gapHeight + volumeChartHeight - (vol / maxVolume) * volumeChartHeight;
  const candleWidth = Math.min(60, (chartWidth / chartCandles.length) * 0.65);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BACKGROUND
  // ─────────────────────────────────────────────────────────────────────────────
  
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  
  // Subtle card background
  ctx.fillStyle = COLORS.bgCard;
  roundRect(ctx, padding.left - 15, padding.top - 15, chartWidth + 30, priceChartHeight + gapHeight + volumeChartHeight + 30, 12);
  ctx.fill();
  
  // ─────────────────────────────────────────────────────────────────────────────
  // GRID LINES with nice round Y-axis values
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Calculate nice round tick values
  function getNiceTickValues(min, max, targetTicks = 4) {
    const range = max - min;
    const roughStep = range / (targetTicks - 1);
    
    // Find a nice step size (0.25, 0.50, 1.00, 2.00, 5.00, etc.)
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;
    let niceStep;
    if (residual <= 1.5) niceStep = magnitude;
    else if (residual <= 3) niceStep = 2 * magnitude;
    else if (residual <= 7) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;
    
    // Round min down and max up to nice values
    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;
    
    const ticks = [];
    for (let v = niceMin; v <= niceMax + niceStep * 0.01; v += niceStep) {
      if (v >= min - niceStep * 0.5 && v <= max + niceStep * 0.5) {
        ticks.push(v);
      }
    }
    return ticks;
  }
  
  const priceTicks = getNiceTickValues(dataMin, dataMax, 4);
  
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  
  for (const price of priceTicks) {
    const y = yPrice(price);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
    
    // Price label - larger font
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
    ctx.textAlign = 'right';
    // Format nicely: $1.00 or $0.50
    const formatted = price < 10 ? `$${price.toFixed(2)}` : `$${price.toFixed(1)}`;
    ctx.fillText(formatted, padding.left - 15, y + 5);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ZONE BACKGROUNDS (green → yellow → red)
  // Labels go at BOTTOM of zones to avoid overlap with PEAK label
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Zone label Y position - near bottom of price chart area
  const zoneLabelY = padding.top + priceChartHeight - 15;
  
  if (options.bucket === 'CASE_STUDY' || options.bucket === 'ACTIONABLE') {
    // Ramp zone: from start to before peak (when price was rising)
    if (peakIdx > 0) {
      const x1 = xScale(0) - candleWidth;
      const x2 = xScale(peakIdx - 1) + candleWidth;
      ctx.fillStyle = COLORS.zoneEntry;
      ctx.fillRect(x1, padding.top, x2 - x1, priceChartHeight);
      
      // Zone label at bottom
      ctx.fillStyle = COLORS.bullish;
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('RAMP', (x1 + x2) / 2, zoneLabelY);
    }
    
    // Peak zone: the peak candle itself
    {
      const x1 = xScale(peakIdx) - candleWidth;
      const x2 = xScale(peakIdx) + candleWidth;
      ctx.fillStyle = COLORS.zoneHold;
      ctx.fillRect(x1, padding.top, x2 - x1, priceChartHeight);
      
      // No label here - PEAK annotation goes in sidebar
    }
    
    // Dilution zone: after peak to end
    if (peakIdx < chartCandles.length - 1) {
      const x1 = xScale(peakIdx + 1) - candleWidth;
      const x2 = xScale(chartCandles.length - 1) + candleWidth;
      ctx.fillStyle = COLORS.zoneDanger;
      ctx.fillRect(x1, padding.top, x2 - x1, priceChartHeight);
      
      // Zone label at bottom
      ctx.fillStyle = COLORS.bearish;
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('DILUTION', (x1 + x2) / 2, zoneLabelY);
    }
  } else if (options.bucket === 'WATCH_LIST') {
    // Watch list: all yellow/amber
    const x1 = xScale(0) - candleWidth;
    const x2 = xScale(chartCandles.length - 1) + candleWidth;
    ctx.fillStyle = COLORS.zoneHold;
    ctx.fillRect(x1, padding.top, x2 - x1, priceChartHeight);
    
    // Zone label at bottom
    ctx.fillStyle = '#d29922';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('WATCHING', (x1 + x2) / 2, zoneLabelY);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // VOLUME SECTION with label
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Volume label on the left
  const volumeTop = padding.top + priceChartHeight + gapHeight;
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'right';
  ctx.fillText('VOL', padding.left - 15, volumeTop + volumeChartHeight / 2 + 4);
  
  // Volume bars
  for (let i = 0; i < chartCandles.length; i++) {
    const candle = chartCandles[i];
    const x = xScale(i);
    const isBullish = candle.close >= candle.open;
    
    ctx.fillStyle = isBullish ? COLORS.volumeBullish : COLORS.volumeBearish;
    // Minimum bar height of 10px so all bars are visible
    const barHeight = Math.max(10, (candle.volume / maxVolume) * volumeChartHeight);
    ctx.fillRect(
      x - candleWidth / 2,
      padding.top + priceChartHeight + gapHeight + volumeChartHeight - barHeight,
      candleWidth,
      barHeight
    );
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CANDLESTICKS
  // ─────────────────────────────────────────────────────────────────────────────
  
  for (let i = 0; i < chartCandles.length; i++) {
    const candle = chartCandles[i];
    const x = xScale(i);
    const isBullish = candle.close >= candle.open;
    const color = isBullish ? COLORS.bullish : COLORS.bearish;
    
    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, yPrice(candle.high));
    ctx.lineTo(x, yPrice(candle.low));
    ctx.stroke();
    
    // Body
    const bodyTop = yPrice(Math.max(candle.open, candle.close));
    const bodyBottom = yPrice(Math.min(candle.open, candle.close));
    const bodyHeight = Math.max(2, bodyBottom - bodyTop);
    
    ctx.fillStyle = color;
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    
    // Border for body
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ANNOTATION SIDEBAR (right side, outside chart area)
  // ─────────────────────────────────────────────────────────────────────────────
  
  const sidebarX = padding.left + chartWidth + 25;
  
  // Peak annotation
  if (options.peakGain) {
    const peakY = yPrice(peakHigh);
    
    // Small dot on the peak candle
    ctx.fillStyle = COLORS.bullish;
    ctx.beginPath();
    ctx.arc(xScale(peakIdx), yPrice(peakHigh), 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Line to sidebar
    ctx.strokeStyle = COLORS.bullish;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xScale(peakIdx) + 5, peakY);
    ctx.lineTo(sidebarX - 5, peakY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Label in sidebar
    ctx.fillStyle = COLORS.bullish;
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
    ctx.textAlign = 'left';
    ctx.fillText('PEAK', sidebarX, peakY - 8);
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
    ctx.fillText(`+${options.peakGain.toFixed(0)}%`, sidebarX, peakY + 16);
  }
  
  // Current/crash annotation (for case study)
  if (options.bucket === 'CASE_STUDY' && options.currentGain !== undefined) {
    const crashIdx = chartCandles.length - 1;
    const crashCandle = chartCandles[crashIdx];
    const crashY = yPrice(crashCandle.close);
    
    // Small dot on the crash candle
    ctx.fillStyle = COLORS.bearish;
    ctx.beginPath();
    ctx.arc(xScale(crashIdx), crashY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Line to sidebar
    ctx.strokeStyle = COLORS.bearish;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xScale(crashIdx) + 5, crashY);
    ctx.lineTo(sidebarX - 5, crashY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Label in sidebar
    ctx.fillStyle = COLORS.bearish;
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
    ctx.textAlign = 'left';
    ctx.fillText('NOW', sidebarX, crashY - 8);
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
    ctx.fillText(`${options.currentGain.toFixed(0)}%`, sidebarX, crashY + 16);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DATE LABELS - larger and clearer
  // ─────────────────────────────────────────────────────────────────────────────
  
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'center';
  
  for (let i = 0; i < chartCandles.length; i++) {
    const date = new Date(chartCandles[i].date);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    ctx.fillText(label, xScale(i), height - padding.bottom + 28);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HEADER - Consolidated on left side
  // ─────────────────────────────────────────────────────────────────────────────
  
  const lastCandle = chartCandles[chartCandles.length - 1];
  const firstCandle = chartCandles[0];
  const periodChange = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
  
  // Row 1: Ticker + Current Price
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`$${ticker}`, padding.left, 50);
  
  // Price next to ticker
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  const tickerWidth = ctx.measureText(`$${ticker}`).width;
  ctx.fillStyle = COLORS.textSecondary;
  ctx.fillText(`$${lastCandle.close.toFixed(2)}`, padding.left + tickerWidth + 20, 50);
  
  // 7d change next to price
  ctx.fillStyle = periodChange >= 0 ? COLORS.bullish : COLORS.bearish;
  ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  const priceWidth = ctx.measureText(`$${lastCandle.close.toFixed(2)}`).width;
  ctx.fillText(`${periodChange >= 0 ? '+' : ''}${periodChange.toFixed(1)}%`, padding.left + tickerWidth + priceWidth + 35, 50);
  
  // Row 2: Bucket label
  const bucketLabel = options.bucket === 'CASE_STUDY' ? 'CASE STUDY' : options.bucket === 'WATCH_LIST' ? 'WATCH LIST' : 'ACTIONABLE';
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.fillText(bucketLabel, padding.left, 72);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FOOTER - Branding
  // ─────────────────────────────────────────────────────────────────────────────
  
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial';
  ctx.textAlign = 'right';
  ctx.fillText('@DilutionHunter', width - padding.right, height - 12);
  
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

// ═══════════════════════════════════════════════════════════════════════════════
// CLI - Test standalone
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const ticker = process.argv[2]?.toUpperCase() || 'INHD';
  
  console.log(`\n📈 Generating chart for ${ticker}...\n`);
  
  // Fetch candles (7 days)
  const candles = await fetchCandles(ticker, 7);
  console.log(`   Fetched ${candles.length} candles`);
  
  // Calculate peak gain for display
  const startPrice = candles[0].open;
  const peakHigh = Math.max(...candles.map(c => c.high));
  const currentPrice = candles[candles.length - 1].close;
  const peakGain = ((peakHigh - startPrice) / startPrice) * 100;
  const currentGain = ((currentPrice - startPrice) / startPrice) * 100;
  
  const filepath = await generateChart(ticker, candles, {}, {
    bucket: 'CASE_STUDY',
    peakGain,
    currentGain
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
