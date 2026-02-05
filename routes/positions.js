// routes/positions.js
const express = require('express');
const router = express.Router();
const Position = require('../models/Position');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const positions = await Position.find({
      userId: req.user.userId,
      isOpen: true
    }).sort({ createdAt: -1 });
    
    const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);
    
    res.json({
      success: true,
      data: positions,
      summary: { totalPnL, count: positions.length }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
