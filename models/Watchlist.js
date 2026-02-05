// models/Watchlist.js
const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  stocks: [{
    symbol: {
      type: String,
      required: true,
      uppercase: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Index for faster queries
watchlistSchema.index({ userId: 1 });

module.exports = mongoose.model('Watchlist', watchlistSchema);
