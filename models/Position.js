// models/Position.js
const mongoose = require('mongoose');
const { getLiquidationPrice, MAINTENANCE_MARGIN_RATE } = require('../utils/marginCalculator');

const positionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // ── Stock / Contract details ──────────────────────────────────────────────
  symbol: {
    type: String,
    required: true,
    uppercase: true
  },
  companyName:    { type: String },
  tradingSymbol:  { type: String, uppercase: true },
  instrumentType: {
    type: String,
    enum: ['EQUITY', 'FUTIDX', 'FUTSTK', 'OPTIDX', 'OPTSTK', 'COMMODITY'],
    default: 'EQUITY'
  },
  contractType: {
    type: String,
    enum: ['SPOT', 'FUTURE', 'FUTURES', 'CE', 'PE'],
    default: 'SPOT'
  },
  expiryDate:  { type: Date },
  expiryMonth: { type: String, uppercase: true },
  strikePrice: { type: Number },
  lotSize:     { type: Number, default: 1 },

  // ── Position direction ────────────────────────────────────────────────────
  positionType: {
    type: String,
    enum: ['LONG', 'SHORT'],
    required: true
  },

  // ── Quantity & Prices ─────────────────────────────────────────────────────
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  entryPrice: {
    type: Number,
    required: true
  },
  currentPrice: {
    type: Number,
    required: true
  },
  exitPrice: {
    type: Number,
    default: null
  },

  // ── 🎯 STOP LOSS & TAKE PROFIT ────────────────────────────────────────────
  stopLoss: {
    type: Number,
    default: null,
    comment: 'SL price — auto-exit when price hits this'
  },
  takeProfit: {
    type: Number,
    default: null,
    comment: 'Target price — auto-exit when price hits this'
  },
  // Convenience alias used by some routes (maps to takeProfit)
  target: {
    type: Number,
    default: null
  },

  // SL/TP hit status (written by userDataSyncJob)
  stopLossTriggered:  { type: Boolean, default: false },
  takeProfitTriggered:{ type: Boolean, default: false },
  closeReason: {
    type: String,
    enum: ['STOP_LOSS', 'TARGET', 'LIQUIDATION', 'MANUAL', 'EXPIRY', null],
    default: null
  },

  // ── 💀 LIQUIDATION PRICE ──────────────────────────────────────────────────
  // Price at which margin is completely wiped → broker force-closes position
  // LONG:  liquidationPrice = entryPrice - (marginUsed / quantity)
  // SHORT: liquidationPrice = entryPrice + (marginUsed / quantity)
  // Updated on every save (when marginUsed or entryPrice changes)
  liquidationPrice: {
    type: Number,
    default: null,
    comment: 'Force-close price when margin = 0'
  },
  // % drop/rise from currentPrice to liquidation (updated by sync job)
  liquidationDistance: {
    type: Number,
    default: null,
    comment: '|currentPrice - liquidationPrice| / currentPrice * 100'
  },
  // Warning flags (set by sync job based on proximity to liquidation)
  liquidationRisk: {
    type: String,
    enum: ['safe', 'warning', 'danger', 'liquidated', null],
    default: null,
    comment: 'safe >5% | warning 2-5% | danger <2% | liquidated = hit'
  },
  isLiquidated: {
    type: Boolean,
    default: false,
    comment: 'true when force-closed due to margin exhaustion'
  },

  // ── Margin system ─────────────────────────────────────────────────────────
  marginUsed: {
    type: Number,
    default: 0,
    comment: 'Margin blocked for this position'
  },
  marginMultiplier: {
    type: Number,
    default: 1
  },

  // ── Brokerage ─────────────────────────────────────────────────────────────
  entryBrokerage: { type: Number, default: 0 },
  exitBrokerage:  { type: Number, default: 0 },
  totalBrokerage: { type: Number, default: 0 },

  // ── P&L ──────────────────────────────────────────────────────────────────
  investmentValue: {
    type: Number,
    required: true,
    comment: 'entryPrice × quantity (used as cost basis)'
  },
  currentValue: {
    type: Number,
    required: true,
    comment: 'currentPrice × quantity'
  },
  pnl: {
    type: Number,
    default: 0
  },
  pnlPercentage: {
    type: Number,
    default: 0
  },
  realizedPnL: {
    type: Number,
    default: 0
  },
  finalPnL: {
    type: Number,
    default: null,
    comment: 'Set on close — final P&L after all charges'
  },

  // ── Dates ─────────────────────────────────────────────────────────────────
  entryDate: { type: Date, default: Date.now },
  exitDate:  { type: Date, default: null },
  exitedAt:  { type: Date, default: null },   // alias written by sync job

  // ── Status ────────────────────────────────────────────────────────────────
  isActive: {
    type: Boolean,
    default: true,
    comment: 'true = open, false = closed'
  },
  isOpen: {
    type: Boolean,
    default: true,
    comment: 'Alias of isActive — for query compatibility'
  },

}, { timestamps: true });

// ─── Indexes ──────────────────────────────────────────────────────────────
positionSchema.index({ userId: 1, isActive: 1 });
positionSchema.index({ symbol: 1, isActive: 1 });
positionSchema.index({ stopLoss: 1, takeProfit: 1 }); // for SL/TP monitor queries
positionSchema.index({ liquidationPrice: 1, isActive: 1 }); // for liquidation monitor

// ─── Pre-save: sync alias fields + recalculate P&L ───────────────────────
positionSchema.pre('save', function(next) {
  // Keep target ↔ takeProfit in sync
  if (this.isModified('takeProfit') && this.takeProfit != null) {
    this.target = this.takeProfit;
  } else if (this.isModified('target') && this.target != null) {
    this.takeProfit = this.target;
  }

  // Keep isOpen ↔ isActive in sync
  if (this.isModified('isActive')) this.isOpen = this.isActive;
  if (this.isModified('isOpen'))   this.isActive = this.isOpen;

  // ── Liquidation price (cross-margin formula from marginCalculator) ─────────
  if (this.marginUsed > 0 && this.quantity > 0 && this.entryPrice > 0) {
    const liq = getLiquidationPrice(
      this.entryPrice,
      this.quantity,
      this.marginUsed,          // walletBalance = margin blocked for this position
      this.marginMultiplier || 1,
      this.positionType         // 'LONG' or 'SHORT'
    );
    this.liquidationPrice = liq > 0 ? parseFloat(liq.toFixed(2)) : null;
  }

  // Recalculate P&L if price or qty changed
  if (!this.isActive) return next(); // don't recalc on closed position

  this.currentValue = this.currentPrice * this.quantity;

  if (this.positionType === 'LONG') {
    const gross = this.currentValue - this.investmentValue;
    this.pnl    = gross - this.totalBrokerage;
  } else {
    const gross = this.investmentValue - this.currentValue;
    this.pnl    = gross - this.totalBrokerage;
  }

  if (this.investmentValue > 0) {
    this.pnlPercentage = (this.pnl / this.investmentValue) * 100;
  }

  // Liquidation distance from current price
  if (this.liquidationPrice && this.currentPrice > 0) {
    this.liquidationDistance = parseFloat(
      (Math.abs(this.currentPrice - this.liquidationPrice) / this.currentPrice * 100).toFixed(4)
    );
    // Risk level
    if (this.liquidationDistance <= 2)      this.liquidationRisk = 'danger';
    else if (this.liquidationDistance <= 5) this.liquidationRisk = 'warning';
    else                                    this.liquidationRisk = 'safe';
  }

  next();
});

// ─── Method: update live price + recalculate P&L ────────────────────────
positionSchema.methods.updatePrice = function(newPrice) {
  this.currentPrice = newPrice;
  this.currentValue = newPrice * this.quantity;

  if (this.positionType === 'LONG') {
    this.pnl = (this.currentValue - this.investmentValue) - this.totalBrokerage;
  } else {
    this.pnl = (this.investmentValue - this.currentValue) - this.totalBrokerage;
  }

  if (this.investmentValue > 0) {
    this.pnlPercentage = (this.pnl / this.investmentValue) * 100;
  }
};

// ─── Method: calculate liquidation price (cross-margin formula) ──────────
// Uses getLiquidationPrice from utils/marginCalculator.js
// walletBalance = this.marginUsed (margin blocked for this specific position)
positionSchema.methods.calculateLiquidationPrice = function() {
  if (!this.marginUsed || !this.quantity || !this.entryPrice) return null;
  const liq = getLiquidationPrice(
    this.entryPrice,
    this.quantity,
    this.marginUsed,
    this.marginMultiplier || 1,
    this.positionType
  );
  return liq > 0 ? parseFloat(liq.toFixed(2)) : null;
};

// ─── Method: set / update SL and Target ─────────────────────────────────
positionSchema.methods.setSLTP = function({ stopLoss, takeProfit } = {}) {
  if (stopLoss   != null) { this.stopLoss   = parseFloat(stopLoss);   }
  if (takeProfit != null) { this.takeProfit = parseFloat(takeProfit); this.target = this.takeProfit; }

  // Validate direction
  if (this.stopLoss != null && this.positionType === 'LONG' && this.stopLoss >= this.entryPrice)
    throw new Error('Stop Loss for LONG position must be below entry price');
  if (this.stopLoss != null && this.positionType === 'SHORT' && this.stopLoss <= this.entryPrice)
    throw new Error('Stop Loss for SHORT position must be above entry price');
  if (this.takeProfit != null && this.positionType === 'LONG' && this.takeProfit <= this.entryPrice)
    throw new Error('Take Profit for LONG position must be above entry price');
  if (this.takeProfit != null && this.positionType === 'SHORT' && this.takeProfit >= this.entryPrice)
    throw new Error('Take Profit for SHORT position must be below entry price');
};

// ─── Method: check if SL or Target is hit ───────────────────────────────
positionSchema.methods.checkSLTP = function(markPrice) {
  const sl     = this.stopLoss;
  const target = this.takeProfit || this.target;
  const isLong = this.positionType === 'LONG';

  if (isLong) {
    if (sl     && markPrice <= sl)     return 'sl_hit';
    if (target && markPrice >= target) return 'target_hit';
  } else {
    if (sl     && markPrice >= sl)     return 'sl_hit';
    if (target && markPrice <= target) return 'target_hit';
  }
  return null;
};

// ─── Method: close position ──────────────────────────────────────────────
positionSchema.methods.close = function(exitPrice, exitBrokerage = 0, reason = 'MANUAL') {
  exitPrice = parseFloat(exitPrice);

  this.exitPrice      = exitPrice;
  this.exitBrokerage  = exitBrokerage;
  this.totalBrokerage = (this.entryBrokerage || 0) + exitBrokerage;
  this.exitDate       = new Date();
  this.exitedAt       = new Date();
  this.isActive       = false;
  this.isOpen         = false;
  this.closeReason    = reason;
  if (reason === 'LIQUIDATION') this.isLiquidated = true;

  const exitValue = exitPrice * this.quantity;

  if (this.positionType === 'LONG') {
    const gross       = exitValue - this.investmentValue;
    this.realizedPnL  = gross - this.totalBrokerage;
  } else {
    const gross       = this.investmentValue - exitValue;
    this.realizedPnL  = gross - this.totalBrokerage;
  }

  this.pnl         = this.realizedPnL;
  this.finalPnL    = this.realizedPnL;
  this.currentValue = exitValue;

  if (this.investmentValue > 0) {
    this.pnlPercentage = (this.realizedPnL / this.investmentValue) * 100;
  }

  // Mark triggers
  if (reason === 'STOP_LOSS')  this.stopLossTriggered   = true;
  if (reason === 'TARGET')     this.takeProfitTriggered = true;
};

// ─── Virtuals ─────────────────────────────────────────────────────────────
positionSchema.virtual('slDistance').get(function() {
  if (!this.stopLoss || !this.currentPrice) return null;
  return Math.abs(this.currentPrice - this.stopLoss);
});

positionSchema.virtual('tpDistance').get(function() {
  const tp = this.takeProfit || this.target;
  if (!tp || !this.currentPrice) return null;
  return Math.abs(this.currentPrice - tp);
});

// ─── Trading-side value helpers (for UI) ────────────────────────────────────
// For LONG:  buy at entry, sell at mark/exit
// For SHORT: sell at entry, buy back at mark/exit
positionSchema.virtual('buyPrice').get(function() {
  return this.positionType === 'SHORT' ? (this.currentPrice ?? null) : (this.entryPrice ?? null);
});

positionSchema.virtual('sellPrice').get(function() {
  return this.positionType === 'SHORT' ? (this.entryPrice ?? null) : (this.currentPrice ?? null);
});

positionSchema.virtual('buyValue').get(function() {
  if (this.positionType === 'SHORT') return this.currentValue ?? null;
  return this.investmentValue ?? null;
});

positionSchema.virtual('sellValue').get(function() {
  if (this.positionType === 'SHORT') return this.investmentValue ?? null;
  return this.currentValue ?? null;
});

positionSchema.virtual('liquidationRiskLabel').get(function() {
  const risk = this.liquidationRisk;
  if (risk === 'danger')  return '🔴 Danger — Near Liquidation';
  if (risk === 'warning') return '🟡 Warning — Monitor Closely';
  if (risk === 'safe')    return '🟢 Safe';
  return null;
});

positionSchema.virtual('hasSL').get(function() {
  return !!(this.stopLoss && this.stopLoss > 0);
});

positionSchema.virtual('hasTP').get(function() {
  return !!((this.takeProfit || this.target) > 0);
});

positionSchema.set('toJSON',   { virtuals: true });
positionSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Position', positionSchema);