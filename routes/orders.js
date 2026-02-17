// routes/orders.js
// ✅ MARKET order   → COMPLETED instantly → Position created
// ✅ LIMIT order    → PENDING → pendingOrderMonitor executes when price hits
// ✅ SL / SL-M      → PENDING → pendingOrderMonitor executes when trigger hits
// ✅ Margin blocked on order placement for all types
// ✅ Brokerage + GST + Stamp + TxnCharges calculated
// ✅ SL/TP attached to Position for realtime monitoring
// ✅ Firebase synced after every action

const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Stock = require('../models/Stock');
const Position = require('../models/Position');
const auth = require('../middleware/auth');
const { syncSingleUserToFirebase } = require('../services/userFirebaseService');

// ─────────────────────────────────────────
// GET /api/orders  – user's order list
// ─────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const query = { userId: req.user.userId };
    if (status) query.status = status.toUpperCase();

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 })
        .limit(+limit).skip((+page - 1) * +limit),
      Order.countDocuments(query)
    ]);

    res.json({
      success: true, data: orders,
      pagination: { total, page: +page, limit: +limit }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────
// POST /api/orders/place
// ─────────────────────────────────────────
router.post('/place', auth, async (req, res) => {
  try {
    const {
      symbol, companyName, tradingSymbol,
      instrumentType = 'EQUITY', contractType = 'SPOT',
      expiryDate, expiryMonth, strikePrice, lotSize,
      orderType, orderMode = 'MARKET',
      quantity, price, limitPrice,
      stopLoss, takeProfit, notes
    } = req.body;

    /* ── 1. Basic validation ── */
    if (!symbol || !orderType || !quantity || !price)
      return res.status(400).json({ success: false, message: 'symbol, orderType, quantity, price are required' });

    const MODE = (orderMode || 'MARKET').toUpperCase();
    const TYPE = orderType.toUpperCase();

    // LIMIT / SL / SL-M needs a trigger/limit price
    if (['LIMIT', 'SL', 'SL-M'].includes(MODE) && !limitPrice)
      return res.status(400).json({
        success: false,
        message: `limitPrice is required for ${MODE} order`
      });

    /* ── 2. SL / TP price validation ── */
    if (stopLoss != null) {
      if (TYPE === 'BUY' && +stopLoss >= +price)
        return res.status(400).json({ success: false, message: 'Stop-Loss (BUY) must be BELOW entry price' });
      if (TYPE === 'SELL' && +stopLoss <= +price)
        return res.status(400).json({ success: false, message: 'Stop-Loss (SELL) must be ABOVE entry price' });
    }
    if (takeProfit != null) {
      if (TYPE === 'BUY' && +takeProfit <= +price)
        return res.status(400).json({ success: false, message: 'Take-Profit (BUY) must be ABOVE entry price' });
      if (TYPE === 'SELL' && +takeProfit >= +price)
        return res.status(400).json({ success: false, message: 'Take-Profit (SELL) must be BELOW entry price' });
    }

    /* ── 3. Load user & stock ── */
    const [user, stockData] = await Promise.all([
      User.findById(req.user.userId),
      Stock.findOne({ symbol: symbol.toUpperCase() })
    ]);

    if (!user || !user.isActive)
      return res.status(404).json({ success: false, message: 'User not found or inactive' });
    if (!stockData)
      return res.status(404).json({ success: false, message: `Stock '${symbol}' not found` });
    if (stockData.expiryDate && new Date(stockData.expiryDate) < new Date())
      return res.status(400).json({ success: false, message: 'Contract has expired' });

    /* ── 4. Build order document ── */
    const order = new Order({
      userId: user._id,
      symbol: symbol.toUpperCase(),
      companyName: companyName || stockData.companyName,
      tradingSymbol: (tradingSymbol || symbol).toUpperCase(),
      instrumentType: instrumentType.toUpperCase(),
      contractType: contractType.toUpperCase(),
      expiryDate: expiryDate || stockData.expiryDate,
      expiryMonth: expiryMonth ? expiryMonth.toUpperCase() : stockData.expiryMonth,
      strikePrice: strikePrice || stockData.strikePrice,
      lotSize: lotSize || stockData.lotSize || 1,
      orderType: TYPE,
      orderMode: MODE,
      quantity: parseInt(quantity),
      price: parseFloat(price),
      limitPrice: limitPrice ? parseFloat(limitPrice) : undefined,
      stopLoss: stopLoss != null ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit != null ? parseFloat(takeProfit) : undefined,
      totalAmount: parseInt(quantity) * parseFloat(price),
      status: 'PENDING',
      notes
    });

    /* ── 5. Calculate margin ── */
    order.calculateMargin(user);   // sets marginRequired, marginUsed, marginPercent

    /* ── 6. Calculate charges ── */
    order.calculateCharges(user);  // sets brokerage, gst, txnCharges, stampDuty, netAmount

    /* ── 7. Calculate SL / TP amounts ── */
    if (order.stopLoss || order.takeProfit) {
      try { order.calculateSLTP(); }
      catch (e) { return res.status(400).json({ success: false, message: e.message }); }
    }

    /* ── 8. Margin / Position checks ── */
    if (TYPE === 'BUY') {
      if (!user.hasEnoughMargin(order.netAmount))
        return res.status(400).json({
          success: false,
          message: 'Insufficient margin balance',
          required: order.netAmount,
          available: user.availableMargin
        });

      // Block margin immediately (even for PENDING orders)
      user.useMargin(order.marginUsed);
      user.addBrokerage(order.brokerage);   // deducts from balance
      await user.save();

    } else {
      // SELL – must have an open LONG position
      const existingPos = await Position.findOne({
        userId: user._id,
        symbol: symbol.toUpperCase(),
        positionType: 'LONG',
        isActive: true
      });
      if (!existingPos || existingPos.quantity < parseInt(quantity))
        return res.status(400).json({
          success: false,
          message: 'Insufficient open position to sell'
        });
    }

    await order.save();

    /* ── 9. MARKET → execute immediately ── */
    if (MODE === 'MARKET') {
      await _executeOrder(order, user, parseFloat(price));
      // user already saved inside _executeOrder
    }
    // LIMIT / SL / SL-M  → stays PENDING
    // pendingOrderMonitorJob will watch & execute

    // ── 10. Firebase sync ──
    syncSingleUserToFirebase(user._id.toString()).catch(console.error);

    return res.status(201).json({
      success: true,
      message: MODE === 'MARKET'
        ? '✅ Order executed & position created'
        : `⏳ Order placed as PENDING (${MODE}) – will execute when price hits ₹${limitPrice}`,
      order: {
        orderId: order._id,
        symbol: order.symbol,
        orderType: order.orderType,
        orderMode: order.orderMode,
        quantity: order.quantity,
        price: order.price,
        limitPrice: order.limitPrice,
        status: order.status,
        // SL/TP
        stopLoss: order.stopLoss,
        stopLossAmount: order.stopLossAmount,
        stopLossPercent: order.stopLossPercent,
        takeProfit: order.takeProfit,
        takeProfitAmount: order.takeProfitAmount,
        takeProfitPercent: order.takeProfitPercent,
        riskRewardRatio: order.riskRewardRatio,
        // Charges
        totalAmount: order.totalAmount,
        marginRequired: order.marginRequired,
        brokerage: order.brokerage,
        gst: order.gst,
        stampDuty: order.stampDuty,
        transactionCharges: order.transactionCharges,
        taxesAndCharges: order.taxesAndCharges,
        netAmount: order.netAmount
      },
      userBalance: {
        availableBalance: user.availableBalance,
        usedMargin: user.usedMargin,
        availableMargin: user.availableMargin,
        totalMargin: user.totalMargin
      }
    });

  } catch (e) {
    console.error('❌ Order place error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────
// PATCH /api/orders/:id/cancel
// ─────────────────────────────────────────
router.patch('/:orderId/cancel', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, userId: req.user.userId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'PENDING')
      return res.status(400).json({ success: false, message: 'Only PENDING orders can be cancelled' });

    order.status = 'CANCELLED';
    order.cancelledAt = new Date();
    order.cancelReason = req.body.reason || 'User cancelled';
    await order.save();

    // Release blocked margin for BUY orders
    if (order.orderType === 'BUY' && order.marginUsed > 0) {
      const user = await User.findById(req.user.userId);
      user.releaseMargin(order.marginUsed);
      user.availableBalance += order.brokerage; // refund brokerage
      await user.save();
      syncSingleUserToFirebase(user._id.toString()).catch(console.error);
    }

    res.json({ success: true, message: 'Order cancelled', data: order });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────
// POST /api/orders/close-position/:positionId
// ─────────────────────────────────────────
router.post('/close-position/:positionId', auth, async (req, res) => {
  try {
   
    const position = await Position.findOne({
      _id: req.params.positionId,
      userId: req.user.userId,
      isActive: true
    });
    if (!position)
      return res.status(404).json({ success: false, message: 'Active position not found' });

    const user = await User.findById(req.user.userId);
    const stock = await Stock.findOne({ symbol: position.symbol });
    const exitPrice = req.body.exitPrice
      ? parseFloat(req.body.exitPrice)
      : (stock ? parseFloat(stock.currentPrice) : position.currentPrice);

    const exitBrok = user.calculateBrokerage(position.quantity * exitPrice, position.quantity);
    position.close(exitPrice, exitBrok);
    await position.save();

    user.releaseMargin(position.marginUsed);
    user.totalPnL += position.realizedPnL;
    user.todayPnL += position.realizedPnL;
    user.totalBrokeragePaid += exitBrok;
    await user.save();

    syncSingleUserToFirebase(user._id.toString()).catch(console.error);

    res.json({
      success: true,
      message: 'Position closed successfully',
      realizedPnL: position.realizedPnL,
      exitPrice,
      userBalance: {
        availableBalance: user.availableBalance,
        usedMargin: user.usedMargin,
        availableMargin: user.availableMargin,
        totalPnL: user.totalPnL
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────
// Internal: _executeOrder(order, user, execPrice)
// Called by: MARKET immediately, pendingMonitor for LIMIT/SL
// ─────────────────────────────────────────
async function _executeOrder(order, user, execPrice) {
  order.status = 'COMPLETED';
  order.executedAt = new Date();
  order.executedPrice = execPrice;
  order.filledQuantity = order.quantity;
  order.averagePrice = execPrice;
  await order.save();

  if (order.orderType === 'BUY') {
    // Find or create LONG position
    let pos = await Position.findOne({
      userId: user._id,
      symbol: order.symbol,
      positionType: 'LONG',
      isActive: true
    });

    if (pos) {
      // Average-down / Average-up
      const newQty = pos.quantity + order.quantity;
      const newInvest = (pos.investmentValue + order.quantity * execPrice);
      pos.entryPrice = newInvest / newQty;
      pos.quantity = newQty;
      pos.currentPrice = execPrice;
      pos.investmentValue = newInvest;
      pos.currentValue = newQty * execPrice;
      pos.marginUsed += order.marginUsed;
      pos.entryBrokerage += order.brokerage;
      pos.totalBrokerage = pos.entryBrokerage + pos.exitBrokerage;
      // Update SL/TP if provided in new order
      if (order.stopLoss) pos.stopLoss = order.stopLoss;
      if (order.takeProfit) pos.takeProfit = order.takeProfit;
      await pos.save();
      order.positionId = pos._id;
      await order.save();
    } else {
      // New position
      pos = new Position({
        userId: user._id,
        symbol: order.symbol,
        companyName: order.companyName,
        tradingSymbol: order.tradingSymbol,
        instrumentType: order.instrumentType,
        contractType: order.contractType,
        expiryDate: order.expiryDate,
        expiryMonth: order.expiryMonth,
        strikePrice: order.strikePrice,
        lotSize: order.lotSize,
        positionType: 'LONG',
        quantity: order.quantity,
        entryPrice: execPrice,
        currentPrice: execPrice,
        marginUsed: order.marginUsed,
        marginMultiplier: user.marginMultiplier,
        entryBrokerage: order.brokerage,
        totalBrokerage: order.brokerage,
        investmentValue: order.quantity * execPrice,
        currentValue: order.quantity * execPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        isActive: true
      });
      await pos.save();
      order.positionId = pos._id;
      await order.save();
    }

  } else {
    // SELL → close / reduce LONG position
    const pos = await Position.findOne({
      userId: user._id,
      symbol: order.symbol,
      positionType: 'LONG',
      isActive: true
    });
    if (!pos) return;

    const exitBrok = order.brokerage;

    if (pos.quantity <= order.quantity) {
      // Full close
      pos.close(execPrice, exitBrok);
      await pos.save();
      user.releaseMargin(pos.marginUsed);
      user.totalPnL += pos.realizedPnL;
      user.todayPnL += pos.realizedPnL;
    } else {
      // Partial close
      const closedQty = order.quantity;
      const proportion = closedQty / pos.quantity;
      const partialInvest = pos.investmentValue * proportion;
      const partialExit = closedQty * execPrice;
      const partialPnL = partialExit - partialInvest - exitBrok;
      const marginRelease = pos.marginUsed * proportion;

      pos.quantity -= closedQty;
      pos.investmentValue -= partialInvest;
      pos.currentValue = pos.quantity * execPrice;
      pos.marginUsed -= marginRelease;
      pos.realizedPnL += partialPnL;
      pos.exitBrokerage += exitBrok;
      pos.totalBrokerage = pos.entryBrokerage + pos.exitBrokerage;
      await pos.save();

      user.releaseMargin(marginRelease);
      user.totalPnL += partialPnL;
      user.todayPnL += partialPnL;
    }
    user.totalBrokeragePaid += exitBrok;
    await user.save();
  }
}

module.exports = { router, _executeOrder };