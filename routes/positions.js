// routes/positions.js
const express = require('express');
const router = express.Router();
const Position = require('../models/Position');
const auth = require('../middleware/auth');



router.get('/', auth,async (req, res) => {
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


// =====================================================
// OPEN NEW POSITION
// =====================================================

router.post('/open', auth, async (req, res) => {
    try {
        const { symbol, positionType, quantity, entryPrice } = req.body;
        
        // Validate inputs
        if (!symbol || !positionType || !quantity || !entryPrice) {
            return res.status(400).json({
                success: false,
                message: 'All fields required: symbol, positionType, quantity, entryPrice'
            });
        }
        
        if (!['LONG', 'SHORT'].includes(positionType)) {
            return res.status(400).json({
                success: false,
                message: 'positionType must be LONG or SHORT'
            });
        }
        
        if (quantity <= 0 || entryPrice <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Quantity and price must be positive'
            });
        }
        
        // Check if stock exists
        const stock = await Stock.findOne({ symbol: symbol });
        if (!stock) {
            return res.status(404).json({
                success: false,
                message: 'Stock not found'
            });
        }
        
        // Check user balance
        const user = await User.findById(req.user.userId);
        const requiredAmount = quantity * entryPrice;
        
        if (user.availableBalance < requiredAmount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance'
            });
        }
        
        // Create position
        const position = new Position({
            userId: req.user.userId,
            symbol,
            positionType,
            quantity,
            entryPrice,
            entryDate: new Date(),
            isActive: true
        });
        
        await position.save();
        
        // Update user balance
        user.availableBalance -= requiredAmount;
        user.usedMargin += requiredAmount;
        await user.save();
        
        res.json({
            success: true,
            message: 'Position opened successfully',
            data: position
        });
        
    } catch (error) {
        console.error('Open position error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// =====================================================
// CLOSE POSITION
// =====================================================

router.post('/close/:id', auth, async (req, res) => {
    try {
        const { exitPrice } = req.body;
        
        if (!exitPrice || exitPrice <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid exitPrice required'
            });
        }
        
        // Find position
        const position = await Position.findOne({
            _id: ObjectId(req.params.id),
            userId: req.user.userId,
            isActive: true
        });
        
        if (!position) {
            return res.status(404).json({
                success: false,
                message: 'Active position not found'
            });
        }
        
        // Calculate P&L
        const pnl = (exitPrice - position.entryPrice) * position.quantity;
        
        // Update position
        position.exitPrice = exitPrice;
        position.exitDate = new Date();
        position.pnl = parseFloat(pnl.toFixed(2));
        position.isActive = false;
        
        await position.save();
        
        // Update user balance
        const user = await User.findById(req.user.userId);
        const positionValue = position.quantity * position.entryPrice;
        const settlementAmount = positionValue + pnl;
        
        user.availableBalance += settlementAmount;
        user.usedMargin -= positionValue;
        user.totalPnL += pnl;
        
        await user.save();
        
        res.json({
            success: true,
            message: 'Position closed successfully',
            data: {
                position,
                pnl: parseFloat(pnl.toFixed(2)),
                settlementAmount: parseFloat(settlementAmount.toFixed(2))
            }
        });
        
    } catch (error) {
        console.error('Close position error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// =====================================================
// UPDATE STOP LOSS / TARGET
// =====================================================

router.patch('/:id/targets', auth, async (req, res) => {
    try {
        const { stopLoss, target } = req.body;
        
        const position = await Position.findOne({
            _id: req.params.id,
            userId: req.user.userId,
            isActive: true
        });
        
        if (!position) {
            return res.status(404).json({
                success: false,
                message: 'Active position not found'
            });
        }
        
        if (stopLoss !== undefined) {
            position.stopLoss = stopLoss;
        }
        
        if (target !== undefined) {
            position.target = target;
        }
        
        await position.save();
        
        res.json({
            success: true,
            message: 'Position updated successfully',
            data: position
        });
        
    } catch (error) {
        console.error('Update position error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// =====================================================
// DELETE CLOSED POSITION
// =====================================================

router.delete('/:id', auth, async (req, res) => {
    try {
        const position = await Position.findOne({
            _id: req.params.id,
            userId: req.user.userId,
            isActive: false
        });
        
        if (!position) {
            return res.status(404).json({
                success: false,
                message: 'Closed position not found'
            });
        }
        
        await position.deleteOne();
        
        res.json({
            success: true,
            message: 'Position deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete position error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// =====================================================
// GET POSITION SUMMARY/STATISTICS
// =====================================================

router.get('/stats/summary', auth, async (req, res) => {
    try {
        const positions = await Position.find({ 
            userId: req.user.userId 
        }).lean();
        
        const activePositions = positions.filter(p => p.isActive);
        const closedPositions = positions.filter(p => !p.isActive);
        
        // Calculate stats for closed positions
        const totalRealized = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
        const winningTrades = closedPositions.filter(p => p.pnl > 0).length;
        const losingTrades = closedPositions.filter(p => p.pnl < 0).length;
        const winRate = closedPositions.length > 0 ? 
            (winningTrades / closedPositions.length * 100) : 0;
        
        // Calculate unrealized P&L for active positions
        const symbols = [...new Set(activePositions.map(p => p.symbol))];
        const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();
        const priceMap = {};
        stocks.forEach(s => { priceMap[s.symbol] = s.currentPrice; });
        
        const totalUnrealized = activePositions.reduce((sum, p) => {
            const currentPrice = priceMap[p.symbol] || p.entryPrice;
            const pnl = (currentPrice - p.entryPrice) * p.quantity;
            return sum + pnl;
        }, 0);
        
        res.json({
            success: true,
            data: {
                activePositions: activePositions.length,
                closedPositions: closedPositions.length,
                totalRealized: parseFloat(totalRealized.toFixed(2)),
                totalUnrealized: parseFloat(totalUnrealized.toFixed(2)),
                winningTrades,
                losingTrades,
                winRate: parseFloat(winRate.toFixed(2)),
                totalPnL: parseFloat((totalRealized + totalUnrealized).toFixed(2))
            }
        });
        
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});


module.exports = router;
