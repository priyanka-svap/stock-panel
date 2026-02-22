// services/userFirebaseService.js
//
// Firebase structure:
//   users/{userId}/
//     profile   → name, email, clientId, isActive
//     balance   → availableBalance, usedMargin, remainingMargin, totalMargin,
//                 marginUtilization, marginMultiplier, brokeragePercentage
//     pnl       → totalPnL, todayPnL, unrealizedPnL, totalInvestment, openPositions
//     positions → { posId: { ...all fields + correct liquidationPrice } }
//     watchlist → { symbol: { symbol, addedAt } }

const fetch     = require('node-fetch');
const User      = require('../models/User');
const Position  = require('../models/Position');
const Stock     = require('../models/Stock');
const Watchlist = require('../models/Watchlist');
const { getLiquidationPrice, MAINTENANCE_MARGIN_RATE } = require('../utils/marginCalculator');

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// ─────────────────────────────────────────────────────────────────────────────
// Firebase REST helpers
// ─────────────────────────────────────────────────────────────────────────────
async function _fbPut(path, data) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return r.ok;
  } catch (e) { console.error('Firebase PUT error:', e.message); return false; }
}

async function _fbPatch(updates) {
  try {
    const r = await fetch(`${FIREBASE_URL}/.json`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    return r.ok;
  } catch (e) { console.error('Firebase PATCH error:', e.message); return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ SINGLE liquidation price formula
//    Used by BOTH this file AND userDataSyncJob (imported from here)
//
//  Liquidation = price where margin is FULLY exhausted → force close
//
//  LONG:  liqPrice = entryPrice - (marginUsed / quantity)
//  SHORT: liqPrice = entryPrice + (marginUsed / quantity)
//
//  Example:
//    entryPrice=1000, marginUsed=2000, qty=10
//    marginPerUnit = 2000/10 = 200
//    LONG  → 1000 - 200 = 800   (price falls to 800 → margin gone)
//    SHORT → 1000 + 200 = 1200  (price rises to 1200 → margin gone)
// ─────────────────────────────────────────────────────────────────────────────
function calcLiquidationPrice(pos) {
  console.log({pos})
  const marginUsed = pos.marginUsed || pos.usedMargin || 0;
  const qty        = pos.quantity   || 0;
  const entry      = pos.entryPrice || 0;

  if (!marginUsed || !qty || !entry) return null;

  const marginPerUnit = marginUsed / qty;
  const isLong        = pos.positionType === 'LONG';

  const raw = isLong
    ? entry - marginPerUnit
    : entry + marginPerUnit;
console.log(raw)
  return parseFloat(Math.max(0, raw).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ Balance calculation — mirrors User model virtuals exactly
//    Call this instead of manually computing totalMargin/remainingMargin
// ─────────────────────────────────────────────────────────────────────────────
function calcBalanceFields(user) {
  const availBal = user.availableBalance || 0;
  const usedMgn  = user.usedMargin       || 0;

  let totalMargin;
  if (!user.marginEnabled) {
    totalMargin = availBal;
  } else if ((user.marginMultiplier || 1) > 1) {
    totalMargin = availBal * (user.marginMultiplier || 1);
  } else {
    totalMargin = availBal + (user.marginAllowed || 0);
  }

  const remainingMargin   = Math.max(0, totalMargin - usedMgn);
  const marginUtilization = totalMargin > 0
    ? parseFloat((usedMgn / totalMargin * 100).toFixed(2)) : 0;

  return {
    availableBalance:    parseFloat(availBal.toFixed(2)),
    usedMargin:          parseFloat(usedMgn.toFixed(2)),
    remainingMargin:     parseFloat(remainingMargin.toFixed(2)),
    availableMargin:     parseFloat(remainingMargin.toFixed(2)),
    totalMargin:         parseFloat(totalMargin.toFixed(2)),
    marginUtilization,
    marginMultiplier:    user.marginMultiplier    || 1,
    marginEnabled:       user.marginEnabled       ?? true,
    marginAllowed:       user.marginAllowed       || 0,
    brokeragePercentage: user.brokeragePercentage || 0.05,
    totalBrokeragePaid:  parseFloat((user.totalBrokeragePaid || 0).toFixed(2)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// syncSingleUserToFirebase
// ─────────────────────────────────────────────────────────────────────────────
async function syncSingleUserToFirebase(userId) {
  try {
    const user = await User.findById(userId).lean();
    if (!user) return false;

    const positions = await Position.find({ userId, isActive: true }).lean();
    const symbols   = [...new Set(positions.map(p => p.symbol))];
    const stocks    = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap  = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    let totalUnrealizedPnL = 0;
    let totalInvestment    = 0;
    const positionsData    = {};

    positions.forEach(pos => {
      const markPrice  = priceMap[pos.symbol] || pos.currentPrice || pos.entryPrice || 0;
      const investedVal = pos.investmentValue || (pos.entryPrice * pos.quantity) || 0;
      const currentVal  = markPrice * pos.quantity;
      const isLong      = pos.positionType === 'LONG';

      const pnl    = isLong
        ? currentVal - investedVal - (pos.totalBrokerage || 0)
        : investedVal - currentVal - (pos.totalBrokerage || 0);
      const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;

      totalUnrealizedPnL += pnl;
      totalInvestment    += investedVal;

      // ✅ Correct liquidation price
      const liqPrice = calcLiquidationPrice(pos);
      let liqDist = null, liqPct = null, liqRisk = null;
      if (liqPrice !== null && markPrice > 0) {
        liqDist = parseFloat(Math.abs(markPrice - liqPrice).toFixed(2));
        liqPct  = parseFloat((liqDist / markPrice * 100).toFixed(4));
        liqRisk = liqPct <= 2 ? 'danger' : liqPct <= 5 ? 'warning' : 'safe';
        const liqHit = isLong ? markPrice <= liqPrice : markPrice >= liqPrice;
        if (liqHit) liqRisk = 'liquidated';
      }

      const marginRatio = investedVal > 0 ? ((pos.marginUsed || 0) / investedVal * 100) : 0;

      positionsData[pos._id.toString()] = {
        positionId:       pos._id.toString(),
        symbol:           pos.symbol,
        companyName:      pos.companyName  || pos.symbol,
        positionType:     pos.positionType,
        quantity:         pos.quantity,
        entryPrice:       parseFloat((pos.entryPrice || 0).toFixed(2)),
        markPrice:        parseFloat((markPrice).toFixed(2)),
        investedValue:    parseFloat(investedVal.toFixed(2)),
        currentValue:     parseFloat(currentVal.toFixed(2)),
        pnl:              parseFloat(pnl.toFixed(2)),
        pnlPercentage:    parseFloat(pnlPct.toFixed(2)),
        marginUsed:       pos.marginUsed       || 0,
        marginMultiplier: pos.marginMultiplier || 1,
        marginRatio:      parseFloat(marginRatio.toFixed(2)),
        liquidationPrice: liqPrice,
        liquidationDist:  liqDist,
        liquidationPct:   liqPct,
        liquidationRisk:  liqRisk,
        stopLoss:         pos.stopLoss   || null,
        takeProfit:       pos.takeProfit || null,
        entryBrokerage:   pos.entryBrokerage || 0,
        totalBrokerage:   pos.totalBrokerage  || 0,
        instrumentType:   pos.instrumentType  || 'EQUITY',
        contractType:     pos.contractType    || 'SPOT',
        expiryDate:       pos.expiryDate      || null,
        expiryMonth:      pos.expiryMonth     || null,
        isActive:         true,
        entryDate:        pos.entryDate || pos.createdAt,
        lastUpdated:      Date.now()
      };
    });

    // ── Watchlist ──
    const wlItems = await Watchlist.find({ userId }).lean();
    const watchlistData = {};
    wlItems.forEach(item => {
      if (item.stocks && Array.isArray(item.stocks)) {
        item.stocks.forEach(s => {
          watchlistData[s.symbol] = { symbol: s.symbol, addedAt: s.addedAt || item.createdAt, lastUpdated: Date.now() };
        });
      } else if (item.symbol) {
        watchlistData[item.symbol] = { symbol: item.symbol, addedAt: item.createdAt, lastUpdated: Date.now() };
      }
    });

    // ── Firebase PATCH ──
    const uid     = userId.toString();
    const balance = calcBalanceFields(user);

    const updates = {
      [`users/${uid}/profile`]: {
        userId: uid, username: user.username, fullName: user.fullName,
        email: user.email, clientId: user.clientId, isActive: user.isActive,
        lastUpdated: Date.now()
      },
      [`users/${uid}/balance`]: { ...balance, lastUpdated: Date.now() },
      [`users/${uid}/pnl`]: {
        totalPnL:        parseFloat((user.totalPnL || 0).toFixed(2)),
        todayPnL:        parseFloat((user.todayPnL || 0).toFixed(2)),
        unrealizedPnL:   parseFloat(totalUnrealizedPnL.toFixed(2)),
        totalInvestment: parseFloat(totalInvestment.toFixed(2)),
        openPositions:   positions.length,
        lastUpdated:     Date.now()
      },
      [`users/${uid}/positions`]: positionsData,
      [`users/${uid}/watchlist`]: watchlistData
    };

    const ok = await _fbPatch(updates);
    if (ok) {
      console.log(
        `✅ Firebase synced: ${user.username}` +
        ` | bal:₹${balance.availableBalance}` +
        ` | usedMargin:₹${balance.usedMargin}` +
        ` | remaining:₹${balance.remainingMargin}` +
        ` | pos:${positions.length}`
      );
    }
    return ok;

  } catch (e) {
    console.error(`❌ Firebase sync error for ${userId}:`, e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// syncAllUsersToFirebase
// ─────────────────────────────────────────────────────────────────────────────
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

module.exports = {
  syncSingleUserToFirebase,
  syncAllUsersToFirebase,
  calcLiquidationPrice,   // ✅ exported — userDataSyncJob uses this
  calcBalanceFields,      // ✅ exported — userDataSyncJob uses this
  _fbPatch,
  _fbPut
};
