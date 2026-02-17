// jobs/pendingOrderMonitorJob.js
// ✅ Monitors all PENDING LIMIT / SL / SL-M orders
// ✅ Checks current market price every 2 seconds
// ✅ When price condition met → COMPLETED + Position created
// ✅ Firebase synced after every execution

const Order    = require('../models/Order');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const Position = require('../models/Position');
const { _executeOrder } = require('../routes/orders');
const { syncSingleUserToFirebase } = require('../services/userFirebaseService');

let monitorInterval = null;

// ─────────────────────────────────────────────────
// Core check: does current price satisfy this order?
// ─────────────────────────────────────────────────
function shouldExecute(order, currentPrice) {
  const lp = order.limitPrice;
  const MODE = order.orderMode;
  const TYPE = order.orderType;

  switch (MODE) {

    case 'LIMIT':
      // BUY LIMIT:  execute when market price falls TO or BELOW limitPrice
      // SELL LIMIT: execute when market price rises TO or ABOVE limitPrice
      if (TYPE === 'BUY')  return currentPrice <= lp;
      if (TYPE === 'SELL') return currentPrice >= lp;
      break;

    case 'SL':
      // BUY SL:  execute when price RISES TO or ABOVE trigger (limitPrice)
      // SELL SL: execute when price FALLS TO or BELOW trigger
      if (TYPE === 'BUY')  return currentPrice >= lp;
      if (TYPE === 'SELL') return currentPrice <= lp;
      break;

    case 'SL-M':
      // Same trigger logic as SL but market execution (execute at current price)
      if (TYPE === 'BUY')  return currentPrice >= lp;
      if (TYPE === 'SELL') return currentPrice <= lp;
      break;

    default:
      return false;
  }
  return false;
}

// ─────────────────────────────────────────────────
// Main monitor function
// ─────────────────────────────────────────────────
async function monitorPendingOrders() {
  try {
    // Get all PENDING non-MARKET orders
    const pendingOrders = await Order.find({
      status: 'PENDING',
      orderMode: { $in: ['LIMIT', 'SL', 'SL-M'] }
    }).lean();

    if (!pendingOrders.length) return;

    // Collect unique symbols to fetch prices once
    const symbols = [...new Set(pendingOrders.map(o => o.symbol))];
    const stocks  = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    for (const o of pendingOrders) {
      const currentPrice = priceMap[o.symbol];
      if (!currentPrice) continue;

      if (!shouldExecute(o, currentPrice)) continue;

      // Reload fresh (to avoid stale data)
      const order = await Order.findById(o._id);
      if (!order || order.status !== 'PENDING') continue; // already handled

      const user = await User.findById(order.userId);
      if (!user || !user.isActive) {
        order.status = 'REJECTED';
        order.rejectionReason = 'User inactive or not found';
        await order.save();
        continue;
      }

      // Execution price: LIMIT = limitPrice, SL = limitPrice, SL-M = current market
      const execPrice = order.orderMode === 'SL-M' ? currentPrice : order.limitPrice;

      console.log(`\n⚡ PENDING ORDER EXECUTING:`);
      console.log(`   ${order.symbol} | ${order.orderType} | ${order.orderMode}`);
      console.log(`   Trigger: ₹${order.limitPrice} | Current: ₹${currentPrice} | Exec: ₹${execPrice}`);

      try {
        await _executeOrder(order, user, execPrice);
        await syncSingleUserToFirebase(user._id.toString());
        console.log(`   ✅ Executed successfully → Position created`);
      } catch (execErr) {
        console.error(`   ❌ Execution failed:`, execErr.message);
        order.status = 'REJECTED';
        order.rejectionReason = execErr.message;
        await order.save();
        // Release blocked margin
        if (order.orderType === 'BUY' && order.marginUsed > 0) {
          user.releaseMargin(order.marginUsed);
          user.availableBalance += order.brokerage;
          await user.save();
        }
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
  console.log(`   Checking LIMIT/SL/SL-M orders every ${intervalMs/1000}s`);
  console.log('─'.repeat(55));

  monitorPendingOrders(); // immediate first run
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
