// jobs/userDataSyncJob.js - NESTED STRUCTURE: users/{userId}/orders/{orderId}
const User = require('../models/User');
const Watchlist = require('../models/Watchlist');
const Order = require('../models/Order');
const Holding = require('../models/Holding');
const Position = require('../models/Position');
const Stock = require('../models/Stock');

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

let syncInterval = null;

// =====================================================
// FIREBASE HELPER
// =====================================================

async function updateFirebase(path, data) {
    try {
        const url = `${FIREBASE_URL}/${path}.json`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
    } catch (error) {
        console.error(`Firebase error (${path}):`, error.message);
        return false;
    }
}

async function batchUpdateFirebase(updates) {
    try {
        const url = `${FIREBASE_URL}/.json`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
    } catch (error) {
        console.error('Firebase batch error:', error.message);
        return false;
    }
}

// =====================================================
// 🔥 SYNC ALL USERS WITH NESTED ORDERS
// =====================================================

async function syncAllUsersData() {
    try {
        const users = await User.find({ isActive: true }).lean();
        
        console.log(`🔄 Syncing ${users.length} users to Firebase...`);
        
        const firebaseUpdates = {};
        
        for (const user of users) {
            const userId = user._id.toString();
            
            // Get user's orders
            const orders = await Order.find({ userId: user._id })
                .sort({ createdAt: -1 })
                .limit(100)
                .lean();
            
            // Get positions
            const positions = await Position.find({ userId: user._id }).lean();
            
            // Get holdings
            const holdings = await Holding.find({ userId: user._id }).lean();
            
            // Get watchlist
            const watchlist = await Watchlist.find({ userId: user._id }).lean();
            
            // Update with current prices
            const positionsWithPrices = await updatePositionsPrices(positions);
            const holdingsWithPrices = await updateHoldingsPrices(holdings);
            
            // Calculate summaries
            const openPositions = positionsWithPrices.filter(p => p.isOpen);
            const totalPnL = openPositions.reduce((sum, p) => {
                const currentValue = p.quantity * (p.currentPrice || p.avgPrice);
                const investedValue = p.quantity * p.avgPrice;
                const pnl = p.type === 'BUY' ? currentValue - investedValue : investedValue - currentValue;
                return sum + pnl;
            }, 0);
            
            // 🔥 Firebase Structure: users/{userId}/...
            firebaseUpdates[`users/${userId}`] = {
                // Profile
                profile: {
                    userId: userId,
                    username: user.username,
                    fullName: user.fullName,
                    email: user.email,
                    clientId: user.clientId,
                    isActive: user.isActive,
                    createdAt: user.createdAt
                },
                
                // Balance & Margin
                balance: {
                    availableBalance: user.availableBalance || 0,
                    marginAllowed: user.marginAllowed || 0,
                    marginMultiplier: user.marginMultiplier || 1,
                    usedMargin: user.usedMargin || 0,
                    totalMargin: (user.availableBalance || 0) * (user.marginMultiplier || 1),
                    availableMargin: ((user.availableBalance || 0) * (user.marginMultiplier || 1)) - (user.usedMargin || 0),
                    brokeragePercentage: user.brokeragePercentage || 0.03
                },
                
                // P&L Summary
                pnl: {
                    totalPnL: user.totalPnL || 0,
                    todayPnL: user.todayPnL || 0,
                    unrealizedPnL: totalPnL,
                    openPositionsCount: openPositions.length
                },
                
                // 📊 ORDERS (nested)
                orders: formatOrders(orders),
                
                // 📊 POSITIONS (nested)
                positions: formatPositions(positionsWithPrices),
                
                // 📊 HOLDINGS (nested)
                holdings: formatHoldings(holdingsWithPrices),
                
                // 📊 WATCHLIST (nested)
                watchlist: formatWatchlist(watchlist),
                
                // Metadata
                lastSync: Date.now()
            };
        }
        
        // Batch update Firebase
        await batchUpdateFirebase(firebaseUpdates);
        
        console.log(`✅ Synced ${users.length} users to Firebase`);
        
    } catch (error) {
        console.error('❌ Sync error:', error.message);
    }
}

// =====================================================
// 📊 FORMAT ORDERS (with SL/TP)
// =====================================================

function formatOrders(orders) {
    if (!orders || orders.length === 0) return {};
    
    const formatted = {};
    
    orders.forEach(order => {
        const orderId = order._id.toString();
        
        formatted[orderId] = {
            // IDs
            orderId: orderId,
            positionId: order.positionId ? order.positionId.toString() : null,
            
            // Stock Details
            symbol: order.symbol,
            tradingSymbol: order.tradingSymbol || order.symbol,
            companyName: order.companyName,
            
            // Instrument Type
            instrumentType: order.instrumentType || 'EQUITY',
            contractType: order.contractType || 'SPOT',
            expiryDate: order.expiryDate || null,
            expiryMonth: order.expiryMonth || null,
            strikePrice: order.strikePrice || null,
            lotSize: order.lotSize || 1,
            
            // Order Details
            orderType: order.orderType,
            orderMode: order.orderMode || 'MARKET',
            quantity: order.quantity,
            price: order.price,
            limitPrice: order.limitPrice || null,
            totalAmount: order.totalAmount || (order.quantity * order.price),
            
            // 🎯 Stop-Loss & Take-Profit
            stopLoss: order.stopLoss || null,
            stopLossAmount: order.stopLossAmount || 0,
            stopLossPercent: order.stopLossPercent || 0,
            stopLossTriggered: order.stopLossTriggered || false,
            
            takeProfit: order.takeProfit || null,
            takeProfitAmount: order.takeProfitAmount || 0,
            takeProfitPercent: order.takeProfitPercent || 0,
            takeProfitTriggered: order.takeProfitTriggered || false,
            
            riskRewardRatio: order.riskRewardRatio || 0,
            
            // Charges & Margin
            marginRequired: order.marginRequired || 0,
            marginUsed: order.marginUsed || 0,
            marginPercent: order.marginPercent || 100,
            brokerage: order.brokerage || 0,
            brokeragePercent: order.brokeragePercent || 0,
            gst: order.gst || 0,
            transactionCharges: order.transactionCharges || 0,
            stampDuty: order.stampDuty || 0,
            taxesAndCharges: order.taxesAndCharges || 0,
            netAmount: order.netAmount || 0,
            
            // Status
            status: order.status,
            filledQuantity: order.filledQuantity || 0,
            averagePrice: order.averagePrice || 0,
            executedAt: order.executedAt || null,
            executedPrice: order.executedPrice || 0,
            
            // Cancel Info
            cancelledAt: order.cancelledAt || null,
            cancelReason: order.cancelReason || null,
            rejectionReason: order.rejectionReason || null,
            
            // Notes
            notes: order.notes || null,
            
            // Timestamps
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
        };
    });
    
    return formatted;
}

// =====================================================
// 📊 FORMAT POSITIONS (with SL/TP)
// =====================================================

function formatPositions(positions) {
    if (!positions || positions.length === 0) return {};
    
    const formatted = {};
    
    positions.forEach(position => {
        const positionId = position._id.toString();
        
        // Calculate P&L
        const currentPrice = position.currentPrice || position.avgPrice;
        const currentValue = position.quantity * currentPrice;
        const investedValue = position.quantity * position.avgPrice;
        const pnl = position.type === 'BUY' 
            ? currentValue - investedValue 
            : investedValue - currentValue;
        const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
        
        formatted[positionId] = {
            // IDs
            positionId: positionId,
            orderId: position.orderId ? position.orderId.toString() : null,
            
            // Stock Details
            symbol: position.symbol,
            tradingSymbol: position.tradingSymbol || position.symbol,
            companyName: position.companyName,
            
            // Instrument Type
            instrumentType: position.instrumentType || 'EQUITY',
            contractType: position.contractType || 'SPOT',
            expiryDate: position.expiryDate || null,
            expiryMonth: position.expiryMonth || null,
            strikePrice: position.strikePrice || null,
            lotSize: position.lotSize || 1,
            
            // Position Details
            type: position.type,
            quantity: position.quantity,
            avgPrice: position.avgPrice,
            currentPrice: currentPrice,
            
            // 🎯 Stop-Loss & Take-Profit
            stopLoss: position.stopLoss || null,
            takeProfit: position.takeProfit || null,
            
            // P&L
            pnl: pnl,
            pnlPercent: pnlPercent,
            netPnL: pnl - (position.totalBrokerage || 0) - (position.totalCharges || 0),
            realizedPnL: position.realizedPnL || 0,
            
            // Charges
            marginUsed: position.marginUsed || 0,
            marginPercent: position.marginPercent || 100,
            totalBrokerage: position.totalBrokerage || 0,
            exitBrokerage: position.exitBrokerage || 0,
            totalCharges: position.totalCharges || 0,
            
            // Status
            isOpen: position.isOpen !== undefined ? position.isOpen : true,
            exitPrice: position.exitPrice || null,
            exitedAt: position.exitedAt || null,
            
            // Timestamps
            createdAt: position.createdAt,
            updatedAt: position.updatedAt
        };
    });
    
    return formatted;
}

// =====================================================
// 📊 FORMAT HOLDINGS
// =====================================================

function formatHoldings(holdings) {
    if (!holdings || holdings.length === 0) return {};
    
    const formatted = {};
    
    holdings.forEach(holding => {
        const holdingId = holding._id.toString();
        
        // Calculate P&L
        const currentPrice = holding.currentPrice || holding.averagePrice;
        const currentValue = holding.quantity * currentPrice;
        const investedValue = holding.quantity * holding.averagePrice;
        const pnl = currentValue - investedValue;
        const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
        
        formatted[holdingId] = {
            holdingId: holdingId,
            symbol: holding.stockSymbol || holding.symbol,
            companyName: holding.companyName,
            
            quantity: holding.quantity,
            averagePrice: holding.averagePrice,
            currentPrice: currentPrice,
            
            investedValue: investedValue,
            currentValue: currentValue,
            pnl: pnl,
            pnlPercent: pnlPercent,
            
            createdAt: holding.createdAt,
            updatedAt: holding.updatedAt
        };
    });
    
    return formatted;
}

// =====================================================
// 📊 FORMAT WATCHLIST
// =====================================================

function formatWatchlist(watchlist) {
    if (!watchlist || watchlist.length === 0) return {};
    
    const formatted = {};
    
    watchlist.forEach(item => {
        const itemId = item._id.toString();
        
        formatted[itemId] = {
            watchlistId: itemId,
            symbol: item.symbol,
            addedAt: item.createdAt
        };
    });
    
    return formatted;
}

// =====================================================
// UPDATE PRICES
// =====================================================

async function updatePositionsPrices(positions) {
    try {
        if (!positions || positions.length === 0) return [];
        
        const symbols = positions.map(p => p.symbol);
        const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();
        
        const priceMap = {};
        stocks.forEach(stock => {
            priceMap[stock.symbol] = parseFloat(stock.currentPrice) || 0;
        });
        
        return positions.map(position => ({
            ...position,
            currentPrice: priceMap[position.symbol] || position.avgPrice || 0
        }));
    } catch (error) {
        console.error('Position prices error:', error.message);
        return positions;
    }
}

async function updateHoldingsPrices(holdings) {
    try {
        if (!holdings || holdings.length === 0) return [];
        
        const symbols = holdings.map(h => h.stockSymbol || h.symbol);
        const stocks = await Stock.find({ symbol: { $in: symbols } }).lean();
        
        const priceMap = {};
        stocks.forEach(stock => {
            priceMap[stock.symbol] = parseFloat(stock.currentPrice) || 0;
        });
        
        return holdings.map(holding => ({
            ...holding,
            currentPrice: priceMap[holding.stockSymbol || holding.symbol] || holding.averagePrice || 0
        }));
    } catch (error) {
        console.error('Holding prices error:', error.message);
        return holdings;
    }
}

// =====================================================
// 🔥 SYNC SINGLE USER
// =====================================================

async function syncSingleUserData(userId) {
    try {
        const user = await User.findById(userId).lean();
        if (!user) return false;
        
        const orders = await Order.find({ userId: userId })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        
        const positions = await Position.find({ userId: userId }).lean();
        const holdings = await Holding.find({ userId: userId }).lean();
        const watchlist = await Watchlist.find({ userId: userId }).lean();
        
        const positionsWithPrices = await updatePositionsPrices(positions);
        const holdingsWithPrices = await updateHoldingsPrices(holdings);
        
        const openPositions = positionsWithPrices.filter(p => p.isOpen);
        const totalPnL = openPositions.reduce((sum, p) => {
            const currentValue = p.quantity * (p.currentPrice || p.avgPrice);
            const investedValue = p.quantity * p.avgPrice;
            const pnl = p.type === 'BUY' ? currentValue - investedValue : investedValue - currentValue;
            return sum + pnl;
        }, 0);
        
        const userData = {
            profile: {
                userId: userId,
                username: user.username,
                fullName: user.fullName,
                email: user.email,
                clientId: user.clientId,
                isActive: user.isActive,
                createdAt: user.createdAt
            },
            
            balance: {
                availableBalance: user.availableBalance || 0,
                marginAllowed: user.marginAllowed || 0,
                marginMultiplier: user.marginMultiplier || 1,
                usedMargin: user.usedMargin || 0,
                totalMargin: (user.availableBalance || 0) * (user.marginMultiplier || 1),
                availableMargin: ((user.availableBalance || 0) * (user.marginMultiplier || 1)) - (user.usedMargin || 0),
                brokeragePercentage: user.brokeragePercentage || 0.03
            },
            
            pnl: {
                totalPnL: user.totalPnL || 0,
                todayPnL: user.todayPnL || 0,
                unrealizedPnL: totalPnL,
                openPositionsCount: openPositions.length
            },
            
            orders: formatOrders(orders),
            positions: formatPositions(positionsWithPrices),
            holdings: formatHoldings(holdingsWithPrices),
            watchlist: formatWatchlist(watchlist),
            
            lastSync: Date.now()
        };
        
        await updateFirebase(`users/${userId}`, userData);
        
        console.log(`✅ User ${userId} synced`);
        return true;
    } catch (error) {
        console.error(`❌ Sync error for ${userId}:`, error.message);
        return false;
    }
}

// =====================================================
// START/STOP
// =====================================================

function startUserDataSync(intervalSeconds = 5) {
    if (syncInterval) {
        console.log('⚠️ Sync already running');
        return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('🔥 USER DATA SYNC STARTED (NESTED STRUCTURE)');
    console.log('='.repeat(70));
    console.log(`⏱️  Interval: Every ${intervalSeconds} seconds`);
    console.log('📊 Structure: users/{userId}/orders/{orderId}');
    console.log('='.repeat(70) + '\n');
    
    syncAllUsersData();
    
    syncInterval = setInterval(() => {
        syncAllUsersData();
    }, intervalSeconds * 1000);
    
    console.log('✅ Sync job started\n');
}

function stopUserDataSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('\n🛑 Sync job stopped\n');
    }
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    startUserDataSync,
    stopUserDataSync,
    syncSingleUserData,
    syncAllUsersData
};