// models/Stock.js - Updated MongoDB Stock Model with Market Depth Support

const mongoose = require('mongoose');

const marketDepthItemSchema = new mongoose.Schema({
    price: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },
    orders: { type: Number, default: 0 }
}, { _id: false });

const quoteschema = new mongoose.Schema({
    // Basic Info
    symbol: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true
    },
    companyName: {
        type: String,
        trim: true
    },
    
    // Price Data
    currentPrice: {
        type: Number,
        default: 0,
        min: 0
    },
    openPrice: {
        type: Number,
        default: 0,
        min: 0
    },
    dayHigh: {
        type: Number,
        default: 0,
        min: 0
    },
    dayLow: {
        type: Number,
        default: 0,
        min: 0
    },
    previousClose: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Change Data
    priceChange: {
        type: Number,
        default: 0
    },
    percentageChange: {
        type: Number,
        default: 0
    },
    
    // Volume Data
    volume: {
        type: Number,
        default: 0,
        min: 0
    },
    totalBuyQuantity: {
        type: Number,
        default: 0,
        min: 0
    },
    totalSellQuantity: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Market Depth - Best Prices
    bestBid: {
        type: Number,
        default: 0,
        min: 0
    },
    bestAsk: {
        type: Number,
        default: 0,
        min: 0
    },
    spread: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Market Depth - Bid/Ask Arrays
    bidDepth: {
        type: [marketDepthItemSchema],
        default: []
    },
    askDepth: {
        type: [marketDepthItemSchema],
        default: []
    },
    
    // Company Info (Optional)
    sector: {
        type: String,
        default: 'Unknown'
    },
    industry: {
        type: String,
        default: 'Unknown'
    },
    marketCap: {
        type: Number,
        default: 0,
        min: 0
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
        default: Date.now,
        index: true
    }
}, {
    timestamps: true,
    collection: 'quotes'
});

// =====================================================
// INDEXES
// =====================================================

quoteschema.index({ symbol: 1, isActive: 1 });
quoteschema.index({ percentageChange: -1 });
quoteschema.index({ volume: -1 });
quoteschema.index({ lastUpdated: -1 });

// =====================================================
// VIRTUAL FIELDS
// =====================================================

quoteschema.virtual('isGainer').get(function() {
    return this.percentageChange > 0;
});

quoteschema.virtual('isLoser').get(function() {
    return this.percentageChange < 0;
});

quoteschema.virtual('displayPrice').get(function() {
    return `₹${this.currentPrice.toFixed(2)}`;
});

quoteschema.virtual('displayChange').get(function() {
    const sign = this.percentageChange >= 0 ? '+' : '';
    return `${sign}${this.percentageChange.toFixed(2)}%`;
});

// =====================================================
// STATIC METHODS
// =====================================================

// Get top gainers
quoteschema.statics.getTopGainers = function(limit = 10) {
    return this.find({ 
        isActive: true,
        percentageChange: { $gt: 0 }
    })
    .sort({ percentageChange: -1 })
    .limit(limit)
    .lean();
};

// Get top losers
quoteschema.statics.getTopLosers = function(limit = 10) {
    return this.find({ 
        isActive: true,
        percentageChange: { $lt: 0 }
    })
    .sort({ percentageChange: 1 })
    .limit(limit)
    .lean();
};

// Get most active by volume
quoteschema.statics.getMostActive = function(limit = 10) {
    return this.find({ isActive: true })
        .sort({ volume: -1 })
        .limit(limit)
        .lean();
};

// Get quotes with high spread (good for trading)
quoteschema.statics.getHighSpread = function(minSpread = 1, limit = 10) {
    return this.find({ 
        isActive: true,
        spread: { $gte: minSpread }
    })
    .sort({ spread: -1 })
    .limit(limit)
    .lean();
};

// Get market summary
quoteschema.statics.getMarketSummary = async function() {
    const quotes = await this.find({ isActive: true }).lean();
    
    const gainers = quotes.filter(s => s.percentageChange > 0).length;
    const losers = quotes.filter(s => s.percentageChange < 0).length;
    const unchanged = quotes.filter(s => s.percentageChange === 0).length;
    
    const avgChange = quotes.reduce((sum, s) => sum + s.percentageChange, 0) / quotes.length;
    const totalVolume = quotes.reduce((sum, s) => sum + s.volume, 0);
    
    return {
        total: quotes.length,
        gainers,
        losers,
        unchanged,
        avgChange: avgChange.toFixed(2),
        totalVolume,
        lastUpdated: new Date()
    };
};

// =====================================================
// INSTANCE METHODS
// =====================================================

// Get market depth summary
quoteschema.methods.getDepthSummary = function() {
    const totalBidQty = this.bidDepth.reduce((sum, bid) => sum + bid.quantity, 0);
    const totalAskQty = this.askDepth.reduce((sum, ask) => sum + ask.quantity, 0);
    
    return {
        symbol: this.symbol,
        bestBid: this.bestBid,
        bestAsk: this.bestAsk,
        spread: this.spread,
        totalBidQuantity: totalBidQty,
        totalAskQuantity: totalAskQty,
        bidLevels: this.bidDepth.length,
        askLevels: this.askDepth.length,
        buyPressure: totalBidQty / (totalBidQty + totalAskQty)
    };
};

// Check if stock is volatile
quoteschema.methods.isVolatile = function(threshold = 3) {
    return Math.abs(this.percentageChange) > threshold;
};

// Get price range percentage
quoteschema.methods.getPriceRangePercent = function() {
    if (!this.dayLow || !this.dayHigh) return 0;
    return ((this.dayHigh - this.dayLow) / this.dayLow * 100).toFixed(2);
};

// =====================================================
// MIDDLEWARE
// =====================================================

// Update lastUpdated before save
quoteschema.pre('save', function(next) {
    this.lastUpdated = new Date();
    next();
});

// =====================================================
// EXPORT MODEL
// =====================================================

const Quote = mongoose.model('Quote', quoteschema);

module.exports = Quote;
