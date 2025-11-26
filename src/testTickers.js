/**
 * Test Tickers Reference
 * 
 * Curated lists for development and testing.
 * These are organized by profile to help validate different scenarios.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// HIGH-DILUTION, LOW-FLOAT, FREQUENT ATM NAMES (Best for Testing)
// These are the primary targets — small float, cash-strapped, known diluters
// ═══════════════════════════════════════════════════════════════════════════════
export const HIGH_DILUTION_TARGETS = [
  'FFIE',   // Faraday Future - EV, massive dilution history
  'CYN',    // Cyngn - autonomous vehicles, low float
  'GFAI',   // Guardforce AI - security/AI, frequent offerings
  'SIDU',   // Sidus Space - space tech, tiny float
  'HILS',   // Hillstream BioPharma - biotech, cash burner
  'MLGO',   // MicroAlgo - AI/crypto adjacent
  'BNOX',   // Bionomics - biotech
  'COSM',   // Cosmos Holdings - pharma distribution
  'PEGY',   // Pineapple Energy - solar/energy
  'AEMD',   // Aethlon Medical - biotech
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGULAR RUG-PULL / REVERSE-SPLIT CANDIDATES
// History of destroying shareholder value through dilution + R/S
// ═══════════════════════════════════════════════════════════════════════════════
export const RUG_PULL_CANDIDATES = [
  'TTOO',   // T2 Biosystems - diagnostics
  'TOP',    // TOP Financial Group
  'SNTI',   // Senti Biosciences - biotech
  'CRKN',   // Crown Electrokinetics
  'DRMA',   // Dermata Therapeutics
  'VGX',    // Vanguard - crypto
  'NVOS',   // Novo Integrated Sciences
  'ICCT',   // iCoreConnect
  'APLM',   // Apollomics - biotech
];

// ═══════════════════════════════════════════════════════════════════════════════
// BIOTECH CASH-BURNERS (often dilute pre-news)
// High burn rates, constant need for capital
// ═══════════════════════════════════════════════════════════════════════════════
export const BIOTECH_BURNERS = [
  'IMPP',   // Imperial Petroleum - tanker/energy (mislabeled but known diluter)
  'ONCY',   // Oncolytics Biotech
  'SLS',    // SELLAS Life Sciences
  'DBGI',   // Digital Brands Group
  'VTGN',   // VistaGen Therapeutics
  'TMDX',   // TransMedics - organ transplant tech
  'ACXP',   // Acurx Pharmaceuticals
  'TENX',   // Tenax Therapeutics
];

// ═══════════════════════════════════════════════════════════════════════════════
// CRYPTO-ADJACENT / MEME-WAVE SPECIALS
// High volatility, prone to parabolic runs and crashes
// ═══════════════════════════════════════════════════════════════════════════════
export const CRYPTO_MEME_PLAYS = [
  'MARA',   // Marathon Digital - BTC mining
  'RIOT',   // Riot Platforms - BTC mining
  'HIVE',   // HIVE Digital - crypto mining
  'BTBT',   // Bit Digital - BTC mining
  'HUDI',   // Huadi International
  'HKD',    // AMTD Digital - famous meme stock
  'AIKI',   // AIkido Pharma (crypto pivot)
  'PHUN',   // Phunware - meme/political plays
  'WISA',   // WiSA Technologies
];

// ═══════════════════════════════════════════════════════════════════════════════
// LARGE-CAP CONTROL SAMPLE (SHOULD NOT TRIGGER)
// These should NEVER fire a signal — use to validate false positive rate
// ═══════════════════════════════════════════════════════════════════════════════
export const CONTROL_LARGE_CAPS = [
  'AAPL',   // Apple
  'MSFT',   // Microsoft
  'NVDA',   // NVIDIA
  'GOOGL',  // Alphabet
  'AMZN',   // Amazon
  'META',   // Meta
  'V',      // Visa
  'JPM',    // JPMorgan
  'KO',     // Coca-Cola
  'PEP',    // PepsiCo
];

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK TEST SHORTLIST
// Start with these for initial development — most likely to have data & trigger
// ═══════════════════════════════════════════════════════════════════════════════
export const QUICK_TEST = [
  'FFIE',   // #1 pick - Faraday Future, notorious diluter
  'MARA',   // #2 pick - Marathon Digital, crypto miner with ATMs
  'GFAI',   // #3 pick - Guardforce AI, small float
];

// Default export for easy import
export default {
  HIGH_DILUTION_TARGETS,
  RUG_PULL_CANDIDATES,
  BIOTECH_BURNERS,
  CRYPTO_MEME_PLAYS,
  CONTROL_LARGE_CAPS,
  QUICK_TEST,
  
  // All test tickers combined (excluding control)
  ALL_TEST_TICKERS: [
    ...HIGH_DILUTION_TARGETS,
    ...RUG_PULL_CANDIDATES,
    ...BIOTECH_BURNERS,
    ...CRYPTO_MEME_PLAYS,
  ],
};
