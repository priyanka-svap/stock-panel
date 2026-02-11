// services/firebaseRealtimeService.js - FIXED (No Admin SDK needed for frontend-only approach)
const Stock = require('../models/Stock');
const Index = require('../models/Index');

class FirebaseRealtimeService {
  constructor() {
    this.initialized = false;
    this.updateIntervals = new Map();

    // Firebase REST API Configuration
    this.firebaseConfig = {
      databaseURL: "https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app"
    };

    // Configuration
    this.config = {
      STOCK_UPDATE_MS: 1000,     // Update stocks every 1 second
      INDEX_UPDATE_MS: 2000,     // Update indices every 2 seconds
      BATCH_SIZE: 50             // Update 50 stocks at a time
    };

    console.log('✅ Firebase REST API initialized');
    this.initialized = true;
  }

  // ============================================
  // UPDATE FIREBASE VIA REST API
  // ============================================

  async updateFirebase(path, data) {
    try {
      const url = `${this.firebaseConfig.databaseURL}/${path}.json`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error(`Error updating Firebase ${path}:`, error.message);
      return false;
    }
  }

  // ============================================
  // BATCH UPDATE FIREBASE
  // ============================================

  async batchUpdateFirebase(updates) {
    try {
      const url = `${this.firebaseConfig.databaseURL}/.json`;

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error('Batch update error:', error.message);
      return false;
    }
  }

  // ============================================
  // START REAL-TIME UPDATES
  // ============================================

  start() {
    console.log('▶️  Starting Firebase Real-time Updates (REST API)...');

    // Start stock updates
    this.startStockUpdates();

    // Start index updates
    this.startIndexUpdates();

    console.log('✅ Firebase Real-time service started');
  }

  // ============================================
  // STOCK UPDATES (Every 1 second)
  // ============================================

  startStockUpdates() {
    const updateStocks = async () => {
      if (!this.isMarketOpen()) return;

      try {
        // Get active stocks
        const stocks = await Stock.find({ isActive: true })
          .limit(this.config.BATCH_SIZE)
          .lean();

        if (stocks.length === 0) return;

        // Prepare batch update
        const updates = {};

        stocks.forEach(stock => {
          const stockData = {
            symbol: stock.symbol,
            companyName: stock.companyName,
            currentPrice: stock.currentPrice || 0,
            percentageChange: stock.percentageChange || 0,
            priceChange: stock.priceChange || 0,
            dayHigh: stock.dayHigh || 0,
            dayLow: stock.dayLow || 0,
            openPrice: stock.openPrice || 0,
            volume: stock.volume || 0,
            lastUpdated: Date.now()
          };

          updates[`stocks/${stock.symbol}`] = stockData;
        });

        // Batch write to Firebase via REST API
        const success = await this.batchUpdateFirebase(updates);

        if (success) {
          console.log(`📊 Updated ${stocks.length} stocks in Firebase`);
        }

      } catch (error) {
        console.error('❌ Stock update error:', error.message);
      }
    };

    // Initial update
    updateStocks();

    // Run every 1 second
    const intervalId = setInterval(updateStocks, this.config.STOCK_UPDATE_MS);
    this.updateIntervals.set('stocks', intervalId);

    console.log(`📈 Stock updates: every ${this.config.STOCK_UPDATE_MS}ms`);
  }

  // ============================================
  // INDEX UPDATES (Every 2 seconds)
  // ============================================

  startIndexUpdates() {
    const updateIndices = async () => {
      if (!this.isMarketOpen()) return;

      try {
        const indices = await Index.find({}).lean();

        if (indices.length === 0) return;

        const updates = {};

        indices.forEach(index => {
          const indexData = {
            name: index.name,
            displayName: index.displayName,
            value: index.value || 0,
            percentageChange: index.percentageChange || 0,
            change: index.change || 0,
            dayHigh: index.dayHigh || 0,
            dayLow: index.dayLow || 0,
            openValue: index.openValue || 0,
            lastUpdated: Date.now()
          };

          updates[`indices/${index.name}`] = indexData;
        });

        const success = await this.batchUpdateFirebase(updates);

        if (success) {
          console.log(`📉 Updated ${indices.length} indices in Firebase`);
        }

      } catch (error) {
        console.error('❌ Index update error:', error.message);
      }
    };

    // Initial update
    updateIndices();

    // Run every 2 seconds
    const intervalId = setInterval(updateIndices, this.config.INDEX_UPDATE_MS);
    this.updateIntervals.set('indices', intervalId);

    console.log(`📊 Index updates: every ${this.config.INDEX_UPDATE_MS}ms`);
  }

  // ============================================
  // UPDATE SINGLE STOCK
  // ============================================

  async updateSingleStock(symbol) {
    try {
      const stock = await Stock.findOne({ symbol: symbol.toUpperCase() }).lean();

      if (!stock) {
        console.error(`Stock ${symbol} not found`);
        return false;
      }

      const stockData = {
        symbol: stock.symbol,
        companyName: stock.companyName,
        currentPrice: stock.currentPrice || 0,
        percentageChange: stock.percentageChange || 0,
        priceChange: stock.priceChange || 0,
        dayHigh: stock.dayHigh || 0,
        dayLow: stock.dayLow || 0,
        openPrice: stock.openPrice || 0,
        volume: stock.volume || 0,
        lastUpdated: Date.now()
      };

      const success = await this.updateFirebase(`stocks/${stock.symbol}`, stockData);

      if (success) {
        console.log(`✓ Updated ${symbol} in Firebase`);
      }

      return success;

    } catch (error) {
      console.error(`Error updating ${symbol}:`, error.message);
      return false;
    }
  }

  // ============================================
  // UPDATE SINGLE INDEX
  // ============================================

  async updateSingleIndex(indexName) {
    try {
      const index = await Index.findOne({ name: indexName.toUpperCase() }).lean();

      if (!index) {
        console.error(`Index ${indexName} not found`);
        return false;
      }

      const indexData = {
        name: index.name,
        displayName: index.displayName,
        value: index.value || 0,
        percentageChange: index.percentageChange || 0,
        change: index.change || 0,
        dayHigh: index.dayHigh || 0,
        dayLow: index.dayLow || 0,
        openValue: index.openValue || 0,
        lastUpdated: Date.now()
      };

      const success = await this.updateFirebase(`indices/${index.name}`, indexData);

      if (success) {
        console.log(`✓ Updated ${indexName} in Firebase`);
      }

      return success;

    } catch (error) {
      console.error(`Error updating ${indexName}:`, error.message);
      return false;
    }
  }

  // ============================================
  // MARKET HOURS CHECK
  // ============================================

  isMarketOpen() {
    const now = new Date();
    const istOffset = 5.5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = utcMinutes + istOffset;
    const hours = Math.floor(istMinutes / 60) % 24;
    const minutes = istMinutes % 60;
    const currentTime = hours * 60 + minutes;

    const marketOpen = 9 * 60 + 15;   // 9:15 AM
    const marketClose = 15 * 60 + 30; // 3:30 PM
    const day = now.getDay();
    const isWeekday = day >= 1 && day <= 5;

    return isWeekday && currentTime >= marketOpen && currentTime <= marketClose;
  }

  // ============================================
  // STOP UPDATES
  // ============================================

  stop() {
    this.updateIntervals.forEach((intervalId, key) => {
      clearInterval(intervalId);
      console.log(`⏹️  Stopped ${key} updates`);
    });

    this.updateIntervals.clear();
    console.log('✅ Firebase Real-time service stopped');
  }

  // ============================================
  // FORCE REFRESH ALL
  // ============================================

  async forceRefreshAll() {
    console.log('🔄 Force refreshing all data...');

    try {
      const [stocks, indices] = await Promise.all([
        Stock.find({ isActive: true }).lean(),
        Index.find({}).lean()
      ]);

      const updates = {};

      // Add stocks
      stocks.forEach(stock => {
        updates[`stocks/${stock.symbol}`] = {
          symbol: stock.symbol,
          companyName: stock.companyName,
          currentPrice: stock.currentPrice || 0,
          percentageChange: stock.percentageChange || 0,
          priceChange: stock.priceChange || 0,
          dayHigh: stock.dayHigh || 0,
          dayLow: stock.dayLow || 0,
          openPrice: stock.openPrice || 0,
          volume: stock.volume || 0,
          lastUpdated: Date.now()
        };
      });

      // Add indices
      indices.forEach(index => {
        updates[`indices/${index.name}`] = {
          name: index.name,
          displayName: index.displayName,
          value: index.value || 0,
          percentageChange: index.percentageChange || 0,
          change: index.change || 0,
          dayHigh: index.dayHigh || 0,
          dayLow: index.dayLow || 0,
          openValue: index.openValue || 0,
          lastUpdated: Date.now()
        };
      });

      const success = await this.batchUpdateFirebase(updates);

      if (success) {
        console.log(`✅ Refreshed ${stocks.length} stocks and ${indices.length} indices`);
      }

    } catch (error) {
      console.error('❌ Force refresh error:', error.message);
    }
  }
}

module.exports = FirebaseRealtimeService;
