// models/Position.js - UPDATED FOR MARGIN SYSTEM
const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true
  },
  positionType: {
    type: String,
    enum: ['LONG', 'SHORT'],
    required: true
  },
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
  
  // MARGIN SYSTEM - NEW
  marginUsed: {
    type: Number,
    required: true,
    comment: 'Margin blocked for this position'
  },
  marginMultiplier: {
    type: Number,
    default: 1,
    comment: 'Margin multiplier when position opened'
  },
  
  // BROKERAGE SYSTEM - NEW
  entryBrokerage: {
    type: Number,
    default: 0,
    comment: 'Brokerage paid at entry'
  },
  exitBrokerage: {
    type: Number,
    default: 0,
    comment: 'Brokerage paid at exit'
  },
  totalBrokerage: {
    type: Number,
    default: 0,
    comment: 'Total brokerage for this position'
  },
  
  // P&L CALCULATION
  investmentValue: {
    type: Number,
    required: true,
    comment: 'Entry price * quantity + entry brokerage'
  },
  currentValue: {
    type: Number,
    required: true,
    comment: 'Current price * quantity'
  },
  pnl: {
    type: Number,
    default: 0,
    comment: 'Current P&L (includes brokerage)'
  },
  pnlPercentage: {
    type: Number,
    default: 0
  },
  realizedPnL: {
    type: Number,
    default: 0,
    comment: 'P&L after closing position'
  },
  
  // DATES
  entryDate: {
    type: Date,
    default: Date.now
  },
  exitDate: {
    type: Date
  },
  
  // EXPIRY (for F&O)
  hasExpiry: {
    type: Boolean,
    default: false
  },
  expiryDate: {
    type: Date
  },
  expiryMonth: {
    type: String
  },
  expiryYear: {
    type: Number
  },
  
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Calculate P&L before saving
positionSchema.pre('save', function(next) {
  // Update current value
  this.currentValue = this.currentPrice * this.quantity;
  
  // Calculate P&L based on position type
  if (this.positionType === 'LONG') {
    // LONG: Profit when price goes up
    const grossPnL = this.currentValue - this.investmentValue;
    this.pnl = grossPnL - this.totalBrokerage;
  } else {
    // SHORT: Profit when price goes down
    const grossPnL = this.investmentValue - this.currentValue;
    this.pnl = grossPnL - this.totalBrokerage;
  }
  
  // Calculate percentage
  if (this.investmentValue > 0) {
    this.pnlPercentage = (this.pnl / this.investmentValue) * 100;
  }
  
  next();
});

// Method to update current price and recalculate P&L
positionSchema.methods.updatePrice = function(newPrice) {
  this.currentPrice = newPrice;
  this.currentValue = this.currentPrice * this.quantity;
  
  if (this.positionType === 'LONG') {
    const grossPnL = this.currentValue - this.investmentValue;
    this.pnl = grossPnL - this.totalBrokerage;
  } else {
    const grossPnL = this.investmentValue - this.currentValue;
    this.pnl = grossPnL - this.totalBrokerage;
  }
  
  if (this.investmentValue > 0) {
    this.pnlPercentage = (this.pnl / this.investmentValue) * 100;
  }
};

// Method to close position
positionSchema.methods.close = function(exitPrice, exitBrokerage) {
  this.currentPrice = exitPrice;
  this.exitBrokerage = exitBrokerage;
  this.totalBrokerage = this.entryBrokerage + this.exitBrokerage;
  this.exitDate = new Date();
  this.isActive = false;
  
  // Calculate final realized P&L
  this.currentValue = exitPrice * this.quantity;
  
  if (this.positionType === 'LONG') {
    const grossPnL = this.currentValue - this.investmentValue;
    this.realizedPnL = grossPnL - this.totalBrokerage;
  } else {
    const grossPnL = this.investmentValue - this.currentValue;
    this.realizedPnL = grossPnL - this.totalBrokerage;
  }
  
  this.pnl = this.realizedPnL;
  
  if (this.investmentValue > 0) {
    this.pnlPercentage = (this.realizedPnL / this.investmentValue) * 100;
  }
};

module.exports = mongoose.model('Position', positionSchema);