// services/firebaseService.js
const admin = require('firebase-admin');
const serviceAccount = require('../config/firebase-service-account.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://console.firebase.google.com/project/stockpanelapp/database/stockpanelapp-default-rtdb/data/~2F"
});

const db = admin.database();

class FirebaseService {
  
  // Update single stock in Firebase
  async updateStock(stockData) {
    try {
      const stockRef = db.ref(`stocks/${stockData.symbol}`);
      await stockRef.set({
        symbol: stockData.symbol,
        companyName: stockData.companyName,
        currentPrice: stockData.currentPrice,
        previousClose: stockData.previousClose,
        priceChange: stockData.priceChange,
        percentageChange: stockData.percentageChange,
        dayHigh: stockData.dayHigh,
        dayLow: stockData.dayLow,
        openPrice: stockData.openPrice,
        volume: stockData.volume,
        marketCap: stockData.marketCap,
        sector: stockData.sector,
        lastUpdated: admin.database.ServerValue.TIMESTAMP
      });
      
      console.log(`🔥 Firebase: Updated ${stockData.symbol}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Firebase Error for ${stockData.symbol}:`, error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Update multiple stocks at once
  async updateMultipleStocks(stocksArray) {
    try {
      const updates = {};
      
      stocksArray.forEach(stock => {
        updates[`stocks/${stock.symbol}`] = {
          symbol: stock.symbol,
          companyName: stock.companyName,
          currentPrice: stock.currentPrice,
          previousClose: stock.previousClose,
          priceChange: stock.priceChange,
          percentageChange: stock.percentageChange,
          dayHigh: stock.dayHigh,
          dayLow: stock.dayLow,
          openPrice: stock.openPrice,
          volume: stock.volume,
          marketCap: stock.marketCap,
          sector: stock.sector,
          lastUpdated: admin.database.ServerValue.TIMESTAMP
        };
      });
      
      await db.ref().update(updates);
      console.log(`🔥 Firebase: Batch updated ${stocksArray.length} stocks`);
      return { success: true, count: stocksArray.length };
      
    } catch (error) {
      console.error('❌ Firebase Batch Update Error:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Update index in Firebase
  async updateIndex(indexData) {
    try {
      const indexRef = db.ref(`indices/${indexData.name}`);
      await indexRef.set({
        name: indexData.name,
        displayName: indexData.displayName,
        value: indexData.value,
        previousClose: indexData.previousClose,
        change: indexData.change,
        percentageChange: indexData.percentageChange,
        dayHigh: indexData.dayHigh,
        dayLow: indexData.dayLow,
        openValue: indexData.openValue,
        lastUpdated: admin.database.ServerValue.TIMESTAMP
      });
      
      console.log(`🔥 Firebase: Updated ${indexData.displayName}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Firebase Error for ${indexData.name}:`, error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Get all stocks
  async getAllStocks() {
    try {
      const snapshot = await db.ref('stocks').once('value');
      return snapshot.val() || {};
    } catch (error) {
      console.error('❌ Error fetching stocks:', error.message);
      return {};
    }
  }
  
  // Get specific stock
  async getStock(symbol) {
    try {
      const snapshot = await db.ref(`stocks/${symbol}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error(`❌ Error fetching ${symbol}:`, error.message);
      return null;
    }
  }
  
  // Delete stock
  async deleteStock(symbol) {
    try {
      await db.ref(`stocks/${symbol}`).remove();
      console.log(`🗑️ Deleted ${symbol} from Firebase`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Error deleting ${symbol}:`, error.message);
      return { success: false, error: error.message };
    }
  }
  
  // Get database reference (for custom operations)
  getRef(path) {
    return db.ref(path);
  }
}

module.exports = new FirebaseService();