// models/User.js - UPDATED WITH MARGIN & BROKERAGE
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  fullName: {
    type: String,
    required: true
  },
  clientId: {
    type: String,
    unique: true
  },
  
  // BALANCE & MARGIN SYSTEM
  availableBalance: {
    type: Number,
    default: 0
  },
  marginAllowed: {
    type: Number,
    default: 0,
    comment: 'Fixed margin amount (optional)'
  },
  marginMultiplier: {
    type: Number,
    default: 1,
    min: 1,
    max: 10,
    comment: 'Margin multiplier (1x to 10x)'
  },
  usedMargin: {
    type: Number,
    default: 0,
    comment: 'Currently used margin for open positions'
  },
  marginEnabled: {
    type: Boolean,
    default: true
  },
  
  // BROKERAGE SYSTEM - NEW
  brokeragePercentage: {
    type: Number,
    default: 0.05,
    min: 0,
    max: 5,
    comment: 'Brokerage percentage per trade (e.g., 0.05 = 0.05%)'
  },
  totalBrokeragePaid: {
    type: Number,
    default: 0,
    comment: 'Total brokerage paid till date'
  },
  
  // P&L TRACKING
  totalPnL: {
    type: Number,
    default: 0
  },
  todayPnL: {
    type: Number,
    default: 0
  },
  lastPnLReset: {
    type: Date,
    default: Date.now
  },
  maxLossPerDay: {
    type: Number,
    default: 0,
    comment: 'Max loss allowed per day (0 = no limit)'
  },
  
  portfolioValue: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// VIRTUALS - Calculate total and available margin
userSchema.virtual('totalMargin').get(function() {
  if (!this.marginEnabled) return this.availableBalance;
  
  if (this.marginMultiplier > 1) {
    return this.availableBalance * this.marginMultiplier;
  }
  return this.availableBalance + this.marginAllowed;
});

userSchema.virtual('availableMargin').get(function() {
  const total = this.marginEnabled ? 
    (this.marginMultiplier > 1 ? 
      this.availableBalance * this.marginMultiplier : 
      this.availableBalance + this.marginAllowed
    ) : this.availableBalance;
  
  return Math.max(0, total - this.usedMargin);
});

userSchema.virtual('marginUtilization').get(function() {
  const total = this.marginEnabled ? 
    (this.marginMultiplier > 1 ? 
      this.availableBalance * this.marginMultiplier : 
      this.availableBalance + this.marginAllowed
    ) : this.availableBalance;
  
  return total > 0 ? (this.usedMargin / total * 100) : 0;
});
userSchema.methods.calculateBrokerage = function(orderValue, quantity = 1) {
  if (this.brokerageType === 'FLAT') {
    return this.flatBrokerage;
  } else if (this.brokerageType === 'PER_ORDER') {
    return this.flatBrokerage * quantity;
  } else {
    // PERCENTAGE
    return (orderValue * this.brokeragePercentage) / 100;
  }
};
// Include virtuals in JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// METHODS
userSchema.methods.hasEnoughMargin = function(requiredAmount) {
  return this.availableBalance >= requiredAmount;
};

userSchema.methods.useMargin = function(amount) {
  // usedMargin track karo (for display)
  this.usedMargin += amount;
  // ✅ availableBalance se bhi deduct karo (actual money block)
  this.availableBalance = Math.max(0, this.availableBalance - amount);
};

userSchema.methods.releaseMargin = function(amount) {
  // usedMargin kam karo
  this.usedMargin = Math.max(0, this.usedMargin - amount);
  // ✅ availableBalance wapas add karo (money unblock)
  this.availableBalance += amount;
};

userSchema.methods.addBrokerage = function(amount) {
  this.totalBrokeragePaid += amount;
  this.availableBalance -= amount;
};

userSchema.methods.resetDailyPnL = function() {
  const today = new Date().setHours(0, 0, 0, 0);
  const lastReset = new Date(this.lastPnLReset).setHours(0, 0, 0, 0);
  
  if (today > lastReset) {
    this.todayPnL = 0;
    this.lastPnLReset = new Date();
  }
};

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate Client ID
userSchema.pre('save', function(next) {
  if (!this.clientId) {
    this.clientId = 'CL' + Date.now() + Math.floor(Math.random() * 1000);
  }
  next();
});

module.exports = mongoose.model('User', userSchema);