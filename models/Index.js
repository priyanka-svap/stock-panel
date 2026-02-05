// models/Index.js
const mongoose = require('mongoose');

const indexSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  displayName: {
    type: String,
    required: true
  },
  value: {
    type: Number,
    required: true
  },
  previousClose: {
    type: Number,
    default: 0
  },
  change: {
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
  openValue: {
    type: String,
   // default: 0
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

indexSchema.index({ name: 1 });

module.exports = mongoose.model('Index', indexSchema);
