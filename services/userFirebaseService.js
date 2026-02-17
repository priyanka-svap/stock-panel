// services/userFirebaseService.js
// Firebase structure (LEAN - only what app needs):
//
// users/{userId}/
//   profile    → name, email, clientId
//   balance    → availableBalance, usedMargin, availableMargin, totalMargin, brokeragePercentage
//   pnl        → totalPnL, todayPnL, unrealizedPnL, totalInvestment
//   positions  → { posId: { symbol, qty, entryPrice, markPrice, pnl, pnl%, margin, marginRatio, liqPrice, sl, tp, positionType } }
//   watchlist  → { symbol: { symbol, addedAt } }
//
// ❌ NO orders, holdings synced to Firebase (only in MongoDB)

const fetch = require('node-fetch');
const User     = require('../models/User');
const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const Watchlist = require('../models/Watchlist');

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// ─────────────────────────────────────────────
// Firebase REST helpers
// ─────────────────────────────────────────────
async function _fbPut(path, data) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return r.ok;
  } catch (e) {
    console.error(`Firebase PUT error (${path}):`, e.message);
    return false;
  }
}

async function _fbPatch(updates) {
  try {
    const r = await fetch(`${FIREBASE_URL}/.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    return r.ok;
  } catch (e) {
    console.error('Firebase PATCH error:', e.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// Main: sync single user to Firebase
// ─────────────────────────────────────────────
async function syncSingleUserToFirebase(userId) {
  try {
    const user = await User.findById(userId).lean();
    if (!user) return false;

    // ── Positions with live prices ──
    const positions = await Position.find({ userId, isActive: true }).lean();

    // Get live prices for all position symbols
    const symbols = [...new Set(positions.map(p => p.symbol))];
    const stocks  = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    let totalUnrealizedPnL  = 0;
    let totalInvestment     = 0;
    const positionsData = {};

    positions.forEach(pos => {
      const markPrice    = priceMap[pos.symbol] || pos.currentPrice;
      const investedVal  = pos.investmentValue || (pos.entryPrice * pos.quantity);
      const currentVal   = markPrice * pos.quantity;

      let pnl, pnlPct;
      if (pos.positionType === 'LONG') {
        pnl    = currentVal - investedVal - (pos.totalBrokerage || 0);
        pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;
      } else {
        pnl    = investedVal - currentVal - (pos.totalBrokerage || 0);
        pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;
      }

      totalUnrealizedPnL += pnl;
      totalInvestment    += investedVal;

      // Margin ratio = marginUsed / investedVal * 100
      const marginRatio  = investedVal > 0 ? (pos.marginUsed / investedVal * 100) : 0;

      // Liquidation price estimate (simplified)
      let liqPrice = null;
      if (pos.marginMultiplier > 1 && pos.positionType === 'LONG') {
        liqPrice = parseFloat((pos.entryPrice * (1 - 1 / pos.marginMultiplier * 0.8)).toFixed(2));
      }

      positionsData[pos._id.toString()] = {
        positionId:   pos._id.toString(),
        symbol:       pos.symbol,
        companyName:  pos.companyName || pos.symbol,
        positionType: pos.positionType,      // LONG / SHORT
        quantity:     pos.quantity,
        entryPrice:   pos.entryPrice,
        markPrice:    markPrice,             // live mark price
        investedValue: investedVal,
        currentValue:  currentVal,
        pnl:           parseFloat(pnl.toFixed(2)),
        pnlPercentage: parseFloat(pnlPct.toFixed(2)),
        marginUsed:    pos.marginUsed,
        marginRatio:   parseFloat(marginRatio.toFixed(2)),
        marginMultiplier: pos.marginMultiplier || 1,
        liquidationPrice: liqPrice,
        entryBrokerage: pos.entryBrokerage || 0,
        totalBrokerage: pos.totalBrokerage  || 0,
        stopLoss:      pos.stopLoss  || null,
        takeProfit:    pos.takeProfit || null,
        instrumentType: pos.instrumentType || 'EQUITY',
        contractType:  pos.contractType || 'SPOT',
        expiryDate:    pos.expiryDate || null,
        expiryMonth:   pos.expiryMonth || null,
        isActive:      pos.isActive,
        entryDate:     pos.entryDate || pos.createdAt,
        lastUpdated:   Date.now()
      };
    });

    // ── Watchlist ──
    const wlItems   = await Watchlist.find({ userId }).lean();
    const watchlistData = {};
    wlItems.forEach(item => {
      if (item.stocks && Array.isArray(item.stocks)) {
        item.stocks.forEach(s => {
          watchlistData[s.symbol] = {
            symbol:  s.symbol,
            addedAt: s.addedAt || item.createdAt,
            lastUpdated: Date.now()
          };
        });
      } else if (item.symbol) {
        watchlistData[item.symbol] = {
          symbol:  item.symbol,
          addedAt: item.createdAt,
          lastUpdated: Date.now()
        };
      }
    });

    // ── Build Firebase PATCH ──
    const uid = userId.toString();
    const updates = {
      [`users/${uid}/profile`]: {
        userId:   uid,
        username: user.username,
        fullName: user.fullName,
        email:    user.email,
        clientId: user.clientId,
        isActive: user.isActive,
        lastUpdated: Date.now()
      },
      [`users/${uid}/balance`]: {
        availableBalance:    parseFloat((user.availableBalance || 0).toFixed(2)),
        usedMargin:          parseFloat((user.usedMargin || 0).toFixed(2)),
        availableMargin:     parseFloat(((user.availableBalance * (user.marginMultiplier || 1)) - (user.usedMargin || 0)).toFixed(2)),
        totalMargin:         parseFloat(((user.availableBalance || 0) * (user.marginMultiplier || 1)).toFixed(2)),
        marginMultiplier:    user.marginMultiplier || 1,
        brokeragePercentage: user.brokeragePercentage || 0.05,
        totalBrokeragePaid:  parseFloat((user.totalBrokeragePaid || 0).toFixed(2)),
        lastUpdated: Date.now()
      },
      [`users/${uid}/pnl`]: {
        totalPnL:        parseFloat((user.totalPnL || 0).toFixed(2)),
        todayPnL:        parseFloat((user.todayPnL || 0).toFixed(2)),
        unrealizedPnL:   parseFloat(totalUnrealizedPnL.toFixed(2)),
        totalInvestment: parseFloat(totalInvestment.toFixed(2)),
        openPositions:   positions.length,
        lastUpdated: Date.now()
      },
      [`users/${uid}/positions`]: positionsData,
      [`users/${uid}/watchlist`]: watchlistData
    };

    const ok = await _fbPatch(updates);
    if (ok) console.log(`✅ Firebase synced: ${user.username} | pos:${positions.length} | wl:${Object.keys(watchlistData).length}`);
    return ok;

  } catch (e) {
    console.error(`❌ Firebase sync error for ${userId}:`, e.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// Sync ALL active users (called by periodic job)
// ─────────────────────────────────────────────
async function syncAllUsersToFirebase() {
  try {
    const users = await User.find({ isActive: true }, '_id').lean();
    for (const u of users) {
      await syncSingleUserToFirebase(u._id.toString());
    }
    console.log(`🔄 Firebase full sync done: ${users.length} users`);
  } catch (e) {
    console.error('❌ Full sync error:', e.message);
  }
}

module.exports = { syncSingleUserToFirebase, syncAllUsersToFirebase, _fbPatch, _fbPut };