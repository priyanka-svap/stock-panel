// models/Stock.js
const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  companyName: {
    type: String,
    required: true
  },
  exchange: {
    type: String,
    enum: ['NSE', 'BSE'],
    default: 'NSE'
  },
  currentPrice: {
    type: Number,
    required: true,
    min: 0
  },
  previousClose: {
    type: Number,
    default: 0
  },
  priceChange: {
    type: Number,
    default: 0
  },
  percentageChange: {
    type: Number,
    default: 0
  },
  dayHigh: {
    type: Number,
    default: 0
  },
  dayLow: {
    type: Number,
    default: 0
  },
  openPrice: {
    type: String,
   // default: 0
  },
  volume: {
    type: Number,
    default: 0
  },
  marketCap: {
    type: String
  },
  sector: {
    type: String
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for faster queries
stockSchema.index({ symbol: 1 });
stockSchema.index({ percentageChange: -1 });
stockSchema.index({ sector: 1 });

module.exports = mongoose.model('Stock', stockSchema);
