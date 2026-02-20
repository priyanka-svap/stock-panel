// jobs/sltpMonitorJob.js
// ✅ Monitors all ACTIVE positions for SL/TP triggers
// ✅ Auto-executes exit order when SL or TP hit
// ✅ Updates user balance, P&L, releases margin
// ✅ Firebase synced after trigger

const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const Order    = require('../models/Order');
const { syncSingleUserToFirebase } = require('../services/userFirebaseService');

let monitorInterval = null;

async function monitorSLTP() {
  try {
    // Fetch all active positions — SL/TP positions + margin positions (for liquidation)
    const positions = await Position.find({
      isActive: true,
      $or: [
        { stopLoss:   { $exists: true, $ne: null } },
        { takeProfit: { $exists: true, $ne: null } },
        { usedMargin: { $gt: 0 } },    // margin positions need liquidation monitoring
        { marginUsed: { $gt: 0 } }
      ]
    }).lean();

    if (!positions.length) return;

    const symbols  = [...new Set(positions.map(p => p.symbol))];
    const stocks   = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    for (const pos of positions) {
      const markPrice = priceMap[pos.symbol];
      if (!markPrice) continue;

      let triggered    = false;
      let triggerType  = null;
      let exitPrice    = null;

      // ── SL / TP check ──────────────────────────────────────────────────
      if (pos.positionType === 'LONG') {
        if (pos.stopLoss   && markPrice <= pos.stopLoss)   { triggered = true; triggerType = 'SL';          exitPrice = pos.stopLoss; }
        if (pos.takeProfit && markPrice >= pos.takeProfit) { triggered = true; triggerType = 'TP';          exitPrice = pos.takeProfit; }
      } else {
        if (pos.stopLoss   && markPrice >= pos.stopLoss)   { triggered = true; triggerType = 'SL';          exitPrice = pos.stopLoss; }
        if (pos.takeProfit && markPrice <= pos.takeProfit) { triggered = true; triggerType = 'TP';          exitPrice = pos.takeProfit; }
      }

      // ── 💀 LIQUIDATION check ────────────────────────────────────────────
      // If no SL/TP triggered yet, check if margin has been exhausted
      if (!triggered) {
        const marginUsed    = pos.usedMargin || pos.marginUsed || 0;
        const marginPerUnit = marginUsed > 0 && pos.quantity > 0
          ? marginUsed / pos.quantity
          : 0;

        if (marginPerUnit > 0 && pos.entryPrice > 0) {
          const liqPrice = pos.positionType === 'LONG'
            ? pos.entryPrice - marginPerUnit
            : pos.entryPrice + marginPerUnit;

          const liqHit = pos.positionType === 'LONG'
            ? markPrice <= liqPrice
            : markPrice >= liqPrice;

          if (liqHit) {
            triggered   = true;
            triggerType = 'LIQUIDATION';
            exitPrice   = parseFloat(liqPrice.toFixed(2));
            console.log(`\n💀 LIQUIDATION triggered: ${pos.symbol} | liqPrice: ₹${exitPrice} | markPrice: ₹${markPrice}`);
          }
        }
      }

      if (!triggered) continue;

      // Reload fresh document
      const position = await Position.findById(pos._id);
      if (!position || !position.isActive) continue;

      const user = await User.findById(pos.userId);
      if (!user) continue;

      const triggerEmoji = triggerType === 'LIQUIDATION' ? '💀' : '🔔';
      console.log(`\n${triggerEmoji} ${triggerType} TRIGGERED: ${pos.symbol} | Mark: ₹${markPrice} | Exit: ₹${exitPrice}`);

      const exitBrok = user.calculateBrokerage(position.quantity * exitPrice, position.quantity);

      // Close position
      const closeReason = triggerType === 'SL' ? 'STOP_LOSS'
        : triggerType === 'TP' ? 'TARGET'
        : 'LIQUIDATION';
      position.close(exitPrice, exitBrok, closeReason);
      await position.save();

      // Update user
      user.releaseMargin(pos.marginUsed);
      user.totalPnL          += position.realizedPnL;
      user.todayPnL          += position.realizedPnL;
      user.totalBrokeragePaid += exitBrok;
      await user.save();

      // Record exit order
      const exitOrder = new Order({
        userId:        user._id,
        symbol:        position.symbol,
        companyName:   position.companyName,
        tradingSymbol: position.tradingSymbol || position.symbol,
        instrumentType: position.instrumentType || 'EQUITY',
        contractType:  position.contractType || 'SPOT',
        orderType:     position.positionType === 'LONG' ? 'SELL' : 'BUY',
        orderMode:     'MARKET',
        quantity:      position.quantity,
        price:         exitPrice,
        totalAmount:   position.quantity * exitPrice,
        marginRequired: 0,
        brokerage:     exitBrok,
        netAmount:     exitBrok,
        status:        'COMPLETED',
        executedAt:    new Date(),
        executedPrice: exitPrice,
        positionId:    position._id,
        notes:         triggerType === 'LIQUIDATION'
          ? `⚠️ LIQUIDATED: Margin exhausted @ ₹${exitPrice}`
          : `Auto-exit: ${triggerType} triggered at ₹${exitPrice}`
      });
      // need calculateCharges for gst/stamp
      exitOrder.gst              = exitBrok * 0.18;
      exitOrder.taxesAndCharges  = exitOrder.gst;
      exitOrder.netAmount        = exitBrok + exitOrder.taxesAndCharges;
      await exitOrder.save();

      await syncSingleUserToFirebase(user._id.toString());

      console.log(`   ✅ Position closed | realizedPnL: ₹${position.realizedPnL.toFixed(2)}`);
    }

  } catch (e) {
    console.error('❌ SLTP monitor error:', e.message);
  }
}

function startSLTPMonitoring(intervalMs = 3000) {
  if (monitorInterval) return;

  console.log('\n' + '─'.repeat(55));
  console.log('🎯 SL/TP MONITOR STARTED');
  console.log(`   Interval: every ${intervalMs/1000}s`);
  console.log('─'.repeat(55));

  monitorSLTP();
  monitorInterval = setInterval(monitorSLTP, intervalMs);
}

function stopSLTPMonitoring() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  console.log('🛑 SL/TP monitor stopped');
}

process.on('SIGINT',  () => { stopSLTPMonitoring(); process.exit(0); });
process.on('SIGTERM', () => { stopSLTPMonitoring(); process.exit(0); });

module.exports = { startSLTPMonitoring, stopSLTPMonitoring, monitorSLTP };