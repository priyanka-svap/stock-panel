// routes/funds.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const transactions = await Transaction.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(10);
    
    res.json({
      success: true,
      data: {
        availableBalance: user.availableBalance,
        usedMargin: user.usedMargin,
        totalPnL: user.totalPnL,
        transactions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/deposit', auth, async (req, res) => {
  try {
    const { amount, method } = req.body;
    
    const user = await User.findById(req.user.userId);
    user.availableBalance += amount;
    await user.save();
    
    const transaction = new Transaction({
      userId: req.user.userId,
      type: 'DEPOSIT',
      amount,
      method: method || 'UPI',
      description: 'Funds added',
      referenceId: 'TXN' + Date.now()
    });
    await transaction.save();
    
    res.json({ success: true, message: 'Funds added', data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, method } = req.body;
    
    const user = await User.findById(req.user.userId);
    if (user.availableBalance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    
    user.availableBalance -= amount;
    await user.save();
    
    const transaction = new Transaction({
      userId: req.user.userId,
      type: 'WITHDRAWAL',
      amount,
      method: method || 'BANK_TRANSFER',
      description: 'Funds withdrawn',
      referenceId: 'TXN' + Date.now()
    });
    await transaction.save();
    
    res.json({ success: true, message: 'Withdrawal successful', data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
