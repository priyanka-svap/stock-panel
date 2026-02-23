// routes/orders.js
const express  = require('express');
const router   = express.Router();
const Order    = require('../models/Order');
const User     = require('../models/User');
const Stock    = require('../models/Stock');
const Position = require('../models/Position');
const auth     = require('../middleware/auth');
const { syncSingleUserToFirebase } = require('../services/userFirebaseService');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const query = { userId: req.user.userId };
    if (status) query.status = status.toUpperCase();

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).limit(+limit).skip((+page - 1) * +limit),
      Order.countDocuments(query)
    ]);
    res.json({ success: true, data: orders, pagination: { total, page: +page, limit: +limit } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/place
// ─────────────────────────────────────────────────────────────────────────────
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

    if (!symbol || !orderType || !quantity || !price)
      return res.status(400).json({ success: false, message: 'symbol, orderType, quantity, price required' });

    const MODE = (orderMode || 'MARKET').toUpperCase();
    const TYPE = orderType.toUpperCase();

    if (['LIMIT', 'SL', 'SL-M'].includes(MODE) && !limitPrice)
      return res.status(400).json({ success: false, message: `limitPrice required for ${MODE} order` });

    // SL/TP validation
    if (stopLoss != null) {
      if (TYPE === 'BUY'  && +stopLoss >= +price) return res.status(400).json({ success: false, message: 'SL (BUY) must be BELOW entry price' });
      if (TYPE === 'SELL' && +stopLoss <= +price) return res.status(400).json({ success: false, message: 'SL (SELL) must be ABOVE entry price' });
    }
    if (takeProfit != null) {
      if (TYPE === 'BUY'  && +takeProfit <= +price) return res.status(400).json({ success: false, message: 'TP (BUY) must be ABOVE entry price' });
      if (TYPE === 'SELL' && +takeProfit >= +price) return res.status(400).json({ success: false, message: 'TP (SELL) must be BELOW entry price' });
    }

    const [user, stockData] = await Promise.all([
      User.findById(req.user.userId),
      Stock.findOne({ symbol: symbol.toUpperCase() })
    ]);

    if (!user || !user.isActive) return res.status(404).json({ success: false, message: 'User not found or inactive' });
    if (!stockData)              return res.status(404).json({ success: false, message: `Stock '${symbol}' not found` });
    if (stockData.expiryDate && new Date(stockData.expiryDate) < new Date())
      return res.status(400).json({ success: false, message: 'Contract expired' });

    const order = new Order({
      userId: user._id, symbol: symbol.toUpperCase(),
      companyName: companyName || stockData.companyName,
      tradingSymbol: (tradingSymbol || symbol).toUpperCase(),
      instrumentType: instrumentType.toUpperCase(), contractType: contractType.toUpperCase(),
      expiryDate: expiryDate || stockData.expiryDate,
      expiryMonth: expiryMonth ? expiryMonth.toUpperCase() : stockData.expiryMonth,
      strikePrice: strikePrice || stockData.strikePrice,
      lotSize: lotSize || stockData.lotSize || 1,
      orderType: TYPE, orderMode: MODE,
      quantity: parseInt(quantity), price: parseFloat(price),
      limitPrice: limitPrice ? parseFloat(limitPrice) : undefined,
      stopLoss:   stopLoss   != null ? parseFloat(stopLoss)   : undefined,
      takeProfit: takeProfit != null ? parseFloat(takeProfit) : undefined,
      totalAmount: parseInt(quantity) * parseFloat(price),
      status: 'PENDING', notes
    });

    order.calculateMargin(user);
    order.calculateCharges(user);
    if (order.stopLoss || order.takeProfit) {
      try { order.calculateSLTP(); }
      catch (e) { return res.status(400).json({ success: false, message: e.message }); }
    }

    if (TYPE === 'BUY') {
      console.log(order.netAmount,order.marginUsed,"vgvfgfgfg");
      if (!user.hasEnoughMargin(order.netAmount))
        return res.status(200).json({
          success: false, message: 'Insufficient margin',data:{
          required: order.netAmount, available: user.availableMargin}
        });

      // ✅ useMargin: usedMargin++ AND availableBalance-- (both in User method)
      user.useMargin(order.marginUsed);
      // ✅ addBrokerage: totalBrokeragePaid++ AND availableBalance-- (both in User method)
      user.addBrokerage(order.brokerage);
      await user.save();

    } else {
      const existingPos = await Position.findOne({
        userId: user._id, symbol: symbol.toUpperCase(), positionType: 'LONG', isActive: true
      });
      if (!existingPos || existingPos.quantity < parseInt(quantity))
        return res.status(400).json({ success: false, message: 'Insufficient open position to sell' });
    }

    await order.save();

    if (MODE === 'MARKET') {
      await _executeOrder(order, user, parseFloat(price));
    }

    syncSingleUserToFirebase(user._id.toString()).catch(console.error);

    return res.status(201).json({
      success: true,
      message: MODE === 'MARKET'
        ? '✅ Order executed & position created'
        : `⏳ Order PENDING (${MODE}) – executes when price hits ₹${limitPrice}`,
      order: {
        orderId: order._id, symbol: order.symbol,
        orderType: order.orderType, orderMode: order.orderMode,
        quantity: order.quantity, price: order.price, limitPrice: order.limitPrice,
        status: order.status,
        stopLoss: order.stopLoss, stopLossAmount: order.stopLossAmount,
        stopLossPercent: order.stopLossPercent, takeProfit: order.takeProfit,
        takeProfitAmount: order.takeProfitAmount, takeProfitPercent: order.takeProfitPercent,
        riskRewardRatio: order.riskRewardRatio,
        totalAmount: order.totalAmount, marginRequired: order.marginRequired,
        brokerage: order.brokerage, gst: order.gst, stampDuty: order.stampDuty,
        transactionCharges: order.transactionCharges, taxesAndCharges: order.taxesAndCharges,
        netAmount: order.netAmount
      },
      userBalance: {
        availableBalance: user.availableBalance,
        usedMargin:       user.usedMargin,
        availableMargin:  user.availableMargin,
        totalMargin:      user.totalMargin,
        remainingMargin:  user.remainingMargin
      }
    });

  } catch (e) {
    console.error('❌ Order place error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/orders/:orderId/edit  (only PENDING orders)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:orderId/edit', auth, async (req, res) => {
  try {
    const { quantity, price, limitPrice, stopLoss, takeProfit, notes } = req.body;

    const order = await Order.findOne({ _id: req.params.orderId, userId: req.user.userId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'PENDING')
      return res.status(400).json({ success: false, message: `Cannot edit ${order.status} order` });

    const user       = await User.findById(req.user.userId);
    const oldMargin  = order.marginUsed;
    const oldBrok    = order.brokerage;

    if (quantity) { if (+quantity <= 0) return res.status(400).json({ success: false, message: 'Quantity must be > 0' }); order.quantity = +quantity; }
    if (price)    { if (+price    <= 0) return res.status(400).json({ success: false, message: 'Price must be > 0'    }); order.price    = +price;    }
    if (limitPrice !== undefined) order.limitPrice = limitPrice ? +limitPrice : undefined;
    if (notes      !== undefined) order.notes      = notes;

    const newPrice = price || order.price;
    if (stopLoss !== undefined) {
      if (stopLoss && order.orderType === 'BUY'  && +stopLoss >= +newPrice) return res.status(400).json({ success: false, message: 'SL (BUY) below entry' });
      if (stopLoss && order.orderType === 'SELL' && +stopLoss <= +newPrice) return res.status(400).json({ success: false, message: 'SL (SELL) above entry' });
      order.stopLoss = stopLoss ? +stopLoss : undefined;
    }
    if (takeProfit !== undefined) {
      if (takeProfit && order.orderType === 'BUY'  && +takeProfit <= +newPrice) return res.status(400).json({ success: false, message: 'TP (BUY) above entry' });
      if (takeProfit && order.orderType === 'SELL' && +takeProfit >= +newPrice) return res.status(400).json({ success: false, message: 'TP (SELL) below entry' });
      order.takeProfit = takeProfit ? +takeProfit : undefined;
    }

    order.totalAmount = order.quantity * order.price;
    order.calculateMargin(user);
    order.calculateCharges(user);
    if (order.stopLoss || order.takeProfit) {
      try { order.calculateSLTP(); } catch (e) { return res.status(400).json({ success: false, message: e.message }); }
    }

    if (order.orderType === 'BUY') {
      const marginDiff = order.marginUsed - oldMargin;
      const brokDiff   = order.brokerage  - oldBrok;

      if (marginDiff > 0) {
        if (!user.hasEnoughMargin(order.netAmount))
          return res.status(400).json({ success: false, message: `Insufficient margin. Need ₹${order.netAmount}, have ₹${user.availableMargin}` });
        // useMargin handles both usedMargin++ and availableBalance--
        user.useMargin(marginDiff);
        // brokerage diff: only balance deduction (totalBrokeragePaid not tracked for diff)
        user.availableBalance -= brokDiff;
      } else if (marginDiff < 0) {
        // releaseMargin handles both usedMargin-- and availableBalance++
        user.releaseMargin(Math.abs(marginDiff));
        user.availableBalance -= brokDiff; // negative = refund
      }
      await user.save();
      syncSingleUserToFirebase(user._id.toString()).catch(console.error);
    }

    order.updatedAt = new Date();
    await order.save();
    res.json({ success: true, message: 'Order updated', data: order });

  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/orders/:orderId/cancel
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:orderId/cancel', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, userId: req.user.userId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'PENDING')
      return res.status(400).json({ success: false, message: 'Only PENDING orders can be cancelled' });

    order.status      = 'CANCELLED';
    order.cancelledAt = new Date();
    order.cancelReason = req.body.reason || 'User cancelled';
    await order.save();

    if (order.orderType === 'BUY' && order.marginUsed > 0) {
      const user = await User.findById(req.user.userId);
      // ✅ releaseMargin: usedMargin-- AND availableBalance++ (margin unblock)
      user.releaseMargin(order.marginUsed);
      // ✅ Refund brokerage separately (addBrokerage had deducted it)
      user.availableBalance   += order.brokerage;
      user.totalBrokeragePaid  = Math.max(0, (user.totalBrokeragePaid || 0) - order.brokerage);
      await user.save();
      syncSingleUserToFirebase(user._id.toString()).catch(console.error);
    }

    res.json({ success: true, message: 'Order cancelled', data: order });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/close-position/:positionId
// ─────────────────────────────────────────────────────────────────────────────
router.post('/close-position/:positionId', auth, async (req, res) => {
  try {
    const position = await Position.findOne({
      _id: req.params.positionId, userId: req.user.userId, isActive: true
    });
    if (!position) return res.status(404).json({ success: false, message: 'Active position not found' });

    const user  = await User.findById(req.user.userId);
    const stock = await Stock.findOne({ symbol: position.symbol });
    const exitPrice = req.body.exitPrice
      ? parseFloat(req.body.exitPrice)
      : (stock ? parseFloat(stock.currentPrice) : position.currentPrice);

    const exitBrok = user.calculateBrokerage(position.quantity * exitPrice, position.quantity);

    // Close position document (sets realizedPnL internally)
    position.close(exitPrice, exitBrok);
    await position.save();

    // ✅ releaseMargin: usedMargin-- AND availableBalance++ (margin unblock)
    user.releaseMargin(position.marginUsed);

    // ✅ PnL reflect in availableBalance
    user.availableBalance += position.realizedPnL;  // profit add / loss deduct
    user.availableBalance -= exitBrok;              // exit brokerage deduct

    user.totalPnL          += position.realizedPnL;
    user.todayPnL          += position.realizedPnL;
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
        usedMargin:       user.usedMargin,
        availableMargin:  user.availableMargin,
        totalMargin:      user.totalMargin,
        remainingMargin:  user.remainingMargin,
        totalPnL:         user.totalPnL
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// _executeOrder (internal — called by MARKET order + pendingOrderMonitor)
// ─────────────────────────────────────────────────────────────────────────────
async function _executeOrder(order, user, execPrice) {
  order.status        = 'COMPLETED';
  order.executedAt    = new Date();
  order.executedPrice = execPrice;
  order.filledQuantity = order.quantity;
  order.averagePrice  = execPrice;
  await order.save();

  if (order.orderType === 'BUY') {
    let pos = await Position.findOne({
      userId: user._id, symbol: order.symbol, positionType: 'LONG', isActive: true
    });

    if (pos) {
      // Average into existing position
      const newQty    = pos.quantity + order.quantity;
      const newInvest = pos.investmentValue + (order.quantity * execPrice);
      pos.entryPrice     = newInvest / newQty;
      pos.quantity       = newQty;
      pos.currentPrice   = execPrice;
      pos.investmentValue = newInvest;
      pos.currentValue   = newQty * execPrice;
      pos.marginUsed    += order.marginUsed;
      pos.entryBrokerage += order.brokerage;
      pos.totalBrokerage  = pos.entryBrokerage + (pos.exitBrokerage || 0);
      pos.isActive        = true;
      if (order.stopLoss)   pos.stopLoss   = order.stopLoss;
      if (order.takeProfit) pos.takeProfit = order.takeProfit;
      await pos.save();
      order.positionId = pos._id;
      await order.save();
    } else {
      // New position
      pos = new Position({
        userId: user._id, symbol: order.symbol,
        companyName: order.companyName, tradingSymbol: order.tradingSymbol,
        instrumentType: order.instrumentType, contractType: order.contractType,
        expiryDate: order.expiryDate, expiryMonth: order.expiryMonth,
        strikePrice: order.strikePrice, lotSize: order.lotSize,
        positionType: 'LONG',
        quantity:         order.quantity,
        entryPrice:       execPrice,
        currentPrice:     execPrice,
        marginUsed:       order.marginUsed,
        marginMultiplier: user.marginMultiplier,
        entryBrokerage:   order.brokerage,
        totalBrokerage:   order.brokerage,
        investmentValue:  order.quantity * execPrice,
        currentValue:     order.quantity * execPrice,
        stopLoss:         order.stopLoss,
        takeProfit:       order.takeProfit,
        isActive: true, isOpen: true,
      });
      await pos.save();
      order.positionId = pos._id;
      await order.save();
    }

  } else {
    // SELL → close / reduce LONG position
    const pos = await Position.findOne({
      userId: user._id, symbol: order.symbol, positionType: 'LONG', isActive: true
    });
    if (!pos) return;

    const exitBrok = order.brokerage;

    if (pos.quantity <= order.quantity) {
      // Full close
      pos.close(execPrice, exitBrok);
      await pos.save();

      // ✅ releaseMargin: usedMargin-- AND availableBalance++ (margin unblock)
      user.releaseMargin(pos.marginUsed);
      // ✅ PnL reflect in balance
      user.availableBalance += pos.realizedPnL;  // profit add / loss deduct
      user.availableBalance -= exitBrok;         // exit brokerage deduct
      user.totalPnL         += pos.realizedPnL;
      user.todayPnL         += pos.realizedPnL;

    } else {
      // Partial close
      const closedQty     = order.quantity;
      const proportion    = closedQty / pos.quantity;
      const partialInvest = pos.investmentValue * proportion;
      const partialExit   = closedQty * execPrice;
      const partialPnL    = partialExit - partialInvest - exitBrok;
      const marginRelease = pos.marginUsed * proportion;

      pos.quantity        -= closedQty;
      pos.investmentValue -= partialInvest;
      pos.currentValue     = pos.quantity * execPrice;
      pos.marginUsed      -= marginRelease;
      pos.realizedPnL     += partialPnL;
      pos.exitBrokerage   += exitBrok;
      pos.totalBrokerage   = pos.entryBrokerage + pos.exitBrokerage;
      await pos.save();

      // ✅ proportion ke hisaab se release
      user.releaseMargin(marginRelease);
      user.availableBalance += partialPnL;  // partial PnL adjust
      user.availableBalance -= exitBrok;    // exit brokerage deduct
      user.totalPnL         += partialPnL;
      user.todayPnL         += partialPnL;
    }

    user.totalBrokeragePaid += exitBrok;
    await user.save();
  }
}

module.exports = { router, _executeOrder };
