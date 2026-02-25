// jobs/userDataSyncJob.js (OPTIMIZED)
// ✅ N+1 query fix: User.findById() loop se bahar nikala — single query
// ✅ Firebase updates batched — ek PATCH call per cycle (pehle ek position pe ek call tha)
// ✅ Market hours ke baad P&L sync band
// ✅ Admin panel required keys: balance{availableBalance,usedMargin}, positions, pnl

const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const Order    = require('../models/Order');
const {
  syncSingleUserToFirebase,
  calcLiquidationPrice,
  calcBalanceFields,
  _fbPatch
} = require('../services/userFirebaseService');

let pnlInterval = null;
const autoCloseInProgress = new Set();

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

    const posDoc = await Position.findById(posId);
    if (posDoc) {
      posDoc.close(markPrice, brokerage, closeReason);
      await posDoc.save();
    }

    await Order.create({
      userId: pos.userId, symbol: pos.symbol, companyName: pos.companyName,
      orderType: exitSide, orderMode: 'MARKET', quantity: pos.quantity,
      price: markPrice, totalAmount: exitValue, netAmount: exitValue,
      brokerage, status: 'COMPLETED', executedAt: new Date(),
      executedPrice: markPrice, positionId: pos._id,
      notes: `Auto-exit: ${reasonLabel} @ ₹${markPrice}`,
    });

    const user = await User.findById(pos.userId);
    if (user) {
      const marginToRelease = pos.marginUsed || pos.usedMargin || 0;
      user.releaseMargin(marginToRelease);
      user.availableBalance += pnl;
      user.availableBalance -= brokerage;
      user.totalPnL  = (user.totalPnL  || 0) + pnl;
      user.todayPnL  = (user.todayPnL  || 0) + pnl;
      await user.save();
    }

    const uid = pos.userId.toString();
    await _fbPatch({ [`users/${uid}/positions/${posId}`]: null });
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
// Main P&L update loop — OPTIMIZED
// Fix 1: User.findById() ab loop ke andar nahi — pehle saare users ek saath fetch
// Fix 2: Sab Firebase updates ek single PATCH mein
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

    // ✅ FIX: Saare users ek saath fetch karo (N+1 → 1 query)
    const userIds = Object.keys(byUser);
    const usersArr = await User.find(
      { _id: { $in: userIds } },
      'totalPnL todayPnL availableBalance usedMargin marginMultiplier marginEnabled marginAllowed marginAllowed brokeragePercentage totalBrokeragePaid'
    ).lean();
    const userMap = {};
    usersArr.forEach(u => { userMap[u._id.toString()] = u; });

    const fbUpdates   = {};
    const toAutoClose = [];

    for (const [uid, userPositions] of Object.entries(byUser)) {
      const userDoc = userMap[uid];
      if (!userDoc) continue;

      const bal = calcBalanceFields(userDoc);

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

        const liquidationPrice = calcLiquidationPrice(pos, bal?.availableBalance);
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

        // ✅ Admin panel required position keys
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
          [`users/${uid}/positions/${posId}/availableBalance`]: bal.availableBalance,
        });
      }

      // ✅ Admin panel required balance+pnl keys
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

    // ✅ Single PATCH call for ALL users (pehle user per alag call tha)
    if (Object.keys(fbUpdates).length > 0) await _fbPatch(fbUpdates);

    for (const { pos, markPrice, reason } of toAutoClose) {
      await autoClosePosition(pos, markPrice, reason);
    }

  } catch (e) {
    console.error('❌ P&L update error:', e.message);
  }
}

function startUserDataSync(pnlIntervalMs = 5000) {
  if (pnlInterval) { console.log('⚠️  User sync already running'); return; }

  console.log('\n' + '═'.repeat(60));
  console.log('🔥 USER FIREBASE SYNC STARTED (OPTIMIZED)');
  console.log(`   P&L + SL/TP: every ${pnlIntervalMs / 1000}s  (market hours only: 9:15–15:30)`);
  console.log('   Fix: N+1 query removed — single User.find() per cycle');
  console.log('   Fix: All Firebase updates in single PATCH call');
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
