// models/Stock.js - Updated Stock Model with Futures Support & NaN Protection
const mongoose = require('mongoose');

// =====================================================
// HELPER FUNCTION - NaN Protection
// =====================================================
function sanitizeNumber(value, defaultValue = 0) {
  // Convert to number
  const num = Number(value);
  
  // Check if valid number
  if (num === null || num === undefined || isNaN(num) || !isFinite(num)) {
    return defaultValue;
  }
  
  return num;
}

const stockSchema = new mongoose.Schema({
  // Basic Information
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    index: true
  },
  companyName: {
    type: String,
    required: true
  },
  
  // Contract Information
  contractType: {
    type: String,
    enum: ['SPOT', 'FUTURE', 'OPTION'],
    default: 'SPOT',
    required: true,
    index: true
  },
  
  // Future Contract Specific Fields
  baseSymbol: {
    type: String,
    uppercase: true,
    index: true,
    // Required for FUTURE contracts, null for SPOT
    required: function() {
      return this.contractType === 'FUTURE';
    }
  },
  expiryDate: {
    type: Date,
    // Required for FUTURE contracts, null for SPOT
    required: function() {
      return this.contractType === 'FUTURE';
    },
    index: true
  },
  expiryString: {
    type: String,
    // Format: "JAN25", "FEB25", etc.
    required: function() {
      return this.contractType === 'FUTURE';
    }
  },
  lotSize: {
    type: Number,
    // Required for FUTURE contracts, null for SPOT
    required: function() {
      return this.contractType === 'FUTURE';
    },
    set: v => sanitizeNumber(v, 1)  // ✅ NaN protection
  },
  
  // Price Information
  currentPrice: {
    type: Number,
    required: true,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  openPrice: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  dayHigh: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  dayLow: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  previousClose: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  
  // Change Metrics
  priceChange: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  percentageChange: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  
  // Volume & Trading Data
  volume: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0)  // ✅ NaN protection
  },
  openInterest: {
    type: Number,
    default: 0,
    set: v => sanitizeNumber(v, 0),  // ✅ NaN protection
    // Particularly relevant for futures
  },
  
  // Additional Information
  sector: {
    type: String,
    default: 'Others'
  },
  industry: {
    type: String,
    default: 'Others'
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  // Timestamps
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// =====================================================
// INDEXES FOR PERFORMANCE
// =====================================================

// Compound index for efficient querying
stockSchema.index({ contractType: 1, isActive: 1 });
stockSchema.index({ baseSymbol: 1, contractType: 1 });
stockSchema.index({ contractType: 1, expiryDate: 1 });

// Text index for search functionality
stockSchema.index({ 
  symbol: 'text', 
  companyName: 'text',
  baseSymbol: 'text'
});

// =====================================================
// MIDDLEWARE - NaN VALIDATION
// =====================================================

// Pre-save middleware to ensure no NaN values
stockSchema.pre('save', function(next) {
  // List of all number fields to validate
  const numberFields = [
    'currentPrice', 'openPrice', 'dayHigh', 'dayLow', 'previousClose',
    'priceChange', 'percentageChange', 'volume', 'openInterest', 'lotSize'
  ];
  
  // Sanitize each field
  numberFields.forEach(field => {
    if (this[field] !== undefined && this[field] !== null) {
      this[field] = sanitizeNumber(this[field], 0);
    }
  });
  
  next();
});

// Pre-update middleware to ensure no NaN values
stockSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  // Handle $set operations
  if (update.$set) {
    const numberFields = [
      'currentPrice', 'openPrice', 'dayHigh', 'dayLow', 'previousClose',
      'priceChange', 'percentageChange', 'volume', 'openInterest', 'lotSize'
    ];
    
    numberFields.forEach(field => {
      if (update.$set[field] !== undefined && update.$set[field] !== null) {
        update.$set[field] = sanitizeNumber(update.$set[field], 0);
      }
    });
  }
  
  next();
});

// Pre-update middleware for updateOne/updateMany
stockSchema.pre('updateOne', function(next) {
  const update = this.getUpdate();
  
  if (update.$set) {
    const numberFields = [
      'currentPrice', 'openPrice', 'dayHigh', 'dayLow', 'previousClose',
      'priceChange', 'percentageChange', 'volume', 'openInterest', 'lotSize'
    ];
    
    numberFields.forEach(field => {
      if (update.$set[field] !== undefined && update.$set[field] !== null) {
        update.$set[field] = sanitizeNumber(update.$set[field], 0);
      }
    });
  }
  
  next();
});

stockSchema.pre('updateMany', function(next) {
  const update = this.getUpdate();
  
  if (update.$set) {
    const numberFields = [
      'currentPrice', 'openPrice', 'dayHigh', 'dayLow', 'previousClose',
      'priceChange', 'percentageChange', 'volume', 'openInterest', 'lotSize'
    ];
    
    numberFields.forEach(field => {
      if (update.$set[field] !== undefined && update.$set[field] !== null) {
        update.$set[field] = sanitizeNumber(update.$set[field], 0);
      }
    });
  }
  
  next();
});

// =====================================================
// VALIDATION MIDDLEWARE
// =====================================================

// Pre-save middleware to validate future contract data
stockSchema.pre('save', function(next) {
  if (this.contractType === 'FUTURE') {
    // Ensure baseSymbol exists
    if (!this.baseSymbol) {
      return next(new Error('baseSymbol is required for FUTURE contracts'));
    }
    
    // Ensure expiryDate exists
    if (!this.expiryDate) {
      return next(new Error('expiryDate is required for FUTURE contracts'));
    }
    
    // Ensure lotSize exists and is valid
    if (!this.lotSize || this.lotSize <= 0) {
      return next(new Error('Valid lotSize is required for FUTURE contracts'));
    }
  }
  
  next();
});

// Pre-save middleware to update lastUpdated
stockSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

// =====================================================
// METHODS
// =====================================================

// Instance method to check if contract is expired
stockSchema.methods.isExpired = function() {
  if (this.contractType !== 'FUTURE') {
    return false;
  }
  return this.expiryDate < new Date();
};

// Instance method to get days until expiry
stockSchema.methods.daysUntilExpiry = function() {
  if (this.contractType !== 'FUTURE') {
    return null;
  }
  const today = new Date();
  const diffTime = this.expiryDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

// Static method to get all active spot stocks
stockSchema.statics.getSpotStocks = function() {
  return this.find({ contractType: 'SPOT', isActive: true });
};

// Static method to get active futures for a base symbol
stockSchema.statics.getFuturesBySymbol = function(baseSymbol) {
  return this.find({ 
    baseSymbol: baseSymbol,
    contractType: 'FUTURE',
    isActive: true,
    expiryDate: { $gte: new Date() }
  }).sort({ expiryDate: 1 });
};

// Static method to get current month futures
stockSchema.statics.getCurrentMonthFutures = function() {
  const today = new Date();
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  return this.find({
    contractType: 'FUTURE',
    isActive: true,
    expiryDate: { $gte: today, $lte: endOfMonth }
  });
};

// Static method to get next month futures
stockSchema.statics.getNextMonthFutures = function() {
  const today = new Date();
  const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const endOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  
  return this.find({
    contractType: 'FUTURE',
    isActive: true,
    expiryDate: { $gte: startOfNextMonth, $lte: endOfNextMonth }
  });
};

// Static method to deactivate expired contracts
stockSchema.statics.deactivateExpiredContracts = async function() {
  const result = await this.updateMany(
    {
      contractType: 'FUTURE',
      expiryDate: { $lt: new Date() },
      isActive: true
    },
    {
      $set: { isActive: false }
    }
  );
  
  return result;
};

// =====================================================
// VIRTUAL PROPERTIES
// =====================================================

// Virtual for display name
stockSchema.virtual('displayName').get(function() {
  if (this.contractType === 'FUTURE') {
    return `${this.baseSymbol} ${this.expiryString}`;
  }
  return this.symbol;
});

// Virtual for contract display string
stockSchema.virtual('contractDisplay').get(function() {
  if (this.contractType === 'FUTURE') {
    return `FUT ${this.expiryString}`;
  }
  return 'SPOT';
});

// Virtual for total contract value (for futures)
stockSchema.virtual('contractValue').get(function() {
  if (this.contractType === 'FUTURE') {
    return sanitizeNumber(this.currentPrice * this.lotSize, 0);
  }
  return sanitizeNumber(this.currentPrice, 0);
});

// =====================================================
// EXPORT MODEL
// =====================================================

module.exports = mongoose.model('Stock', stockSchema);