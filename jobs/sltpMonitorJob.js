// jobs/sltpMonitorJob.js - AUTOMATIC STOP-LOSS & TAKE-PROFIT MONITORING

const Order = require('../models/Order');
const Position = require('../models/Position');
const Stock = require('../models/Stock');
const User = require('../models/User');

let monitorInterval = null;

// ===================================
// MONITOR ALL ACTIVE POSITIONS
// ===================================
async function monitorSLTP() {
  try {
    console.log('🎯 Monitoring SL/TP for all positions...');
    
    // Get all active positions with SL or TP
    const positions = await Position.find({
      isOpen: true,
      $or: [
        { stopLoss: { $exists: true, $ne: null } },
        { takeProfit: { $exists: true, $ne: null } }
      ]
    }).populate('orderId userId');
    
    if (positions.length === 0) {
      console.log('   No positions with SL/TP found');
      return;
    }
    
    console.log(`   Found ${positions.length} positions with SL/TP`);
    
    let triggered = 0;
    
    for (const position of positions) {
      try {
        // Get current price
        const stock = await Stock.findOne({ 
          symbol: position.symbol,
          instrumentType: position.instrumentType
        });
        
        if (!stock) {
          console.log(`   ⚠️  Stock not found: ${position.symbol}`);
          continue;
        }
        
        const currentPrice = parseFloat(stock.currentPrice) || 0;
        
        if (currentPrice === 0) {
          console.log(`   ⚠️  Invalid price for ${position.symbol}`);
          continue;
        }
        
        // Check if SL or TP triggered
        const check = checkTrigger(position, currentPrice);
        
        if (check.triggered) {
          triggered++;
          
          console.log(`\n   🔔 TRIGGER ALERT:`);
          console.log(`      Symbol: ${position.symbol}`);
          console.log(`      Type: ${check.stopLossHit ? 'STOP-LOSS' : 'TAKE-PROFIT'}`);
          console.log(`      Entry: ₹${position.avgPrice}`);
          console.log(`      Current: ₹${currentPrice}`);
          console.log(`      Exit: ₹${check.exitPrice}`);
          console.log(`      Action: ${check.action}`);
          
          // Execute exit order
          await executeExitOrder(position, check, currentPrice);
        }
        
      } catch (error) {
        console.error(`   ❌ Error checking ${position.symbol}:`, error.message);
      }
    }
    
    if (triggered > 0) {
      console.log(`\n   ✅ Triggered ${triggered} positions`);
    }
    
  } catch (error) {
    console.error('❌ Error in SL/TP monitor:', error.message);
  }
}

// ===================================
// CHECK IF SL/TP TRIGGERED
// ===================================
function checkTrigger(position, currentPrice) {
  const triggers = {
    triggered: false,
    stopLossHit: false,
    takeProfitHit: false,
    action: null,
    exitPrice: null,
    pnl: 0
  };
  
  if (position.type === 'BUY') {
    // Check Stop-Loss (price fell below SL)
    if (position.stopLoss && currentPrice <= position.stopLoss) {
      triggers.triggered = true;
      triggers.stopLossHit = true;
      triggers.action = 'SELL';
      triggers.exitPrice = position.stopLoss;
      triggers.pnl = (position.stopLoss - position.avgPrice) * position.quantity;
    }
    
    // Check Take-Profit (price rose above TP)
    if (position.takeProfit && currentPrice >= position.takeProfit) {
      triggers.triggered = true;
      triggers.takeProfitHit = true;
      triggers.action = 'SELL';
      triggers.exitPrice = position.takeProfit;
      triggers.pnl = (position.takeProfit - position.avgPrice) * position.quantity;
    }
    
  } else {
    // SELL position
    // Check Stop-Loss (price rose above SL)
    if (position.stopLoss && currentPrice >= position.stopLoss) {
      triggers.triggered = true;
      triggers.stopLossHit = true;
      triggers.action = 'BUY';
      triggers.exitPrice = position.stopLoss;
      triggers.pnl = (position.avgPrice - position.stopLoss) * position.quantity;
    }
    
    // Check Take-Profit (price fell below TP)
    if (position.takeProfit && currentPrice <= position.takeProfit) {
      triggers.triggered = true;
      triggers.takeProfitHit = true;
      triggers.action = 'BUY';
      triggers.exitPrice = position.takeProfit;
      triggers.pnl = (position.avgPrice - position.takeProfit) * position.quantity;
    }
  }
  
  return triggers;
}

// ===================================
// EXECUTE EXIT ORDER
// ===================================
async function executeExitOrder(position, trigger, currentPrice) {
  try {
    const user = await User.findById(position.userId);
    
    if (!user) {
      console.error('   ❌ User not found');
      return;
    }
    
    // Create exit order
    const exitOrder = new Order({
      userId: position.userId,
      symbol: position.symbol,
      companyName: position.companyName,
      tradingSymbol: position.tradingSymbol,
      instrumentType: position.instrumentType,
      contractType: position.contractType,
      expiryDate: position.expiryDate,
      expiryMonth: position.expiryMonth,
      strikePrice: position.strikePrice,
      lotSize: position.lotSize,
      orderType: trigger.action, // SELL or BUY
      orderMode: 'MARKET',
      quantity: position.quantity,
      price: trigger.exitPrice,
      totalAmount: position.quantity * trigger.exitPrice,
      status: 'COMPLETED',
      executedAt: new Date(),
      executedPrice: trigger.exitPrice,
      notes: trigger.stopLossHit ? 'Auto-executed: Stop-Loss triggered' : 'Auto-executed: Take-Profit triggered'
    });
    
    // Calculate charges
    await exitOrder.calculateCharges(user);
    await exitOrder.save();
    
    // Close position
    await position.closePosition(trigger.exitPrice, exitOrder.brokerage);
    
    // Update order references
    if (position.orderId) {
      const originalOrder = await Order.findById(position.orderId);
      if (originalOrder) {
        if (trigger.stopLossHit) {
          originalOrder.stopLossTriggered = true;
        }
        if (trigger.takeProfitHit) {
          originalOrder.takeProfitTriggered = true;
        }
        await originalOrder.save();
      }
    }
    
    // Release margin
    await user.releaseMargin(position.marginUsed);
    
    // Update user P&L
    user.todayPnL += position.netPnL;
    user.totalPnL += position.netPnL;
    await user.save();
    
    console.log(`   ✅ Exit order executed:`);
    console.log(`      Order ID: ${exitOrder._id}`);
    console.log(`      Exit Price: ₹${trigger.exitPrice}`);
    console.log(`      Gross P&L: ₹${trigger.pnl.toFixed(2)}`);
    console.log(`      Charges: ₹${exitOrder.brokerage + exitOrder.taxesAndCharges}`);
    console.log(`      Net P&L: ₹${position.netPnL.toFixed(2)}`);
    
  } catch (error) {
    console.error('   ❌ Error executing exit order:', error.message);
  }
}

// ===================================
// START MONITORING
// ===================================
function startSLTPMonitoring(intervalMs = 5000) {
  if (monitorInterval) {
    console.log('⚠️  SL/TP monitoring already running');
    return;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('🎯 STOP-LOSS & TAKE-PROFIT MONITOR STARTED');
  console.log('='.repeat(60));
  console.log(`⏱️  Check Interval: Every ${intervalMs / 1000} seconds`);
  console.log('='.repeat(60) + '\n');
  
  // Initial check
  monitorSLTP();
  
  // Set interval
  monitorInterval = setInterval(monitorSLTP, intervalMs);
  
  console.log('✅ SL/TP monitoring active\n');
}

// ===================================
// STOP MONITORING
// ===================================
function stopSLTPMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('\n🛑 SL/TP monitoring stopped\n');
  }
}

// ===================================
// GRACEFUL SHUTDOWN
// ===================================
process.on('SIGINT', () => {
  console.log('\n⚠️  Received SIGINT signal...');
  stopSLTPMonitoring();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Received SIGTERM signal...');
  stopSLTPMonitoring();
  process.exit(0);
});

// ===================================
// EXPORTS
// ===================================
module.exports = {
  startSLTPMonitoring,
  stopSLTPMonitoring,
  monitorSLTP,
  checkTrigger,
  executeExitOrder
};
