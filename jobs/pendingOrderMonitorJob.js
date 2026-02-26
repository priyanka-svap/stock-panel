// jobs/pendingOrderMonitorJob.js
// ✅ Monitors all PENDING LIMIT / SL / SL-M orders
// ✅ Checks current market price every 2 seconds (market hours only)
// ✅ When price condition met → COMPLETED + Position created/updated
// ✅ Firebase synced after every execution
//
// FIXED: Self-contained execution (no circular dependency on routes/orders)
// FIXED: User balance + margin properly updated on LIMIT execution

const Order    = require('../models/Order');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const Position = require('../models/Position');
const { scheduleUserFirebaseSync } = require('../services/userFirebaseService');

let monitorInterval = null;

// Prevent double-executing same order
const executingOrders = new Set();

// ─────────────────────────────────────────────────
// Market Hours Check
// ─────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const cur = ist.getHours() * 60 + ist.getMinutes();
  return cur >= (9 * 60 + 15) && cur <= (15 * 60 + 30);
}

// ─────────────────────────────────────────────────
// Core check: does current price satisfy this order?
// ─────────────────────────────────────────────────
function shouldExecute(order, currentPrice) {
  const lp   = parseFloat(order.limitPrice || 0);
  const MODE = order.orderMode;
  const TYPE = order.orderType;

  if (!lp) return false;

  switch (MODE) {
    case 'LIMIT':
      // BUY LIMIT:  execute when price falls TO or BELOW limitPrice
      // SELL LIMIT: execute when price rises TO or ABOVE limitPrice
      if (TYPE === 'BUY')  return currentPrice <= lp;
      if (TYPE === 'SELL') return currentPrice >= lp;
      break;

    case 'SL':
    case 'SL-M':
      // BUY SL/SL-M:  trigger when price RISES TO or ABOVE limitPrice (stop)
      // SELL SL/SL-M: trigger when price FALLS TO or BELOW limitPrice (stop)
      if (TYPE === 'BUY')  return currentPrice >= lp;
      if (TYPE === 'SELL') return currentPrice <= lp;
      break;

    default:
      return false;
  }
  return false;
}

// ─────────────────────────────────────────────────
// Execute a triggered pending order
// Self-contained: no dependency on routes/orders.js
// ─────────────────────────────────────────────────
async function executePendingOrder(order, user, execPrice) {
  execPrice = parseFloat(execPrice);

  // 1. Mark order as COMPLETED
  order.status         = 'COMPLETED';
  order.executedAt     = new Date();
  order.executedPrice  = execPrice;
  order.filledQuantity = order.quantity;
  order.averagePrice   = execPrice;
  await order.save();

  const TYPE = order.orderType; // BUY or SELL

  if (TYPE === 'BUY') {
    // ── Find or create LONG position ──
    let pos = await Position.findOne({
      userId:       user._id,
      symbol:       order.symbol,
      positionType: 'LONG',
      isActive:     true
    });

    if (pos) {
      // Add to existing position (average)
      const newQty     = pos.quantity + order.quantity;
      const newInvest  = pos.investmentValue + (order.quantity * execPrice);
      pos.entryPrice   = newInvest / newQty;         // weighted avg
      pos.quantity     = newQty;
      pos.currentPrice = execPrice;
      pos.investmentValue = newInvest;
      pos.currentValue = newQty * execPrice;
      pos.marginUsed  += order.marginUsed || 0;
      pos.entryBrokerage += order.brokerage || 0;
      pos.totalBrokerage  = pos.entryBrokerage + (pos.exitBrokerage || 0);
      if (order.stopLoss)   pos.stopLoss   = order.stopLoss;
      if (order.takeProfit) pos.takeProfit = order.takeProfit;
      await pos.save();
      order.positionId = pos._id;
      await order.save();

    } else {
      // New position
      pos = new Position({
        userId:          user._id,
        symbol:          order.symbol,
        companyName:     order.companyName,
        tradingSymbol:   order.tradingSymbol,
        instrumentType:  order.instrumentType || 'EQUITY',
        contractType:    order.contractType   || 'SPOT',
        expiryDate:      order.expiryDate,
        expiryMonth:     order.expiryMonth,
        strikePrice:     order.strikePrice,
        lotSize:         order.lotSize || 1,
        positionType:    'LONG',
        quantity:        order.quantity,
        entryPrice:      execPrice,
        currentPrice:    execPrice,
        marginUsed:      order.marginUsed || 0,
        marginMultiplier: user.marginMultiplier || 1,
        entryBrokerage:  order.brokerage || 0,
        totalBrokerage:  order.brokerage || 0,
        investmentValue: order.quantity * execPrice,
        currentValue:    order.quantity * execPrice,
        stopLoss:        order.stopLoss  || null,
        takeProfit:      order.takeProfit || null,
        isActive:        true,
        isOpen:          true,
      });
      await pos.save();
      order.positionId = pos._id;
      await order.save();
    }

    // ✅ Margin was blocked at order placement — no extra deduction needed
    // Just ensure usedMargin is correct (already blocked)

  } else {
    // ── SELL → close / reduce LONG position ──
    const pos = await Position.findOne({
      userId:       user._id,
      symbol:       order.symbol,
      positionType: 'LONG',
      isActive:     true
    });

    if (!pos) {
      // No position to close — reject
      order.status = 'REJECTED';
      order.rejectionReason = 'No active LONG position found to close';
      await order.save();
      return;
    }

    const exitBrok = order.brokerage || 0;

    if (pos.quantity <= order.quantity) {
      // Full close
      // ✅ pos.close() use karo — pre-save hook chalega, liquidationPrice/pnl update hoga
      const marginToRelease = pos.marginUsed || 0;
      pos.close(execPrice, exitBrok, 'MANUAL');
      await pos.save();

      // ✅ releaseMargin: usedMargin-- AND availableBalance++ (margin unblock)
      user.releaseMargin(marginToRelease);
      // ✅ pos.close() ke andar realizedPnL = gross - totalBrokerage (entryBrok+exitBrok)
      //    toh yahan sirf PnL adjust karo — exitBrok alag se NAHI hatao (already included)
      user.availableBalance += pos.realizedPnL; // profit add / loss deduct
      user.totalPnL          = (user.totalPnL || 0) + pos.realizedPnL;
      user.todayPnL          = (user.todayPnL || 0) + pos.realizedPnL;

    } else {
      // ── Partial close ──
      const closedQty     = order.quantity;
      const proportion    = closedQty / pos.quantity;
      const partialInvest = pos.investmentValue * proportion;
      const partialExit   = closedQty * execPrice;
      const partialPnL    = partialExit - partialInvest - exitBrok;
      const marginRelease = (pos.marginUsed || 0) * proportion;

      pos.quantity        -= closedQty;
      pos.investmentValue -= partialInvest;
      pos.currentValue     = pos.quantity * execPrice;
      pos.marginUsed      -= marginRelease;
      pos.realizedPnL     += partialPnL;
      pos.exitBrokerage   += exitBrok;
      pos.totalBrokerage   = (pos.entryBrokerage || 0) + pos.exitBrokerage;
      await pos.save();

      // ✅ proportion ke hisaab se release
      user.releaseMargin(marginRelease);
      user.availableBalance += partialPnL; // partial PnL adjust
      user.availableBalance -= exitBrok;   // exit brokerage deduct
      user.totalPnL          = (user.totalPnL || 0) + partialPnL;
      user.todayPnL          = (user.todayPnL || 0) + partialPnL;
    }

    user.totalBrokeragePaid = (user.totalBrokeragePaid || 0) + exitBrok;
    await user.save();
  }
}

// ─────────────────────────────────────────────────
// Main monitor function
// ─────────────────────────────────────────────────
async function monitorPendingOrders() {
  // ✅ Only run during market hours
  if (!isMarketOpen()) return;

  try {
    const pendingOrders = await Order.find({
      status:    'PENDING',
      orderMode: { $in: ['LIMIT', 'SL', 'SL-M'] }
    }).lean();

    if (!pendingOrders.length) return;

    const symbols  = [...new Set(pendingOrders.map(o => o.symbol))];
    const stocks   = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    for (const o of pendingOrders) {
      const currentPrice = priceMap[o.symbol];
      if (!currentPrice) continue;
      if (!shouldExecute(o, currentPrice)) continue;
      if (executingOrders.has(o._id.toString())) continue;

      executingOrders.add(o._id.toString());

      try {
        // Reload fresh (stale data protection)
        const order = await Order.findById(o._id);
        if (!order || order.status !== 'PENDING') {
          executingOrders.delete(o._id.toString());
          continue;
        }

        const user = await User.findById(order.userId);
        if (!user || !user.isActive) {
          order.status = 'REJECTED';
          order.rejectionReason = 'User inactive or not found';
          await order.save();
          executingOrders.delete(o._id.toString());
          continue;
        }

        // Execution price: LIMIT/SL = limitPrice, SL-M = current market
        const execPrice = order.orderMode === 'SL-M'
          ? currentPrice
          : parseFloat(order.limitPrice);

        console.log(`\n⚡ LIMIT ORDER EXECUTING: ${order.symbol} | ${order.orderType} | ${order.orderMode}`);
        console.log(`   Trigger: ₹${order.limitPrice} | Market: ₹${currentPrice} | Exec: ₹${execPrice}`);

        await executePendingOrder(order, user, execPrice);
        scheduleUserFirebaseSync(user._id.toString());
        console.log(`   ✅ Executed: ${order.symbol} @ ₹${execPrice}`);

      } catch (execErr) {
        console.error(`   ❌ Execution failed for ${o.symbol}:`, execErr.message);
        try {
          const failedOrder = await Order.findById(o._id);
          if (failedOrder && failedOrder.status === 'PENDING') {
            failedOrder.status = 'REJECTED';
            failedOrder.rejectionReason = execErr.message;
            await failedOrder.save();

            // Release blocked margin on failure
            if (o.orderType === 'BUY' && o.marginUsed > 0) {
              const user = await User.findById(o.userId);
              if (user) {
                // ✅ releaseMargin: wapas unblock karo
                user.releaseMargin(o.marginUsed || 0);
                user.availableBalance += (o.brokerage || 0); // brokerage refund
                await user.save();
              }
            }
          }
        } catch (cleanupErr) {
          console.error('   ❌ Cleanup error:', cleanupErr.message);
        }
      } finally {
        executingOrders.delete(o._id.toString());
      }
    }

  } catch (err) {
    console.error('❌ Pending order monitor error:', err.message);
  }
}

// ─────────────────────────────────────────────────
// Start / Stop
// ─────────────────────────────────────────────────
function startPendingOrderMonitor(intervalMs = 2000) {
  if (monitorInterval) {
    console.log('⚠️  Pending order monitor already running');
    return;
  }

  console.log('\n' + '─'.repeat(55));
  console.log('⚡ PENDING ORDER MONITOR STARTED');
  console.log(`   Checking LIMIT/SL/SL-M every ${intervalMs/1000}s (market hours only)`);
  console.log('─'.repeat(55));

  monitorPendingOrders();
  monitorInterval = setInterval(monitorPendingOrders, intervalMs);
}

function stopPendingOrderMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('🛑 Pending order monitor stopped');
  }
}

process.on('SIGINT',  () => { stopPendingOrderMonitor(); process.exit(0); });
process.on('SIGTERM', () => { stopPendingOrderMonitor(); process.exit(0); });

module.exports = { startPendingOrderMonitor, stopPendingOrderMonitor, monitorPendingOrders };
