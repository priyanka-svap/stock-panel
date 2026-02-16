// middleware/firebaseSyncHooks.js - Auto-sync on data changes
const UserFirebaseService = require('../services/userFirebaseService');
const userFirebase = new UserFirebaseService();

// =====================================================
// WATCHLIST HOOKS
// =====================================================

async function onWatchlistChange(userId) {
    try {
        const Watchlist = require('../models/Watchlist');
        const watchlist = await Watchlist.find({ userId: userId }).lean();
        await userFirebase.syncUserWatchlist(userId.toString(), watchlist);
    } catch (error) {
        console.error('Watchlist sync hook error:', error.message);
    }
}

// =====================================================
// ORDER HOOKS
// =====================================================

async function onOrderChange(userId) {
    try {
        const Order = require('../models/Order');
        const orders = await Order.find({ userId: userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
            console.log(orders)
        await userFirebase.syncUserOrders(userId.toString(), orders);
    } catch (error) {
        console.error('Order sync hook error:', error.message);
    }
}

// =====================================================
// HOLDING HOOKS
// =====================================================

async function onHoldingChange(userId) {
    try {
        const Holding = require('../models/Holding');
        const Stock = require('../models/Stock');
        
        const holdings = await Holding.find({ userId: userId }).lean();
        
        // Get current prices
        const symbols = holdings.map(h => h.stockSymbol);
        const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();
        
        const priceMap = {};
        stocks.forEach(stock => {
            priceMap[stock.symbol] = stock.currentPrice;
        });
        
        const holdingsWithPrices = holdings.map(h => ({
            ...h,
            currentPrice: priceMap[h.stockSymbol] || h.averagePrice
        }));
        
        await userFirebase.syncUserHoldings(userId.toString(), holdingsWithPrices);
    } catch (error) {
        console.error('Holding sync hook error:', error.message);
    }
}

// =====================================================
// POSITION HOOKS
// =====================================================

async function onPositionChange(userId) {
    try {
        const Position = require('../models/Position');
        const Stock = require('../models/Stock');
        
        const positions = await Position.find({ 
            userId: userId,
            isActive: true 
        }).lean();
        
        // Get current prices
        const symbols = positions.map(p => p.symbol);
        const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();
        
        const priceMap = {};
        stocks.forEach(stock => {
            priceMap[stock.symbol] = stock.currentPrice;
        });
        
        const positionsWithPrices = positions.map(p => ({
            ...p,
            currentPrice: priceMap[p.symbol] || p.entryPrice
        }));
        
        await userFirebase.syncUserPositions(userId.toString(), positionsWithPrices);
    } catch (error) {
        console.error('Position sync hook error:', error.message);
    }
}

// =====================================================
// USER PROFILE HOOKS
// =====================================================

async function onUserProfileChange(userId) {
    try {
        const User = require('../models/User');
        const user = await User.findById(userId).lean();
        
        if (user) {
            await userFirebase.syncUserProfile(userId.toString(), user);
        }
    } catch (error) {
        console.error('Profile sync hook error:', error.message);
    }
}

// =====================================================
// EXPRESS MIDDLEWARE - Auto Sync After Route
// =====================================================

function autoSyncMiddleware(syncType) {
    return async (req, res, next) => {
        // Store original json method
        const originalJson = res.json;
        console.log(req)
        // Override json method
        res.json = function(data) {
            // Call original json
            originalJson.call(this, data);
            
            // Trigger sync in background (don't await)
            if (data.success && req.user && req.user.userId) {
                const userId = req.user.userId;
               
                switch(syncType) {
                    case 'watchlist':
                        onWatchlistChange(userId);
                        break;
                    case 'order':
                        onOrderChange(userId);
                        break;
                    case 'holding':
                        onHoldingChange(userId);
                        break;
                    case 'position':
                        onPositionChange(userId);
                        break;
                    case 'profile':
                        onUserProfileChange(userId);
                        break;
                }
            }
        };
        
        next();
    };
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    autoSyncMiddleware,
    onWatchlistChange,
    onOrderChange,
    onHoldingChange,
    onPositionChange,
    onUserProfileChange
};

// =====================================================
// USAGE IN ROUTES
// =====================================================

/*
const { autoSyncMiddleware } = require('../middleware/firebaseSyncHooks');

// In watchlist routes
router.post('/add', auth, autoSyncMiddleware('watchlist'), async (req, res) => {
    // Add to watchlist
    res.json({ success: true });
    // Firebase sync happens automatically!
});

// In order routes
router.post('/place', auth, autoSyncMiddleware('order'), async (req, res) => {
    // Place order
    res.json({ success: true });
    // Firebase sync happens automatically!
});

// In holdings routes
router.post('/buy', auth, autoSyncMiddleware('holding'), async (req, res) => {
    // Buy stock
    res.json({ success: true });
    // Firebase sync happens automatically!
});

// In positions routes
router.post('/open', auth, autoSyncMiddleware('position'), async (req, res) => {
    // Open position
    res.json({ success: true });
    // Firebase sync happens automatically!
});
*/
