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

module.exports = { startIndexUpdateJob, startStockUpdateJob, isMarketOpen };
