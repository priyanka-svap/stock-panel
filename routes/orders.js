// routes/orders.js - CORRECTED VERSION with productType

const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Stock = require('../models/Stock');
const Holding = require('../models/Holding');
const Position = require('../models/Position');
const auth = require('../middleware/auth');
const { autoSyncMiddleware } = require('../middleware/firebaseSyncHooks');

// Get all orders for a user
router.get('/', auth,autoSyncMiddleware('order'),  async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    const query = { userId: req.user.userId };
    if (status) {
      query.status = status.toUpperCase();
    }
    
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const count = await Order.countDocuments(query);
    
    res.json({
      success: true,
      data: orders,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
});

// Place new order
router.post('/place', auth,autoSyncMiddleware('order'),  async (req, res) => {
 try {
    const {
      symbol, companyName, tradingSymbol, instrumentType = 'EQUITY',
      contractType = 'SPOT', expiryDate, expiryMonth, strikePrice,
      lotSize = 1, orderType, orderMode = 'Market', quantity, price,
      stopLoss, takeProfit, notes
    } = req.body;
    
    if (!symbol || !orderType || !quantity || !price) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    const user = await User.findById(req.user.userId);
    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, message: 'User not found or inactive' });
    }
    
    const stockData = 
      await Stock.findOne({ symbol: symbol.toUpperCase() });
    
    if (!stockData) {
      return res.status(404).json({ success: false, message: 'Stock/Contract not found' });
    }
    
    if (stockData.expiryDate && new Date(stockData.expiryDate) < new Date()) {
      return res.status(400).json({ success: false, message: 'Contract expired' });
    }
    
    const totalAmount = quantity * price;
    
    const order = new Order({
      userId: user._id,
      symbol: symbol.toUpperCase(),
      companyName: companyName || stockData.companyName,
      tradingSymbol: (tradingSymbol || symbol).toUpperCase(),
      instrumentType: (instrumentType || stockData.instrumentType).toUpperCase(),
      contractType: contractType.toUpperCase(),
      expiryDate: expiryDate || stockData.expiryDate,
      expiryMonth: (expiryMonth || stockData.expiryMonth)?.toUpperCase(),
      strikePrice: strikePrice || stockData.strikePrice,
      lotSize: lotSize || stockData.lotSize || 1,
      orderType: orderType.toUpperCase(),
      orderMode,
      quantity: parseInt(quantity),
      price: parseFloat(price),
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      totalAmount,
      status: 'PENDING',
      platform: 'WEB',
      notes
    });
    
    const marginRequired = order.calculateMargin(user);
    await order.calculateCharges(user);
    
    if (orderType.toUpperCase() === 'BUY') {
      if (!user.hasEnoughMargin(marginRequired)) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient margin',
          required: marginRequired,
          available: user.availableMargin
        });
      }
    } else {
      const position = await Position.findOne({
        userId: user._id,
        symbol: symbol.toUpperCase(),
        isOpen: true
      });
      
      if (!position || position.quantity < quantity) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient quantity to sell'
        });
      }
    }
    
    if (orderType.toUpperCase() === 'BUY') {
      await user.useMargin(marginRequired);
    }
    
    await order.save();
    
    if (orderMode === 'Market') {
      order.status = 'COMPLETED';
      order.executedAt = new Date();
      order.executedPrice = price;
      await order.save();
      await createOrUpdatePosition(order, user);
    }
    
    res.status(201).json({
      success: true,
      message: `Order ${order.status.toLowerCase()} successfully`,
      order: {
        orderId: order._id,
        symbol: order.symbol,
        orderType: order.orderType,
        quantity: order.quantity,
        price: order.price,
        marginRequired: order.marginRequired,
        brokerage: order.brokerage,
        netAmount: order.netAmount,
        status: order.status
      },
      user: {
        availableMargin: user.availableMargin,
        usedMargin: user.usedMargin
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error placing order', error: error.message });
  }
});
async function createOrUpdatePosition(order, user) {
  const positionQuery = {
    userId: user._id,
    symbol: order.symbol,
    tradingSymbol: order.tradingSymbol,
    isOpen: true
  };
  
  if (order.orderType === 'BUY') {
    let position = await Position.findOne(positionQuery);
    
    if (position) {
      const totalQty = position.quantity + order.quantity;
      const totalCost = (position.quantity * position.avgPrice) + (order.quantity * order.price);
      position.avgPrice = totalCost / totalQty;
      position.quantity = totalQty;
      position.currentPrice = order.price;
      position.brokerage += order.brokerage;
      position.totalCharges += order.taxesAndCharges;
      position.marginUsed += order.marginUsed;
      await position.save();
    } else {
      position = new Position({
        userId: user._id,
        orderId: order._id,
        symbol: order.symbol,
        companyName: order.companyName,
        tradingSymbol: order.tradingSymbol,
        instrumentType: order.instrumentType,
        contractType: order.contractType,
        expiryDate: order.expiryDate,
        expiryMonth: order.expiryMonth,
        strikePrice: order.strikePrice,
        lotSize: order.lotSize,
        type: 'BUY',
        quantity: order.quantity,
        avgPrice: order.price,
        currentPrice: order.price,
        marginUsed: order.marginUsed,
        marginType: order.marginType,
        brokerage: order.brokerage,
        totalCharges: order.taxesAndCharges,
        isOpen: true
      });
      await position.save();
    }
  } else {
    const position = await Position.findOne(positionQuery);
    if (position) {
      if (position.quantity <= order.quantity) {
        await position.closePosition(order.price, order.brokerage, order.taxesAndCharges);
        await user.releaseMargin(position.marginUsed);
        user.todayPnL += position.realizedPnL;
        user.totalPnL += position.realizedPnL;
        await user.save();
      } else {
        const closedQty = order.quantity;
        const partialPnL = (order.price - position.avgPrice) * closedQty - order.brokerage - order.taxesAndCharges;
        position.quantity -= closedQty;
        position.realizedPnL += partialPnL;
        const marginToRelease = (position.marginUsed * closedQty) / (position.quantity + closedQty);
        position.marginUsed -= marginToRelease;
        await user.releaseMargin(marginToRelease);
        user.todayPnL += partialPnL;
        user.totalPnL += partialPnL;
        await position.save();
        await user.save();
      }
    }
  }
}
// Cancel order
router.patch('/:orderId/cancel', auth,autoSyncMiddleware('order'),  async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      userId: req.user.userId
    });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    if (order.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'Only pending orders can be cancelled'
      });
    }
    
    order.status = 'CANCELLED';
    order.cancelledAt = new Date();
    order.cancelReason = req.body.reason || 'User cancelled';
    
    await order.save();
    
    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error cancelling order',
      error: error.message
    });
  }
});

module.exports = router;
