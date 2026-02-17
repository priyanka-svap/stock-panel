// routes/holdings.js
const express = require('express');
const router = express.Router();
const Holding = require('../models/Holding');
const Stock = require('../models/Stock');
const User = require('../models/User');
const auth = require('../middleware/auth');


// Get all holdings
router.get('/', auth,  autoSyncMiddleware('holding'), async (req, res) => {
  try {
    let holdings = await Holding.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    
    for (let holding of holdings) {
      const stock = await Stock.findOne({ symbol: holding.symbol });
      if (stock) {
        holding.currentPrice = stock.currentPrice;
        holding.currentValue = holding.quantity * stock.currentPrice;
        holding.investedValue = holding.quantity * holding.avgPrice;
        holding.totalPnL = holding.currentValue - holding.investedValue;
        holding.pnlPercentage = (holding.totalPnL / holding.investedValue) * 100;
        holding.lastUpdated = new Date();
        await holding.save();
      }
    }
    
    holdings = await Holding.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    
    const totalInvested = holdings.reduce((sum, h) => sum + h.investedValue, 0);
    const totalCurrent = holdings.reduce((sum, h) => sum + h.currentValue, 0);
    const totalPnL = totalCurrent - totalInvested;
    const totalPnLPercentage = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    
    res.json({
      success: true,
      data: holdings,
      summary: {
        totalInvested: parseFloat(totalInvested.toFixed(2)),
        totalCurrent: parseFloat(totalCurrent.toFixed(2)),
        totalPnL: parseFloat(totalPnL.toFixed(2)),
        totalPnLPercentage: parseFloat(totalPnLPercentage.toFixed(2)),
        count: holdings.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Buy stock (add to holdings)
router.post('/buy', auth, autoSyncMiddleware('holding'),  async (req, res) => {
  try {
    const { symbol, companyName, quantity, price } = req.body;
    
    if (!symbol || !quantity || !price) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    const stock = await Stock.findOne({ symbol: symbol.toUpperCase() });
    const currentPrice = stock ? stock.currentPrice : price;
    const company = companyName || (stock ? stock.companyName : symbol);
    
    let holding = await Holding.findOne({ userId: req.user.userId, symbol: symbol.toUpperCase() });
    
    if (holding) {
      const totalQuantity = holding.quantity + quantity;
      const totalInvested = (holding.quantity * holding.avgPrice) + (quantity * price);
      holding.quantity = totalQuantity;
      holding.avgPrice = totalInvested / totalQuantity;
      holding.currentPrice = currentPrice;
      holding.investedValue = totalQuantity * holding.avgPrice;
      holding.currentValue = totalQuantity * currentPrice;
      holding.totalPnL = holding.currentValue - holding.investedValue;
      holding.pnlPercentage = (holding.totalPnL / holding.investedValue) * 100;
    } else {
      holding = new Holding({
        userId: req.user.userId,
        symbol: symbol.toUpperCase(),
        companyName: company,
        quantity,
        avgPrice: price,
        currentPrice,
        investedValue: quantity * price,
        currentValue: quantity * currentPrice,
        totalPnL: (quantity * currentPrice) - (quantity * price),
        pnlPercentage: ((currentPrice - price) / price) * 100
      });
    }
    
    await holding.save();
    
    const user = await User.findById(req.user.userId);
    const totalCost = quantity * price;
    if (user.availableBalance < totalCost) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    user.availableBalance -= totalCost;
    await user.save();
    
    res.status(201).json({ success: true, message: 'Stock bought', data: holding });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Sell stock
router.post('/sell/:symbol', auth,  autoSyncMiddleware('holding'), async (req, res) => {
  try {
    const { quantity } = req.body;
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Valid quantity required' });
    }
    
    const holding = await Holding.findOne({ userId: req.user.userId, symbol: req.params.symbol.toUpperCase() });
    
    if (!holding) {
      return res.status(404).json({ success: false, message: 'Stock not found in holdings' });
    }
    
    if (quantity > holding.quantity) {
      return res.status(400).json({ success: false, message: `You only own ${holding.quantity} shares` });
    }
    
    const stock = await Stock.findOne({ symbol: holding.symbol });
    const sellPrice = stock ? stock.currentPrice : holding.currentPrice;
    
    const soldValue = quantity * sellPrice;
    const investedValue = quantity * holding.avgPrice;
    const realizedPnL = soldValue - investedValue;
    
    const user = await User.findById(req.user.userId);
    user.availableBalance += soldValue;
    user.totalPnL += realizedPnL;
    await user.save();
    
    if (quantity === holding.quantity) {
      await Holding.deleteOne({ _id: holding._id });
      return res.json({
        success: true,
        message: 'All shares sold',
        data: { quantitySold: quantity, sellPrice, realizedPnL, newBalance: user.availableBalance }
      });
    } else {
      holding.quantity -= quantity;
      holding.currentPrice = sellPrice;
      holding.investedValue = holding.quantity * holding.avgPrice;
      holding.currentValue = holding.quantity * sellPrice;
      holding.totalPnL = holding.currentValue - holding.investedValue;
      holding.pnlPercentage = (holding.totalPnL / holding.investedValue) * 100;
      await holding.save();
      
      res.json({
        success: true,
        message: 'Shares sold',
        data: { quantitySold: quantity, sellPrice, realizedPnL, remaining: holding, newBalance: user.availableBalance }
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete holding
router.delete('/:symbol', auth, autoSyncMiddleware('holding'),  async (req, res) => {
  try {
    const holding = await Holding.findOneAndDelete({
      userId: req.user.userId,
      symbol: req.params.symbol.toUpperCase()
    });
    
    if (!holding) {
      return res.status(404).json({ success: false, message: 'Holding not found' });
    }
    
    res.json({ success: true, message: 'Holding deleted', data: holding });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
