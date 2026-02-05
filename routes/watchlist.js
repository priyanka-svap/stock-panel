// routes/watchlist.js
const express = require('express');
const router = express.Router();
const Watchlist = require('../models/Watchlist');
const Stock = require('../models/Stock');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    let watchlist = await Watchlist.findOne({ userId: req.user.userId });
    if (!watchlist) {
      watchlist = new Watchlist({ userId: req.user.userId, stocks: [] });
      await watchlist.save();
    }
    
    const symbols = watchlist.stocks.map(s => s.symbol);
    const stocks = await Stock.find({ symbol: { $in: symbols } });
    
    res.json({ success: true, data: stocks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/add/:symbol', auth, async (req, res) => {
  try {
    const watchlist = await Watchlist.findOne({ userId: req.user.userId }) || 
                       new Watchlist({ userId: req.user.userId, stocks: [] });
    
    if (!watchlist.stocks.find(s => s.symbol === req.params.symbol.toUpperCase())) {
      watchlist.stocks.push({ symbol: req.params.symbol.toUpperCase() });
      await watchlist.save();
    }
    
    res.json({ success: true, message: 'Added to watchlist' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/remove/:symbol', auth, async (req, res) => {
  try {
    const watchlist = await Watchlist.findOne({ userId: req.user.userId });
    if (watchlist) {
      watchlist.stocks = watchlist.stocks.filter(s => s.symbol !== req.params.symbol.toUpperCase());
      await watchlist.save();
    }
    
    res.json({ success: true, message: 'Removed from watchlist' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
