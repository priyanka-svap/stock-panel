// jobs/marketUpdateJob.js
const cron = require('node-cron');
const { updateAllIndices, updateMultipleStocks } = require('../services/liveDataService');
const Stock = require('../models/Stock');

function isMarketOpen() {
  const now = new Date();
  const istOffset = 5.5 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = utcMinutes + istOffset;
  const hours = Math.floor(istMinutes / 60) % 24;
  const minutes = istMinutes % 60;
  const currentTime = hours * 60 + minutes;

  const marketOpen = 9 * 60 + 15;
  const marketClose = 15 * 60 + 30;
  const day = now.getDay();
  const isWeekday = day >= 1 && day <= 5;

  return isWeekday && currentTime >= marketOpen && currentTime <= marketClose;
}

function startIndexUpdateJob() {
  cron.schedule('*/2 * * * *', async () => {
    if (isMarketOpen()) {
      console.log('📊 Updating indices...');
      await updateAllIndices();
    }
  });
  console.log('✅ Index update job started (every 2 minutes)');
}

function startStockUpdateJob() {
  cron.schedule('*/5 * * * *', async () => {
    if (isMarketOpen()) {
      console.log('📈 Updating stocks...');
      const stocks = await Stock.find({ isActive: true }).limit(20);
      const symbols = stocks.map(s => s.symbol);
      await updateMultipleStocks(symbols);
    }
  });
  console.log('✅ Stock update job started (every 5 minutes)');
}
// Real-time Firebase updates (every 2 seconds)
let stockUpdateInterval = null;

function startFirebaseStockUpdates() {
  if (stockUpdateInterval) {
    clearInterval(stockUpdateInterval);
  }

  stockUpdateInterval = setInterval(async () => {
    if (isMarketOpen()) {
      console.log('🔥 Firebase: Updating stocks...');
      const stocks = await Stock.find({ isActive: true }).limit(50);
      const symbols = stocks.map(s => s.symbol);

      // Update in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        await updateMultipleStocks(batch);
      }
    }
  }, 2000); // 2 seconds (Firebase handles 1s updates well)

  console.log('✅ Firebase stock updates started (every 2 seconds)');
}

// Index updates (every 5 seconds)
function startFirebaseIndexUpdates() {
  setInterval(async () => {
    if (isMarketOpen()) {
      console.log('🔥 Firebase: Updating indices...');
      await updateAllIndices();
    }
  }, 5000);

  console.log('✅ Firebase index updates started (every 5 seconds)');
}
module.exports = {
  startIndexUpdateJob, startStockUpdateJob, isMarketOpen, startFirebaseStockUpdates,
  startFirebaseIndexUpdates
};
