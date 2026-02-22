// // routes/positions.js
// const express = require('express');
// const router = express.Router();
// const Position = require('../models/Position');
// const auth = require('../middleware/auth');



// router.get('/', auth,async (req, res) => {
//   try {
//     const positions = await Position.find({
//       userId: req.user.userId,
//       isOpen: true
//     }).sort({ createdAt: -1 });
    
//     const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);
    
//     res.json({
//       success: true,
//       data: positions,
//       summary: { totalPnL, count: positions.length }
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// });


// // =====================================================
// // OPEN NEW POSITION
// // =====================================================

// router.post('/open', auth, async (req, res) => {
//     try {
//         const { symbol, positionType, quantity, entryPrice } = req.body;
        
//         // Validate inputs
//         if (!symbol || !positionType || !quantity || !entryPrice) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'All fields required: symbol, positionType, quantity, entryPrice'
//             });
//         }
        
//         if (!['LONG', 'SHORT'].includes(positionType)) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'positionType must be LONG or SHORT'
//             });
//         }
        
//         if (quantity <= 0 || entryPrice <= 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Quantity and price must be positive'
//             });
//         }
        
//         // Check if stock exists
//         const stock = await Stock.findOne({ symbol: symbol });
//         if (!stock) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Stock not found'
//             });
//         }
        
//         // Check user balance
//         const user = await User.findById(req.user.userId);
//         const requiredAmount = quantity * entryPrice;
        
//         if (user.availableBalance < requiredAmount) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Insufficient balance'
//             });
//         }
        
//         // Create position
//         const position = new Position({
//             userId: req.user.userId,
//             symbol,
//             positionType,
//             quantity,
//             entryPrice,
//             entryDate: new Date(),
//             isActive: true
//         });
        
//         await position.save();
        
//         // Update user balance
//         user.availableBalance -= requiredAmount;
//         user.usedMargin += requiredAmount;
//         await user.save();
        
//         res.json({
//             success: true,
//             message: 'Position opened successfully',
//             data: position
//         });
        
//     } catch (error) {
//         console.error('Open position error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: error.message 
//         });
//     }
// });

// // =====================================================
// // CLOSE POSITION
// // =====================================================

// router.post('/close/:id', auth, async (req, res) => {
//     try {
//         const { exitPrice } = req.body;
        
//         if (!exitPrice || exitPrice <= 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Valid exitPrice required'
//             });
//         }
        
//         // Find position
//         const position = await Position.findOne({
//             _id: req.params.id,
//             userId: req.user.userId,
//             isActive: true
//         });
        
//         if (!position) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Active position not found'
//             });
//         }
        
//         // Calculate P&L
//         const pnl = (exitPrice - position.entryPrice) * position.quantity;
        
//         // Update position
//         position.exitPrice = exitPrice;
//         position.exitDate = new Date();
//         position.pnl = parseFloat(pnl.toFixed(2));
//         position.isActive = false;
        
//         await position.save();
        
//         // Update user balance
//         const user = await User.findById(req.user.userId);
//         const positionValue = position.quantity * position.entryPrice;
//         const settlementAmount = positionValue + pnl;
        
//         user.availableBalance += settlementAmount;
//         user.usedMargin -= positionValue;
//         user.totalPnL += pnl;
        
//         await user.save();
        
//         res.json({
//             success: true,
//             message: 'Position closed successfully',
//             data: {
//                 position,
//                 pnl: parseFloat(pnl.toFixed(2)),
//                 settlementAmount: parseFloat(settlementAmount.toFixed(2))
//             }
//         });
        
//     } catch (error) {
//         console.error('Close position error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: error.message 
//         });
//     }
// });

// // =====================================================
// // UPDATE STOP LOSS / TARGET
// // =====================================================

// router.patch('/:id/targets', auth, async (req, res) => {
//     try {
//         const { stopLoss, target } = req.body;
        
//         const position = await Position.findOne({
//             _id: req.params.id,
//             userId: req.user.userId,
//             isActive: true
//         });
        
//         if (!position) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Active position not found'
//             });
//         }
        
//         if (stopLoss !== undefined) {
//             position.stopLoss = stopLoss;
//         }
        
//         if (target !== undefined) {
//             position.target = target;
//         }
        
//         await position.save();
        
//         res.json({
//             success: true,
//             message: 'Position updated successfully',
//             data: position
//         });
        
//     } catch (error) {
//         console.error('Update position error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: error.message 
//         });
//     }
// });

// // =====================================================
// // DELETE CLOSED POSITION
// // =====================================================

// router.delete('/:id', auth, async (req, res) => {
//     try {
//         const position = await Position.findOne({
//             _id: req.params.id,
//             userId: req.user.userId,
//             isActive: false
//         });
        
//         if (!position) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Closed position not found'
//             });
//         }
        
//         await position.deleteOne();
        
//         res.json({
//             success: true,
//             message: 'Position deleted successfully'
//         });
        
//     } catch (error) {
//         console.error('Delete position error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: error.message 
//         });
//     }
// });

// // =====================================================
// // GET POSITION SUMMARY/STATISTICS
// // =====================================================

// router.get('/stats/summary', auth, async (req, res) => {
//     try {
//         const positions = await Position.find({ 
//             userId: req.user.userId 
//         }).lean();
        
//         const activePositions = positions.filter(p => p.isActive);
//         const closedPositions = positions.filter(p => !p.isActive);
        
//         // Calculate stats for closed positions
//         const totalRealized = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
//         const winningTrades = closedPositions.filter(p => p.pnl > 0).length;
//         const losingTrades = closedPositions.filter(p => p.pnl < 0).length;
//         const winRate = closedPositions.length > 0 ? 
//             (winningTrades / closedPositions.length * 100) : 0;
        
//         // Calculate unrealized P&L for active positions
//         const symbols = [...new Set(activePositions.map(p => p.symbol))];
//         const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();
//         const priceMap = {};
//         stocks.forEach(s => { priceMap[s.symbol] = s.currentPrice; });
        
//         const totalUnrealized = activePositions.reduce((sum, p) => {
//             const currentPrice = priceMap[p.symbol] || p.entryPrice;
//             const pnl = (currentPrice - p.entryPrice) * p.quantity;
//             return sum + pnl;
//         }, 0);
        
//         res.json({
//             success: true,
//             data: {
//                 activePositions: activePositions.length,
//                 closedPositions: closedPositions.length,
//                 totalRealized: parseFloat(totalRealized.toFixed(2)),
//                 totalUnrealized: parseFloat(totalUnrealized.toFixed(2)),
//                 winningTrades,
//                 losingTrades,
//                 winRate: parseFloat(winRate.toFixed(2)),
//                 totalPnL: parseFloat((totalRealized + totalUnrealized).toFixed(2))
//             }
//         });
        
//     } catch (error) {
//         console.error('Get stats error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: error.message 
//         });
//     }
// });


// module.exports = router;
// routes/positions.js — Fixed: stopLoss/takeProfit consistent, LONG/SHORT P&L correct

const express  = require('express');
const router   = express.Router();
const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const auth     = require('../middleware/auth');
const { syncSingleUserToFirebase } = require('../services/userFirebaseService');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/positions  — all open positions for logged-in user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const positions = await Position.find({
      userId: req.user.userId,
      isActive: true
    }).sort({ createdAt: -1 });

    const totalPnL = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);

    res.json({
      success: true,
      data: positions,
      summary: {
        totalPnL:       parseFloat(totalPnL.toFixed(2)),
        count:          positions.length,
        withSL:         positions.filter(p => p.stopLoss).length,
        withTP:         positions.filter(p => p.takeProfit || p.target).length,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/positions/history  — closed positions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const [positions, total] = await Promise.all([
      Position.find({ userId: req.user.userId, isActive: false })
        .sort({ exitedAt: -1, exitDate: -1, updatedAt: -1 })
        .limit(+limit).skip((+page - 1) * +limit),
      Position.countDocuments({ userId: req.user.userId, isActive: false })
    ]);

    res.json({
      success: true,
      data: positions,
      pagination: { total, page: +page, limit: +limit }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/positions/stats/summary
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/summary', auth, async (req, res) => {
  try {
    const all = await Position.find({ userId: req.user.userId }).lean();

    const active = all.filter(p => p.isActive);
    const closed = all.filter(p => !p.isActive);

    // Realized P&L
    const totalRealized = closed.reduce((s, p) => s + (p.realizedPnL || p.pnl || 0), 0);
    const winning       = closed.filter(p => (p.realizedPnL || p.pnl || 0) > 0).length;
    const losing        = closed.filter(p => (p.realizedPnL || p.pnl || 0) < 0).length;
    const winRate       = closed.length > 0 ? (winning / closed.length * 100) : 0;

    // SL/TP stats for closed positions
    const slHits     = closed.filter(p => p.closeReason === 'STOP_LOSS').length;
    const targetHits = closed.filter(p => p.closeReason === 'TARGET').length;

    // Unrealized P&L (use live stock prices)
    const symbols  = [...new Set(active.map(p => p.symbol))];
    const stocks   = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = s.currentPrice; });

    const totalUnrealized = active.reduce((s, p) => {
      const cmp  = priceMap[p.symbol] || p.currentPrice || p.entryPrice;
      const iv   = p.investmentValue || (p.entryPrice * p.quantity);
      const cv   = cmp * p.quantity;
      const pnl  = p.positionType === 'LONG'
        ? cv - iv - (p.totalBrokerage || 0)
        : iv - cv - (p.totalBrokerage || 0);
      return s + pnl;
    }, 0);

    res.json({
      success: true,
      data: {
        activePositions:  active.length,
        closedPositions:  closed.length,
        totalRealized:    parseFloat(totalRealized.toFixed(2)),
        totalUnrealized:  parseFloat(totalUnrealized.toFixed(2)),
        totalPnL:         parseFloat((totalRealized + totalUnrealized).toFixed(2)),
        winningTrades:    winning,
        losingTrades:     losing,
        winRate:          parseFloat(winRate.toFixed(2)),
        // SL/TP stats
        slHits,
        targetHits,
        withActiveSL:     active.filter(p => p.stopLoss).length,
        withActiveTP:     active.filter(p => p.takeProfit || p.target).length,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/positions/:id  — single position detail
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const pos = await Position.findOne({
      _id: req.params.id,
      userId: req.user.userId
    });
    if (!pos) return res.status(404).json({ success: false, message: 'Position not found' });

    // Fetch live price
    const stock = await Stock.findOne({ symbol: pos.symbol });
    const livePrice = stock ? stock.currentPrice : pos.currentPrice;

    const sltpHit = pos.checkSLTP(livePrice);

    res.json({
      success: true,
      data: {
        ...pos.toObject(),
        livePrice,
        sltpHit: sltpHit || null,
        slDistance:  pos.stopLoss  ? Math.abs(livePrice - pos.stopLoss).toFixed(2)                : null,
        tpDistance:  (pos.takeProfit || pos.target) ? Math.abs(livePrice - (pos.takeProfit || pos.target)).toFixed(2) : null,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/positions/open  — manually open a position
// (normally positions are created via orders/place)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/open', auth, async (req, res) => {
  try {
    const {
      symbol, positionType, quantity, entryPrice,
      stopLoss, takeProfit   // ← optional SL/TP at open time
    } = req.body;

    if (!symbol || !positionType || !quantity || !entryPrice)
      return res.status(400).json({
        success: false,
        message: 'symbol, positionType, quantity, entryPrice required'
      });

    if (!['LONG', 'SHORT'].includes(positionType))
      return res.status(400).json({ success: false, message: 'positionType must be LONG or SHORT' });

    if (+quantity <= 0 || +entryPrice <= 0)
      return res.status(400).json({ success: false, message: 'quantity and entryPrice must be positive' });

    const [stock, user] = await Promise.all([
      Stock.findOne({ symbol: symbol.toUpperCase() }),
      User.findById(req.user.userId)
    ]);

    if (!stock) return res.status(404).json({ success: false, message: 'Stock not found' });

    // ✅ Leverage-aware margin calculation
    // marginUsed = notional / leverage (same logic as Order.calculateMargin)
    const notional       = +quantity * +entryPrice;
    const leverage       = user.marginEnabled && user.marginMultiplier > 1
      ? user.marginMultiplier : 1;
    const marginUsed     = parseFloat((notional / leverage).toFixed(2));
    const requiredMargin = marginUsed; // only this much is blocked from wallet

    if (!user.hasEnoughMargin(requiredMargin))
      return res.status(400).json({
        success: false,
        message: 'Insufficient margin',
        required: requiredMargin,
        available: user.availableMargin
      });

    const pos = new Position({
      userId:           req.user.userId,
      symbol:           symbol.toUpperCase(),
      companyName:      stock.companyName,
      positionType,
      quantity:         +quantity,
      entryPrice:       +entryPrice,
      currentPrice:     stock.currentPrice || +entryPrice,
      investmentValue:  notional,
      currentValue:     +quantity * (stock.currentPrice || +entryPrice),
      // ✅ marginUsed = notional/leverage so liquidationPrice calculates correctly
      marginUsed:       marginUsed,
      // ✅ marginMultiplier saved on position (needed by calcLiquidationPrice)
      marginMultiplier: leverage,
      isActive:         true,
      isOpen:           true,
      entryDate:        new Date()
    });

    // Set SL/TP via model method (validates direction)
    if (stopLoss || takeProfit) {
      try {
        pos.setSLTP({ stopLoss, takeProfit });
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
    }

    await pos.save();  // pre-save hook calculates liquidationPrice correctly

    // ✅ useMargin: both usedMargin++ and availableBalance-- 
    user.useMargin(marginUsed);
    await user.save();

    syncSingleUserToFirebase(user._id.toString()).catch(console.error);

    res.json({
      success: true,
      message: 'Position opened successfully',
      data: pos
    });

  } catch (e) {
    console.error('Open position error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/positions/close/:id  — manually close a position
// ─────────────────────────────────────────────────────────────────────────────
router.post('/close/:id', auth, async (req, res) => {
  try {
    const { exitPrice } = req.body;

    const pos = await Position.findOne({
      _id: req.params.id,
      userId: req.user.userId,
      isActive: true
    });
    if (!pos) return res.status(404).json({ success: false, message: 'Active position not found' });

    const user  = await User.findById(req.user.userId);
    const stock = await Stock.findOne({ symbol: pos.symbol });
    const price = exitPrice
      ? parseFloat(exitPrice)
      : (stock ? stock.currentPrice : pos.currentPrice);

    const exitBrok = user.calculateBrokerage
      ? user.calculateBrokerage(pos.quantity * price, pos.quantity)
      : 0;

    const marginToRelease = pos.marginUsed || 0;  // save before close()
    pos.close(price, exitBrok, 'MANUAL');
    await pos.save();  // pre-save hook runs → pnl, pnlPercentage updated

    // ✅ releaseMargin: usedMargin-- AND availableBalance++ (margin unblock)
    user.releaseMargin(marginToRelease);
    // ✅ PnL reflect in balance (profit add, loss deduct)
    user.availableBalance   += pos.realizedPnL;
    user.availableBalance   -= exitBrok;
    user.totalPnL            = (user.totalPnL || 0) + pos.realizedPnL;
    user.todayPnL            = (user.todayPnL || 0) + pos.realizedPnL;
    user.totalBrokeragePaid  = (user.totalBrokeragePaid || 0) + exitBrok;
    await user.save();

    syncSingleUserToFirebase(user._id.toString()).catch(console.error);

    res.json({
      success: true,
      message: 'Position closed successfully',
      data: {
        position:         pos,
        exitPrice:        price,
        realizedPnL:      parseFloat(pos.realizedPnL.toFixed(2)),
        settlementAmount: parseFloat((price * pos.quantity - exitBrok).toFixed(2))
      },
      userBalance: {
        availableBalance: user.availableBalance,
        usedMargin:       user.usedMargin,
        totalPnL:         user.totalPnL
      }
    });
  } catch (e) {
    console.error('Close position error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/positions/:id/sltp  — set / update Stop Loss and Take Profit
//
// Body: { stopLoss: 1580, takeProfit: 1820 }
// Either field is optional — send only what you want to update
// Send null to remove: { stopLoss: null } removes SL
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/sltp', auth, async (req, res) => {
  try {
    const { stopLoss, takeProfit } = req.body;

    if (stopLoss === undefined && takeProfit === undefined)
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of: stopLoss, takeProfit'
      });

    const pos = await Position.findOne({
      _id: req.params.id,
      userId: req.user.userId,
      isActive: true
    });
    if (!pos) return res.status(404).json({ success: false, message: 'Active position not found' });

    // null = remove, number = set/update
    if (stopLoss === null) {
      pos.stopLoss = null;
    } else if (stopLoss !== undefined) {
      // Validate
      if (pos.positionType === 'LONG' && +stopLoss >= pos.entryPrice)
        return res.status(400).json({ success: false, message: 'Stop Loss for LONG must be below entry price' });
      if (pos.positionType === 'SHORT' && +stopLoss <= pos.entryPrice)
        return res.status(400).json({ success: false, message: 'Stop Loss for SHORT must be above entry price' });
      pos.stopLoss = parseFloat(stopLoss);
    }

    if (takeProfit === null) {
      pos.takeProfit = null;
      pos.target     = null;
    } else if (takeProfit !== undefined) {
      if (pos.positionType === 'LONG' && +takeProfit <= pos.entryPrice)
        return res.status(400).json({ success: false, message: 'Take Profit for LONG must be above entry price' });
      if (pos.positionType === 'SHORT' && +takeProfit >= pos.entryPrice)
        return res.status(400).json({ success: false, message: 'Take Profit for SHORT must be below entry price' });
      pos.takeProfit = parseFloat(takeProfit);
      pos.target     = pos.takeProfit; // keep alias in sync
    }

    await pos.save();

    // Push updated SL/TP to Firebase immediately
    syncSingleUserToFirebase(req.user.userId.toString()).catch(console.error);

    res.json({
      success: true,
      message: 'Stop Loss / Take Profit updated',
      data: {
        positionId:  pos._id,
        symbol:      pos.symbol,
        positionType:pos.positionType,
        entryPrice:  pos.entryPrice,
        stopLoss:    pos.stopLoss   || null,
        takeProfit:  pos.takeProfit || null,
        target:      pos.target     || null,
        // Distance from current price
        slDistance:  pos.stopLoss
          ? parseFloat(Math.abs(pos.currentPrice - pos.stopLoss).toFixed(2))
          : null,
        tpDistance: (pos.takeProfit || pos.target)
          ? parseFloat(Math.abs(pos.currentPrice - (pos.takeProfit || pos.target)).toFixed(2))
          : null,
      }
    });
  } catch (e) {
    console.error('Update SL/TP error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/positions/:id/targets  — LEGACY alias (kept for backward compat)
// Same as /sltp but uses { stopLoss, target } field names
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/targets', auth, async (req, res) => {
  // Remap 'target' → 'takeProfit' and forward to /sltp logic
  const { stopLoss, target, takeProfit } = req.body;
  req.body.takeProfit = takeProfit ?? target; // prefer takeProfit, fallback to target
  req.params.id = req.params.id;

  // Reuse the same handler inline
  try {
    const sl  = req.body.stopLoss !== undefined ? req.body.stopLoss : stopLoss;
    const tp  = req.body.takeProfit;

    if (sl === undefined && tp === undefined)
      return res.status(400).json({ success: false, message: 'Provide stopLoss or target/takeProfit' });

    const pos = await Position.findOne({
      _id: req.params.id,
      userId: req.user.userId,
      isActive: true
    });
    if (!pos) return res.status(404).json({ success: false, message: 'Active position not found' });

    if (sl !== undefined) {
      if (sl === null) { pos.stopLoss = null; }
      else {
        if (pos.positionType === 'LONG'  && +sl >= pos.entryPrice)
          return res.status(400).json({ success: false, message: 'Stop Loss for LONG must be below entry price' });
        if (pos.positionType === 'SHORT' && +sl <= pos.entryPrice)
          return res.status(400).json({ success: false, message: 'Stop Loss for SHORT must be above entry price' });
        pos.stopLoss = parseFloat(sl);
      }
    }

    if (tp !== undefined) {
      if (tp === null) { pos.takeProfit = null; pos.target = null; }
      else {
        if (pos.positionType === 'LONG'  && +tp <= pos.entryPrice)
          return res.status(400).json({ success: false, message: 'Take Profit for LONG must be above entry price' });
        if (pos.positionType === 'SHORT' && +tp >= pos.entryPrice)
          return res.status(400).json({ success: false, message: 'Take Profit for SHORT must be below entry price' });
        pos.takeProfit = parseFloat(tp);
        pos.target     = pos.takeProfit;
      }
    }

    await pos.save();
    syncSingleUserToFirebase(req.user.userId.toString()).catch(console.error);

    res.json({ success: true, message: 'Position updated', data: pos });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/positions/:id  — delete a CLOSED position from history
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const pos = await Position.findOne({
      _id: req.params.id,
      userId: req.user.userId,
      isActive: false
    });
    if (!pos) return res.status(404).json({ success: false, message: 'Closed position not found' });

    await pos.deleteOne();
    res.json({ success: true, message: 'Position deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;