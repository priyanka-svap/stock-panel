// routes/watchlist.js
const express   = require('express');
const router    = express.Router();
const Watchlist = require('../models/Watchlist');
const Stock     = require('../models/Stock');
const auth      = require('../middleware/auth');
const fetch     = require('node-fetch');

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// ─────────────────────────────────────────────────────────────────
// Firebase helpers — market hours se INDEPENDENT direct push
// ─────────────────────────────────────────────────────────────────

async function fbSet(path, data) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    return r.ok;
  } catch (e) {
    console.error('Firebase SET error:', e.message);
    return false;
  }
}

async function fbDelete(path) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'DELETE'
    });
    return r.ok;
  } catch (e) {
    console.error('Firebase DELETE error:', e.message);
    return false;
  }
}

// Full stock data object for Firebase watchlist entry
function buildWatchlistEntry(symbol, stock, addedAt) {
  const cp   = parseFloat(stock?.currentPrice  || 0);
  const tick = (stock?.exchange === 'MCX') ? 0.1 : 0.05;

  // ask/bid — stored value ya auto-calculate
  let ask  = parseFloat(stock?.askPrice || 0);
  let bid  = parseFloat(stock?.bidPrice || 0);
  let sprd = parseFloat(stock?.spread   || 0);
  if (ask === 0 && cp > 0) {
    const half = cp * (cp < 500 ? 0.0004 : cp < 5000 ? 0.000125 : 0.000075);
    ask  = parseFloat((Math.round((cp + half) / tick) * tick).toFixed(2));
    bid  = parseFloat((Math.round((cp - half) / tick) * tick).toFixed(2));
    sprd = parseFloat((ask - bid).toFixed(2));
  }

  return {
    symbol:           symbol,
    companyName:      stock?.companyName      || symbol,
    exchange:         stock?.exchange         || 'NSE',
    sector:           stock?.sector           || '',
    contractType:     stock?.contractType     || 'SPOT',
    currentPrice:     cp,
    openPrice:        parseFloat(stock?.openPrice     || 0),
    previousClose:    parseFloat(stock?.previousClose || 0),
    dayHigh:          parseFloat(stock?.dayHigh       || 0),
    dayLow:           parseFloat(stock?.dayLow        || 0),
    priceChange:      parseFloat(stock?.priceChange   || 0),
    percentageChange: parseFloat(stock?.percentageChange || 0),
    askPrice:         ask,
    bidPrice:         bid,
    spread:           sprd,
    volume:           parseFloat(stock?.volume        || 0),
    openInterest:     parseFloat(stock?.openInterest  || 0),
    addedAt:          addedAt || Date.now(),
    lastUpdated:      Date.now()
  };
}

// ─────────────────────────────────────────────────────────────────
// GET /api/watchlist
// ─────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    let watchlist = await Watchlist.findOne({ userId: req.user.userId });
    if (!watchlist) {
      watchlist = new Watchlist({ userId: req.user.userId, stocks: [] });
      await watchlist.save();
    }

    const symbols = watchlist.stocks.map(s => s.symbol);
    const stocks  = await Stock.find({ symbol: { $in: symbols }, contractType: 'SPOT' }).lean();

    // Return full stock data with addedAt
    const stockMap = {};
    stocks.forEach(s => { stockMap[s.symbol] = s; });

    const data = watchlist.stocks.map(ws => {
      const s = stockMap[ws.symbol] || {};
      return buildWatchlistEntry(ws.symbol, s, ws.addedAt);
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/watchlist/add/:symbol
// MongoDB save + INSTANT Firebase push (market hours independent)
// ─────────────────────────────────────────────────────────────────
router.post('/add/:symbol', auth, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const userId = req.user.userId;

    // 1. MongoDB update
    let watchlist = await Watchlist.findOne({ userId });
    if (!watchlist) {
      watchlist = new Watchlist({ userId, stocks: [] });
    }

    const alreadyExists = watchlist.stocks.find(s => s.symbol === symbol);
    if (!alreadyExists) {
      watchlist.stocks.push({ symbol, addedAt: new Date() });
      await watchlist.save();
    }

    // 2. Fetch stock data for Firebase entry
    const stock   = await Stock.findOne({ symbol, contractType: 'SPOT' }).lean();
    const addedAt = alreadyExists
      ? alreadyExists.addedAt
      : watchlist.stocks.find(s => s.symbol === symbol)?.addedAt || new Date();

    const entry = buildWatchlistEntry(symbol, stock, addedAt);

    // 3. Instant Firebase push — market band ho ya open, fark nahi
    const fbOk = await fbSet(`users/${userId}/watchlist/${symbol}`, entry);

    console.log(`📌 Watchlist ADD: ${userId} → ${symbol} | Firebase: ${fbOk ? '✅' : '⚠️ failed'}`);

    res.json({
      success: true,
      message:      `${symbol} added to watchlist`,
      firebaseSynced: fbOk,
      data:           entry
    });

  } catch (error) {
    console.error('Watchlist add error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/watchlist/remove/:symbol
// MongoDB remove + INSTANT Firebase delete (market hours independent)
// ─────────────────────────────────────────────────────────────────
router.delete('/remove/:symbol', auth, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const userId = req.user.userId;

    // 1. MongoDB remove
    const watchlist = await Watchlist.findOne({ userId });
    if (watchlist) {
      watchlist.stocks = watchlist.stocks.filter(s => s.symbol !== symbol);
      await watchlist.save();
    }

    // 2. Instant Firebase delete — market band ho ya open, fark nahi
    const fbOk = await fbDelete(`users/${userId}/watchlist/${symbol}`);

    console.log(`🗑️  Watchlist REMOVE: ${userId} → ${symbol} | Firebase: ${fbOk ? '✅' : '⚠️ failed'}`);

    res.json({
      success:        true,
      message:        `${symbol} removed from watchlist`,
      firebaseSynced: fbOk
    });

  } catch (error) {
    console.error('Watchlist remove error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
