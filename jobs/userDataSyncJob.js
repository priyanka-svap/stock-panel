// jobs/userDataSyncJob.js
//
// ✅ SMART SYNC STRATEGY:
//    - Market hours (9:15–3:30): Position P&L har 3s mein update → Firebase
//    - Market CLOSED: syncAllUsersToFirebase nahi chalega
//    - User data (balance, pnl) sirf tab sync hoga jab value badli ho
//    - Position data: market hours mein har cycle mein (prices change hoti hain)
//    - SL/TP monitoring: market hours mein hi
//    - Liquidation price: SINGLE formula — entryPrice ± (marginUsed / qty)
//
// ✅ FIXED ISSUES:
//    1. liquidationPrice: ek consistent formula (service ke saath match)
//    2. users bar bar sync: change detection se avoid
//    3. Market hours ke bahar: P&L loop band, sirf event-driven sync
//    4. autoCloseInProgress.delete() on success bhi

const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const Order    = require('../models/Order');
const {
  syncAllUsersToFirebase,
  forceSyncUserToFirebase,
  calcLiquidationPrice,
  _fbPatch
} = require('../services/userFirebaseService');

let pnlInterval  = null;

// Prevent double auto-closing the same position in same cycle
const autoCloseInProgress = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// MARKET HOURS CHECK (IST)
// ─────────────────────────────────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false; // Weekend
  const cur = ist.getHours() * 60 + ist.getMinutes();
  return cur >= (9 * 60 + 15) && cur <= (15 * 60 + 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Is position LONG or SHORT?
// ─────────────────────────────────────────────────────────────────────────────
function isLongPosition(pos) {
  return pos.positionType === 'LONG' || pos.type === 'BUY' || pos.orderType === 'BUY';
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Check if SL or takeProfit is hit
// Returns: 'sl_hit' | 'takeProfit_hit' | null
// ─────────────────────────────────────────────────────────────────────────────
function checkSLTP(pos, markPrice) {
  const sl         = parseFloat(pos.stopLoss    || pos.sl     || 0);
  const takeProfit = parseFloat(pos.takeProfit  || pos.takeProfitPrice || 0);
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Descriptive SL/TP status
// ─────────────────────────────────────────────────────────────────────────────
function getSLTPStatus(pos, markPrice) {
  const sl         = parseFloat(pos.stopLoss   || pos.sl    || 0);
  const takeProfit = parseFloat(pos.takeProfit || pos.takeProfitPrice || 0);

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
// AUTO CLOSE: When SL / takeProfit / Liquidation hits
// ─────────────────────────────────────────────────────────────────────────────
async function autoClosePosition(pos, markPrice, reason) {
  const posId = pos._id.toString();

  if (autoCloseInProgress.has(posId)) return false;
  autoCloseInProgress.add(posId);

  try {
    const isLong      = isLongPosition(pos);
    const exitSide    = isLong ? 'SELL' : 'BUY';
    const reasonLabel = reason === 'sl_hit' ? 'Stop Loss'
      : reason === 'takeProfit_hit' ? 'Take Profit'
      : 'LIQUIDATION';

    const investedVal = pos.investmentValue || (pos.entryPrice * pos.quantity) || 0;
    const exitValue   = markPrice * pos.quantity;
    const brokerage   = pos.totalBrokerage || 0;
    const pnl         = isLong
      ? exitValue - investedVal - brokerage
      : investedVal - exitValue - brokerage;

    console.log(`🎯 [AUTO-CLOSE] ${reasonLabel}: ${pos.symbol} @ ₹${markPrice} | PnL: ₹${pnl.toFixed(2)}`);

    const closeReason = reason === 'sl_hit'          ? 'STOP_LOSS'
      : reason === 'takeProfit_hit' ? 'TARGET'
      : 'LIQUIDATION';

    // 1. Close position in MongoDB
    await Position.findByIdAndUpdate(posId, {
      isActive:    false,
      isOpen:      false,
      exitPrice:   markPrice,
      exitedAt:    new Date(),
      exitDate:    new Date(),
      closeReason: closeReason,
      finalPnL:    parseFloat(pnl.toFixed(2)),
      realizedPnL: parseFloat(pnl.toFixed(2)),
    });

    // 2. Create closing Order record
    await Order.create({
      userId:      pos.userId,
      symbol:      pos.symbol,
      companyName: pos.companyName,
      orderType:   exitSide,
      orderMode:   'MARKET',
      quantity:    pos.quantity,
      price:       markPrice,
      totalAmount: exitValue,
      netAmount:   exitValue,
      brokerage:   brokerage,
      status:      'COMPLETED',
      executedAt:  new Date(),
      executedPrice: markPrice,
      positionId:  pos._id,
      notes:       `Auto-exit: ${reasonLabel} @ ₹${markPrice}`,
    });

    // 3. Release margin + update user PnL
    const user = await User.findById(pos.userId);
    if (user) {
      const marginToRelease = pos.marginUsed || pos.usedMargin || 0;
      // ✅ releaseMargin: usedMargin kam karo + availableBalance wapas do
      user.releaseMargin(marginToRelease);
      // PnL diff aur brokerage adjust karo
      user.availableBalance += pnl;      // profit add / loss deduct
      user.availableBalance -= brokerage; // exit brokerage deduct
      user.totalPnL          = (user.totalPnL || 0) + pnl;
      user.todayPnL          = (user.todayPnL || 0) + pnl;
      await user.save();
    }

    // 4. Remove position from Firebase (null = delete node)
    const uid = pos.userId.toString();
    await _fbPatch({ [`users/${uid}/positions/${posId}`]: null });

    // 5. Force-sync user to update balance/pnl in Firebase
    await forceSyncUserToFirebase(uid);

    console.log(`✅ [AUTO-CLOSE] Done: ${pos.symbol} | ${reasonLabel} | PnL: ₹${pnl.toFixed(2)}`);
    autoCloseInProgress.delete(posId); // ✅ delete on success too
    return true;

  } catch (e) {
    console.error(`❌ [AUTO-CLOSE] Error for ${pos.symbol}:`, e.message);
    autoCloseInProgress.delete(posId);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FAST P&L + SL/TP UPDATE  (runs every 3s, only during market hours)
//
// Firebase structure per position:
//   users/{uid}/positions/{posId}/
//     markPrice, currentValue, pnl, pnlPercentage
//     stopLoss, slDistanceAmt, slDistancePct
//     takeProfit, tgtDistanceAmt, tgtDistancePct
//     sltpStatus, sltpHit
//     liquidationPrice, liquidationDist, liquidationPct, liquidationRisk
//     isActive, lastUpdated
// ─────────────────────────────────────────────────────────────────────────────
async function updateAllUsersPnL() {
  // ✅ Sirf market hours mein chalao
  if (!isMarketOpen()) return;

  try {
    const positions = await Position.find({ isActive: true, isOpen: true }).lean();
    if (!positions.length) return;

    const symbols  = [...new Set(positions.map(p => p.symbol))];
    const stocks   = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

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
        const investedVal = pos.investmentValue || (pos.entryPrice * pos.quantity) || 0;
        const currentVal  = markPrice * pos.quantity;
        const isLong      = isLongPosition(pos);

        // P&L
        const pnl    = isLong
          ? currentVal - investedVal - (pos.totalBrokerage || 0)
          : investedVal - currentVal - (pos.totalBrokerage || 0);
        const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;

        totalUnrealized += pnl;
        totalInvestment += investedVal;

        // SL / TP distances
        const sl         = parseFloat(pos.stopLoss   || 0);
        const takeProfit = parseFloat(pos.takeProfit || 0);
        const slDistAmt  = sl > 0         ? Math.abs(markPrice - sl)         : null;
        const tgtDistAmt = takeProfit > 0 ? Math.abs(markPrice - takeProfit) : null;
        const slDistPct  = sl > 0         && markPrice > 0 ? (slDistAmt  / markPrice) * 100 : null;
        const tgtDistPct = takeProfit > 0 && markPrice > 0 ? (tgtDistAmt / markPrice) * 100 : null;

        const sltpStatus = getSLTPStatus(pos, markPrice);
        const sltpHit    = checkSLTP(pos, markPrice);

        if (sltpHit && !autoCloseInProgress.has(posId)) {
          toAutoClose.push({ pos, markPrice, reason: sltpHit });
        }

        // ── Liquidation price ──────────────────────────────────────────────
        // ✅ SAME formula as userFirebaseService.calcLiquidationPrice
        // LONG:  entryPrice - (marginUsed / qty)
        // SHORT: entryPrice + (marginUsed / qty)
        const liquidationPrice = calcLiquidationPrice(pos);

        let liquidationDist = null;
        let liquidationPct  = null;
        let liquidationRisk = null;

        if (liquidationPrice !== null && markPrice > 0) {
          liquidationDist = parseFloat(Math.abs(markPrice - liquidationPrice).toFixed(2));
          liquidationPct  = parseFloat((liquidationDist / markPrice * 100).toFixed(4));

          if (liquidationPct <= 2)      liquidationRisk = 'danger';
          else if (liquidationPct <= 5) liquidationRisk = 'warning';
          else                          liquidationRisk = 'safe';

          // Check if already liquidated
          const liqHit = isLong ? markPrice <= liquidationPrice : markPrice >= liquidationPrice;
          if (liqHit) {
            liquidationRisk = 'liquidated';
            if (!autoCloseInProgress.has(posId)) {
              toAutoClose.push({ pos, markPrice, reason: 'liquidation' });
            }
          }
        }

        // Build Firebase update for this position
        Object.assign(fbUpdates, {
          [`users/${uid}/positions/${posId}/markPrice`]:       parseFloat(markPrice.toFixed(2)),
          [`users/${uid}/positions/${posId}/currentValue`]:    parseFloat(currentVal.toFixed(2)),
          [`users/${uid}/positions/${posId}/pnl`]:             parseFloat(pnl.toFixed(2)),
          [`users/${uid}/positions/${posId}/pnlPercentage`]:   parseFloat(pnlPct.toFixed(4)),

          [`users/${uid}/positions/${posId}/stopLoss`]:        sl || null,
          [`users/${uid}/positions/${posId}/slDistanceAmt`]:   sl > 0 ? parseFloat(slDistAmt.toFixed(2)) : null,
          [`users/${uid}/positions/${posId}/slDistancePct`]:   sl > 0 ? parseFloat(slDistPct.toFixed(4)) : null,

          [`users/${uid}/positions/${posId}/takeProfit`]:      takeProfit || null,
          [`users/${uid}/positions/${posId}/tgtDistanceAmt`]:  takeProfit > 0 ? parseFloat(tgtDistAmt.toFixed(2)) : null,
          [`users/${uid}/positions/${posId}/tgtDistancePct`]:  takeProfit > 0 ? parseFloat(tgtDistPct.toFixed(4)) : null,

          [`users/${uid}/positions/${posId}/sltpStatus`]:      sltpStatus,
          [`users/${uid}/positions/${posId}/sltpHit`]:         sltpHit || null,

          [`users/${uid}/positions/${posId}/liquidationPrice`]: liquidationPrice,
          [`users/${uid}/positions/${posId}/liquidationDist`]:  liquidationDist,
          [`users/${uid}/positions/${posId}/liquidationPct`]:   liquidationPct,
          [`users/${uid}/positions/${posId}/liquidationRisk`]:  liquidationRisk,

          [`users/${uid}/positions/${posId}/isActive`]:        true,
          [`users/${uid}/positions/${posId}/lastUpdated`]:     Date.now(),
        });
      }

      // User-level P&L summary (sirf agar positions hain)
      const user = await User.findById(uid, 'totalPnL todayPnL availableBalance usedMargin marginMultiplier marginEnabled marginAllowed').lean();
      if (user) {
        // ✅ Same formula as User model virtual
        const availBal   = user.availableBalance || 0;
        const usedMgn    = user.usedMargin || 0;
        let totalMargin;
        if (!user.marginEnabled) {
          totalMargin = availBal;
        } else if ((user.marginMultiplier || 1) > 1) {
          totalMargin = availBal * (user.marginMultiplier || 1);
        } else {
          totalMargin = availBal + (user.marginAllowed || 0);
        }
        const remainingMargin = Math.max(0, totalMargin - usedMgn);
        const marginUtilPct   = totalMargin > 0 ? parseFloat((usedMgn / totalMargin * 100).toFixed(2)) : 0;

        Object.assign(fbUpdates, {
          [`users/${uid}/pnl/unrealizedPnL`]:   parseFloat(totalUnrealized.toFixed(2)),
          [`users/${uid}/pnl/totalInvestment`]: parseFloat(totalInvestment.toFixed(2)),
          [`users/${uid}/pnl/openPositions`]:   userPositions.length,
          [`users/${uid}/pnl/totalPnL`]:        parseFloat((user.totalPnL  || 0).toFixed(2)),
          [`users/${uid}/pnl/todayPnL`]:        parseFloat((user.todayPnL  || 0).toFixed(2)),
          [`users/${uid}/pnl/lastUpdated`]:     Date.now(),

          [`users/${uid}/balance/availableBalance`]: parseFloat(availBal.toFixed(2)),
          [`users/${uid}/balance/usedMargin`]:       parseFloat(usedMgn.toFixed(2)),
          [`users/${uid}/balance/remainingMargin`]:  parseFloat(remainingMargin.toFixed(2)),  // ✅
          [`users/${uid}/balance/availableMargin`]:  parseFloat(remainingMargin.toFixed(2)),  // alias
          [`users/${uid}/balance/totalMargin`]:      parseFloat(totalMargin.toFixed(2)),
          [`users/${uid}/balance/marginUtilization`]: marginUtilPct,
          [`users/${uid}/balance/lastUpdated`]:      Date.now(),
        });
      }
    }

    if (Object.keys(fbUpdates).length > 0) {
      await _fbPatch(fbUpdates);
    }

    // Auto-close AFTER Firebase push (app sees hit first, then position closes)
    for (const { pos, markPrice, reason } of toAutoClose) {
      await autoClosePosition(pos, markPrice, reason);
    }

  } catch (e) {
    console.error('❌ P&L update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────────
function startUserDataSync(pnlIntervalMs = 3000) {
  if (pnlInterval) {
    console.log('⚠️  User sync already running');
    return;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🔥 USER FIREBASE SYNC STARTED');
  console.log(`   P&L + SL/TP: every ${pnlIntervalMs / 1000}s (market hours only: 9:15–3:30)`);
  console.log('   Smart sync: sirf changed data Firebase ko jayega');
  console.log('   Liquidation: entryPrice ± (marginUsed / qty) — consistent formula');
  console.log('═'.repeat(60) + '\n');

  // Immediate first P&L run (if market open)
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
  startUserDataSync,
  stopUserDataSync,
  updateAllUsersPnL,
  checkSLTP,
  getSLTPStatus,
  autoClosePosition,
  isMarketOpen,
};
