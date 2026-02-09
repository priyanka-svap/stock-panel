// models/Order.js - CORRECTED VERSION

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
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
  companyName: {
    type: String,
    required: true
  },
  orderType: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true,
    uppercase: true
  },
  
  // ===================================
  // ORDER EXECUTION TYPE
  // ===================================
  orderMode: {
    type: String,
    enum: ['Market', 'Limit', 'SL', 'SL-M'],
    default: 'Market'
  },
  
  // ===================================
  // ✨ NEW: PRODUCT TYPE (DELIVERY/INTRADAY)
  // ===================================
  productType: {
    type: String,
    enum: ['DELIVERY', 'INTRADAY', 'CNC', 'MIS'],
    default: 'DELIVERY',
    uppercase: true
  },
  // Note: 
  // - DELIVERY/CNC = Long-term holding
  // - INTRADAY/MIS = Same-day trading
  
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
  stopLoss: {
    type: Number,
    min: 0
  },
  takeProfit: {
    type: Number,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  brokerage: {
    type: Number,
    default: 0
  },
  taxesAndCharges: {
    type: Number,
    default: 0
  },
  netAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'REJECTED'],
    default: 'PENDING',
    uppercase: true
  },
  executedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  cancelReason: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for faster queries
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ symbol: 1 });
orderSchema.index({ status: 1 });

module.exports = mongoose.model('Order', orderSchema);
