// models/Order.js - WITH STOP-LOSS & TAKE-PROFIT CALCULATION

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // ===================================
  // STOCK/CONTRACT DETAILS
  // ===================================
  symbol: {
    type: String,
    required: true,
    uppercase: true
  },
  companyName: {
    type: String,
    required: true
  },
  
  // ===================================
  // F&O / EXPIRY TRADING FIELDS
  // ===================================
  tradingSymbol: {
    type: String,
    uppercase: true,
  },
  
  instrumentType: {
    type: String,
    enum: ['EQUITY', 'FUTIDX', 'FUTSTK', 'OPTIDX', 'OPTSTK', 'COMMODITY'],
    default: 'EQUITY',
    uppercase: true
  },
  
  contractType: {
    type: String,
    enum: ['SPOT', 'FUTURES', 'CE', 'PE'],
    default: 'SPOT'
  },
  
  expiryDate: {
    type: Date,
  },
  
  expiryMonth: {
    type: String,
    uppercase: true
  },
  
  strikePrice: {
    type: Number,
  },
  
  lotSize: {
    type: Number,
    default: 1,
  },
  
  // ===================================
  // ORDER DETAILS
  // ===================================
  orderType: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true,
    uppercase: true
  },
  
  orderMode: {
    type: String,
    enum: ['MARKET', 'LIMIT', 'SL', 'SL-M'],
    default: 'MARKET',
    uppercase: true
  },
  
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  
  price: {
    type: Number,
    required: true,
    min: 0
  },
  
  limitPrice: {
    type: Number,
  },
  
  // ===================================
  // 🎯 STOP-LOSS & TAKE-PROFIT
  // ===================================
  stopLoss: {
    type: Number,
    min: 0
  },
  
  takeProfit: {
    type: Number,
    min: 0
  },
  
  // Calculated fields
  stopLossAmount: {
    type: Number,
    default: 0,
    // Max loss if SL hits = (buyPrice - SL) * quantity
  },
  
  takeProfitAmount: {
    type: Number,
    default: 0,
    // Profit if TP hits = (TP - buyPrice) * quantity
  },
  
  stopLossPercent: {
    type: Number,
    default: 0,
    // SL as % from entry price
  },
  
  takeProfitPercent: {
    type: Number,
    default: 0,
    // TP as % from entry price
  },
  
  // Risk-Reward Ratio
  riskRewardRatio: {
    type: Number,
    default: 0,
    // TP amount / SL amount
  },
  
  // Stop-loss triggered status
  stopLossTriggered: {
    type: Boolean,
    default: false
  },
  
  takeProfitTriggered: {
    type: Boolean,
    default: false
  },
  
  // ===================================
  // 💰 MARGIN & CHARGES
  // ===================================
  totalAmount: {
    type: Number,
    required: true,
  },
  
  marginRequired: {
    type: Number,
    required: true,
  },
  
  marginUsed: {
    type: Number,
    default: 0,
  },
  
  marginPercent: {
    type: Number,
    default: 100,
  },
  
  brokerage: {
    type: Number,
    default: 0
  },
  
  brokeragePercent: {
    type: Number,
    default: 0
  },
  
  taxesAndCharges: {
    type: Number,
    default: 0
  },
  
  stampDuty: {
    type: Number,
    default: 0
  },
  
  transactionCharges: {
    type: Number,
    default: 0
  },
  
  gst: {
    type: Number,
    default: 0
  },
  
  netAmount: {
    type: Number,
    required: true
  },
  
  // ===================================
  // ORDER STATUS
  // ===================================
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'REJECTED', 'PARTIAL'],
    default: 'PENDING',
    uppercase: true
  },
  
  filledQuantity: {
    type: Number,
    default: 0
  },
  
  averagePrice: {
    type: Number,
    default: 0
  },
  
  executedAt: {
    type: Date
  },
  
  executedPrice: {
    type: Number,
    default: 0
  },
  
  cancelledAt: {
    type: Date
  },
  
  cancelReason: {
    type: String
  },
  
  rejectionReason: {
    type: String
  },
  
  positionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Position'
  }
  
}, {
  timestamps: true
});

// ===================================
// INDEXES
// ===================================
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ symbol: 1 });
orderSchema.index({ tradingSymbol: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ instrumentType: 1 });
orderSchema.index({ expiryDate: 1 });
orderSchema.index({ stopLoss: 1, takeProfit: 1 }); // For SL/TP monitoring

// ===================================
// VIRTUALS
// ===================================
orderSchema.virtual('isFOOrder').get(function() {
  return this.instrumentType !== 'EQUITY';
});

orderSchema.virtual('isExpired').get(function() {
  if (!this.expiryDate) return false;
  return new Date() > new Date(this.expiryDate);
});

orderSchema.virtual('hasStopLoss').get(function() {
  return this.stopLoss && this.stopLoss > 0;
});

orderSchema.virtual('hasTakeProfit').get(function() {
  return this.takeProfit && this.takeProfit > 0;
});

// ===================================
// METHODS
// ===================================

// 🎯 Calculate Stop-Loss & Take-Profit
orderSchema.methods.calculateSLTP = function() {
  const entryPrice = this.price;
  const qty = this.quantity;
  
  // Calculate Stop-Loss
  if (this.stopLoss && this.stopLoss > 0) {
    if (this.orderType === 'BUY') {
      // For BUY orders: SL should be below entry price
      if (this.stopLoss >= entryPrice) {
        throw new Error('Stop-Loss for BUY order must be below entry price');
      }
      
      this.stopLossAmount = (entryPrice - this.stopLoss) * qty;
      this.stopLossPercent = ((entryPrice - this.stopLoss) / entryPrice) * 100;
      
    } else {
      // For SELL orders: SL should be above entry price
      if (this.stopLoss <= entryPrice) {
        throw new Error('Stop-Loss for SELL order must be above entry price');
      }
      
      this.stopLossAmount = (this.stopLoss - entryPrice) * qty;
      this.stopLossPercent = ((this.stopLoss - entryPrice) / entryPrice) * 100;
    }
  }
  
  // Calculate Take-Profit
  if (this.takeProfit && this.takeProfit > 0) {
    if (this.orderType === 'BUY') {
      // For BUY orders: TP should be above entry price
      if (this.takeProfit <= entryPrice) {
        throw new Error('Take-Profit for BUY order must be above entry price');
      }
      
      this.takeProfitAmount = (this.takeProfit - entryPrice) * qty;
      this.takeProfitPercent = ((this.takeProfit - entryPrice) / entryPrice) * 100;
      
    } else {
      // For SELL orders: TP should be below entry price
      if (this.takeProfit >= entryPrice) {
        throw new Error('Take-Profit for SELL order must be below entry price');
      }
      
      this.takeProfitAmount = (entryPrice - this.takeProfit) * qty;
      this.takeProfitPercent = ((entryPrice - this.takeProfit) / entryPrice) * 100;
    }
  }
  
  // Calculate Risk-Reward Ratio
  if (this.stopLossAmount > 0 && this.takeProfitAmount > 0) {
    this.riskRewardRatio = this.takeProfitAmount / this.stopLossAmount;
  }
  
  return {
    stopLoss: this.stopLoss,
    stopLossAmount: this.stopLossAmount,
    stopLossPercent: this.stopLossPercent,
    takeProfit: this.takeProfit,
    takeProfitAmount: this.takeProfitAmount,
    takeProfitPercent: this.takeProfitPercent,
    riskRewardRatio: this.riskRewardRatio
  };
};

// Check if SL or TP should trigger
orderSchema.methods.checkSLTP = function(currentPrice) {
  if (!this.status === 'COMPLETED') return { triggered: false };
  
  const triggers = {
    stopLossHit: false,
    takeProfitHit: false,
    action: null,
    exitPrice: null
  };
  
  if (this.orderType === 'BUY') {
    // Check Stop-Loss (price fell below SL)
    if (this.stopLoss && currentPrice <= this.stopLoss) {
      triggers.stopLossHit = true;
      triggers.action = 'SELL';
      triggers.exitPrice = this.stopLoss;
    }
    
    // Check Take-Profit (price rose above TP)
    if (this.takeProfit && currentPrice >= this.takeProfit) {
      triggers.takeProfitHit = true;
      triggers.action = 'SELL';
      triggers.exitPrice = this.takeProfit;
    }
    
  } else {
    // SELL order
    // Check Stop-Loss (price rose above SL)
    if (this.stopLoss && currentPrice >= this.stopLoss) {
      triggers.stopLossHit = true;
      triggers.action = 'BUY';
      triggers.exitPrice = this.stopLoss;
    }
    
    // Check Take-Profit (price fell below TP)
    if (this.takeProfit && currentPrice <= this.takeProfit) {
      triggers.takeProfitHit = true;
      triggers.action = 'BUY';
      triggers.exitPrice = this.takeProfit;
    }
  }
  
  triggers.triggered = triggers.stopLossHit || triggers.takeProfitHit;
  
  return triggers;
};

// Calculate all charges
orderSchema.methods.calculateCharges = function(user) {
  // 1. Brokerage
  this.brokerage = user.calculateBrokerage(this.totalAmount, this.quantity);
  this.brokeragePercent = user.brokeragePercentage;
  
  // 2. GST on brokerage (18%)
  this.gst = this.brokerage * 0.18;
  
  // 3. Transaction charges
  if (this.instrumentType === 'EQUITY') {
    this.transactionCharges = this.totalAmount * 0.0000325;
  } else {
    this.transactionCharges = this.totalAmount * 0.00005;
  }
  
  // 4. Stamp duty
  if (this.orderType === 'BUY') {
    this.stampDuty = this.totalAmount * 0.00015;
  } else {
    this.stampDuty = this.totalAmount * 0.00003;
  }
  
  // 5. Total taxes and charges
  this.taxesAndCharges = this.gst + this.transactionCharges + this.stampDuty;
  
  // 6. Net amount
  this.netAmount = this.marginRequired + this.brokerage + this.taxesAndCharges;
  
  return {
    brokerage: this.brokerage,
    gst: this.gst,
    transactionCharges: this.transactionCharges,
    stampDuty: this.stampDuty,
    taxesAndCharges: this.taxesAndCharges,
    marginRequired: this.marginRequired,
    netAmount: this.netAmount
  };
};

// Calculate margin required
orderSchema.methods.calculateMargin = function(user) {
  const contractValue = this.quantity * this.price;
  this.totalAmount = contractValue;
  
  let marginPercent = 100;
  
  if (user.marginEnabled && user.marginMultiplier > 1) {
    marginPercent = (100 / user.marginMultiplier);
  }
  
  if (this.instrumentType === 'EQUITY') {
    this.marginPercent = marginPercent;
    this.marginRequired = contractValue * (marginPercent / 100);
    
  } else if (this.contractType === 'FUTURES') {
    this.marginPercent = marginPercent;
    this.marginRequired = contractValue * (marginPercent / 100);
    
  } else if (this.contractType === 'CE' || this.contractType === 'PE') {
    if (this.orderType === 'BUY') {
      this.marginPercent = 100;
      this.marginRequired = contractValue;
    } else {
      this.marginPercent = marginPercent;
      this.marginRequired = contractValue *(marginPercent / 100);
    }
  }
  
  this.marginUsed = this.marginRequired;
  
  return this.marginRequired;
};

// ===================================
// MIDDLEWARE
// ===================================

// Pre-save hook - Calculate SL/TP
orderSchema.pre('save', function(next) {
  // Auto-calculate total amount
  if (this.isNew || this.isModified('price') || this.isModified('quantity')) {
    this.totalAmount = this.quantity * this.price;
  }
  
  // Calculate SL/TP if provided
  if (this.isNew || this.isModified('stopLoss') || this.isModified('takeProfit')) {
    try {
      if (this.stopLoss || this.takeProfit) {
        this.calculateSLTP();
      }
    } catch (error) {
      return next(error);
    }
  }
  
  next();
});

// Ensure virtuals in JSON
orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Order', orderSchema);