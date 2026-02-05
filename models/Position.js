// models/Position.js
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
  companyName: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  avgPrice: {
    type: Number,
    required: true
  },
  currentPrice: {
    type: Number,
    required: true
  },
  totalValue: {
    type: Number,
    required: true
  },
  pnl: {
    type: Number,
    default: 0
  },
  pnlPercentage: {
    type: Number,
    default: 0
  },
  dayChange: {
    type: Number,
    default: 0
  },
  isOpen: {
    type: Boolean,
    default: true
  },
  exitPrice: {
    type: Number
  },
  exitedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
positionSchema.index({ userId: 1, isOpen: 1 });
positionSchema.index({ symbol: 1 });

module.exports = mongoose.model('Position', positionSchema);
