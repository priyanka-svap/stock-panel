// routes/orders.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Get all orders for a user
router.get('/', auth, async (req, res) => {
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
router.post('/', auth, async (req, res) => {
  try {
    const {
      symbol,
      companyName,
      orderType,
      quantity,
      price,
      orderMode,
      stopLoss,
      takeProfit
    } = req.body;
    
    // Validation
    if (!symbol || !companyName || !orderType || !quantity || !price) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Calculate amounts
    const totalAmount = quantity * price;
    const brokerage = 20;
    const taxesAndCharges = 15.50;
    const netAmount = totalAmount + brokerage + taxesAndCharges;
    
    // Check user balance
    const user = await User.findById(req.user.userId);
    if (orderType === 'BUY' && user.availableBalance < netAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }
    
    // Create order
    const order = new Order({
      userId: req.user.userId,
      symbol: symbol.toUpperCase(),
      companyName,
      orderType: orderType.toUpperCase(),
      quantity,
      price,
      orderMode: orderMode || 'Market',
      stopLoss,
      takeProfit,
      totalAmount,
      brokerage,
      taxesAndCharges,
      netAmount,
      status: orderMode === 'Market' ? 'COMPLETED' : 'PENDING'
    });
    
    if (orderMode === 'Market') {
      order.executedAt = new Date();
      
      // Update user balance
      if (orderType === 'BUY') {
        user.availableBalance -= netAmount;
      } else {
        user.availableBalance += (totalAmount - brokerage - taxesAndCharges);
      }
      await user.save();
    }
    
    await order.save();
    
    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error placing order',
      error: error.message
    });
  }
});

// Cancel order
router.patch('/:orderId/cancel', auth, async (req, res) => {
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
