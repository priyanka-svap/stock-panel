// services/userFirebaseService.js - User Data Real-time Firebase Sync
const fetch = require('node-fetch');

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

class UserFirebaseService {
    constructor() {
        this.lastUpdate = {};
    }

    // =====================================================
    // SYNC USER WATCHLIST TO FIREBASE
    // =====================================================

    async syncUserWatchlist(userId, watchlistItems) {
        try {
            const path = `users/${userId}/watchlist`;

            // Format watchlist data
            const watchlistData = {};

            watchlistItems.forEach((item, index1) => {
                item.stocks.forEach((items, index) => {
                    watchlistData[items.symbol] = {
                        symbol: items.symbol,
                        addedAt: items.addedAt || Date.now(),
                        position: index,
                        lastUpdated: Date.now()
                    };
                })
            });

            const success = await this.updateFirebase(path, watchlistData);

            if (success) {
                console.log(`✅ Synced watchlist for user ${userId} (${watchlistItems.length} items)`);
            }

            return success;

        } catch (error) {
            console.error(`Firebase watchlist sync error for ${userId}:`, error.message);
            return false;
        }
    }

    // =====================================================
    // SYNC USER ORDERS TO FIREBASE
    // =====================================================

    async syncUserOrders(userId, orders) {
        try {
            const path = `users/${userId}/orders`;

            // Format orders data
            const ordersData = {};
            orders.forEach(order => {
                ordersData[order._id] = {
                    orderId: order._id.toString(),
                    symbol: order.symbol,
                    orderType: order.orderType, // BUY or SELL
                    quantity: order.quantity,
                    price: order.price,
                    status: order.status, // PENDING, EXECUTED, CANCELLED
                    orderDate: order.orderDate || order.createdAt,
                    executedPrice: order.executedPrice || null,
                    executedAt: order.executedAt || null,
                    lastUpdated: Date.now()
                };
            });
     
            const success = await this.updateFirebase(path, ordersData);

            if (success) {
                console.log(`✅ Synced orders for user ${userId} (${orders.length} orders)`);
            }

            return success;

        } catch (error) {
            console.error(`Firebase orders sync error for ${userId}:`, error.message);
            return false;
        }
    }

    // =====================================================
    // SYNC USER HOLDINGS TO FIREBASE
    // =====================================================

    async syncUserHoldings(userId, holdings) {
        try {
            const path = `users/${userId}/holdings`;

            // Format holdings data
            const holdingsData = {};
            holdings.forEach(holding => {
                const currentPrice = holding.currentPrice || 0;
                const avgPrice = holding.averagePrice || 0;
                const quantity = holding.quantity || 0;

                // Calculate P&L
                const investedValue = avgPrice * quantity;
                const currentValue = currentPrice * quantity;
                const pnl = currentValue - investedValue;
                const pnlPercentage = investedValue > 0 ? ((pnl / investedValue) * 100) : 0;

                holdingsData[holding.symbol] = {
                    symbol: holding.symbol,
                    quantity: quantity,
                    averagePrice: avgPrice,
                    currentPrice: currentPrice,
                    investedValue: investedValue,
                    currentValue: currentValue,
                    pnl: pnl,
                    pnlPercentage: pnlPercentage,
                    lastBuyDate: holding.purchaseDate || holding.createdAt,
                    lastUpdated: Date.now()
                };
            });

            const success = await this.updateFirebase(path, holdingsData);

            if (success) {
                console.log(`✅ Synced holdings for user ${userId} (${holdings.length} holdings)`);
            }

            return success;

        } catch (error) {
            console.error(`Firebase holdings sync error for ${userId}:`, error.message);
            return false;
        }
    }

    // =====================================================
    // SYNC USER POSITIONS TO FIREBASE
    // =====================================================

    async syncUserPositions(userId, positions) {
        try {
            const path = `users/${userId}/positions`;

            // Format positions data
            const positionsData = {};
            positions.forEach(position => {
                const entryPrice = position.entryPrice || 0;
                const currentPrice = position.currentPrice || 0;
                const quantity = position.quantity || 0;

                // Calculate P&L
                const pnl = (currentPrice - entryPrice) * quantity;
                const pnlPercentage = entryPrice > 0 ? (((currentPrice - entryPrice) / entryPrice) * 100) : 0;

                positionsData[position._id] = {
                    positionId: position._id.toString(),
                    symbol: position.symbol,
                    positionType: position.positionType, // LONG or SHORT
                    quantity: quantity,
                    entryPrice: entryPrice,
                    currentPrice: currentPrice,
                    pnl: pnl,
                    pnlPercentage: pnlPercentage,
                    entryDate: position.entryDate || position.createdAt,
                    isActive: position.isActive !== false,
                    lastUpdated: Date.now()
                };
            });

            const success = await this.updateFirebase(path, positionsData);

            if (success) {
                console.log(`✅ Synced positions for user ${userId} (${positions.length} positions)`);
            }

            return success;

        } catch (error) {
            console.error(`Firebase positions sync error for ${userId}:`, error.message);
            return false;
        }
    }

    // =====================================================
    // SYNC USER PROFILE TO FIREBASE
    // =====================================================

    async syncUserProfile(userId, userProfile) {
        try {
            const path = `users/${userId}/profile`;

            const profileData = {
                userId: userId,
                username: userProfile.username,
                fullName: userProfile.fullName,
                email: userProfile.email,
                clientId: userProfile.clientId,
                availableBalance: userProfile.availableBalance || 0,
                usedMargin: userProfile.usedMargin || 0,
                totalPnL: userProfile.totalPnL || 0,
                portfolioValue: userProfile.portfolioValue || 0,
                isActive: userProfile.isActive !== false,
                lastUpdated: Date.now()
            };

            const success = await this.updateFirebase(path, profileData);

            if (success) {
                console.log(`✅ Synced profile for user ${userId}`);
            }

            return success;

        } catch (error) {
            console.error(`Firebase profile sync error for ${userId}:`, error.message);
            return false;
        }
    }

    // =====================================================
    // SYNC ALL USER DATA (Complete Sync)
    // =====================================================

    async syncAllUserData(userId, data) {
        try {
            const results = {
                profile: false,
                watchlist: false,
                orders: false,
                holdings: false,
                positions: false
            };

            // Sync profile
            if (data.profile) {
                results.profile = await this.syncUserProfile(userId, data.profile);
            }

            // Sync watchlist
            if (data.watchlist && data.watchlist.length > 0) {
                results.watchlist = await this.syncUserWatchlist(userId, data.watchlist);
            }

            // Sync orders
            if (data.orders && data.orders.length > 0) {
                results.orders = await this.syncUserOrders(userId, data.orders);
            }

            // Sync holdings
            if (data.holdings && data.holdings.length > 0) {
                results.holdings = await this.syncUserHoldings(userId, data.holdings);
            }

            // Sync positions
            if (data.positions && data.positions.length > 0) {
                results.positions = await this.syncUserPositions(userId, data.positions);
            }

            return results;

        } catch (error) {
            console.error(`Firebase full sync error for ${userId}:`, error.message);
            return null;
        }
    }

    // =====================================================
    // DELETE USER DATA FROM FIREBASE
    // =====================================================

    async deleteUserData(userId) {
        try {
            const path = `users/${userId}`;
            const url = `${FIREBASE_URL}/${path}.json`;

            const response = await fetch(url, {
                method: 'DELETE'
            });

            if (response.ok) {
                console.log(`✅ Deleted Firebase data for user ${userId}`);
                return true;
            }

            return false;

        } catch (error) {
            console.error(`Firebase delete error for ${userId}:`, error.message);
            return false;
        }
    }

    // =====================================================
    // FIREBASE UPDATE FUNCTION (REST API)
    // =====================================================

    async updateFirebase(path, data) {
        try {
            const url = `${FIREBASE_URL}/${path}.json`;

            const response = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            return response.ok;

        } catch (error) {
            console.error(`Firebase update error (${path}):`, error.message);
            return false;
        }
    }

    // =====================================================
    // BATCH UPDATE (Multiple paths at once)
    // =====================================================

    async batchUpdateFirebase(updates) {
        try {
            const url = `${FIREBASE_URL}/.json`;

            const response = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            return response.ok;

        } catch (error) {
            console.error('Firebase batch update error:', error.message);
            return false;
        }
    }
}

module.exports = UserFirebaseService;

// =====================================================
// USAGE EXAMPLE
// =====================================================

/*
const UserFirebaseService = require('./services/userFirebaseService');
const userFirebase = new UserFirebaseService();

// Sync watchlist
await userFirebase.syncUserWatchlist(userId, watchlistItems);

// Sync orders
await userFirebase.syncUserOrders(userId, orders);

// Sync holdings
await userFirebase.syncUserHoldings(userId, holdings);

// Sync positions
await userFirebase.syncUserPositions(userId, positions);

// Sync all at once
await userFirebase.syncAllUserData(userId, {
    profile: userProfile,
    watchlist: watchlistItems,
    orders: orders,
    holdings: holdings,
    positions: positions
});
*/
