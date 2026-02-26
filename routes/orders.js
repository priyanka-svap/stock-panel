// routes/orders.js
const express  = require('express');
const router   = express.Router();
const Order    = require('../models/Order');
const User     = require('../models/User');
const Stock    = require('../models/Stock');
const Index    = require('../models/Index');
const Position = require('../models/Position');
const auth     = require('../middleware/auth');
const { scheduleUserFirebaseSync } = require('../services/userFirebaseService');

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
//
// BUY  → LONG  position open hoti hai (pehle jaisa)
// SELL → SHORT position open hoti hai (Bybit style — seedha bech sakte ho)
//
// Agar SELL karo aur already LONG position open hai us symbol pe →
//   pehle LONG close hogi, bacha hua quantity SHORT mein jayega
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
    const TYPE = orderType.toUpperCase();  // 'BUY' | 'SELL'

    if (!['BUY', 'SELL'].includes(TYPE))
      return res.status(400).json({ success: false, message: 'orderType must be BUY or SELL' });

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

    const [user, stockDoc, indexDoc] = await Promise.all([
      User.findById(req.user.userId),
      Stock.findOne({ symbol: symbol.toUpperCase() }),
      Index.findOne({ name: symbol.toUpperCase() })
    ]);

    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, message: 'User not found or inactive' });
    }

    // Support indices (e.g. NIFTY 50) via Index model fallback
    let stockData = stockDoc;
    let isIndexInstrument = false;

    if (!stockData && indexDoc) {
      isIndexInstrument = true;
      stockData = {
        companyName: indexDoc.displayName || indexDoc.name,
        currentPrice: indexDoc.value,
        expiryDate: null,
        expiryMonth: null,
        strikePrice: null,
        lotSize: lotSize || 1
      };
    }

    if (!stockData) {
      return res.status(404).json({ success: false, message: `Instrument '${symbol}' not found` });
    }

    // Expiry validation only for derivative contracts coming from Stock collection
    if (!isIndexInstrument && stockData.expiryDate && new Date(stockData.expiryDate) < new Date()) {
      return res.status(400).json({ success: false, message: 'Contract expired' });
    }

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

    // ── Margin check — BUY aur SELL dono ke liye margin chahiye ────────────
    if (!user.hasEnoughMargin(order.netAmount))
      return res.status(400).json({
        success: false, message: 'Insufficient margin',
        data: { required: order.netAmount, available: user.availableMargin }
      });

    // Margin aur brokerage deduct karo (BUY aur SELL dono ke liye)
    user.useMargin(order.marginUsed);
    user.addBrokerage(order.brokerage);
    await user.save();

    await order.save();

    if (MODE === 'MARKET') {
      await _executeOrder(order, user, parseFloat(price));
    }

    scheduleUserFirebaseSync(user._id.toString());

    return res.status(201).json({
      success: true,
      message: MODE === 'MARKET'
        ? `✅ ${TYPE} Order executed — ${TYPE === 'BUY' ? 'LONG' : 'SHORT'} position created`
        : `⏳ Order PENDING (${MODE}) – executes when price hits ₹${limitPrice}`,
      order: {
        orderId:          order._id,
        symbol:           order.symbol,
        orderType:        order.orderType,
        orderMode:        order.orderMode,
        positionSide:     TYPE === 'BUY' ? 'LONG' : 'SHORT',
        quantity:         order.quantity,
        price:            order.price,
        limitPrice:       order.limitPrice,
        status:           order.status,
        stopLoss:         order.stopLoss,         stopLossAmount:    order.stopLossAmount,
        stopLossPercent:  order.stopLossPercent,  takeProfit:        order.takeProfit,
        takeProfitAmount: order.takeProfitAmount, takeProfitPercent: order.takeProfitPercent,
        riskRewardRatio:  order.riskRewardRatio,
        totalAmount:      order.totalAmount,      marginRequired:    order.marginRequired,
        brokerage:        order.brokerage,        gst:               order.gst,
        stampDuty:        order.stampDuty,        transactionCharges: order.transactionCharges,
        taxesAndCharges:  order.taxesAndCharges,  netAmount:         order.netAmount
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

    const user      = await User.findById(req.user.userId);
    const oldMargin = order.marginUsed;
    const oldBrok   = order.brokerage;

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

    const marginDiff = order.marginUsed - oldMargin;
    const brokDiff   = order.brokerage  - oldBrok;

    if (marginDiff > 0) {
      if (!user.hasEnoughMargin(order.netAmount))
        return res.status(400).json({ success: false, message: `Insufficient margin. Need ₹${order.netAmount}, have ₹${user.availableMargin}` });
      user.useMargin(marginDiff);
      user.availableBalance -= brokDiff;
    } else if (marginDiff < 0) {
      user.releaseMargin(Math.abs(marginDiff));
      user.availableBalance -= brokDiff;
    }

    await user.save();
    scheduleUserFirebaseSync(user._id.toString());

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

    order.status       = 'CANCELLED';
    order.cancelledAt  = new Date();
    order.cancelReason = req.body.reason || 'User cancelled';
    await order.save();

    // BUY aur SELL dono ke liye margin + brokerage refund
    if (order.marginUsed > 0) {
      const user = await User.findById(req.user.userId);
      user.releaseMargin(order.marginUsed);
      user.availableBalance   += order.brokerage;
      user.totalBrokeragePaid  = Math.max(0, (user.totalBrokeragePaid || 0) - order.brokerage);
      await user.save();
      scheduleUserFirebaseSync(user._id.toString());
    }

    res.json({ success: true, message: 'Order cancelled', data: order });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/close-position/:positionId
//
// LONG  position close → SELL karke close karo
// SHORT position close → BUY karke close karo
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

    // Close position (realizedPnL calculate hoga — LONG ya SHORT dono ke liye)
    position.close(exitPrice, exitBrok);
    await position.save();

    user.releaseMargin(position.marginUsed);
    user.availableBalance  += position.realizedPnL;
    user.availableBalance  -= exitBrok;
    user.totalPnL          += position.realizedPnL;
    user.todayPnL          += position.realizedPnL;
    user.totalBrokeragePaid += exitBrok;
    await user.save();

    scheduleUserFirebaseSync(user._id.toString());

    res.json({
      success: true,
      message: `${position.positionType} position closed successfully`,
      positionType:  position.positionType,
      realizedPnL:   position.realizedPnL,
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
// _executeOrder — MARKET order execute karo
//
// BUY  → LONG  position open / average karo
// SELL → SHORT position open karo (Bybit style)
//         Agar LONG position already open hai → pehle LONG close, baaki SHORT
// ─────────────────────────────────────────────────────────────────────────────
async function _executeOrder(order, user, execPrice) {
  order.status         = 'COMPLETED';
  order.executedAt     = new Date();
  order.executedPrice  = execPrice;
  order.filledQuantity = order.quantity;
  order.averagePrice   = execPrice;
  await order.save();

  // ════════════════════════════════════════════════════════════════════════════
  // BUY → LONG position
  // ════════════════════════════════════════════════════════════════════════════
  if (order.orderType === 'BUY') {

    // Existing SHORT position hai? → pehle SHORT close karo (BUY se)
    const shortPos = await Position.findOne({
      userId: user._id, symbol: order.symbol, positionType: 'SHORT', isActive: true
    });

    let remainingQty = order.quantity;

    if (shortPos) {
      const closeQty   = Math.min(shortPos.quantity, remainingQty);
      const closeBrok  = user.calculateBrokerage(closeQty * execPrice, closeQty);
      const proportion = closeQty / shortPos.quantity;

      if (closeQty >= shortPos.quantity) {
        // Full SHORT close
        shortPos.close(execPrice, closeBrok);
        await shortPos.save();
        user.releaseMargin(shortPos.marginUsed);
      } else {
        // Partial SHORT close
        const partialInvest = shortPos.investmentValue * proportion;
        const partialExit   = closeQty * execPrice;
        // SHORT P&L = entry - exit (profit jab price gire)
        const partialPnL    = partialInvest - partialExit - closeBrok;
        const marginRelease = shortPos.marginUsed * proportion;

        shortPos.quantity        -= closeQty;
        shortPos.investmentValue -= partialInvest;
        shortPos.currentValue     = shortPos.quantity * execPrice;
        shortPos.marginUsed      -= marginRelease;
        shortPos.realizedPnL     += partialPnL;
        shortPos.exitBrokerage   += closeBrok;
        shortPos.totalBrokerage   = shortPos.entryBrokerage + shortPos.exitBrokerage;
        await shortPos.save();

        user.releaseMargin(marginRelease);
        user.availableBalance += partialPnL;
        user.availableBalance -= closeBrok;
        user.totalPnL         += partialPnL;
        user.todayPnL         += partialPnL;
      }

      user.totalBrokeragePaid += closeBrok;
      remainingQty -= closeQty;
    }

    // Bacha hua quantity → LONG position mein daalo
    if (remainingQty > 0) {
      let longPos = await Position.findOne({
        userId: user._id, symbol: order.symbol, positionType: 'LONG', isActive: true
      });

      if (longPos) {
        // Average into existing LONG
        const newQty    = longPos.quantity + remainingQty;
        const newInvest = longPos.investmentValue + (remainingQty * execPrice);
        longPos.entryPrice      = newInvest / newQty;
        longPos.quantity        = newQty;
        longPos.currentPrice    = execPrice;
        longPos.investmentValue = newInvest;
        longPos.currentValue    = newQty * execPrice;
        longPos.marginUsed     += order.marginUsed * (remainingQty / order.quantity);
        longPos.entryBrokerage += order.brokerage  * (remainingQty / order.quantity);
        longPos.totalBrokerage  = longPos.entryBrokerage + (longPos.exitBrokerage || 0);
        if (order.stopLoss)   longPos.stopLoss   = order.stopLoss;
        if (order.takeProfit) longPos.takeProfit = order.takeProfit;
        await longPos.save();
        order.positionId = longPos._id;
      } else {
        // Naya LONG position
        const pos = new Position({
          userId: user._id, symbol: order.symbol,
          companyName: order.companyName, tradingSymbol: order.tradingSymbol,
          instrumentType: order.instrumentType, contractType: order.contractType,
          expiryDate: order.expiryDate, expiryMonth: order.expiryMonth,
          strikePrice: order.strikePrice, lotSize: order.lotSize,
          positionType:   'LONG',
          quantity:        remainingQty,
          entryPrice:      execPrice,
          currentPrice:    execPrice,
          marginUsed:      order.marginUsed * (remainingQty / order.quantity),
          marginMultiplier: user.marginMultiplier,
          entryBrokerage:  order.brokerage  * (remainingQty / order.quantity),
          totalBrokerage:  order.brokerage  * (remainingQty / order.quantity),
          investmentValue: remainingQty * execPrice,
          currentValue:    remainingQty * execPrice,
          stopLoss:        order.stopLoss,
          takeProfit:      order.takeProfit,
          isActive: true, isOpen: true,
        });
        await pos.save();
        order.positionId = pos._id;
      }
    }

    await order.save();
    await user.save();

  // ════════════════════════════════════════════════════════════════════════════
  // SELL → SHORT position (Bybit style — directly sell karo)
  //  Agar LONG position hai → pehle LONG close, baaki SHORT mein daalo
  // ════════════════════════════════════════════════════════════════════════════
  } else {

    // Existing LONG position hai?
    const longPos = await Position.findOne({
      userId: user._id, symbol: order.symbol, positionType: 'LONG', isActive: true
    });

    let remainingQty = order.quantity;

    if (longPos) {
      const closeQty   = Math.min(longPos.quantity, remainingQty);
      const closeBrok  = user.calculateBrokerage(closeQty * execPrice, closeQty);
      const proportion = closeQty / longPos.quantity;

      if (closeQty >= longPos.quantity) {
        // Full LONG close
        longPos.close(execPrice, closeBrok);
        await longPos.save();

        user.releaseMargin(longPos.marginUsed);
        user.availableBalance += longPos.realizedPnL;
        user.availableBalance -= closeBrok;
        user.totalPnL         += longPos.realizedPnL;
        user.todayPnL         += longPos.realizedPnL;
      } else {
        // Partial LONG close
        const partialInvest = longPos.investmentValue * proportion;
        const partialExit   = closeQty * execPrice;
        const partialPnL    = partialExit - partialInvest - closeBrok;
        const marginRelease = longPos.marginUsed * proportion;

        longPos.quantity        -= closeQty;
        longPos.investmentValue -= partialInvest;
        longPos.currentValue     = longPos.quantity * execPrice;
        longPos.marginUsed      -= marginRelease;
        longPos.realizedPnL     += partialPnL;
        longPos.exitBrokerage   += closeBrok;
        longPos.totalBrokerage   = longPos.entryBrokerage + longPos.exitBrokerage;
        await longPos.save();

        user.releaseMargin(marginRelease);
        user.availableBalance += partialPnL;
        user.availableBalance -= closeBrok;
        user.totalPnL         += partialPnL;
        user.todayPnL         += partialPnL;
      }

      user.totalBrokeragePaid += closeBrok;
      remainingQty -= closeQty;
    }

    // Bacha hua quantity → SHORT position mein daalo
    if (remainingQty > 0) {
      let shortPos = await Position.findOne({
        userId: user._id, symbol: order.symbol, positionType: 'SHORT', isActive: true
      });

      if (shortPos) {
        // Average into existing SHORT
        const newQty    = shortPos.quantity + remainingQty;
        const newInvest = shortPos.investmentValue + (remainingQty * execPrice);
        shortPos.entryPrice      = newInvest / newQty;
        shortPos.quantity        = newQty;
        shortPos.currentPrice    = execPrice;
        shortPos.investmentValue = newInvest;
        shortPos.currentValue    = newQty * execPrice;
        shortPos.marginUsed     += order.marginUsed * (remainingQty / order.quantity);
        shortPos.entryBrokerage += order.brokerage  * (remainingQty / order.quantity);
        shortPos.totalBrokerage  = shortPos.entryBrokerage + (shortPos.exitBrokerage || 0);
        if (order.stopLoss)   shortPos.stopLoss   = order.stopLoss;
        if (order.takeProfit) shortPos.takeProfit = order.takeProfit;
        await shortPos.save();
        order.positionId = shortPos._id;
      } else {
        // Naya SHORT position
        const pos = new Position({
          userId: user._id, symbol: order.symbol,
          companyName: order.companyName, tradingSymbol: order.tradingSymbol,
          instrumentType: order.instrumentType, contractType: order.contractType,
          expiryDate: order.expiryDate, expiryMonth: order.expiryMonth,
          strikePrice: order.strikePrice, lotSize: order.lotSize,
          positionType:   'SHORT',
          quantity:        remainingQty,
          entryPrice:      execPrice,
          currentPrice:    execPrice,
          marginUsed:      order.marginUsed * (remainingQty / order.quantity),
          marginMultiplier: user.marginMultiplier,
          entryBrokerage:  order.brokerage  * (remainingQty / order.quantity),
          totalBrokerage:  order.brokerage  * (remainingQty / order.quantity),
          investmentValue: remainingQty * execPrice,
          currentValue:    remainingQty * execPrice,
          stopLoss:        order.stopLoss,
          takeProfit:      order.takeProfit,
          isActive: true, isOpen: true,
        });
        await pos.save();
        order.positionId = pos._id;
      }
    }

    await order.save();
    await user.save();
  }
}

module.exports = { router, _executeOrder };