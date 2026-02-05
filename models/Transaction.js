// models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['DEPOSIT', 'WITHDRAWAL', 'TRADING'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  method: {
    type: String,
    enum: ['UPI', 'BANK_TRANSFER', 'CARD', 'NET_BANKING', 'TRADING'],
    default: 'UPI'
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED'],
    default: 'COMPLETED'
  },
  description: {
    type: String
  },
  referenceId: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes
transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
