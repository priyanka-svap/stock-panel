// jobs/userDataSyncJob.js
// ✅ Periodic sync: every 10s syncs ALL users to Firebase
// ✅ Realtime P&L: updates position mark prices → pnl → balance live
// ✅ Stop Loss & takeProfit: pushed to Firebase per position
// ✅ SL/takeProfit hit detection: auto-closes position + notifies Firebase
// ✅ Distance tracking: how far price is from SL/takeProfit (amt + %)

const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const Order    = require('../models/Order');
const { syncAllUsersToFirebase, syncSingleUserToFirebase, _fbPatch } = require('../services/userFirebaseService');

let syncInterval = null;
let pnlInterval  = null;

// Prevent double auto-closing the same position in same cycle
const autoCloseInProgress = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Is position LONG or SHORT?
// ─────────────────────────────────────────────────────────────────────────────
function isLongPosition(pos) {
  return (
    pos.positionType === 'LONG' ||
    pos.type         === 'BUY'  ||
    pos.orderType    === 'BUY'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Check if SL or takeProfit is hit
// Returns: 'sl_hit' | 'takeProfit_hit' | null
// ─────────────────────────────────────────────────────────────────────────────
function checkSLTP(pos, markPrice) {
  const sl     = parseFloat(pos.stopLoss    || pos.sl     || 0);
  const takeProfit = parseFloat(pos.takeProfitPrice || pos.takeProfit || 0);
  const isLong = isLongPosition(pos);

  if (isLong) {
    if (sl     > 0 && markPrice <= sl)     return 'sl_hit';
    if (takeProfit > 0 && markPrice >= takeProfit) return 'takeProfit_hit';
  } else {
    if (sl     > 0 && markPrice >= sl)     return 'sl_hit';
    if (takeProfit > 0 && markPrice <= takeProfit) return 'takeProfit_hit';
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Descriptive SL/takeProfit status for Firebase
// Values: 'no_sltp' | 'safe' | 'near_sl' | 'near_takeProfit' | 'sl_hit' | 'takeProfit_hit'
// ─────────────────────────────────────────────────────────────────────────────
function getSLTPStatus(pos, markPrice) {
  const sl     = parseFloat(pos.stopLoss    || pos.sl     || 0);
  const takeProfit = parseFloat(pos.takeProfitPrice || pos.takeProfit || 0);

  if (!sl && !takeProfit) return 'no_sltp';

  const hit = checkSLTP(pos, markPrice);
  if (hit) return hit;

  const isLong   = isLongPosition(pos);
  const WARN_PCT = 1.5; // warn if within 1.5%

  if (isLong) {
    if (sl     > 0 && ((markPrice - sl)     / markPrice * 100) < WARN_PCT) return 'near_sl';
    if (takeProfit > 0 && ((takeProfit - markPrice) / markPrice * 100) < WARN_PCT) return 'near_takeProfit';
  } else {
    if (sl     > 0 && ((sl - markPrice)     / markPrice * 100) < WARN_PCT) return 'near_sl';
    if (takeProfit > 0 && ((markPrice - takeProfit) / markPrice * 100) < WARN_PCT) return 'near_takeProfit';
  }

  return 'safe';
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO CLOSE: When SL or takeProfit hits
// - Marks position inactive in MongoDB
// - Creates closing Order record
// - Releases margin + updates user PnL + balance
// ─────────────────────────────────────────────────────────────────────────────
async function autoClosePosition(pos, markPrice, reason) {
  const posId = pos._id.toString();

  if (autoCloseInProgress.has(posId)) return false;
  autoCloseInProgress.add(posId);

  try {
    const isLong      = isLongPosition(pos);
    const exitSide    = isLong ? 'SELL' : 'BUY';
    const reasonLabel = reason === 'sl_hit' ? 'Stop Loss' : 'takeProfit';
    const investedVal = pos.investmentValue || (pos.entryPrice * pos.quantity) || 0;
    const exitValue   = markPrice * pos.quantity;
    const brokerage   = pos.totalBrokerage || 0;
    const pnl         = isLong
      ? exitValue - investedVal - brokerage
      : investedVal - exitValue - brokerage;

    console.log(`🎯 [SLTP] ${reasonLabel} hit: ${pos.symbol} @ ₹${markPrice} | PnL: ₹${pnl.toFixed(2)} | User: ${pos.userId}`);

    // 1. Close position in MongoDB
    await Position.findByIdAndUpdate(posId, {
      isActive:    false,
      isOpen:      false,
      exitPrice:   markPrice,
      exitedAt:    new Date(),
      closeReason: reason === 'sl_hit' ? 'STOP_LOSS' : 'takeProfit',
      finalPnL:    parseFloat(pnl.toFixed(2)),
    });

    // 2. Create closing Order record
    await Order.create({
      userId:      pos.userId,
      symbol:      pos.symbol,
      orderType:   exitSide,
      productType: pos.productType || pos.segment || 'INTRADAY',
      quantity:    pos.quantity,
      price:       markPrice,
      netAmount:   exitValue,
      status:      'COMPLETED',
      executedAt:  new Date(),
      notes:       `Auto-exit: ${reasonLabel} triggered @ ₹${markPrice}`,
    });

    // 3. Release margin + update user PnL + balance
    const user = await User.findById(pos.userId);
    if (user) {
      user.usedMargin       = Math.max(0, (user.usedMargin || 0) - (pos.usedMargin || 0));
      user.totalPnL         = (user.totalPnL || 0) + pnl;
      user.todayPnL         = (user.todayPnL || 0) + pnl;
      user.availableBalance = (user.availableBalance || 0) + exitValue - brokerage;
      await user.save();
    }

    console.log(`✅ [SLTP] Closed: ${pos.symbol} | ${reasonLabel} | PnL: ₹${pnl.toFixed(2)}`);
    return true;

  } catch (e) {
    console.error(`❌ [SLTP] Auto-close error for ${pos.symbol}:`, e.message);
    autoCloseInProgress.delete(posId);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FAST P&L + SL/takeProfit UPDATE  (runs every 3s)
//
// Firebase structure written per position:
//   users/{uid}/positions/{posId}/
//     markPrice        — current market price
//     currentValue     — markPrice × qty
//     pnl              — net pnl after brokerage
//     pnlPercentage    — pnl / investedVal × 100
//     stopLoss         — SL price (null if not set)
//     takeProfitPrice      — takeProfit price (null if not set)
//     slDistanceAmt    — |markPrice - stopLoss| in ₹
//     slDistancePct    — slDistanceAmt / markPrice × 100
//     tgtDistanceAmt   — |takeProfitPrice - markPrice| in ₹
//     tgtDistancePct   — tgtDistanceAmt / markPrice × 100
//     sltpStatus       — 'no_sltp' | 'safe' | 'near_sl' | 'near_takeProfit' | 'sl_hit' | 'takeProfit_hit'
//     sltpHit          — null | 'sl_hit' | 'takeProfit_hit'
//     isActive         — false once closed
//     closeReason      — null | 'STOP_LOSS' | 'takeProfit'
//     lastUpdated      — epoch ms
// ─────────────────────────────────────────────────────────────────────────────
async function updateAllUsersPnL() {
  try {
    const positions = await Position.find({ isActive: true }).lean();
    if (!positions.length) return;

    // Batch-fetch all stock prices
    const symbols  = [...new Set(positions.map(p => p.symbol))];
    const stocks   = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    // Group by userId
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
        const posId      = pos._id.toString();
        const markPrice  = priceMap[pos.symbol] || pos.currentPrice || pos.entryPrice || 0;
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

        // SL / takeProfit
        const sl     = parseFloat(pos.stopLoss    || pos.sl     || 0);
        const takeProfit = parseFloat(pos.takeProfitPrice || pos.takeProfit || 0);

        const slDistAmt  = sl     > 0 ? Math.abs(markPrice - sl)     : null;
        const tgtDistAmt = takeProfit > 0 ? Math.abs(markPrice - takeProfit) : null;
        const slDistPct  = sl     > 0 && markPrice > 0 ? (slDistAmt  / markPrice) * 100 : null;
        const tgtDistPct = takeProfit > 0 && markPrice > 0 ? (tgtDistAmt / markPrice) * 100 : null;

        const sltpStatus = getSLTPStatus(pos, markPrice);
        const sltpHit    = checkSLTP(pos, markPrice);

        if (sltpHit && !autoCloseInProgress.has(posId)) {
          toAutoClose.push({ pos, markPrice, reason: sltpHit });
        }

        // ── Liquidation price ─────────────────────────────────────────────
        // Price at which margin is fully exhausted → force close
        // LONG:  liqPrice = entryPrice - (marginUsed / qty)
        // SHORT: liqPrice = entryPrice + (marginUsed / qty)
        const marginUsed    = pos.usedMargin || pos.marginUsed || 0;
        const marginPerUnit = marginUsed > 0 && pos.quantity > 0
          ? marginUsed / pos.quantity
          : 0;

        let liquidationPrice = null;
        let liquidationDist  = null;   // ₹ distance from current price
        let liquidationPct   = null;   // % distance from current price
        let liquidationRisk  = 'safe'; // 'safe' | 'warning' | 'danger' | 'liquidated'

        if (marginPerUnit > 0 && pos.entryPrice > 0) {
          liquidationPrice = isLong
            ? parseFloat((pos.entryPrice - marginPerUnit).toFixed(2))
            : parseFloat((pos.entryPrice + marginPerUnit).toFixed(2));

          liquidationDist = parseFloat(Math.abs(markPrice - liquidationPrice).toFixed(2));
          liquidationPct  = markPrice > 0
            ? parseFloat((liquidationDist / markPrice * 100).toFixed(4))
            : null;

          // Risk levels
          if (liquidationPct !== null) {
            if (liquidationPct <= 2)      liquidationRisk = 'danger';
            else if (liquidationPct <= 5) liquidationRisk = 'warning';
            else                          liquidationRisk = 'safe';
          }

          // Check if liquidation price already breached
          const liqHit = isLong
            ? markPrice <= liquidationPrice
            : markPrice >= liquidationPrice;

          if (liqHit) {
            liquidationRisk = 'liquidated';
            if (!autoCloseInProgress.has(posId)) {
              toAutoClose.push({ pos, markPrice, reason: 'liquidation' });
            }
          }
        }

        // Build Firebase update for this position
        Object.assign(fbUpdates, {
          // P&L
          [`users/${uid}/positions/${posId}/markPrice`]:      parseFloat(markPrice.toFixed(2)),
          [`users/${uid}/positions/${posId}/currentValue`]:   parseFloat(currentVal.toFixed(2)),
          [`users/${uid}/positions/${posId}/pnl`]:            parseFloat(pnl.toFixed(2)),
          [`users/${uid}/positions/${posId}/pnlPercentage`]:  parseFloat(pnlPct.toFixed(4)),

          // Stop Loss
          [`users/${uid}/positions/${posId}/stopLoss`]:       sl || null,
          [`users/${uid}/positions/${posId}/slDistanceAmt`]:  sl > 0 ? parseFloat(slDistAmt.toFixed(2)) : null,
          [`users/${uid}/positions/${posId}/slDistancePct`]:  sl > 0 ? parseFloat(slDistPct.toFixed(4)) : null,

          // takeProfit
          [`users/${uid}/positions/${posId}/takeProfitPrice`]:    takeProfit || null,
          [`users/${uid}/positions/${posId}/tgtDistanceAmt`]: takeProfit > 0 ? parseFloat(tgtDistAmt.toFixed(2)) : null,
          [`users/${uid}/positions/${posId}/tgtDistancePct`]: takeProfit > 0 ? parseFloat(tgtDistPct.toFixed(4)) : null,

          // SLTP status
          [`users/${uid}/positions/${posId}/sltpStatus`]:         sltpStatus,
          [`users/${uid}/positions/${posId}/sltpHit`]:            sltpHit || null,

          // 💀 Liquidation
          [`users/${uid}/positions/${posId}/liquidationPrice`]:   liquidationPrice,
          [`users/${uid}/positions/${posId}/liquidationDist`]:    liquidationDist,
          [`users/${uid}/positions/${posId}/liquidationPct`]:     liquidationPct,
          [`users/${uid}/positions/${posId}/liquidationRisk`]:    liquidationRisk,

          // Meta
          [`users/${uid}/positions/${posId}/symbol`]:         pos.symbol,
          [`users/${uid}/positions/${posId}/entryPrice`]:     parseFloat((pos.entryPrice || 0).toFixed(2)),
          [`users/${uid}/positions/${posId}/quantity`]:       pos.quantity,
          [`users/${uid}/positions/${posId}/positionType`]:   isLong ? 'LONG' : 'SHORT',
          [`users/${uid}/positions/${posId}/isActive`]:       true,
          [`users/${uid}/positions/${posId}/lastUpdated`]:    Date.now(),
        });
      }

      // User-level summary
      const user = await User.findById(uid, 'totalPnL todayPnL availableBalance usedMargin marginMultiplier').lean();
      if (user) {
        const totalMargin = (user.availableBalance || 0) * (user.marginMultiplier || 1);
        Object.assign(fbUpdates, {
          [`users/${uid}/pnl/unrealizedPnL`]:   parseFloat(totalUnrealized.toFixed(2)),
          [`users/${uid}/pnl/totalInvestment`]: parseFloat(totalInvestment.toFixed(2)),
          [`users/${uid}/pnl/openPositions`]:   userPositions.length,
          [`users/${uid}/pnl/totalPnL`]:        parseFloat((user.totalPnL  || 0).toFixed(2)),
          [`users/${uid}/pnl/todayPnL`]:        parseFloat((user.todayPnL  || 0).toFixed(2)),
          [`users/${uid}/pnl/lastUpdated`]:     Date.now(),

          [`users/${uid}/balance/availableBalance`]: parseFloat((user.availableBalance || 0).toFixed(2)),
          [`users/${uid}/balance/usedMargin`]:       parseFloat((user.usedMargin       || 0).toFixed(2)),
          [`users/${uid}/balance/availableMargin`]:  parseFloat(Math.max(0, totalMargin - (user.usedMargin || 0)).toFixed(2)),
          [`users/${uid}/balance/lastUpdated`]:      Date.now(),
        });
      }
    }

    // Single PATCH to Firebase for all users + positions
    if (Object.keys(fbUpdates).length > 0) {
      await _fbPatch(fbUpdates);
    }

    // Auto-close SL/takeProfit hits AFTER Firebase push
    // (app sees the hit status first, then position closes)
    for (const { pos, markPrice, reason } of toAutoClose) {
      const closed = await autoClosePosition(pos, markPrice, reason);

      if (closed) {
        const uid   = pos.userId.toString();
        const posId = pos._id.toString();

        // Mark as closed in Firebase
        await _fbPatch({
          [`users/${uid}/positions/${posId}/isActive`]:    false,
          [`users/${uid}/positions/${posId}/sltpStatus`]:  reason,
          [`users/${uid}/positions/${posId}/sltpHit`]:     reason,
          [`users/${uid}/positions/${posId}/closeReason`]: reason === 'sl_hit' ? 'STOP_LOSS' : 'takeProfit',
          [`users/${uid}/positions/${posId}/closedAt`]:    Date.now(),
        });

        // Full user sync to refresh balance/PnL in Firebase
        await syncSingleUserToFirebase(uid).catch(() => {});
      }
    }

  } catch (e) {
    console.error('❌ P&L update error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────────
function startUserDataSync(fullSyncIntervalSec = 10, pnlIntervalMs = 3000) {
  if (syncInterval) {
    console.log('⚠️  User sync already running');
    return;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🔥 USER FIREBASE SYNC STARTED');
  console.log(`   Full sync:    every ${fullSyncIntervalSec}s`);
  console.log(`   P&L + SL/TP: every ${pnlIntervalMs / 1000}s`);
  console.log('   Syncing: profile | balance | pnl | positions | SL/TP | watchlist');
  console.log('═'.repeat(60) + '\n');

  syncAllUsersToFirebase();
  syncInterval = setInterval(syncAllUsersToFirebase, fullSyncIntervalSec * 1000);
  pnlInterval  = setInterval(updateAllUsersPnL, pnlIntervalMs);

  console.log('✅ User data sync active (SL/takeProfit monitoring ON)\n');
}

function stopUserDataSync() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  if (pnlInterval)  { clearInterval(pnlInterval);  pnlInterval  = null; }
  console.log('🛑 User data sync stopped');
}

process.on('SIGINT',  () => { stopUserDataSync(); process.exit(0); });
process.on('SIGTERM', () => { stopUserDataSync(); process.exit(0); });

module.exports = {
  startUserDataSync,
  stopUserDataSync,
  syncAllUsersToFirebase,
  syncSingleUserToFirebase,
  updateAllUsersPnL,
  checkSLTP,
  getSLTPStatus,
  autoClosePosition,
};