// jobs/userDataSyncJob.js
//
// ✅ Market hours (9:15–3:30) mein hi chalega
// ✅ Liquidation price: calcLiquidationPrice() — service se import (same formula)
// ✅ Balance: calcBalanceFields() — service se import (same formula as User model virtual)
// ✅ Auto-close: SL/TP/Liquidation hit on releaseMargin properly

const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const Order    = require('../models/Order');
const {
  syncSingleUserToFirebase,
  calcLiquidationPrice,   // ✅ same formula as userFirebaseService
  calcBalanceFields,      // ✅ same formula as User virtual
  _fbPatch
} = require('../services/userFirebaseService');

let pnlInterval = null;
const autoCloseInProgress = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// Market hours check (IST 9:15 – 15:30, Mon–Fri)
// ─────────────────────────────────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  if (ist.getDay() === 0 || ist.getDay() === 6) return false;
  const cur = ist.getHours() * 60 + ist.getMinutes();
  return cur >= (9 * 60 + 15) && cur <= (15 * 60 + 30);
}

function isLongPosition(pos) {
  return pos.positionType === 'LONG' || pos.type === 'BUY' || pos.orderType === 'BUY';
}

// ─────────────────────────────────────────────────────────────────────────────
// SL/TP check
// ─────────────────────────────────────────────────────────────────────────────
function checkSLTP(pos, markPrice) {
  const sl         = parseFloat(pos.stopLoss   || 0);
  const takeProfit = parseFloat(pos.takeProfit || 0);
  const isLong     = isLongPosition(pos);

  if (isLong) {
    if (sl > 0         && markPrice <= sl)         return 'sl_hit';
    if (takeProfit > 0 && markPrice >= takeProfit) return 'takeProfit_hit';
  } else {
    if (sl > 0         && markPrice >= sl)         return 'sl_hit';
    if (takeProfit > 0 && markPrice <= takeProfit) return 'takeProfit_hit';
  }
  return null;
}

function getSLTPStatus(pos, markPrice) {
  const sl         = parseFloat(pos.stopLoss   || 0);
  const takeProfit = parseFloat(pos.takeProfit || 0);
  if (!sl && !takeProfit) return 'no_sltp';

  const hit = checkSLTP(pos, markPrice);
  if (hit) return hit;

  const isLong   = isLongPosition(pos);
  const WARN_PCT = 1.5;

  if (isLong) {
    if (sl > 0         && ((markPrice - sl)         / markPrice * 100) < WARN_PCT) return 'near_sl';
    if (takeProfit > 0 && ((takeProfit - markPrice) / markPrice * 100) < WARN_PCT) return 'near_takeProfit';
  } else {
    if (sl > 0         && ((sl - markPrice)         / markPrice * 100) < WARN_PCT) return 'near_sl';
    if (takeProfit > 0 && ((markPrice - takeProfit) / markPrice * 100) < WARN_PCT) return 'near_takeProfit';
  }
  return 'safe';
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto close position (SL / TP / Liquidation)
// ─────────────────────────────────────────────────────────────────────────────
async function autoClosePosition(pos, markPrice, reason) {
  const posId = pos._id.toString();
  if (autoCloseInProgress.has(posId)) return false;
  autoCloseInProgress.add(posId);

  try {
    const isLong      = isLongPosition(pos);
    const exitSide    = isLong ? 'SELL' : 'BUY';
    const reasonLabel = reason === 'sl_hit' ? 'Stop Loss'
      : reason === 'takeProfit_hit' ? 'Take Profit' : 'LIQUIDATION';

    const investedVal = pos.investmentValue || (pos.entryPrice * pos.quantity) || 0;
    const exitValue   = markPrice * pos.quantity;
    const brokerage   = pos.totalBrokerage || 0;
    const pnl         = isLong
      ? exitValue - investedVal - brokerage
      : investedVal - exitValue - brokerage;

    const closeReason = reason === 'sl_hit' ? 'STOP_LOSS'
      : reason === 'takeProfit_hit' ? 'TARGET' : 'LIQUIDATION';

    // 1. Mark position closed in MongoDB
    // ✅ Use .close() method + .save() instead of findByIdAndUpdate
    //    findByIdAndUpdate SKIPS pre-save hook → liquidationPrice/pnl not recalculated
    const posDoc = await Position.findById(posId);
    if (posDoc) {
      posDoc.close(markPrice, brokerage, closeReason);
      await posDoc.save();  // pre-save hook runs → liquidationPrice, pnlPercentage updated
    }

    // 2. Create exit order record
    await Order.create({
      userId: pos.userId, symbol: pos.symbol, companyName: pos.companyName,
      orderType: exitSide, orderMode: 'MARKET', quantity: pos.quantity,
      price: markPrice, totalAmount: exitValue, netAmount: exitValue,
      brokerage, status: 'COMPLETED', executedAt: new Date(),
      executedPrice: markPrice, positionId: pos._id,
      notes: `Auto-exit: ${reasonLabel} @ ₹${markPrice}`,
    });

    // 3. Release margin + adjust balance + update PnL
    const user = await User.findById(pos.userId);
    if (user) {
      const marginToRelease = pos.marginUsed || pos.usedMargin || 0;
      // releaseMargin: usedMargin ghata + availableBalance wapas do (margin unblock)
      user.releaseMargin(marginToRelease);
      // PnL profit/loss balance mein reflect karo
      user.availableBalance += pnl;      // profit → add, loss → deduct
      user.availableBalance -= brokerage; // exit brokerage deduct
      user.totalPnL  = (user.totalPnL  || 0) + pnl;
      user.todayPnL  = (user.todayPnL  || 0) + pnl;
      await user.save();
    }

    // 4. Remove position node from Firebase
    const uid = pos.userId.toString();
    await _fbPatch({ [`users/${uid}/positions/${posId}`]: null });

    // 5. Sync full user snapshot to Firebase
    await syncSingleUserToFirebase(uid);

    console.log(`✅ [AUTO-CLOSE] ${pos.symbol} | ${reasonLabel} | PnL:₹${pnl.toFixed(2)}`);
    autoCloseInProgress.delete(posId);
    return true;

  } catch (e) {
    console.error(`❌ [AUTO-CLOSE] ${pos.symbol}:`, e.message);
    autoCloseInProgress.delete(posId);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main P&L update loop — runs every 3s during market hours
// ─────────────────────────────────────────────────────────────────────────────
async function updateAllUsersPnL() {
  if (!isMarketOpen()) return;

  try {
    const positions = await Position.find({ isActive: true, isOpen: true }).lean();
    if (!positions.length) return;

    const symbols  = [...new Set(positions.map(p => p.symbol))];
    const stocks   = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    // Group positions by user
    const byUser = {};
    positions.forEach(pos => {
      const uid = pos.userId.toString();
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(pos);
    });

    const fbUpdates   = {};
    const toAutoClose = [];

    for (const [uid, userPositions] of Object.entries(byUser)) {
      let totalUnrealized = 0;
      let totalInvestment = 0;

      for (const pos of userPositions) {
        const posId       = pos._id.toString();
        const markPrice   = priceMap[pos.symbol] || pos.currentPrice || pos.entryPrice || 0;
        const investedVal = pos.investmentValue  || (pos.entryPrice * pos.quantity)   || 0;
        const currentVal  = markPrice * pos.quantity;
        const isLong      = isLongPosition(pos);

        const pnl    = isLong
          ? currentVal - investedVal - (pos.totalBrokerage || 0)
          : investedVal - currentVal - (pos.totalBrokerage || 0);
        const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;

        totalUnrealized += pnl;
        totalInvestment += investedVal;

        // SL/TP distances
        const sl         = parseFloat(pos.stopLoss   || 0);
        const takeProfit = parseFloat(pos.takeProfit || 0);
        const slDistAmt  = sl > 0         ? Math.abs(markPrice - sl)         : null;
        const tgtDistAmt = takeProfit > 0 ? Math.abs(markPrice - takeProfit) : null;
        const slDistPct  = sl > 0 && markPrice > 0 ? (slDistAmt / markPrice)  * 100 : null;
        const tgtDistPct = takeProfit > 0 && markPrice > 0 ? (tgtDistAmt / markPrice) * 100 : null;

        const sltpStatus = getSLTPStatus(pos, markPrice);
        const sltpHit    = checkSLTP(pos, markPrice);
        if (sltpHit && !autoCloseInProgress.has(posId)) {
          toAutoClose.push({ pos, markPrice, reason: sltpHit });
        }
  // ✅ User balance → Firebase (correct formula via calcBalanceFields)
      const userDoc = await User.findById(uid,
        'totalPnL todayPnL availableBalance usedMargin marginMultiplier marginEnabled marginAllowed'
      ).lean();
 if (userDoc) {
        const bal = calcBalanceFields(userDoc);
        // ✅ Correct liquidation price (same formula as userFirebaseService)
        const liquidationPrice = calcLiquidationPrice(pos,bal.availableBalance);
        let liquidationDist = null, liquidationPct = null, liquidationRisk = null;

        if (liquidationPrice !== null && markPrice > 0) {
          liquidationDist = parseFloat(Math.abs(markPrice - liquidationPrice).toFixed(2));
          liquidationPct  = parseFloat((liquidationDist / markPrice * 100).toFixed(4));
          liquidationRisk = liquidationPct <= 2 ? 'danger' : liquidationPct <= 5 ? 'warning' : 'safe';

          const liqHit = isLong ? markPrice <= liquidationPrice : markPrice >= liquidationPrice;
          if (liqHit) {
            liquidationRisk = 'liquidated';
            if (!autoCloseInProgress.has(posId)) toAutoClose.push({ pos, markPrice, reason: 'liquidation' });
          }
        }

        // Position fields → Firebase
        Object.assign(fbUpdates, {
          [`users/${uid}/positions/${posId}/markPrice`]:        parseFloat(markPrice.toFixed(2)),
          [`users/${uid}/positions/${posId}/currentValue`]:     parseFloat(currentVal.toFixed(2)),
          [`users/${uid}/positions/${posId}/pnl`]:              parseFloat(pnl.toFixed(2)),
          [`users/${uid}/positions/${posId}/pnlPercentage`]:    parseFloat(pnlPct.toFixed(4)),
          [`users/${uid}/positions/${posId}/stopLoss`]:         sl || null,
          [`users/${uid}/positions/${posId}/slDistanceAmt`]:    sl > 0 ? parseFloat(slDistAmt.toFixed(2)) : null,
          [`users/${uid}/positions/${posId}/slDistancePct`]:    sl > 0 ? parseFloat(slDistPct.toFixed(4)) : null,
          [`users/${uid}/positions/${posId}/takeProfit`]:       takeProfit || null,
          [`users/${uid}/positions/${posId}/tgtDistanceAmt`]:   takeProfit > 0 ? parseFloat(tgtDistAmt.toFixed(2)) : null,
          [`users/${uid}/positions/${posId}/tgtDistancePct`]:   takeProfit > 0 ? parseFloat(tgtDistPct.toFixed(4)) : null,
          [`users/${uid}/positions/${posId}/sltpStatus`]:       sltpStatus,
          [`users/${uid}/positions/${posId}/sltpHit`]:          sltpHit || null,
          [`users/${uid}/positions/${posId}/liquidationPrice`]: liquidationPrice,
          [`users/${uid}/positions/${posId}/liquidationDist`]:  liquidationDist,
          [`users/${uid}/positions/${posId}/liquidationPct`]:   liquidationPct,
          [`users/${uid}/positions/${posId}/liquidationRisk`]:  liquidationRisk,
          [`users/${uid}/positions/${posId}/isActive`]:         true,
          [`users/${uid}/positions/${posId}/lastUpdated`]:      Date.now(),
        });
      }

    
       // ✅ consistent formula
        Object.assign(fbUpdates, {
          [`users/${uid}/pnl/unrealizedPnL`]:   parseFloat(totalUnrealized.toFixed(2)),
          [`users/${uid}/pnl/totalInvestment`]: parseFloat(totalInvestment.toFixed(2)),
          [`users/${uid}/pnl/openPositions`]:   userPositions.length,
          [`users/${uid}/pnl/totalPnL`]:        parseFloat((userDoc.totalPnL || 0).toFixed(2)),
          [`users/${uid}/pnl/todayPnL`]:        parseFloat((userDoc.todayPnL || 0).toFixed(2)),
          [`users/${uid}/pnl/lastUpdated`]:     Date.now(),

          [`users/${uid}/balance/availableBalance`]:  bal.availableBalance,
          [`users/${uid}/balance/usedMargin`]:        bal.usedMargin,
          [`users/${uid}/balance/remainingMargin`]:   bal.remainingMargin,
          [`users/${uid}/balance/availableMargin`]:   bal.remainingMargin,
          [`users/${uid}/balance/totalMargin`]:       bal.totalMargin,
          [`users/${uid}/balance/marginUtilization`]: bal.marginUtilization,
          [`users/${uid}/balance/lastUpdated`]:       Date.now(),
        });
      }
    }

    if (Object.keys(fbUpdates).length > 0) await _fbPatch(fbUpdates);

    // Auto-close AFTER Firebase push
    for (const { pos, markPrice, reason } of toAutoClose) {
      await autoClosePosition(pos, markPrice, reason);
    }

  } catch (e) {
    console.error('❌ P&L update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Start / Stop
// ─────────────────────────────────────────────────────────────────────────────
function startUserDataSync(pnlIntervalMs = 3000) {
  if (pnlInterval) { console.log('⚠️  User sync already running'); return; }

  console.log('\n' + '═'.repeat(60));
  console.log('🔥 USER FIREBASE SYNC STARTED');
  console.log(`   P&L + SL/TP: every ${pnlIntervalMs / 1000}s  (market hours only: 9:15–15:30)`);
  console.log('   Liquidation: entryPrice ± (marginUsed / qty)');
  console.log('   Balance: availableBalance correctly reflects margin deductions');
  console.log('═'.repeat(60) + '\n');

  updateAllUsersPnL();
  pnlInterval = setInterval(updateAllUsersPnL, pnlIntervalMs);
  console.log('✅ User data sync active\n');
}

function stopUserDataSync() {
  if (pnlInterval) { clearInterval(pnlInterval); pnlInterval = null; }
  console.log('🛑 User data sync stopped');
}

process.on('SIGINT',  () => { stopUserDataSync(); process.exit(0); });
process.on('SIGTERM', () => { stopUserDataSync(); process.exit(0); });

module.exports = {
  startUserDataSync, stopUserDataSync,
  updateAllUsersPnL, autoClosePosition,
  checkSLTP, getSLTPStatus, isMarketOpen,
};
