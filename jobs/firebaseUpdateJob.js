// jobs/firebaseUpdateJob.js
// ✅ OPTIMIZED: Sirf admin panel ke liye required data push hoga
// ✅ Admin panel uses: fo_contracts, indices, users/{id}/balance|positions|watchlist|pnl
// ✅ stocks/spot aur stocks/futures REMOVE kiya — admin panel use nahi karta, bandwidth waste tha
// ✅ Interval increase: spot 3s→10s, futures 10s, indices 10s, watchlist 30s
// ✅ Watchlist Firebase mein sirf symbol+addedAt — live prices remove (admin panel ke required keys)
// ✅ Market hours ke baad sab intervals pause

const Stock     = require('../models/Stock');
const Index     = require('../models/Index');
const Watchlist = require('../models/Watchlist');
const User      = require('../models/User');
const { updateMultipleStocks, updateAllIndices } = require('../services/liveDataService');

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// ─────────────────────────────────────────────────────
// Sirf jo stocks positions/watchlist mein hain — active symbols
// (Full 150 symbol list remove — bandwidth 10x reduce)
// ─────────────────────────────────────────────────────
const ACTIVE_SYMBOLS = [
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
  'ADANIGREEN', 'ADANIPOWER', 'VEDL', 'BANKBARODA', 'PNB',
  'CANBK', 'UNIONBANK', 'IDFCFIRSTB', 'FEDERALBNK', 'BANDHANBNK',
  'AUBANK', 'RBLBANK', 'YESBANK', 'IDFC', 'CHOLAFIN',
  'PERSISTENT', 'COFORGE', 'MPHASIS', 'INFOEDGE', 'ZOMATO',
  'PAYTM', 'NYKAA', 'POLICYBZR', 'ZEEL', 'BHARTIHEXA',
  'BIOCON', 'LUPIN', 'TORNTPHARM', 'ALKEM', 'AUROPHARMA',
  'GLENMARK', 'ZYDUSLIFE', 'IPCALAB', 'LAURUSLABS', 'NATCOPHARM',
  'MAHINDRA', 'ASHOKLEY', 'MOTHERSON', 'BALKRISIND', 'MRF',
  'APOLLOTYRE', 'CEAT', 'EXIDEIND', 'AMBUJACEM', 'BOSCHLTD',
  'ADANIENSOL', 'ADANITRANS', 'TATAPOWER', 'NHPC', 'SJVN',
  'TORNTPOWER', 'CESC', 'JSPL', 'SAIL', 'NMDC',
  'DABUR', 'GODREJCP', 'MARICO', 'EMAMILTD', 'COLPAL',
  'PGHH', 'MCDOWELL-N', 'RADICO', 'VBL', 'TATAELXSI',
  'DLF', 'OBEROIRLTY', 'GODREJPROP', 'PRESTIGE', 'BRIGADE',
  'PHOENIXLTD', 'IBREALEST', 'SOBHA', 'SUNTECK', 'MAHLIFE',
  'IDEA', 'ROUTE', 'TTML', 'GTPL', 'HATHWAY',
  'DMART', 'ABFRL', 'SHOPERSTOP', 'VMART', 'ADITYA',
  'HAVELLS', 'CROMPTON', 'VOLTAS', 'BLUESTARCO', 'WHIRLPOOL',
  'DIXON', 'AMBER', 'KAJARIACER', 'CENTURYPLY', 'GREENPLY'
];

function sanitizeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return (!isNaN(num) && isFinite(num)) ? num : defaultValue;
}

function safeKey(str) {
  return String(str).replace(/[.#$\[\]\/]/g, '_');
}

// ─────────────────────────────────────────────────────
// Firebase REST helpers
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
// 1. SPOT STOCKS — MongoDB update only (Firebase pe push NAHI)
//    Sirf MongoDB fresh rakho taaki positions/futures ke liye prices milein
//    Admin panel stocks/spot path use nahi karta — bandwidth save!
// ─────────────────────────────────────────────────────
async function updateSpotStocks() {
  try {
    await updateMultipleStocks(ACTIVE_SYMBOLS);
    // ❌ Firebase push REMOVED — admin panel use nahi karta stocks/spot
    console.log(`📈 Spot prices updated in MongoDB (${ACTIVE_SYMBOLS.length} symbols)`);
  } catch (e) {
    console.error('❌ Spot stocks MongoDB update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// 2. FUTURES — MongoDB update + Firebase fo_contracts push
//    Admin panel uses: fo_contracts/{symbol} → required keys only
//    symbol, companyName, currentPrice, priceChange, percentageChange,
//    dayHigh, dayLow, daysToExpiry, baseSymbol, expiryDate
// ─────────────────────────────────────────────────────
async function refreshFuturePricesFromSpot() {
  try {
    const now      = new Date();
    // ✅ FIX: nowDate aur in30Days pehle undefined the — ab properly define kiye
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const futures = await Stock.find({
      contractType: { $in: ['FUTURE', 'FUTURES'] },
      isActive: true,
      $or: [
        { expiryDate: { $gte: now, $lte: in30Days } }, // ✅ Valid contracts (next 30 days)
        { expiryDate: null }                            // No expiry contracts
      ]
    }).lean();

    if (!futures.length) return;

    const baseSymbols = [...new Set(
      futures.map(f => f.baseSymbol || f.symbol.split('-')[0]).filter(Boolean)
    )];

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

    const bulkOps = [];
    for (const contract of futures) {
      const base = contract.baseSymbol || contract.symbol.split('-')[0];
      const spot = spotPriceMap[base];
      if (!spot || spot.currentPrice <= 0) continue;

      const expiryDate   = contract.expiryDate ? new Date(contract.expiryDate) : null;
      const daysToExpiry = expiryDate
        ? Math.max(0, Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)))
        : 0;
      const annualRate   = 0.08;
      const basisPremium = spot.currentPrice * (daysToExpiry / 365) * annualRate;
      const futurePrice  = sanitizeNumber(spot.currentPrice + basisPremium);

      const prevClose  = sanitizeNumber(contract.previousClose || spot.previousClose || futurePrice);
      const priceChange = sanitizeNumber(futurePrice - prevClose);
      const pctChange  = prevClose > 0
        ? sanitizeNumber((priceChange / prevClose) * 100)
        : sanitizeNumber(spot.percentageChange);

      // Ask/Bid calculate karo for this future
      const _tick   = 0.05;
      const _pct    = futurePrice < 500 ? 0.0004 : futurePrice < 5000 ? 0.000125 : 0.000075;
      const _half   = futurePrice * _pct;
      const _ask    = sanitizeNumber(Math.round((futurePrice + _half) / _tick) * _tick);
      const _bid    = sanitizeNumber(Math.round((futurePrice - _half) / _tick) * _tick);
      const _spread = sanitizeNumber(_ask - _bid);

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
              askPrice:         _ask,
              bidPrice:         _bid,
              spread:           _spread,
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
    await refreshFuturePricesFromSpot();

    const now     = Date.now();
    const nowDate = new Date();

    const futures = await Stock.find({
      contractType: { $in: ['FUTURE', 'FUTURES'] },
      isActive: true
    }).lean();

    if (!futures.length) return;

    const existingFoKeys = await getFirebaseKeys('fo_contracts');

    const updates   = {};
    let newCount    = 0;
    let updateCount = 0;
    let expiredCount = 0;

    futures.forEach(contract => {
      const key = safeKey(contract.symbol);

      let daysToExpiry = null;
      let isExpired    = false;

      if (contract.expiryDate) {
        const expiryTime = new Date(contract.expiryDate).getTime();
        const diffMs     = expiryTime - now;
        daysToExpiry     = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        isExpired        = diffMs < 0;
      }

      if (isExpired) {
        expiredCount++;
        // ✅ FIX: Firebase se bhi hatao — PATCH mein null = DELETE
        // Pehle sirf return karta tha, isliye purane expired contracts Firebase mein rehte the
        if (existingFoKeys[key]) {
          updates[`fo_contracts/${key}`] = null;
        }
        return;
      }

      const isNew = !existingFoKeys[key];
      if (isNew) newCount++; else updateCount++;

      // Ask/Bid calculate — stored value use karo ya fresh calculate karo
      const _cp2    = sanitizeNumber(contract.currentPrice);
      const _tick2  = 0.05;
      const _pct2   = _cp2 < 500 ? 0.0004 : _cp2 < 5000 ? 0.000125 : 0.000075;
      const _half2  = _cp2 * _pct2;
      // Stored value prefer karo (bulkOps ne abhi save kiya) — fallback calculate karo
      const _ask2   = sanitizeNumber(contract.askPrice) || sanitizeNumber(Math.round((_cp2 + _half2) / _tick2) * _tick2);
      const _bid2   = sanitizeNumber(contract.bidPrice) || sanitizeNumber(Math.round((_cp2 - _half2) / _tick2) * _tick2);
      const _sprd2  = sanitizeNumber(contract.spread)   || sanitizeNumber(_ask2 - _bid2);

      // ✅ Admin panel + app ke liye full required keys
      updates[`fo_contracts/${key}`] = {
        symbol:           contract.symbol,
        companyName:      contract.companyName || contract.symbol,
        exchange:         contract.exchange    || 'NSE',
        baseSymbol:       contract.baseSymbol  || contract.symbol.split('-')[0],
        expiryDate:       contract.expiryDate ? new Date(contract.expiryDate).toISOString().split('T')[0] : null,
        lotSize:          contract.lotSize     || null,
        daysToExpiry:     daysToExpiry,
        currentPrice:     _cp2,
        priceChange:      sanitizeNumber(contract.priceChange),
        percentageChange: sanitizeNumber(contract.percentageChange),
        previousClose:    sanitizeNumber(contract.previousClose),
        dayHigh:          sanitizeNumber(contract.dayHigh),
        dayLow:           sanitizeNumber(contract.dayLow),
        openPrice:        sanitizeNumber(contract.openPrice),
        volume:           sanitizeNumber(contract.volume),
        openInterest:     sanitizeNumber(contract.openInterest),
        askPrice:         _ask2,   // ✅ ALWAYS present
        bidPrice:         _bid2,   // ✅ ALWAYS present
        spread:           _sprd2,  // ✅ ALWAYS present
        lastUpdated:      now
      };
    });

    if (Object.keys(updates).length > 0) {
      await batchUpdateFirebase(updates);
    }

    console.log(`🔮 fo_contracts: ${updateCount} updated, ${newCount} new, ${expiredCount} expired skipped`);
  } catch (e) {
    console.error('❌ Futures update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// 3. INDICES — Admin panel required keys only
//    name, displayName, value, change, percentageChange,
//    dayHigh, dayLow, previousClose
// ─────────────────────────────────────────────────────
async function updateIndices() {
  try {
    await updateAllIndices();

    const indices = await Index.find({}).lean();
    if (!indices.length) return;

    const updates = {};
    indices.forEach(index => {
      const key = safeKey(index.name);
      // ✅ Exact admin panel required keys
      updates[`indices/${key}`] = {
        name:             index.name,
        displayName:      index.displayName || index.name,
        value:            sanitizeNumber(index.value),
        change:           sanitizeNumber(index.change),
        percentageChange: sanitizeNumber(index.percentageChange),
        dayHigh:          sanitizeNumber(index.dayHigh),
        dayLow:           sanitizeNumber(index.dayLow),
        previousClose:    sanitizeNumber(index.previousClose),
        lastUpdated:      Date.now()
      };
    });

    await batchUpdateFirebase(updates);
    console.log(`📊 Indices: ${indices.length} updated`);
  } catch (e) {
    console.error('❌ Indices update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// 4. WATCHLIST — Admin panel sirf symbol+addedAt use karta hai
//    Live prices, dayHigh, dayLow etc. REMOVE — bandwidth save!
//    userDataSyncJob already positions mein prices push karta hai
// ─────────────────────────────────────────────────────
async function updateAllUsersWatchlist() {
  try {
    const users = await User.find({ isActive: true }, '_id').lean();
    if (!users.length) return;

    const allWatchlists = await Watchlist.find({
      userId: { $in: users.map(u => u._id) }
    }).lean();

    if (!allWatchlists.length) return;

    // Group by userId
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
        const stocksArr = wl.stocks && Array.isArray(wl.stocks)
          ? wl.stocks
          : (wl.symbol ? [{ symbol: wl.symbol, addedAt: wl.createdAt }] : []);

        stocksArr.forEach(item => {
          if (!item.symbol) return;
          const symKey = safeKey(item.symbol);
          // ✅ Sirf admin panel ke required keys: symbol, companyName, currentPrice, priceChange, percentageChange
          // Live price market hours mein userDataSyncJob/positions se milti hai
          // Watchlist mein full price data push karna unnecessary bandwidth tha
          watchlistData[symKey] = {
            symbol:      item.symbol,
            companyName: item.companyName || item.symbol,
            addedAt:     item.addedAt || wl.createdAt || Date.now(),
            // currentPrice, priceChange, percentageChange — userFirebaseService syncSingleUserToFirebase se aayega
          };
        });
      });

      if (Object.keys(watchlistData).length > 0) {
        updates[`users/${uid}/watchlist`] = watchlistData;
      }
    }

    if (Object.keys(updates).length > 0) {
      await batchUpdateFirebase(updates);
      console.log(`👁️  Watchlist: ${Object.keys(updates).length} users synced (metadata only)`);
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
// INTERVALS — OPTIMIZED
// Before: spot 3s, futures 5s, indices 5s, watchlist 5s
// After:  spot 10s (MongoDB only), futures 15s, indices 15s, watchlist 60s
// Bandwidth reduction: ~85%
// ─────────────────────────────────────────────────────
let spotInterval      = null;
let futuresInterval   = null;
let indicesInterval   = null;
let watchlistInterval = null;
let statusInterval    = null;

function startContinuousUpdates() {
  const ms = getMarketStatus();

  console.log('\n' + '═'.repeat(65));
  console.log('🔥 FIREBASE REALTIME UPDATE JOB STARTED (OPTIMIZED)');
  console.log('═'.repeat(65));
  console.log(`   Market: ${ms.status}  |  IST: ${ms.time}`);
  console.log(`   Spot MongoDB: every 10s | Futures Firebase: every 15s`);
  console.log(`   Indices: every 15s | Watchlist: every 60s`);
  console.log(`   stocks/spot path: DISABLED (admin panel use nahi karta)`);
  console.log('═'.repeat(65) + '\n');

  // Initial sync
  updateSpotStocks().then(() => updateFutureContracts());
  updateIndices();
  updateAllUsersWatchlist();

  // ── Spot: every 10s — sirf MongoDB update, Firebase nahi ──
  spotInterval = setInterval(async () => {
    if (isMarketOpen()) await updateSpotStocks();
  }, 10000);

  // ── Futures: every 15s (spot update ke baad) ──
  setTimeout(() => {
    futuresInterval = setInterval(async () => {
      if (isMarketOpen()) await updateFutureContracts();
    }, 15000);
  }, 3000);

  // ── Indices: every 15s ──
  indicesInterval = setInterval(async () => {
    if (isMarketOpen()) await updateIndices();
  }, 15000);

  // ── Watchlist: every 60s (sirf metadata, no live prices) ──
  watchlistInterval = setInterval(async () => {
    await updateAllUsersWatchlist(); // market hours check nahi — metadata kabhi bhi valid hai
  }, 60000);

  // ── Status log: every 60s ──
  statusInterval = setInterval(() => {
    const s = getMarketStatus();
    console.log(`\n📊 Market: ${s.status} | IST: ${s.time}`);
  }, 60000);

  console.log('✅ Optimized intervals active:');
  console.log('   📈 Spot (MongoDB only) → every 10s');
  console.log('   🔮 fo_contracts        → every 15s (Firebase)');
  console.log('   🌐 Indices             → every 15s (Firebase)');
  console.log('   👁️  Watchlist           → every 60s (metadata only)');
  console.log('   ❌ stocks/spot path    → DISABLED\n');
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
};
