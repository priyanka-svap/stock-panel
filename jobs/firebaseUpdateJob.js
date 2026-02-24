// jobs/firebaseUpdateJob.js
// ✅ Stocks (SPOT): MongoDB se fetch → Firebase UPSERT (naya ho toh add, purana ho toh update)
// ✅ Futures (FUTURE): Spot price se live derive → MongoDB UPSERT → Firebase UPSERT with expiry countdown
//    → Naya contract aaye toh ADD, purana ho toh UPDATE (price realtime, both DB + Firebase)
// ✅ Indices: MongoDB se fetch → Firebase UPSERT
// ✅ Watchlist: Har user ki watchlist Firebase mein live prices ke saath sync
// ✅ Futures price = Spot price + cost-of-carry basis (daysToExpiry * annualRate)
// ✅ 1ms interval → seed.js ki tarah same structure

const Stock     = require('../models/Stock');
const Index     = require('../models/Index');
const Watchlist = require('../models/Watchlist');
const User      = require('../models/User');
const { updateMultipleStocks, updateAllIndices } = require('../services/liveDataService');

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// ─────────────────────────────────────────────────────
// Seed.js se liya same ACTIVE_SYMBOLS list
// ─────────────────────────────────────────────────────

const ACTIVE_SYMBOLS = [
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

// ─────────────────────────────────────────────────────
// NaN protection (seed.js se same)
// ─────────────────────────────────────────────────────
function sanitizeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return (!isNaN(num) && isFinite(num)) ? num : defaultValue;
}

// Firebase key safe banana (seed.js se same logic)
function safeKey(str) {
  return String(str).replace(/[.#$\[\]\/]/g, '_');
}

// ─────────────────────────────────────────────────────
// Firebase REST API helpers
// ─────────────────────────────────────────────────────
async function batchUpdateFirebase(updates) {
  try {
    const url = `${FIREBASE_URL}/.json`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.error('❌ Firebase batch error:', error.message);
    return false;
  }
}

async function updateFirebase(path, data) {
  try {
    const url = `${FIREBASE_URL}/${path}.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.error(`❌ Firebase PUT error (${path}):`, error.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────
// UPSERT LOGIC:
// - Firebase se existing keys fetch karo (GET)
// - MongoDB se fresh data fetch karo
// - Naye record? → ADD
// - Purane record? → UPDATE price/values
// - Sab ek PATCH call mein push karo
// ─────────────────────────────────────────────────────

// Get all existing keys from a Firebase path
async function getFirebaseKeys(path) {
  try {
    const url = `${FIREBASE_URL}/${path}.json?shallow=true`;
    const response = await fetch(url);
    if (!response.ok) return {};
    const data = await response.json();
    return data || {};
  } catch (e) {
    return {};
  }
}

// ─────────────────────────────────────────────────────
// 1. SPOT STOCKS UPDATE (UPSERT)
// Seed.js structure: stocks/spot/{SYMBOL}
// ─────────────────────────────────────────────────────
async function updateSpotStocks() {
  try {
    // Step 1: Live data fetch → MongoDB update
    await updateMultipleStocks(ACTIVE_SYMBOLS);

    // Step 2: MongoDB se all SPOT stocks fetch karo
    const stocks = await Stock.find({
      $or: [
        { contractType: 'SPOT' },
        { contractType: { $exists: false } }
      ],
      isActive: true
    }).lean();

    if (!stocks.length) return;

    // Step 3: Firebase pe kya already hai
    const existingKeys = await getFirebaseKeys('stocks/spot');

    const updates = {};
    let newCount    = 0;
    let updateCount = 0;

    stocks.forEach(stock => {
      const key = safeKey(stock.symbol);
      const isNew = !existingKeys[key];
      if (isNew) newCount++; else updateCount++;

      // Seed.js ke saath same structure
      updates[`stocks/spot/${key}`] = {
        symbol:           stock.symbol,
        companyName:      stock.companyName || stock.symbol,
        contractType:     'SPOT',
        currentPrice:     sanitizeNumber(stock.currentPrice),
        percentageChange: sanitizeNumber(stock.percentageChange),
        priceChange:      sanitizeNumber(stock.priceChange),
        dayHigh:          sanitizeNumber(stock.dayHigh),
        dayLow:           sanitizeNumber(stock.dayLow),
        openPrice:        sanitizeNumber(stock.openPrice),
        previousClose:    sanitizeNumber(stock.previousClose),
        volume:           sanitizeNumber(stock.volume),
        sector:           stock.sector || 'Unknown',
        lastUpdated:      Date.now()
      };
    });

    await batchUpdateFirebase(updates);
    console.log(`📈 Spot: ${updateCount} updated, ${newCount} new → total ${stocks.length}`);

  } catch (e) {
    console.error('❌ Spot stocks update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// 2. FUTURES UPDATE (UPSERT with expiry)
// ✅ Live price → MongoDB update → Firebase UPSERT
// Seed.js structure: stocks/futures/{SYMBOL}
// + fo_contracts/{SYMBOL} (with expiry countdown)
// ─────────────────────────────────────────────────────

// Helper: baseSymbol se spot price fetch karo aur futures price derive karo
async function refreshFuturePricesFromSpot() {
  try {
    // Step 1: Saare active futures fetch karo (unexpired)
    const now = new Date();
    const futures = await Stock.find({
      contractType: { $in: ['FUTURE', 'FUTURES'] },
      isActive: true,
      $or: [
        { expiryDate: { $gt: now } },
        { expiryDate: null }
      ]
    }).lean();

    if (!futures.length) return;

    // Step 2: Unique baseSymbols nikalo
    const baseSymbols = [...new Set(
      futures.map(f => f.baseSymbol || f.symbol.split('-')[0]).filter(Boolean)
    )];

    // Step 3: Spot stocks se live prices fetch karo (already updated by updateSpotStocks)
    const spotStocks = await Stock.find({
      symbol: { $in: baseSymbols },
      $or: [{ contractType: 'SPOT' }, { contractType: { $exists: false } }]
    }).lean();

    const spotPriceMap = {};
    spotStocks.forEach(s => {
      spotPriceMap[s.symbol] = {
        currentPrice:     sanitizeNumber(s.currentPrice),
        percentageChange: sanitizeNumber(s.percentageChange),
        priceChange:      sanitizeNumber(s.priceChange),
        dayHigh:          sanitizeNumber(s.dayHigh),
        dayLow:           sanitizeNumber(s.dayLow),
        openPrice:        sanitizeNumber(s.openPrice),
        previousClose:    sanitizeNumber(s.previousClose),
        volume:           sanitizeNumber(s.volume)
      };
    });

    // Step 4: Har future contract ka price update karo MongoDB mein
    const bulkOps = [];
    for (const contract of futures) {
      const base  = contract.baseSymbol || contract.symbol.split('-')[0];
      const spot  = spotPriceMap[base];
      if (!spot || spot.currentPrice <= 0) continue;

      // Future premium = spot price + basis (annualized)
      const expiryDate    = contract.expiryDate ? new Date(contract.expiryDate) : null;
      const daysToExpiry  = expiryDate
        ? Math.max(0, Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)))
        : 0;
      const annualRate    = 0.08; // 8% cost of carry
      const basisPremium  = spot.currentPrice * (daysToExpiry / 365) * annualRate;
      const futurePrice   = sanitizeNumber(spot.currentPrice + basisPremium);

      const prevClose     = sanitizeNumber(contract.previousClose || spot.previousClose || futurePrice);
      const priceChange   = sanitizeNumber(futurePrice - prevClose);
      const pctChange     = prevClose > 0
        ? sanitizeNumber((priceChange / prevClose) * 100)
        : sanitizeNumber(spot.percentageChange);

      bulkOps.push({
        updateOne: {
          filter: { symbol: contract.symbol },
          update: {
            $set: {
              currentPrice:     futurePrice,
              percentageChange: pctChange,
              priceChange:      priceChange,
              dayHigh:          sanitizeNumber(Math.max(contract.dayHigh || 0, futurePrice)),
              dayLow:           sanitizeNumber(contract.dayLow > 0 ? Math.min(contract.dayLow, futurePrice) : futurePrice * 0.99),
              openPrice:        sanitizeNumber(contract.openPrice || spot.openPrice || futurePrice),
              previousClose:    prevClose,
              volume:           sanitizeNumber(contract.volume || spot.volume),
              openInterest:     sanitizeNumber(contract.openInterest),
              lastUpdated:      new Date()
            }
          }
        }
      });
    }

    if (bulkOps.length > 0) {
      await Stock.bulkWrite(bulkOps, { ordered: false });
    }

  } catch (e) {
    console.error('❌ Future price refresh error:', e.message);
  }
}

async function updateFutureContracts() {
  try {
    // Step 1: Spot prices se futures ki live price MongoDB mein update karo
    await refreshFuturePricesFromSpot();

    // Step 2: Updated futures MongoDB se fetch karo
    const now     = Date.now();
    const nowDate = new Date();

    const futures = await Stock.find({
      contractType: { $in: ['FUTURE', 'FUTURES'] },
      isActive: true
    }).lean();

    if (!futures.length) {
      console.log('⚠️  No futures in MongoDB');
      return;
    }

    // Step 3: Firebase ke existing keys (UPSERT ke liye)
    const existingSpotKeys = await getFirebaseKeys('stocks/futures');
    const existingFoKeys   = await getFirebaseKeys('fo_contracts');

    const updates    = {};
    let newCount     = 0;
    let updateCount  = 0;
    let expiredCount = 0;

    futures.forEach(contract => {
      const key = safeKey(contract.symbol);

      // Expiry calculation
      let daysToExpiry = null;
      let isExpired    = false;

      if (contract.expiryDate) {
        const expiryTime = new Date(contract.expiryDate).getTime();
        const diffMs     = expiryTime - now;
        daysToExpiry     = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        isExpired        = diffMs < 0;
      }

      // Expired contracts skip (Firebase se bhi hata sakte ho agar chahiye)
      if (isExpired) { expiredCount++; return; }

      // UPSERT check: naya hai ya purana
      const isNewSpot = !existingSpotKeys[key];
      const isNewFo   = !existingFoKeys[key];
      if (isNewSpot || isNewFo) newCount++; else updateCount++;

      const baseData = {
        symbol:           contract.symbol,
        baseSymbol:       contract.baseSymbol || contract.symbol.split('-')[0],
        companyName:      contract.companyName || contract.symbol,
        contractType:     'FUTURE',
        expiryDate:       contract.expiryDate ? new Date(contract.expiryDate).getTime() : null,
        expiryString:     contract.expiryString || contract.expiryMonth || null,
        lotSize:          sanitizeNumber(contract.lotSize, 1),
        // ✅ LIVE price fields (freshly updated from spot)
        currentPrice:     sanitizeNumber(contract.currentPrice),
        percentageChange: sanitizeNumber(contract.percentageChange),
        priceChange:      sanitizeNumber(contract.priceChange),
        dayHigh:          sanitizeNumber(contract.dayHigh),
        dayLow:           sanitizeNumber(contract.dayLow),
        openPrice:        sanitizeNumber(contract.openPrice),
        previousClose:    sanitizeNumber(contract.previousClose),
        volume:           sanitizeNumber(contract.volume),
        openInterest:     sanitizeNumber(contract.openInterest),
        lastUpdated:      now
      };

      // stocks/futures/{key} → seed.js compatible structure
      updates[`stocks/futures/${key}`] = baseData;

      // fo_contracts/{key} → extra expiry info
      updates[`fo_contracts/${key}`] = {
        ...baseData,
        expiryDate:   contract.expiryDate ? new Date(contract.expiryDate).toISOString() : null,
        daysToExpiry: daysToExpiry,
        isExpired:    isExpired
      };
    });

    if (Object.keys(updates).length > 0) {
      await batchUpdateFirebase(updates);
    }

    console.log(`🔮 Futures: ${updateCount} updated, ${newCount} new, ${expiredCount} expired skipped → total ${futures.length - expiredCount} live`);

  } catch (e) {
    console.error('❌ Futures update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// 3. INDICES UPDATE (UPSERT)
// Seed.js structure: indices/{NAME}
// ─────────────────────────────────────────────────────
async function updateIndices() {
  try {
    // Live data → MongoDB
    await updateAllIndices();

    // MongoDB se fetch
    const indices = await Index.find({}).lean();
    if (!indices.length) return;

    // Firebase existing keys
    const existingKeys = await getFirebaseKeys('indices');

    const updates = {};
    let newCount    = 0;
    let updateCount = 0;

    indices.forEach(index => {
      const key = safeKey(index.name);
      const isNew = !existingKeys[key];
      if (isNew) newCount++; else updateCount++;

      // Seed.js ke saath same structure
      updates[`indices/${key}`] = {
        name:             index.name,
        displayName:      index.displayName || index.name,
        value:            sanitizeNumber(index.value),
        percentageChange: sanitizeNumber(index.percentageChange),
        change:           sanitizeNumber(index.change),
        dayHigh:          sanitizeNumber(index.dayHigh),
        dayLow:           sanitizeNumber(index.dayLow),
        openValue:        sanitizeNumber(index.openValue),
        previousClose:    sanitizeNumber(index.previousClose),
        lastUpdated:      Date.now()
      };
    });

    await batchUpdateFirebase(updates);
    console.log(`📊 Indices: ${updateCount} updated, ${newCount} new → total ${indices.length}`);

  } catch (e) {
    console.error('❌ Indices update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// 4. WATCHLIST SYNC (with live prices)
// Structure: users/{userId}/watchlist/{symbol}
// ─────────────────────────────────────────────────────
async function updateAllUsersWatchlist() {
  try {
    // All active users
    const users = await User.find({ isActive: true }, '_id username').lean();
    if (!users.length) return;

    // Collect all watchlist symbols to fetch prices once
    const allWatchlists = await Watchlist.find({
      userId: { $in: users.map(u => u._id) }
    }).lean();

    if (!allWatchlists.length) return;

    // Collect unique symbols
    const allSymbols = new Set();
    allWatchlists.forEach(wl => {
      if (wl.stocks && Array.isArray(wl.stocks)) {
        wl.stocks.forEach(s => s.symbol && allSymbols.add(s.symbol));
      } else if (wl.symbol) {
        allSymbols.add(wl.symbol);
      }
    });

    // Fetch live prices for all watchlist symbols
    const stocks = await Stock.find({
      symbol: { $in: [...allSymbols] },
      $or: [{ contractType: 'SPOT' }, { contractType: { $exists: false } }]
    }).lean();

    const priceMap = {};
    stocks.forEach(s => {
      priceMap[s.symbol] = {
        currentPrice:     sanitizeNumber(s.currentPrice),
        percentageChange: sanitizeNumber(s.percentageChange),
        priceChange:      sanitizeNumber(s.priceChange),
        dayHigh:          sanitizeNumber(s.dayHigh),
        dayLow:           sanitizeNumber(s.dayLow),
        companyName:      s.companyName || s.symbol
      };
    });

    // Build Firebase updates - group by userId
    const wlByUser = {};
    allWatchlists.forEach(wl => {
      const uid = wl.userId.toString();
      if (!wlByUser[uid]) wlByUser[uid] = [];
      wlByUser[uid].push(wl);
    });

    const updates = {};

    for (const [uid, userWatchlists] of Object.entries(wlByUser)) {
      const watchlistData = {};

      userWatchlists.forEach(wl => {
        // Handle both structures: stocks array OR flat symbol
        const stocksArr = wl.stocks && Array.isArray(wl.stocks)
          ? wl.stocks
          : (wl.symbol ? [{ symbol: wl.symbol, addedAt: wl.createdAt }] : []);

        stocksArr.forEach((item, idx) => {
          if (!item.symbol) return;
          const symKey  = safeKey(item.symbol);
          const pricing = priceMap[item.symbol] || {};

          watchlistData[symKey] = {
            symbol:           item.symbol,
            companyName:      pricing.companyName || item.symbol,
            currentPrice:     pricing.currentPrice     || 0,
            percentageChange: pricing.percentageChange || 0,
            priceChange:      pricing.priceChange      || 0,
            dayHigh:          pricing.dayHigh           || 0,
            dayLow:           pricing.dayLow            || 0,
            addedAt:          item.addedAt || wl.createdAt || Date.now(),
            position:         idx,
            lastUpdated:      Date.now()
          };
        });
      });

      if (Object.keys(watchlistData).length > 0) {
        updates[`users/${uid}/watchlist`] = watchlistData;
      }
    }

    if (Object.keys(updates).length > 0) {
      await batchUpdateFirebase(updates);
      console.log(`👁️  Watchlist: ${Object.keys(updates).length} users synced`);
    }

  } catch (e) {
    console.error('❌ Watchlist sync error:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// Market Status (IST)
// ─────────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const cur = ist.getHours() * 60 + ist.getMinutes();
  return cur >= (9 * 60 + 15) && cur <= (15 * 60 + 30);
}

function getMarketStatus() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return {
    isOpen:  isMarketOpen(),
    time:    ist.toLocaleTimeString('en-IN'),
    status:  isMarketOpen() ? '🟢 OPEN' : '🔴 CLOSED'
  };
}

// ─────────────────────────────────────────────────────
// INTERVALS
// ─────────────────────────────────────────────────────
let spotInterval      = null;
let futuresInterval   = null;
let indicesInterval   = null;
let watchlistInterval = null;
let statusInterval    = null;

function startContinuousUpdates() {
  const ms = getMarketStatus();

  console.log('\n' + '═'.repeat(65));
  console.log('🔥 FIREBASE REALTIME UPDATE JOB STARTED');
  console.log('═'.repeat(65));
  console.log(`   Market: ${ms.status}  |  IST: ${ms.time}`);
  console.log(`   Tracking: ${ACTIVE_SYMBOLS.length} spot stocks + all futures + indices`);
  console.log('   Logic: UPSERT → naye add, purane update');
  console.log('═'.repeat(65) + '\n');

  // ── Initial full sync ──
  updateSpotStocks().then(() => updateFutureContracts()); // futures spot ke baad chalein
  updateIndices();
  updateAllUsersWatchlist();

  // ── Spot stocks: every 3 seconds (live prices) ──
  spotInterval = setInterval(async () => {
    if (isMarketOpen()) await updateSpotStocks();
  }, 3000);

  // ── Futures: every 5 seconds (spot update ke ~2s baad) ──
  // Spot (3s) → Futures (5s starting at 2s offset) = always fresh spot price milegi
  setTimeout(() => {
    futuresInterval = setInterval(async () => {
      if (isMarketOpen()) await updateFutureContracts();
    }, 5000);
  }, 2000); // 2s delay taaki spot pehle complete ho

  // ── Indices: every 5 seconds ──
  indicesInterval = setInterval(async () => {
    if (isMarketOpen()) await updateIndices();
  }, 5000);

  // ── Watchlist: every 5 seconds (with live prices) ──
  watchlistInterval = setInterval(async () => {
   if (isMarketOpen())   await updateAllUsersWatchlist();
  }, 5000);

  // ── Status log: every 60 seconds ──
  statusInterval = setInterval(() => {
    const s = getMarketStatus();
    console.log(`\n📊 Market: ${s.status} | IST: ${s.time}`);
  }, 60000);

  console.log('✅ Intervals active:');
  console.log('   📈 Spot stocks   → every 3s (live price fetch + MongoDB + Firebase)');
  console.log('   🔮 Futures       → every 5s (spot price se derive + MongoDB UPSERT + Firebase)');
  console.log('   🌐 Indices       → every 5s');
  console.log('   👁️  Watchlist     → every 5s');
  console.log('   📊 Status log    → every 60s\n');
}

function stopContinuousUpdates() {
  [spotInterval, futuresInterval, indicesInterval, watchlistInterval, statusInterval]
    .forEach(i => i && clearInterval(i));
  spotInterval = futuresInterval = indicesInterval = watchlistInterval = statusInterval = null;
  console.log('\n🛑 Firebase update job stopped\n');
}

process.on('SIGINT',  () => { stopContinuousUpdates(); process.exit(0); });
process.on('SIGTERM', () => { stopContinuousUpdates(); process.exit(0); });

module.exports = {
  startContinuousUpdates,
  stopContinuousUpdates,
  updateSpotStocks,
  updateFutureContracts,
  refreshFuturePricesFromSpot,
  updateIndices,
  updateAllUsersWatchlist,
  isMarketOpen,
  getMarketStatus,
  batchUpdateFirebase,
  updateFirebase
};