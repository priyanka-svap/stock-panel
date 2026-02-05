// models/Holding.js
const mongoose = require('mongoose');

const holdingSchema = new mongoose.Schema({
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
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  avgPrice: {
    type: Number,
    required: true,
    min: 0
  },
  currentPrice: {
    type: Number,
    required: true,
    min: 0
  },
  investedValue: {
    type: Number,
    required: true
  },
  currentValue: {
    type: Number,
    required: true
  },
  totalPnL: {
    type: Number,
    default: 0
  },
  pnlPercentage: {
    type: Number,
    default: 0
  },
  exchange: {
    type: String,
    enum: ['NSE', 'BSE'],
    default: 'NSE'
  },
  purchaseDate: {
    type: Date,
    default: Date.now
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

holdingSchema.index({ userId: 1 });
holdingSchema.index({ symbol: 1 });

module.exports = mongoose.model('Holding', holdingSchema);
