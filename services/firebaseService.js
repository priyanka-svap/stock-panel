const admin = require('firebase-admin');
const serviceAccount = require('../config/stockpanelapp-firebase-adminsdk-fbsvc-c95b35595f.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app"
});
const DATABASE_URL_FIREBASE = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

const db = admin.database();

async function updateStock(stockData) {
  await db.ref(`stocks/${stockData.symbol}`).set({
    symbol: stockData.symbol,
    companyName: stockData.companyName,
    currentPrice: stockData.currentPrice,
    priceChange: stockData.priceChange,
    percentageChange: stockData.percentageChange,
    dayHigh: stockData.dayHigh,
    dayLow: stockData.dayLow,
    volume: stockData.volume,
    lastUpdated: Date.now()
  });
}

async function updateIndex(indexData) {
  await db.ref(`indices/${indexData.name}`).set({
    name: indexData.name,
    displayName: indexData.displayName,
    value: indexData.value,
    change: indexData.change,
    percentageChange: indexData.percentageChange,
    dayHigh: indexData.dayHigh,
    dayLow: indexData.dayLow,
    lastUpdated: Date.now()
  });
}

async function updateFirebase(path, data) {
    try {
        const url = `${DATABASE_URL_FIREBASE}/${path}.json`;
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return true;
    } catch (error) {
        console.error(`Firebase update error (${path}):`, error.message);
        return false;
    }
}
module.exports = { updateStock, updateIndex,updateFirebase };