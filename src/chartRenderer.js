/**
 * DilutionHunter - Chart Renderer
 * 
 * Generates stylized candlestick charts showing the dilution setup.
 * Outputs PNG files for Twitter media attachments.
 * 
 * Features:
 * - Candlestick visualization (green/red)
 * - Volume bars
 * - Risk score overlay
 * - Key metrics annotation
 */

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  width: 1200,
  height: 675,  // Twitter optimal 16:9
  padding: { top: 80, right: 40, bottom: 100, left: 80 },
  colors: {
    background: '#0d1117',
    gridLines: '#21262d',
    text: '#c9d1d9',
    textMuted: '#8b949e',
    greenCandle: '#3fb950',
    redCandle: '#f85149',
    greenVolume: 'rgba(63, 185, 80, 0.4)',
    redVolume: 'rgba(248, 81, 73, 0.4)',
    alertRed: '#f85149',
    alertYellow: '#d29922',
    white: '#ffffff',
  },
  fonts: {
    title: 'bold 28px Arial',
    subtitle: '18px Arial',
    label: '14px Arial',
    stats: 'bold 16px Arial',
    score: 'bold 48px Arial',
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN RENDER FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export function renderChart(analysisData, outputPath = null) {
  const canvas = createCanvas(CONFIG.width, CONFIG.height);
  const ctx = canvas.getContext('2d');
  
  const { symbol, score, priceAction, quote, cashFlow, offerings, data } = analysisData;
  const candles = data?.candles || [];
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BACKGROUND
  // ─────────────────────────────────────────────────────────────────────────────
  ctx.fillStyle = CONFIG.colors.background;
  ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // HEADER
  // ─────────────────────────────────────────────────────────────────────────────
  // Title
  ctx.fillStyle = CONFIG.colors.white;
  ctx.font = CONFIG.fonts.title;
  ctx.fillText(`🎯 ${symbol} DILUTION RISK ALERT`, CONFIG.padding.left, 45);
  
  // Subtitle with price
  ctx.fillStyle = CONFIG.colors.textMuted;
  ctx.font = CONFIG.fonts.subtitle;
  const priceStr = quote?.price ? `$${quote.price.toFixed(2)}` : '';
  const mktCapStr = quote?.marketCap ? `MCap: $${(quote.marketCap / 1e6).toFixed(0)}M` : '';
  ctx.fillText(`${priceStr}  |  ${mktCapStr}`, CONFIG.padding.left, 70);
  
  // Risk Score Badge (top right)
  drawRiskBadge(ctx, score, CONFIG.width - CONFIG.padding.right - 100, 20);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CANDLESTICK CHART AREA
  // ─────────────────────────────────────────────────────────────────────────────
  const chartArea = {
    x: CONFIG.padding.left,
    y: CONFIG.padding.top + 20,
    width: CONFIG.width - CONFIG.padding.left - CONFIG.padding.right - 180,
    height: CONFIG.height - CONFIG.padding.top - CONFIG.padding.bottom - 60
  };
  
  if (candles.length > 0) {
    drawCandlesticks(ctx, candles, chartArea);
  } else {
    // No data placeholder
    ctx.fillStyle = CONFIG.colors.textMuted;
    ctx.font = CONFIG.fonts.label;
    ctx.fillText('Price data unavailable', chartArea.x + chartArea.width / 2 - 60, chartArea.y + chartArea.height / 2);
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATS PANEL (right side)
  // ─────────────────────────────────────────────────────────────────────────────
  drawStatsPanel(ctx, analysisData, {
    x: CONFIG.width - CONFIG.padding.right - 160,
    y: CONFIG.padding.top + 80,
    width: 150
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FOOTER
  // ─────────────────────────────────────────────────────────────────────────────
  ctx.fillStyle = CONFIG.colors.textMuted;
  ctx.font = '12px Arial';
  ctx.fillText('DilutionHunter • Not financial advice • DYOR', CONFIG.padding.left, CONFIG.height - 20);
  ctx.fillText(new Date().toISOString().split('T')[0], CONFIG.width - CONFIG.padding.right - 80, CONFIG.height - 20);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────────────────────────────────────
  const buffer = canvas.toBuffer('image/png');
  
  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    console.log(`📊 Chart saved: ${outputPath}`);
  }
  
  return buffer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANDLESTICK DRAWING
// ═══════════════════════════════════════════════════════════════════════════════

function drawCandlesticks(ctx, candles, area) {
  const { x, y, width, height } = area;
  const numCandles = Math.min(candles.length, 20); // Show last 20 days
  const displayCandles = candles.slice(-numCandles);
  
  // Calculate price range
  let minPrice = Infinity, maxPrice = -Infinity;
  let maxVolume = 0;
  
  for (const c of displayCandles) {
    minPrice = Math.min(minPrice, c.low);
    maxPrice = Math.max(maxPrice, c.high);
    maxVolume = Math.max(maxVolume, c.volume);
  }
  
  // Add padding to price range
  const priceRange = maxPrice - minPrice;
  minPrice -= priceRange * 0.1;
  maxPrice += priceRange * 0.1;
  
  // Grid lines
  ctx.strokeStyle = CONFIG.colors.gridLines;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yPos = y + (height * 0.7) * (i / 4);
    ctx.beginPath();
    ctx.moveTo(x, yPos);
    ctx.lineTo(x + width, yPos);
    ctx.stroke();
  }
  
  // Price labels
  ctx.fillStyle = CONFIG.colors.textMuted;
  ctx.font = '11px Arial';
  for (let i = 0; i <= 4; i++) {
    const price = maxPrice - (maxPrice - minPrice) * (i / 4);
    const yPos = y + (height * 0.7) * (i / 4);
    ctx.fillText(`$${price.toFixed(2)}`, x - 55, yPos + 4);
  }
  
  // Candle dimensions
  const candleWidth = (width - 20) / numCandles;
  const candleBodyWidth = candleWidth * 0.7;
  const chartHeight = height * 0.7; // 70% for price, 30% for volume
  const volumeHeight = height * 0.25;
  const volumeY = y + chartHeight + 10;
  
  // Draw each candle
  displayCandles.forEach((candle, i) => {
    const isGreen = candle.close >= candle.open;
    const color = isGreen ? CONFIG.colors.greenCandle : CONFIG.colors.redCandle;
    const volColor = isGreen ? CONFIG.colors.greenVolume : CONFIG.colors.redVolume;
    
    const candleX = x + 10 + i * candleWidth + candleWidth / 2;
    
    // Scale prices to chart
    const scaleY = (price) => y + ((maxPrice - price) / (maxPrice - minPrice)) * chartHeight;
    
    const openY = scaleY(candle.open);
    const closeY = scaleY(candle.close);
    const highY = scaleY(candle.high);
    const lowY = scaleY(candle.low);
    
    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(candleX, highY);
    ctx.lineTo(candleX, lowY);
    ctx.stroke();
    
    // Body
    ctx.fillStyle = color;
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
    ctx.fillRect(candleX - candleBodyWidth / 2, bodyTop, candleBodyWidth, bodyHeight);
    
    // Volume bar
    const volHeight = (candle.volume / maxVolume) * volumeHeight;
    ctx.fillStyle = volColor;
    ctx.fillRect(candleX - candleBodyWidth / 2, volumeY + volumeHeight - volHeight, candleBodyWidth, volHeight);
  });
  
  // Highlight last candle if red (reversal signal)
  const lastCandle = displayCandles[displayCandles.length - 1];
  if (lastCandle && lastCandle.close < lastCandle.open) {
    const lastX = x + 10 + (numCandles - 1) * candleWidth + candleWidth / 2;
    ctx.strokeStyle = CONFIG.colors.alertRed;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(lastX - candleWidth / 2 - 5, y - 5, candleWidth + 10, chartHeight + volumeHeight + 25);
    ctx.setLineDash([]);
    
    // Label
    ctx.fillStyle = CONFIG.colors.alertRed;
    ctx.font = 'bold 11px Arial';
    ctx.fillText('🔴 REVERSAL?', lastX - 30, y - 12);
  }
  
  // Volume label
  ctx.fillStyle = CONFIG.colors.textMuted;
  ctx.font = '10px Arial';
  ctx.fillText('VOL', x - 30, volumeY + volumeHeight / 2 + 4);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK BADGE
// ═══════════════════════════════════════════════════════════════════════════════

function drawRiskBadge(ctx, score, x, y) {
  const size = 80;
  
  // Badge background
  let bgColor = CONFIG.colors.greenCandle;
  if (score >= 65) bgColor = CONFIG.colors.alertRed;
  else if (score >= 40) bgColor = CONFIG.colors.alertYellow;
  
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, y, size + 20, size, 10);
  ctx.fill();
  
  // Score text
  ctx.fillStyle = CONFIG.colors.white;
  ctx.font = CONFIG.fonts.score;
  ctx.textAlign = 'center';
  ctx.fillText(`${score}%`, x + (size + 20) / 2, y + 55);
  
  // Label
  ctx.font = 'bold 11px Arial';
  ctx.fillText('RISK', x + (size + 20) / 2, y + 75);
  
  ctx.textAlign = 'left'; // Reset
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function drawStatsPanel(ctx, data, area) {
  const { x, y, width } = area;
  const { priceAction, cashFlow, offerings, float } = data;
  
  ctx.fillStyle = CONFIG.colors.text;
  ctx.font = 'bold 14px Arial';
  ctx.fillText('KEY METRICS', x, y);
  
  ctx.font = '13px Arial';
  let yPos = y + 30;
  const lineHeight = 28;
  
  const stats = [
    { label: '7D Change', value: priceAction?.sevenDayReturn ? `${priceAction.sevenDayReturn > 0 ? '+' : ''}${priceAction.sevenDayReturn.toFixed(1)}%` : 'N/A', highlight: priceAction?.sevenDayReturn > 50 },
    { label: '30D Change', value: priceAction?.thirtyDayReturn ? `${priceAction.thirtyDayReturn > 0 ? '+' : ''}${priceAction.thirtyDayReturn.toFixed(1)}%` : 'N/A' },
    { label: 'ATR%', value: priceAction?.atrPercent ? `${priceAction.atrPercent.toFixed(1)}%` : 'N/A' },
    { label: 'Runway', value: cashFlow?.runwayMonths ? `${cashFlow.runwayMonths.toFixed(1)}mo` : 'N/A', highlight: cashFlow?.runwayMonths < 6 },
    { label: 'Float', value: float?.floatRatio ? `${(float.floatRatio * 100).toFixed(0)}%` : 'N/A', highlight: float?.floatRatio < 0.3 },
    { label: 'Offering %', value: offerings?.marketCapRatio ? `${(offerings.marketCapRatio * 100).toFixed(1)}%` : 'None', highlight: offerings?.marketCapRatio > 0.1 },
    { label: 'Active ATM', value: offerings?.hasActiveATM ? '🔴 YES' : '⚪ No', highlight: offerings?.hasActiveATM },
  ];
  
  for (const stat of stats) {
    ctx.fillStyle = stat.highlight ? CONFIG.colors.alertRed : CONFIG.colors.textMuted;
    ctx.fillText(stat.label, x, yPos);
    
    ctx.fillStyle = stat.highlight ? CONFIG.colors.alertRed : CONFIG.colors.text;
    ctx.font = 'bold 13px Arial';
    ctx.fillText(stat.value, x + 90, yPos);
    ctx.font = '13px Arial';
    
    yPos += lineHeight;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST
// ═══════════════════════════════════════════════════════════════════════════════

// Run test if called directly
const isMainModule = process.argv[1]?.includes('chartRenderer');
if (isMainModule) {
  console.log('📊 Testing Chart Renderer...\n');
  
  // Mock data simulating a high-risk ticker
  const mockData = {
    symbol: 'FFIE',
    score: 78,
    quote: { price: 2.45, marketCap: 450000000 },
    priceAction: {
      sevenDayReturn: 187.5,
      thirtyDayReturn: 320,
      atrPercent: 18.5,
      isRedCandle: true
    },
    cashFlow: {
      runwayMonths: 2.1,
      isPositive: false
    },
    float: {
      floatRatio: 0.28
    },
    offerings: {
      marketCapRatio: 0.33,
      hasActiveATM: true,
      remainingCapacity: 150000000
    },
    data: {
      // Generate mock candles showing a pump pattern
      candles: generateMockPumpCandles()
    }
  };
  
  const outputPath = './output/test-chart.png';
  renderChart(mockData, outputPath);
  console.log('✅ Test chart generated!');
}

// Generate mock candles that show a classic pump pattern
function generateMockPumpCandles() {
  const candles = [];
  let price = 0.85;
  const baseVolume = 5000000;
  
  for (let i = 0; i < 20; i++) {
    // Simulate pump: gradual rise, then parabolic, then reversal
    let change;
    if (i < 10) change = 0.02 + Math.random() * 0.05;        // Slow grind
    else if (i < 17) change = 0.10 + Math.random() * 0.15;   // Parabolic
    else if (i < 19) change = -0.05 + Math.random() * 0.08;  // Topping
    else change = -0.12;                                      // Reversal day
    
    const open = price;
    price = price * (1 + change);
    const close = price;
    const high = Math.max(open, close) * (1 + Math.random() * 0.03);
    const low = Math.min(open, close) * (1 - Math.random() * 0.03);
    
    // Volume spikes during pump
    let volMultiplier = 1;
    if (i >= 12 && i <= 17) volMultiplier = 3 + Math.random() * 2;
    if (i === 19) volMultiplier = 4; // High volume reversal
    
    candles.push({
      date: new Date(Date.now() - (19 - i) * 86400000).toISOString().split('T')[0],
      open,
      high,
      low,
      close,
      volume: Math.round(baseVolume * volMultiplier * (0.8 + Math.random() * 0.4))
    });
  }
  
  return candles;
}
