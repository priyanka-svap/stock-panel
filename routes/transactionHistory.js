// routes/transactionHistory.js
const express  = require('express');
const router   = express.Router();
const Order    = require('../models/Order');
const Position = require('../models/Position');
const auth     = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transactions/history
// User ki poori transaction history — BUY/SELL + P&L + Brokerage
//
// Query Params:
//   page       (default: 1)
//   limit      (default: 20)
//   type       BUY | SELL  (optional filter)
//   symbol     e.g. RELIANCE  (optional filter)
//   from       ISO date string  e.g. 2024-01-01
//   to         ISO date string  e.g. 2024-12-31
//   status     COMPLETED | CANCELLED | PENDING (default: COMPLETED)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', auth, async (req, res) => {
  try {
    const {
      page   = 1,
      limit  = 20,
      type,
      symbol,
      from,
      to,
      status = 'COMPLETED'
    } = req.query;

    // ── Build Order query ──────────────────────────────────────────────────
    const query = { userId: req.user.userId };

    if (status)              query.status    = status.toUpperCase();
    if (type)                query.orderType = type.toUpperCase();
    if (symbol)              query.symbol    = symbol.toUpperCase();
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)   query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    const skip = (+page - 1) * +limit;

    const [orders, total] = await Promise.all([
      Order.find(query)
           .sort({ createdAt: -1 })
           .skip(skip)
           .limit(+limit)
           .lean(),
      Order.countDocuments(query)
    ]);

    // ── Enrich each order with P&L (from linked Position) ─────────────────
    const positionIds = orders
      .map(o => o.positionId)
      .filter(Boolean);

    const positions = await Position.find({ _id: { $in: positionIds } }).lean();
    const posMap = {};
    positions.forEach(p => { posMap[p._id.toString()] = p; });

    const transactions = orders.map(order => {
      const pos = order.positionId ? posMap[order.positionId.toString()] : null;

      // ── Charges breakdown ───────────────────────────────────────────────
      const brokerage          = order.brokerage          || 0;
      const gst                = order.gst                || 0;
      const stampDuty          = order.stampDuty          || 0;
      const transactionCharges = order.transactionCharges || 0;
      const taxesAndCharges    = order.taxesAndCharges    || (gst + stampDuty + transactionCharges);
      const totalCharges       = brokerage + taxesAndCharges;

      // ── P&L (only meaningful for SELL / closed positions) ───────────────
      let realizedPnL   = null;
      let pnlPercent    = null;
      let profitOrLoss  = null;  // 'PROFIT' | 'LOSS' | 'BREAKEVEN'

      if (order.orderType === 'SELL' && pos) {
        realizedPnL  = pos.realizedPnL ?? null;
      } else if (order.orderType === 'SELL' && order.status === 'COMPLETED') {
        // Fallback: calculate from order data if position not linked
        const exitValue  = (order.executedPrice || order.price) * order.quantity;
        // entryPrice not always on order; best-effort only
        realizedPnL = null;
      }

      if (realizedPnL !== null) {
        pnlPercent   = pos?.entryPrice
          ? +((realizedPnL / (pos.entryPrice * order.quantity)) * 100).toFixed(2)
          : null;
        profitOrLoss = realizedPnL > 0 ? 'PROFIT' : realizedPnL < 0 ? 'LOSS' : 'BREAKEVEN';
      }

      return {
        // ── Order basics ────────────────────────────────────────────────
        transactionId:    order._id,
        orderId:          order._id,
        date:             order.executedAt || order.createdAt,
        symbol:           order.symbol,
        companyName:      order.companyName,
        tradingSymbol:    order.tradingSymbol,
        instrumentType:   order.instrumentType,
        contractType:     order.contractType,
        expiryDate:       order.expiryDate    || null,
        strikePrice:      order.strikePrice   || null,

        // ── Trade details ───────────────────────────────────────────────
        orderType:        order.orderType,   // BUY | SELL
        orderMode:        order.orderMode,   // MARKET | LIMIT | SL | SL-M
        status:           order.status,
        quantity:         order.quantity,
        entryPrice:       order.price,
        executedPrice:    order.executedPrice || order.price,
        totalAmount:      order.totalAmount,

        // ── SL / TP ─────────────────────────────────────────────────────
        stopLoss:         order.stopLoss     || null,
        takeProfit:       order.takeProfit   || null,

        // ── Charges ─────────────────────────────────────────────────────
        charges: {
          brokerage,
          gst,
          stampDuty,
          transactionCharges,
          taxesAndCharges,
          totalCharges,
        },
        netAmount: order.netAmount || (order.totalAmount + totalCharges),

        // ── P&L (for SELL transactions) ─────────────────────────────────
        pnl: order.orderType === 'SELL' ? {
          realizedPnL:  realizedPnL,
          pnlPercent:   pnlPercent,
          profitOrLoss: profitOrLoss,
          // Position-level details if available
          entryPrice:   pos?.entryPrice   || null,
          exitPrice:    pos?.exitPrice    || order.executedPrice || null,
          holdingDays:  pos?.entryTime && pos?.exitTime
            ? Math.ceil((new Date(pos.exitTime) - new Date(pos.entryTime)) / 86400000)
            : null,
        } : null,

        // ── Position reference ───────────────────────────────────────────
        positionId: order.positionId || null,
        notes:      order.notes     || null,
      };
    });

    // ── Summary stats for the filtered range ─────────────────────────────
    const sellTxns   = transactions.filter(t => t.orderType === 'SELL' && t.pnl?.realizedPnL != null);
    const totalPnL   = sellTxns.reduce((sum, t) => sum + t.pnl.realizedPnL, 0);
    const totalBrok  = transactions.reduce((sum, t) => sum + t.charges.brokerage, 0);
    const totalChargesAll = transactions.reduce((sum, t) => sum + t.charges.totalCharges, 0);
    const profitCount = sellTxns.filter(t => t.pnl.realizedPnL > 0).length;
    const lossCount   = sellTxns.filter(t => t.pnl.realizedPnL < 0).length;

    res.json({
      success: true,
      summary: {
        totalTransactions: total,
        pageTransactions:  transactions.length,
        totalRealizedPnL:  +totalPnL.toFixed(2),
        totalBrokerage:    +totalBrok.toFixed(2),
        totalCharges:      +totalChargesAll.toFixed(2),
        profitTrades:      profitCount,
        lossTrades:        lossCount,
        winRate:           sellTxns.length
          ? +((profitCount / sellTxns.length) * 100).toFixed(2)
          : null,
      },
      data: transactions,
      pagination: {
        total,
        page:       +page,
        limit:      +limit,
        totalPages: Math.ceil(total / +limit),
      },
    });

  } catch (e) {
    console.error('❌ Transaction history error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transactions/summary
// Overall account P&L summary (all-time + today)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // All COMPLETED orders for this user
    const [allOrders, closedPositions] = await Promise.all([
      Order.find({ userId, status: 'COMPLETED' }).lean(),
      Position.find({ userId, isActive: false }).lean(),
    ]);

    // Today's boundary
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayOrders = allOrders.filter(o => new Date(o.createdAt) >= todayStart);

    // Brokerage totals
    const totalBrokerage = allOrders.reduce((s, o) => s + (o.brokerage || 0), 0);
    const todayBrokerage = todayOrders.reduce((s, o) => s + (o.brokerage || 0), 0);

    // P&L from closed positions
    const totalRealizedPnL = closedPositions.reduce((s, p) => s + (p.realizedPnL || 0), 0);
    const todayPnL = closedPositions
      .filter(p => new Date(p.exitTime || p.updatedAt) >= todayStart)
      .reduce((s, p) => s + (p.realizedPnL || 0), 0);

    // Buy / Sell counts
    const buyCount  = allOrders.filter(o => o.orderType === 'BUY').length;
    const sellCount = allOrders.filter(o => o.orderType === 'SELL').length;

    // Win rate
    const closedWithPnL = closedPositions.filter(p => p.realizedPnL != null);
    const winners       = closedWithPnL.filter(p => p.realizedPnL > 0).length;

    res.json({
      success: true,
      summary: {
        totalOrders:       allOrders.length,
        buyOrders:         buyCount,
        sellOrders:        sellCount,
        totalRealizedPnL:  +totalRealizedPnL.toFixed(2),
        todayPnL:          +todayPnL.toFixed(2),
        totalBrokerage:    +totalBrokerage.toFixed(2),
        todayBrokerage:    +todayBrokerage.toFixed(2),
        closedPositions:   closedPositions.length,
        winRate:           closedWithPnL.length
          ? +((winners / closedWithPnL.length) * 100).toFixed(2)
          : null,
      },
    });

  } catch (e) {
    console.error('❌ Transaction summary error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
