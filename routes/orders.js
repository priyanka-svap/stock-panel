// routes/orders.js - CORRECTED VERSION with productType

const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Stock = require('../models/Stock');
const Holding = require('../models/Holding');
const Position = require('../models/Position');
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
      orderType,      // BUY or SELL
      quantity,
      price,
      orderMode,      // Market, Limit, SL, SL-M
      productType,    // ✨ DELIVERY or INTRADAY (CNC or MIS)
      stopLoss,
      takeProfit
    } = req.body;
    
    // Validation
    if (!symbol || !companyName || !orderType || !quantity || !price) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: symbol, companyName, orderType, quantity, price'
      });
    }
    
    // Validate productType
    const validProductTypes = ['DELIVERY', 'INTRADAY', 'CNC', 'MIS'];
    const finalProductType = productType ? productType.toUpperCase() : 'DELIVERY';
    
    if (!validProductTypes.includes(finalProductType)) {
      return res.status(400).json({
        success: false,
        message: 'productType must be DELIVERY, INTRADAY, CNC, or MIS'
      });
    }
    
    // Normalize productType (CNC = DELIVERY, MIS = INTRADAY)
    const normalizedProductType = ['CNC', 'DELIVERY'].includes(finalProductType) ? 'DELIVERY' : 'INTRADAY';
    
    // Calculate amounts
    const totalAmount = quantity * price;
    const brokerage = 20;
    const taxesAndCharges = 15.50;
    const netAmount = totalAmount + brokerage + taxesAndCharges;
    
    // Check user balance
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (orderType.toUpperCase() === 'BUY' && user.availableBalance < netAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Required: ₹${netAmount.toFixed(2)}, Available: ₹${user.availableBalance.toFixed(2)}`
      });
    }
    
    // Get stock details
    const stock = await Stock.findOne({ symbol: symbol.toUpperCase() });
    if (!stock) {
      return res.status(404).json({
        success: false,
        message: `Stock not found: ${symbol}`
      });
    }
    
    // Determine if order should be executed immediately (Market orders)
    const isMarketOrder = !orderMode || orderMode === 'Market';
    
    // Create order
    const order = new Order({
      userId: req.user.userId,
      symbol: symbol.toUpperCase(),
      companyName,
      orderType: orderType.toUpperCase(),
      quantity,
      price,
      orderMode: orderMode || 'Market',      // Market, Limit, SL, SL-M
      productType: finalProductType,          // DELIVERY, INTRADAY, CNC, MIS
      stopLoss,
      takeProfit,
      totalAmount,
      brokerage,
      taxesAndCharges,
      netAmount,
      status: isMarketOrder ? 'COMPLETED' : 'PENDING'
    });
    
    // Execute MARKET orders immediately
    if (isMarketOrder) {
      order.executedAt = new Date();
      
      // Update user balance
      if (orderType.toUpperCase() === 'BUY') {
        user.availableBalance -= netAmount;
      } else {
        user.availableBalance += (totalAmount - brokerage - taxesAndCharges);
      }
      await user.save();
      
      // ========================================
      // ✨ CREATE HOLDING OR POSITION ✨
      // ========================================
      
      console.log(`📊 Executing ${normalizedProductType} order: ${orderType} ${quantity} ${symbol} @ ₹${price}`);
      
      if (normalizedProductType === 'DELIVERY') {
        // DELIVERY/CNC → Create/Update HOLDING
        
        if (orderType.toUpperCase() === 'BUY') {
          let holding = await Holding.findOne({
            userId: req.user.userId,
            symbol: symbol.toUpperCase()
          });
          
          if (holding) {
            // Update existing holding (averaging)
            console.log(`  ↳ Updating existing holding`);
            
            const totalQty = holding.quantity + quantity;
            const totalInvested = (holding.quantity * holding.avgPrice) + (quantity * price);
            
            holding.quantity = totalQty;
            holding.avgPrice = totalInvested / totalQty;
            holding.investedValue = totalInvested;
            holding.currentPrice = stock.currentPrice;
            holding.currentValue = holding.quantity * holding.currentPrice;
            holding.totalPnL = holding.currentValue - holding.investedValue;
            holding.pnlPercentage = (holding.totalPnL / holding.investedValue) * 100;
            
            await holding.save();
            console.log(`  ✓ Holding updated: ${holding.quantity} shares @ avg ₹${holding.avgPrice.toFixed(2)}`);
            
          } else {
            // Create new holding
            console.log(`  ↳ Creating new holding`);
            
            const investedValue = quantity * price;
            const currentValue = quantity * stock.currentPrice;
            const totalPnL = currentValue - investedValue;
            const pnlPercentage = (totalPnL / investedValue) * 100;
            
            holding = await Holding.create({
              userId: req.user.userId,
              symbol: symbol.toUpperCase(),
              companyName: stock.companyName,
              quantity: quantity,
              avgPrice: price,
              currentPrice: stock.currentPrice,
              investedValue: investedValue,
              currentValue: currentValue,
              totalPnL: totalPnL,
              pnlPercentage: pnlPercentage
            });
            
            console.log(`  ✓ Holding created: ${quantity} shares @ ₹${price.toFixed(2)} (P&L: ${totalPnL >= 0 ? '+' : ''}₹${totalPnL.toFixed(2)})`);
          }
          
        } else if (orderType.toUpperCase() === 'SELL') {
          // Handle SELL - reduce holding quantity
          console.log(`  ↳ Processing SELL order`);
          
          let holding = await Holding.findOne({
            userId: req.user.userId,
            symbol: symbol.toUpperCase()
          });
          
          if (holding) {
            if (holding.quantity < quantity) {
              await order.save(); // Save order first
              return res.status(400).json({
                success: false,
                message: `Insufficient holdings. You have ${holding.quantity} shares but trying to sell ${quantity}`
              });
            }
            
            holding.quantity -= quantity;
            
            if (holding.quantity <= 0) {
              await Holding.findByIdAndDelete(holding._id);
              console.log(`  ✓ Holding deleted (all shares sold)`);
            } else {
              holding.investedValue = holding.quantity * holding.avgPrice;
              holding.currentPrice = stock.currentPrice;
              holding.currentValue = holding.quantity * holding.currentPrice;
              holding.totalPnL = holding.currentValue - holding.investedValue;
              holding.pnlPercentage = (holding.totalPnL / holding.investedValue) * 100;
              await holding.save();
              console.log(`  ✓ Holding updated: ${holding.quantity} shares remaining`);
            }
          } else {
            await order.save(); // Save order first
            return res.status(400).json({
              success: false,
              message: `No holdings found for ${symbol}. Cannot sell.`
            });
          }
        }
        
      } else if (normalizedProductType === 'INTRADAY') {
        // INTRADAY/MIS → Create POSITION
        
        console.log(`  ↳ Creating intraday position`);
        
        let pnl = 0;
        let pnlPercentage = 0;
        
        if (orderType.toUpperCase() === 'BUY') {
          pnl = (stock.currentPrice - price) * quantity;
          pnlPercentage = ((stock.currentPrice - price) / price) * 100;
        } else {
          pnl = (price - stock.currentPrice) * quantity;
          pnlPercentage = ((price - stock.currentPrice) / stock.currentPrice) * 100;
        }
        
        const position = await Position.create({
          userId: req.user.userId,
          symbol: symbol.toUpperCase(),
          companyName: stock.companyName,
          type: orderType.toUpperCase(),
          quantity: quantity,
          avgPrice: price,
          currentPrice: stock.currentPrice,
          pnl: pnl,
          pnlPercentage: pnlPercentage,
          isOpen: true
        });
        
        console.log(`  ✓ Position created: ${orderType} ${quantity} @ ₹${price} (P&L: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)})`);
      }
    }
    
    await order.save();
    
    res.status(201).json({
      success: true,
      message: `Order placed successfully${isMarketOrder ? ' and executed' : ''}`,
      data: order
    });
  } catch (error) {
    console.error('❌ Error placing order:', error);
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
