// models/Order.js
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
    required: true
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
  orderMode: {
    type: String,
    enum: ['Market', 'Limit', 'SL', 'SL-M'],
    default: 'Market'
  },
  stopLoss: {
    type: Number,
    default: null
  },
  takeProfit: {
    type: Number,
    default: null
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'REJECTED'],
    default: 'PENDING'
  },
  totalAmount: {
    type: Number,
    required: true
  },
  brokerage: {
    type: Number,
    default: 20
  },
  taxesAndCharges: {
    type: Number,
    default: 15.50
  },
  netAmount: {
    type: Number,
    required: true
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

// Indexes
orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ symbol: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
