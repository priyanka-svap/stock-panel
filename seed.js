// seed.js - Seed database WITH Firebase real-time updates + FUTURES SUPPORT (FIXED)
const mongoose = require('mongoose');
const Stock = require('./models/Stock');
const Index = require('./models/Index');
const User = require('./models/User');
const { updateMultipleStocks, updateAllIndices } = require('./services/liveDataService');
require('dotenv').config();

// Firebase Database URL
const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// =====================================================
// VALIDATION HELPER
// =====================================================

function isValidNumber(value) {
  return value !== null && 
         value !== undefined && 
         !isNaN(value) && 
         isFinite(value) && 
         typeof value === 'number';
}

function sanitizeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return isValidNumber(num) ? num : defaultValue;
}

// =====================================================
// HELPER FUNCTIONS FOR FUTURES
// =====================================================

/**
 * Get the last Thursday of a given month/year
 */
function getLastThursday(year, month) {
  const lastDay = new Date(year, month + 1, 0);
  const lastThursday = new Date(lastDay);
  
  while (lastThursday.getDay() !== 4) {
    lastThursday.setDate(lastThursday.getDate() - 1);
  }
  
  return lastThursday;
}

/**
 * Generate next 3 monthly expiry dates (current, next, far)
 */
function generateExpiryDates() {
  const today = new Date();
  const expiries = [];
  
  for (let i = 0; i < 4; i++) { // Generate 4 to ensure we get 3 valid ones
    const targetMonth = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const lastThursday = getLastThursday(targetMonth.getFullYear(), targetMonth.getMonth());
    
    // Only include future expiries
    if (lastThursday > today) {
      expiries.push(lastThursday);
    }
    
    if (expiries.length >= 3) break;
  }
  
  return expiries;
}

/**
 * Format expiry date as string (e.g., "JAN25", "FEB25")
 */
function formatExpiryString(date) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[date.getMonth()];
  const year = date.getFullYear().toString().slice(-2);
  return `${month}${year}`;
}

/**
 * Create future contract symbol (e.g., "RELIANCE-FUT-JAN25")
 */
function createFutureSymbol(baseSymbol, expiryDate) {
  return `${baseSymbol}-FUT-${formatExpiryString(expiryDate)}`;
}

// =====================================================
// COMPREHENSIVE STOCK SYMBOLS
// =====================================================

const stockSymbols = [
  // NIFTY 50 Stocks (All have F&O)
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL', 'KOTAKBANK',
  'LT', 'AXISBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI',
  'HCLTECH', 'WIPRO', 'TITAN', 'NESTLEIND', 'ULTRACEMCO',
  'SUNPHARMA', 'ONGC', 'NTPC', 'POWERGRID', 'M&M',
  'TATAMOTORS', 'TATASTEEL', 'ADANIPORTS', 'COALINDIA', 'JSWSTEEL',
  'GRASIM', 'BAJAJFINSV', 'HINDALCO', 'INDUSINDBK', 'DRREDDY',
  'CIPLA', 'EICHERMOT', 'DIVISLAB', 'HEROMOTOCO', 'APOLLOHOSP',
  'TECHM', 'TATACONSUM', 'BRITANNIA', 'SHRIRAMFIN', 'ADANIENT',
  'SBILIFE', 'LTIM', 'BAJAJ-AUTO', 'HDFCLIFE', 'TRENT',
  
  // Other Major Stocks
  'ADANIGREEN', 'ADANIPOWER', 'VEDL', 'BANKBARODA', 'PNB',
  'CANBK', 'UNIONBANK', 'IDFCFIRSTB', 'FEDERALBNK', 'BANDHANBNK',
  'AUBANK', 'RBLBANK', 'YESBANK', 'IDFC', 'CHOLAFIN',
  
  // IT & Tech
  'PERSISTENT', 'COFORGE', 'MPHASIS', 'INFOEDGE', 'ZOMATO',
  'PAYTM', 'NYKAA', 'POLICYBZR', 'ZEEL', 'BHARTIHEXA',
  
  // Pharma
  'BIOCON', 'LUPIN', 'TORNTPHARM', 'ALKEM', 'AUROPHARMA',
  'GLENMARK', 'ZYDUSLIFE', 'IPCALAB', 'LAURUSLABS', 'NATCOPHARM',
  
  // Auto
  'MAHINDRA', 'ASHOKLEY', 'MOTHERSON', 'BALKRISIND', 'MRF',
  'APOLLOTYRE', 'CEAT', 'EXIDEIND', 'AMBUJACEM', 'BOSCHLTD',
  
  // Energy & Power
  'ADANIENSOL', 'ADANITRANS', 'TATAPOWER', 'NHPC', 'SJVN',
  'TORNTPOWER', 'CESC', 'JSPL', 'SAIL', 'NMDC',
  
  // FMCG & Consumer
  'DABUR', 'GODREJCP', 'MARICO', 'EMAMILTD', 'COLPAL',
  'PGHH', 'MCDOWELL-N', 'RADICO', 'VBL', 'TATAELXSI',
  
  // Real Estate & Infrastructure
  'DLF', 'OBEROIRLTY', 'GODREJPROP', 'PRESTIGE', 'BRIGADE',
  'PHOENIXLTD', 'IBREALEST', 'SOBHA', 'SUNTECK', 'MAHLIFE',
  
  // Telecom & Media
  'IDEA', 'ROUTE', 'TTML', 'GTPL', 'HATHWAY',
  
  // Retail & E-commerce
  'DMART', 'ABFRL', 'SHOPERSTOP', 'VMART', 'ADITYA',
  
  // Manufacturing
  'HAVELLS', 'CROMPTON', 'VOLTAS', 'BLUESTARCO', 'WHIRLPOOL',
  'DIXON', 'AMBER', 'KAJARIACER', 'CENTURYPLY', 'GREENPLY'
];

// =====================================================
// COMPREHENSIVE F&O STOCKS LIST (150+ stocks)
// Based on NSE F&O segment as of 2024-2025
// =====================================================

const futureStocks = [
  // NIFTY 50 (All 50 stocks)
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL', 'KOTAKBANK',
  'LT', 'AXISBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI',
  'HCLTECH', 'WIPRO', 'TITAN', 'NESTLEIND', 'ULTRACEMCO',
  'SUNPHARMA', 'ONGC', 'NTPC', 'POWERGRID', 'M&M',
  'TATAMOTORS', 'TATASTEEL', 'ADANIPORTS', 'COALINDIA', 'JSWSTEEL',
  'GRASIM', 'BAJAJFINSV', 'HINDALCO', 'INDUSINDBK', 'DRREDDY',
  'CIPLA', 'EICHERMOT', 'DIVISLAB', 'HEROMOTOCO', 'APOLLOHOSP',
  'TECHM', 'TATACONSUM', 'BRITANNIA', 'SHRIRAMFIN', 'ADANIENT',
  'SBILIFE', 'LTIM', 'BAJAJ-AUTO', 'HDFCLIFE', 'TRENT',
  
  // NIFTY Next 50 (Major F&O stocks)
  'ADANIGREEN', 'ADANIPOWER', 'VEDL', 'BANKBARODA', 'PNB',
  'CANBK', 'UNIONBANK', 'IDFCFIRSTB', 'FEDERALBNK', 'BANDHANBNK',
  'GODREJCP', 'DABUR', 'MARICO', 'PIDILITIND', 'COLPAL',
  'BERGEPAINT', 'PAGEIND', 'HAVELLS', 'VOLTAS', 'WHIRLPOOL',
  'TORNTPHARM', 'ALKEM', 'AUROPHARMA', 'BIOCON', 'LUPIN',
  'GLENMARK', 'ZYDUSLIFE', 'IPCALAB', 'LAURUSLABS', 'NATCOPHARM',
  
  // Banking & Financial Services
  'AUBANK', 'RBLBANK', 'YESBANK', 'IDFC', 'CHOLAFIN',
  'MUTHOOTFIN', 'MANAPPURAM', 'LICHSGFIN', 'BAJAJHLDNG', 'PNBHOUSING',
  'RECLTD', 'PFC', 'IRFC', 'ICICIGI', 'SBICARD',
  'HDFCAMC', 'NAM-INDIA', 'CDSL', 'CAMS', 'MCX',
  
  // IT & Technology
  'PERSISTENT', 'COFORGE', 'MPHASIS', 'LTTS', 'MINDTREE',
  'INFOEDGE', 'ZOMATO', 'PAYTM', 'NYKAA', 'POLICYBZR',
  'ZEEL', 'BHARTIHEXA', 'TATAELXSI', 'ROUTE', 'TANLA',
  
  // Automobiles & Auto Components
  'MAHINDRA', 'ASHOKLEY', 'MOTHERSON', 'BALKRISIND', 'MRF',
  'APOLLOTYRE', 'CEAT', 'EXIDEIND', 'BOSCHLTD', 'AMARAJABAT',
  'ESCORTS', 'TVSMOTOR', 'BAJAJ-AUTO', 'HEROMOTOCO', 'EICHERMOT',
  'TIINDIA', 'BHARATFORG', 'ENDURANCE', 'SONA', 'MOTHERSON',
  
  // Metals & Mining
  'JSWSTEEL', 'TATASTEEL', 'HINDALCO', 'VEDL', 'SAIL',
  'NMDC', 'JINDALSTEL', 'HINDZINC', 'NATIONALUM', 'MOIL',
  'RATNAMANI', 'APL', 'WELCORP', 'WELSPUNIND', 'GMRINFRA',
  
  // Oil, Gas & Energy
  'ONGC', 'BPCL', 'IOC', 'GAIL', 'PETRONET',
  'ADANIGREEN', 'ADANITRANS', 'ADANIENSOL', 'TATAPOWER', 'NTPC',
  'NHPC', 'SJVN', 'POWERGRID', 'TORNTPOWER', 'CESC',
  'COALINDIA', 'OIL', 'GSPL', 'IGL', 'MGL',
  
  // Cement & Construction
  'AMBUJACEM', 'ACC', 'ULTRACEMCO', 'SHREECEM', 'RAMCOCEM',
  'DALMIACEM', 'JKCEMENT', 'STAR', 'HEIDELBERG', 'PRISM',
  'LT', 'LTTS', 'BEL', 'HAL', 'COCHINSHIP',
  'RVNL', 'IRCON', 'NBCC', 'NCC', 'KNR',
  
  // Pharmaceuticals
  'SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'TORNTPHARM',
  'LUPIN', 'BIOCON', 'ALKEM', 'AUROPHARMA', 'GLENMARK',
  'ZYDUSLIFE', 'IPCALAB', 'LAURUSLABS', 'NATCOPHARM', 'ABBOTINDIA',
  'SANOFI', 'PFIZER', 'GLAXO', 'CADILAHC', 'GRANULES',
  
  // Consumer Goods & Retail
  'HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM',
  'DABUR', 'GODREJCP', 'MARICO', 'EMAMILTD', 'COLPAL',
  'PGHH', 'MCDOWELL-N', 'RADICO', 'VBL', 'JUBLFOOD',
  'DMART', 'ABFRL', 'TRENT', 'SHOPERSTOP', 'VMART',
  
  // Telecom
  'BHARTIARTL', 'IDEA', 'ROUTE', 'TTML', 'GTPL',
  'HATHWAY', 'DEN', 'BHARTIHEXA', 'STLTECH', 'LTTS',
  
  // Media & Entertainment
  'ZEEL', 'PVRINOX', 'SUNTV', 'NAZARA', 'SAREGAMA',
  'TIPS', 'BALAJITELE', 'TVTODAY', 'NETWORK18', 'DISHMAN',
  
  // Real Estate
  'DLF', 'OBEROIRLTY', 'GODREJPROP', 'PRESTIGE', 'BRIGADE',
  'PHOENIXLTD', 'IBREALEST', 'SOBHA', 'SUNTECK', 'MAHLIFE',
  'LODHA', 'RAYMOND', 'SIGNATURE', 'MACROTECH', 'KOLTEPATIL'
];

// Remove duplicates from futureStocks
const uniqueFutureStocks = [...new Set(futureStocks)];

// ✅ FIX: futureStocks mein jo symbols hain but stockSymbols mein nahi —
// unka spot price MongoDB mein exist nahi karta, isliye skip hote hain
// Hum sirf wahi stocks ke futures banayenge jinke spot prices successfully fetch hue hain
// (seedDatabase() mein dynamic filter hoga — see below)
console.log(`\n📋 Total Future Stocks Configured: ${uniqueFutureStocks.length}\n`);

// =====================================================
// LOT SIZES (NSE F&O Segment)
// Updated as per NSE circular
// =====================================================

const lotSizes = {
  // NIFTY 50
  'RELIANCE': 250, 'TCS': 150, 'HDFCBANK': 550, 'INFY': 300, 'ICICIBANK': 1375,
  'HINDUNILVR': 300, 'ITC': 1600, 'SBIN': 1500, 'BHARTIARTL': 575, 'KOTAKBANK': 400,
  'LT': 300, 'AXISBANK': 600, 'BAJFINANCE': 125, 'ASIANPAINT': 150, 'MARUTI': 50,
  'HCLTECH': 450, 'WIPRO': 900, 'TITAN': 500, 'NESTLEIND': 25, 'ULTRACEMCO': 75,
  'SUNPHARMA': 700, 'ONGC': 2800, 'NTPC': 3000, 'POWERGRID': 2500, 'M&M': 300,
  'TATAMOTORS': 1250, 'TATASTEEL': 600, 'ADANIPORTS': 400, 'COALINDIA': 1750, 'JSWSTEEL': 500,
  'GRASIM': 250, 'BAJAJFINSV': 100, 'HINDALCO': 1250, 'INDUSINDBK': 400, 'DRREDDY': 125,
  'CIPLA': 700, 'EICHERMOT': 150, 'DIVISLAB': 125, 'HEROMOTOCO': 100, 'APOLLOHOSP': 100,
  'TECHM': 600, 'TATACONSUM': 700, 'BRITANNIA': 150, 'SHRIRAMFIN': 250, 'ADANIENT': 400,
  'SBILIFE': 500, 'LTIM': 250, 'BAJAJ-AUTO': 100, 'HDFCLIFE': 850, 'TRENT': 350,
  
  // Banking
  'BANKBARODA': 5400, 'PNB': 7000, 'CANBK': 3600, 'UNIONBANK': 5000, 'IDFCFIRSTB': 7500,
  'FEDERALBNK': 5000, 'BANDHANBNK': 2500, 'AUBANK': 1000, 'RBLBANK': 2500, 'YESBANK': 25000,
  'IDFC': 10000, 'CHOLAFIN': 700, 'MUTHOOTFIN': 500, 'MANAPPURAM': 3500, 'LICHSGFIN': 1000,
  
  // Pharma
  'BIOCON': 1500, 'LUPIN': 500, 'TORNTPHARM': 200, 'ALKEM': 150, 'AUROPHARMA': 700,
  'GLENMARK': 800, 'ZYDUSLIFE': 900, 'IPCALAB': 600, 'LAURUSLABS': 1000, 'NATCOPHARM': 700,
  
  // Auto
  'MAHINDRA': 400, 'ASHOKLEY': 3500, 'MOTHERSON': 5500, 'BALKRISIND': 200, 'MRF': 10,
  'APOLLOTYRE': 1500, 'CEAT': 250, 'EXIDEIND': 1800, 'BOSCHLTD': 25, 'TVSMOTOR': 300,
  'ESCORTS': 1500, 'AMARAJABAT': 1000, 'BHARATFORG': 700, 'TIINDIA': 500, 'ENDURANCE': 3500,
  
  // IT
  'PERSISTENT': 500, 'COFORGE': 100, 'MPHASIS': 250, 'LTTS': 125, 'INFOEDGE': 125,
  'ZOMATO': 2500, 'PAYTM': 1000, 'NYKAA': 3500, 'POLICYBZR': 3500, 'ZEEL': 2500,
  'TATAELXSI': 100, 'ROUTE': 1500, 'TANLA': 500, 'BHARTIHEXA': 900,
  
  // Metals
  'JINDALSTEL': 1000, 'HINDZINC': 1750, 'NATIONALUM': 5500, 'NMDC': 4000, 'SAIL': 4500,
  'VEDL': 2000, 'APL': 2500, 'WELCORP': 1500, 'WELSPUNIND': 7000, 'GMRINFRA': 10000,
  
  // Energy
  'BPCL': 1250, 'IOC': 4400, 'GAIL': 1500, 'PETRONET': 2000, 'ADANIGREEN': 300,
  'ADANIPOWER': 3750, 'ADANITRANS': 175, 'ADANIENSOL': 600, 'TATAPOWER': 2000, 'NHPC': 12000,
  'SJVN': 10000, 'TORNTPOWER': 1000, 'CESC': 900, 'OIL': 4000, 'IGL': 1500,
  'MGL': 500, 'GSPL': 3500, 'COALINDIA': 1750,
  
  // Cement
  'AMBUJACEM': 1250, 'ACC': 500, 'SHREECEM': 25, 'RAMCOCEM': 500, 'DALMIACEM': 300,
  'JKCEMENT': 200, 'STAR': 2500, 'HEIDELBERG': 1500,
  
  // Consumer
  'GODREJCP': 600, 'DABUR': 1000, 'MARICO': 1250, 'EMAMILTD': 1500, 'COLPAL': 350,
  'PGHH': 50, 'MCDOWELL-N': 250, 'RADICO': 500, 'VBL': 2500, 'JUBLFOOD': 1000,
  'DMART': 100, 'ABFRL': 2500, 'SHOPERSTOP': 1000, 'VMART': 500,
  
  // Real Estate
  'DLF': 1250, 'OBEROIRLTY': 600, 'GODREJPROP': 300, 'PRESTIGE': 250, 'BRIGADE': 3500,
  'PHOENIXLTD': 500, 'IBREALEST': 5500, 'SOBHA': 700, 'SUNTECK': 1500, 'MAHLIFE': 1000,
  
  // Telecom
  'IDEA': 20000, 'TTML': 7500, 'GTPL': 5000, 'HATHWAY': 15000, 'STLTECH': 5500,
  
  // Others
  'BEL': 3500, 'HAL': 1250, 'IRCON': 4000, 'RVNL': 3500, 'NBCC': 10000,
  'RECLTD': 3000, 'PFC': 2500, 'IRFC': 9000, 'ICICIGI': 350, 'SBICARD': 700,
  'HDFCAMC': 200, 'CDSL': 400, 'CAMS': 250, 'MCX': 350, 'PVRINOX': 250
};

function getLotSize(symbol) {
  return lotSizes[symbol] || 500; // Default lot size
}

// =====================================================
// FIREBASE UPDATE FUNCTION (REST API - No Admin SDK!)
// =====================================================

async function updateFirebase(path, data) {
  try {
    const url = `${FIREBASE_URL}/${path}.json`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Firebase update error (${path}):`, error.message);
    return false;
  }
}

async function batchUpdateFirebase(updates) {
  try {
    const url = `${FIREBASE_URL}/.json`;
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error('Firebase batch update error:', error.message);
    return false;
  }
}

// =====================================================
// CREATE FUTURE CONTRACTS WITH VALIDATION
// =====================================================

async function createFutureContracts(baseSymbol, spotPrice) {
  // Validate spot price
  if (!isValidNumber(spotPrice) || spotPrice <= 0) {
    console.error(`⚠️  Invalid spot price for ${baseSymbol}: ${spotPrice}`);
    return [];
  }

  const expiryDates = generateExpiryDates();
  const futureContracts = [];
  
  for (let i = 0; i < expiryDates.length; i++) {
    const expiryDate = expiryDates[i];
    const futureSymbol = createFutureSymbol(baseSymbol, expiryDate);
    
    // Calculate future price with premium (typically 0.5-2% based on time to expiry)
    const daysToExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
    const annualizedPremium = 0.08; // 8% per year
    const premium = (daysToExpiry / 365) * annualizedPremium;
    const futurePrice = spotPrice * (1 + premium);
    
    // Calculate random daily change (-2% to +2%)
    const percentChange = (Math.random() - 0.5) * 4;
    const priceChange = futurePrice * (percentChange / 100);
    
    // Validate all numeric values
    const validatedPrice = sanitizeNumber(futurePrice);
    const validatedChange = sanitizeNumber(percentChange);
    const validatedPriceChange = sanitizeNumber(priceChange);
    
    if (validatedPrice <= 0) {
      console.error(`⚠️  Invalid future price for ${futureSymbol}`);
      continue;
    }
    
    const futureContract = {
      symbol: futureSymbol,
      baseSymbol: baseSymbol,
      companyName: `${baseSymbol} Futures ${formatExpiryString(expiryDate)}`,
      contractType: 'FUTURE',
      expiryDate: expiryDate,
      expiryString: formatExpiryString(expiryDate),
      lotSize: getLotSize(baseSymbol),
      currentPrice: validatedPrice,
      percentageChange: validatedChange,
      priceChange: validatedPriceChange,
      dayHigh: validatedPrice * 1.015,
      dayLow: validatedPrice * 0.985,
      openPrice: sanitizeNumber(validatedPrice - validatedPriceChange),
      previousClose:sanitizeNumber( validatedPrice - validatedPriceChange),
      volume: Math.floor(Math.random() * 1000000) + 100000,
      openInterest: Math.floor(Math.random() * 5000000) + 500000,
      isActive: true,
      lastUpdated: new Date()
    };
    
    futureContracts.push(futureContract);
  }
  
  return futureContracts;
}

// =====================================================
// SEED DATABASE
// =====================================================

async function seedDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB');
    console.log('✅ Connected to MongoDB\n');
    
    // Clear existing data
    await Stock.deleteMany({});
    await Index.deleteMany({});
    console.log('🗑️  Cleared existing data\n');
    
    // ==========================================
    // SEED INDICES
    // ==========================================
    console.log('📊 Fetching live index data...');
    await updateAllIndices();
    const indexCount = await Index.countDocuments();
    console.log(`✅ Indices seeded: ${indexCount} indices\n`);
    
    // ==========================================
    // SEED SPOT STOCKS
    // ==========================================
    console.log(`📈 Fetching live data for ${stockSymbols.length} spot stocks...`);
    const results = await updateMultipleStocks(stockSymbols);
    const successful = results.filter(r => r.success).length;
    console.log(`✅ Successfully seeded ${successful}/${stockSymbols.length} spot stocks\n`);
    
    // ==========================================
    // UPDATE SPOT STOCKS WITH CONTRACT TYPE
    // ==========================================
    console.log('🏷️  Updating spot stocks with contract type...');
    await Stock.updateMany(
      { contractType: { $exists: false } },
      { 
        $set: { 
          contractType: 'SPOT',
          expiryDate: null,
          expiryString: null,
          baseSymbol: null,
          lotSize: null
        } 
      }
    );
    console.log('✅ Spot stocks updated with contract type\n');
    
    // ==========================================
    // SEED FUTURE CONTRACTS
    // ==========================================
    // ✅ FIX: Sirf wahi symbols ke futures banao jo MongoDB mein SPOT price ke saath exist karte hain
    // futureStocks list mein extra symbols hain jo Yahoo se fetch nahi hue — unhe skip karo
    const existingSpotSymbols = new Set(
      (await Stock.find({ contractType: { $in: ['SPOT', null] } }, 'symbol').lean())
        .map(s => s.symbol)
    );
    const effectiveFutureStocks = uniqueFutureStocks.filter(sym => existingSpotSymbols.has(sym));
    console.log(`🔮 Creating futures for ${effectiveFutureStocks.length}/${uniqueFutureStocks.length} stocks (rest had no spot price)...`);
    let totalFutures = 0;
    let successCount = 0;
    let failCount = 0;
    
    for (const symbol of effectiveFutureStocks) {
      try {
        const spotStock = await Stock.findOne({ 
          symbol, 
          $or: [
            { contractType: 'SPOT' },
            { contractType: { $exists: false } }
          ]
        });
        
        if (spotStock && isValidNumber(spotStock.currentPrice) && spotStock.currentPrice > 0) {
          const futureContracts = await createFutureContracts(symbol, spotStock.currentPrice);
          
          if (futureContracts.length > 0) {
            // Insert future contracts
            for (const contract of futureContracts) {
              try {
                await Stock.findOneAndUpdate(
                  { symbol: contract.symbol },
                  contract,
                  { upsert: true, new: true, runValidators: true }
                );
                totalFutures++;
              } catch (error) {
                console.error(`   ❌ Failed to save ${contract.symbol}: ${error.message}`);
                failCount++;
              }
            }
            successCount++;
          } else {
            console.warn(`   ⚠️  No valid futures created for ${symbol}`);
            failCount++;
          }
        } else {
          console.warn(`   ⚠️  Skipping ${symbol} - Invalid or missing spot price`);
          failCount++;
        }
      } catch (error) {
        console.error(`   ❌ Error processing ${symbol}: ${error.message}`);
        failCount++;
      }
    }
    
    console.log(`✅ Successfully created ${totalFutures} future contracts`);
    console.log(`   Success: ${successCount} stocks, Failed: ${failCount} stocks\n`);
    
    // ==========================================
    // PUSH TO FIREBASE 🔥
    // ==========================================
    console.log('🔥 Pushing data to Firebase...\n');
    
    // Get all stocks from MongoDB (both spot and futures)
    const spotStocks = await Stock.find({ 
      contractType: 'SPOT', 
      isActive: true 
    }).lean();
    
    const futureContracts = await Stock.find({ 
      contractType: 'FUTURE', 
      isActive: true 
    }).lean();
    
    const indices = await Index.find({}).lean();
    
    // Prepare Firebase updates with validation
    const firebaseUpdates = {};
    
    // Add spot stocks to Firebase
    spotStocks.forEach(stock => {
      if (isValidNumber(stock.currentPrice)) {
        firebaseUpdates[`stocks/spot/${stock.symbol}`] = {
          symbol: stock.symbol,
          companyName: stock.companyName || stock.symbol,
          contractType: 'SPOT',
          currentPrice: sanitizeNumber(stock.currentPrice, 0),
          percentageChange: sanitizeNumber(stock.percentageChange, 0),
          priceChange: sanitizeNumber(stock.priceChange, 0),
          dayHigh: sanitizeNumber(stock.dayHigh, 0),
          dayLow: sanitizeNumber(stock.dayLow, 0),
          openPrice: sanitizeNumber(stock.openPrice, 0),
          volume: sanitizeNumber(stock.volume, 0),
          lastUpdated: Date.now()
        };
      }
    });
    
    // Add future contracts to Firebase
    futureContracts.forEach(contract => {
      if (isValidNumber(contract.currentPrice)) {
        // Ask/Bid spread calculate karo
        const _cp   = sanitizeNumber(contract.currentPrice, 0);
        const _tick = 0.05;
        const _pct  = _cp < 500 ? 0.0004 : _cp < 5000 ? 0.000125 : 0.000075;
        const _half = _cp * _pct;
        const _ask  = sanitizeNumber(Math.round((_cp + _half) / _tick) * _tick);
        const _bid  = sanitizeNumber(Math.round((_cp - _half) / _tick) * _tick);
        const _key  = contract.symbol.replace(/[.#$[\]/]/g, "_");
        firebaseUpdates[`fo_contracts/${_key}`] = {
          symbol:           contract.symbol,
          baseSymbol:       contract.baseSymbol,
          companyName:      contract.companyName,
          contractType:     'FUTURE',
          exchange:         'NSE',
          expiryDate:       contract.expiryDate ? new Date(contract.expiryDate).toISOString().split('T')[0] : null,
          expiryString:     contract.expiryString,
          lotSize:          contract.lotSize,
          currentPrice:     _cp,
          percentageChange: sanitizeNumber(contract.percentageChange, 0),
          priceChange:      sanitizeNumber(contract.priceChange, 0),
          dayHigh:          sanitizeNumber(contract.dayHigh, 0),
          dayLow:           sanitizeNumber(contract.dayLow, 0),
          openPrice:        sanitizeNumber(contract.openPrice, 0),
          previousClose:    sanitizeNumber(contract.previousClose, 0),
          volume:           sanitizeNumber(contract.volume, 0),
          openInterest:     sanitizeNumber(contract.openInterest, 0),
          askPrice:         _ask,
          bidPrice:         _bid,
          spread:           sanitizeNumber(_ask - _bid, 0),
          daysToExpiry:     contract.expiryDate ? Math.max(0, Math.ceil((new Date(contract.expiryDate) - new Date()) / 86400000)) : null,
          lastUpdated:      Date.now()
        };
      }
    });
    
    // Add indices to Firebase
    indices.forEach(index => {
      firebaseUpdates[`indices/${index.name}`] = {
        name: index.name,
        displayName: index.displayName || index.name,
        value: sanitizeNumber(index.value, 0),
        percentageChange: sanitizeNumber(index.percentageChange, 0),
        change: sanitizeNumber(index.change, 0),
        dayHigh: sanitizeNumber(index.dayHigh, 0),
        dayLow: sanitizeNumber(index.dayLow, 0),
        openValue: sanitizeNumber(index.openValue, 0),
        lastUpdated: Date.now()
      };
    });
    
    // Batch update to Firebase
    const firebaseSuccess = await batchUpdateFirebase(firebaseUpdates);
    
    if (firebaseSuccess) {
      console.log(`✅ Pushed ${spotStocks.length} spot stocks to Firebase`);
      console.log(`✅ Pushed ${futureContracts.length} future contracts to Firebase`);
      console.log(`✅ Pushed ${indices.length} indices to Firebase\n`);
    } else {
      console.log('⚠️  Firebase push failed (continuing anyway)\n');
    }
    // ==========================================
    // SEED MCX CONTRACTS 🥇
    // Gold, Silver, Crude Oil, Base Metals
    // ==========================================
    console.log('\n🥇 Seeding MCX Contracts (Gold, Silver, Crude Oil, Metals)...');

    const MCX_SEED = [
      // Gold
      { symbol: 'GOLD-MAR26',       base: 'GOLD',       name: 'Gold',            unit: '10g',    lotSize: 100,  basePrice: 89500,  sector: 'PRECIOUS_METAL' },
      { symbol: 'GOLDM-MAR26',      base: 'GOLDM',      name: 'Gold Mini',       unit: '10g',    lotSize: 10,   basePrice: 89500,  sector: 'PRECIOUS_METAL' },
      { symbol: 'GOLDPETAL-MAR26',  base: 'GOLDPETAL',  name: 'Gold Petal',      unit: '1g',     lotSize: 1,    basePrice: 8950,   sector: 'PRECIOUS_METAL' },
      { symbol: 'SILVER-MAR26',     base: 'SILVER',     name: 'Silver',          unit: '1kg',    lotSize: 30,   basePrice: 102000, sector: 'PRECIOUS_METAL' },
      { symbol: 'SILVERM-MAR26',    base: 'SILVERM',    name: 'Silver Mini',     unit: '1kg',    lotSize: 5,    basePrice: 102000, sector: 'PRECIOUS_METAL' },
      { symbol: 'SILVERMIC-MAR26',  base: 'SILVERMIC',  name: 'Silver Micro',    unit: '1kg',    lotSize: 1,    basePrice: 102000, sector: 'PRECIOUS_METAL' },
      // Energy
      { symbol: 'CRUDEOIL-MAR26',   base: 'CRUDEOIL',   name: 'Crude Oil',       unit: 'BBL',    lotSize: 100,  basePrice: 6200,   sector: 'ENERGY' },
      { symbol: 'CRUDEOILM-MAR26',  base: 'CRUDEOILM',  name: 'Crude Oil Mini',  unit: 'BBL',    lotSize: 10,   basePrice: 6200,   sector: 'ENERGY' },
      { symbol: 'NATURALGAS-MAR26', base: 'NATURALGAS', name: 'Natural Gas',     unit: 'MMBTU',  lotSize: 1250, basePrice: 280,    sector: 'ENERGY' },
      { symbol: 'NATURALGASM-MAR26',base: 'NATURALGASM',name: 'Natural Gas Mini',unit: 'MMBTU',  lotSize: 250,  basePrice: 280,    sector: 'ENERGY' },
      // Base Metals
      { symbol: 'COPPER-MAR26',     base: 'COPPER',     name: 'Copper',          unit: 'kg',     lotSize: 2500, basePrice: 845,    sector: 'BASE_METAL' },
      { symbol: 'COPPERM-MAR26',    base: 'COPPERM',    name: 'Copper Mini',     unit: 'kg',     lotSize: 250,  basePrice: 845,    sector: 'BASE_METAL' },
      { symbol: 'ZINC-MAR26',       base: 'ZINC',       name: 'Zinc',            unit: 'kg',     lotSize: 5000, basePrice: 265,    sector: 'BASE_METAL' },
      { symbol: 'ZINCMINI-MAR26',   base: 'ZINCMINI',   name: 'Zinc Mini',       unit: 'kg',     lotSize: 1000, basePrice: 265,    sector: 'BASE_METAL' },
      { symbol: 'LEAD-MAR26',       base: 'LEAD',       name: 'Lead',            unit: 'kg',     lotSize: 5000, basePrice: 185,    sector: 'BASE_METAL' },
      { symbol: 'LEADMINI-MAR26',   base: 'LEADMINI',   name: 'Lead Mini',       unit: 'kg',     lotSize: 1000, basePrice: 185,    sector: 'BASE_METAL' },
      { symbol: 'ALUMINIUM-MAR26',  base: 'ALUMINIUM',  name: 'Aluminium',       unit: 'kg',     lotSize: 5000, basePrice: 235,    sector: 'BASE_METAL' },
      { symbol: 'ALUMINIUMM-MAR26', base: 'ALUMINIUMM', name: 'Aluminium Mini',  unit: 'kg',     lotSize: 1000, basePrice: 235,    sector: 'BASE_METAL' },
      { symbol: 'NICKEL-MAR26',     base: 'NICKEL',     name: 'Nickel',          unit: 'kg',     lotSize: 1500, basePrice: 1425,   sector: 'BASE_METAL' },
      { symbol: 'NICKELM-MAR26',    base: 'NICKELM',    name: 'Nickel Mini',     unit: 'kg',     lotSize: 100,  basePrice: 1425,   sector: 'BASE_METAL' },
    ];

    // MCX expiry — next 3 months
    const mcxExpiries = [];
    const mcxMonths = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    for (let i = 1; i <= 3; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() + i);
      d.setDate(5); d.setHours(23, 55, 0, 0);
      mcxExpiries.push({ date: d, str: `${mcxMonths[d.getMonth()]}${d.getFullYear().toString().slice(-2)}` });
    }

    const mcxContracts = [];
    const mcxFirebaseUpdates = {};

    for (const cfg of MCX_SEED) {
      for (const exp of mcxExpiries) {
        const sym          = `${cfg.base}-${exp.str}`;
        const daysToExp    = Math.max(0, Math.ceil((exp.date - new Date()) / 86400000));
        const premium      = cfg.basePrice * (daysToExp / 365) * 0.06;
        const price        = parseFloat((cfg.basePrice + premium).toFixed(2));
        const prevClose    = parseFloat((cfg.basePrice * 0.998).toFixed(2));
        const priceChange  = parseFloat((price - prevClose).toFixed(2));
        const pctChange    = parseFloat(((priceChange / prevClose) * 100).toFixed(2));

        // MCX ask/bid (wider spread — 0.03%)
        const mcxTick = 0.1;
        const mcxHalf = price * 0.00015;
        const mcxAsk  = parseFloat((Math.round((price + mcxHalf) / mcxTick) * mcxTick).toFixed(2));
        const mcxBid  = parseFloat((Math.round((price - mcxHalf) / mcxTick) * mcxTick).toFixed(2));

        mcxContracts.push({
          symbol: sym, companyName: cfg.name, contractType: 'FUTURE',
          exchange: 'MCX', baseSymbol: cfg.base,
          expiryDate: exp.date, expiryString: exp.str,
          lotSize: cfg.lotSize, currentPrice: price,
          previousClose: prevClose, priceChange: priceChange,
          percentageChange: pctChange,
          dayHigh: parseFloat((price * 1.005).toFixed(2)),
          dayLow:  parseFloat((price * 0.995).toFixed(2)),
          openPrice: prevClose, volume: 0, openInterest: 0,
          sector: cfg.sector, industry: 'COMMODITY', isActive: true
        });

        // Firebase push — mcx_contracts path
        const fbKey = sym.replace(/[.#$[\]/]/g, '_');
        mcxFirebaseUpdates[`mcx_contracts/${fbKey}`] = {
          symbol: sym, displayName: cfg.name, exchange: 'MCX',
          unit: cfg.unit, lotSize: cfg.lotSize,
          currentPrice: price, priceChange: priceChange,
          percentageChange: pctChange,
          dayHigh: parseFloat((price * 1.005).toFixed(2)),
          dayLow:  parseFloat((price * 0.995).toFixed(2)),
          openPrice: prevClose, previousClose: prevClose,
          volume: 0,
          askPrice: mcxAsk, bidPrice: mcxBid,
          spread: parseFloat((mcxAsk - mcxBid).toFixed(2)),
          contractType: 'MCX_FUTURE', sector: cfg.sector,
          daysToExpiry: daysToExp, lastUpdated: Date.now()
        };
      }
    }

    if (mcxContracts.length > 0) {
      // Delete old MCX contracts and insert fresh
      await Stock.deleteMany({ exchange: 'MCX' });
      await Stock.insertMany(mcxContracts);
      console.log(`✅ MCX MongoDB: ${mcxContracts.length} contracts seeded`);
    }

    // Firebase MCX push
    if (Object.keys(mcxFirebaseUpdates).length > 0) {
      const mcxFbOk = await batchUpdateFirebase(mcxFirebaseUpdates);
      if (mcxFbOk) {
        console.log(`✅ MCX Firebase: ${Object.keys(mcxFirebaseUpdates).length} contracts pushed to mcx_contracts`);
      } else {
        console.log('⚠️  MCX Firebase push failed');
      }
    }

    
    // ==========================================
    // CREATE DEMO USER
    // ==========================================
    const demoUser = await User.findOne({ username: 'demo' });
    if (!demoUser) {
      const user = new User({
        username: 'demo',
        password: 'demo123',
        email: 'demo@stockpanel.com',
        fullName: 'Demo User',
        availableBalance: 100000,
        portfolioValue: 50000,
        totalPnL: 2500
      });
      await user.save();
      console.log('👤 Demo user created:');
      console.log('   Username: demo');
      console.log('   Password: demo123\n');
    }
    
    // ==========================================
    // DISPLAY SUMMARY
    // ==========================================
    const sampleSpotStocks = await Stock.find({ contractType: 'SPOT' })
      .sort({ percentageChange: -1 })
      .limit(10);
    
    console.log('📊 Top 10 Spot Stocks (by % change):');
    console.log('═'.repeat(90));
    sampleSpotStocks.forEach(stock => {
      const change = stock.percentageChange > 0 
        ? `+${stock.percentageChange.toFixed(2)}%` 
        : `${stock.percentageChange.toFixed(2)}%`;
      const emoji = stock.percentageChange > 0 ? '🟢' : '🔴';
      console.log(`${emoji} ${stock.symbol.padEnd(15)} ₹${Number(stock.currentPrice).toFixed(2).padStart(10)} ${change.padStart(10)}`);
    });
    console.log('═'.repeat(90));
    
    const sampleFutures = await Stock.find({ contractType: 'FUTURE' })
      .sort({ expiryDate: 1 })
      .limit(15);
    
    console.log('\n🔮 Sample Future Contracts (sorted by expiry):');
    console.log('═'.repeat(110));
    sampleFutures.forEach(contract => {
      const change = contract.percentageChange > 0 
        ? `+${contract.percentageChange.toFixed(2)}%` 
        : `${contract.percentageChange.toFixed(2)}%`;
      const emoji = contract.percentageChange > 0 ? '🟢' : '🔴';
      const lotInfo = `Lot:${contract.lotSize}`.padStart(10);
      console.log(`${emoji} ${contract.symbol.padEnd(25)} ₹${Number(contract.currentPrice).toFixed(2).padStart(10)} ${change.padStart(10)} ${lotInfo}`);
    });
    console.log('═'.repeat(110));
    
    const allIndices = await Index.find({});
    console.log('\n📊 Market Indices:');
    console.log('═'.repeat(90));
    allIndices.forEach(index => {
      const change = index.percentageChange > 0 
        ? `+${index.percentageChange.toFixed(2)}%` 
        : `${index.percentageChange.toFixed(2)}%`;
      const emoji = index.percentageChange > 0 ? '🟢' : '🔴';
      console.log(`${emoji} ${index.displayName.padEnd(20)} ${index.value.toFixed(2).padStart(12)} ${change.padStart(10)}`);
    });
    console.log('═'.repeat(90));
    
    // Statistics
    const totalSpotStocks     = await Stock.countDocuments({ contractType: 'SPOT' });
    const totalNseFutures     = await Stock.countDocuments({ contractType: 'FUTURE', exchange: { $ne: 'MCX' } });
    const totalMcxContracts   = await Stock.countDocuments({ contractType: 'FUTURE', exchange: 'MCX' });
    
    // Group NSE futures by base symbol
    const futuresByBase = await Stock.aggregate([
      { $match: { contractType: 'FUTURE', exchange: { $ne: 'MCX' } } },
      { $group: { _id: '$baseSymbol', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    console.log('\n📈 Database Statistics:');
    console.log('═'.repeat(90));
    console.log(`   Spot Stocks:                ${totalSpotStocks}`);
    console.log(`   NSE F&O Contracts:          ${totalNseFutures}`);
    console.log(`   MCX Contracts:              ${totalMcxContracts} (Gold/Silver/Crude/Metals)`);
    console.log(`   Stocks with Futures:        ${futuresByBase.length}`);
    console.log(`   Market Indices:             ${allIndices.length}`);
    console.log(`   Total Instruments:          ${totalSpotStocks + totalNseFutures + totalMcxContracts}`);
    console.log('═'.repeat(90));
    
    console.log('\n✨ Database seeding completed!');
    console.log('🔥 Firebase synced: fo_contracts (NSE) + mcx_contracts (MCX) + indices');
    console.log('💡 Start the server with: npm start\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seedDatabase();