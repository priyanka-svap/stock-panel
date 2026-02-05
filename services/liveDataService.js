// services/liveDataService.js - Real LIVE Data from NSE & Yahoo Finance
const axios = require('axios');
const Stock = require('../models/Stock');
const Index = require('../models/Index');

function formatMarketCap(marketCap) {
  if (!marketCap) return 'N/A';
  const crores = marketCap / 10000000;
  if (crores >= 100000) return `₹${(crores / 100000).toFixed(2)} Lakh Cr`;
  if (crores >= 1000) return `₹${(crores / 1000).toFixed(2)}K Cr`;
  return `₹${crores.toFixed(2)} Cr`;
}

// Fetch from Yahoo Finance (Most Reliable for NSE)
async function fetchFromYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS`;
    const response = await axios.get(url, {
      params: { interval: '1d', range: '1d' },
      timeout: 8000
    });
    
    if (response.data?.chart?.result?.[0]) {
      const result = response.data.chart.result[0];
      const meta = result.meta;
      
      return {
        symbol: symbol,
        companyName: meta.longName || symbol,
        currentPrice: parseFloat(meta.regularMarketPrice?.toFixed(2)),
        previousClose: parseFloat(meta.chartPreviousClose?.toFixed(2)),
        priceChange: parseFloat((meta.regularMarketPrice - meta.chartPreviousClose).toFixed(2)),
        percentageChange: parseFloat((((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100).toFixed(2)),
        dayHigh: parseFloat(meta.regularMarketDayHigh?.toFixed(2)),
        dayLow: parseFloat(meta.regularMarketDayLow?.toFixed(2)),
        openPrice: parseFloat(meta.regularMarketOpen?.toFixed(2)),
        volume: parseInt(meta.regularMarketVolume || 0),
        marketCap: formatMarketCap(meta.marketCap),
        sector: 'Unknown',
        lastUpdated: new Date()
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Fetch LIVE Stock Price
async function fetchLiveStockPrice(symbol) {
  console.log(`📡 Fetching LIVE data for ${symbol}...`);
  const data = await fetchFromYahoo(symbol);
  if (data) {
    console.log(`✅ Got LIVE data: ${symbol} @ ₹${data.currentPrice}`);
    return data;
  }
  console.error(`❌ Failed to fetch ${symbol}`);
  return null;
}

// Fetch LIVE Index (Nifty, Sensex, etc.)
async function fetchLiveIndexPrice(indexName) {
  try {
    let yahooSymbol, displayName;
    
    switch(indexName.toUpperCase()) {
      case 'NIFTY50': case 'NIFTY_50':
        yahooSymbol = '^NSEI';
        displayName = 'NIFTY 50';
        break;
      case 'SENSEX':
        yahooSymbol = '^BSESN';
        displayName = 'SENSEX';
        break;
      case 'BANKNIFTY': case 'BANK_NIFTY':
        yahooSymbol = '^NSEBANK';
        displayName = 'BANK NIFTY';
        break;
      case 'NIFTYIT': case 'NIFTY_IT':
        yahooSymbol = '^CNXIT';
        displayName = 'NIFTY IT';
        break;
      default:
        throw new Error('Unknown index');
    }
    
    console.log(`📊 Fetching LIVE ${displayName}...`);
    
    const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`, {
      params: { interval: '1d', range: '1d' },
      timeout: 8000
    });
    
    if (response.data?.chart?.result?.[0]) {
      const result = response.data.chart.result[0];
      const meta = result.meta;
      
      const data = {
        name: indexName.toUpperCase().replace(' ', '_'),
        displayName,
        value: parseFloat(meta.regularMarketPrice?.toFixed(2)),
        previousClose: parseFloat(meta.chartPreviousClose?.toFixed(2)),
        change: parseFloat((meta.regularMarketPrice - meta.chartPreviousClose).toFixed(2)),
        percentageChange: parseFloat((((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100).toFixed(2)),
        dayHigh: parseFloat(meta.regularMarketDayHigh?.toFixed(2)),
        dayLow: parseFloat(meta.regularMarketDayLow?.toFixed(2)),
        openValue: parseFloat(meta.regularMarketOpen?.toFixed(2)),
        lastUpdated: new Date()
      };
      
      console.log(`✅ Got LIVE data: ${displayName} @ ${data.value}`);
      return data;
    }
    return null;
  } catch (error) {
    console.error(`❌ Failed to fetch ${indexName}:`, error.message);
    return null;
  }
}

// Update stock in DB
async function updateStockPrice(symbol) {
  try {
    const liveData = await fetchLiveStockPrice(symbol);
    if (!liveData) {
      return { success: false, message: `Failed for ${symbol}` };
    }
    
    const stock = await Stock.findOneAndUpdate(
      { symbol: liveData.symbol },
      liveData,
      { new: true, upsert: true }
    );
    
    if (global.io) {
      global.io.to(stock.symbol).emit('stockUpdate', {
        symbol: stock.symbol,
        data: stock,
        timestamp: new Date()
      });
    }
    
    console.log(`✅ DB Updated: ${stock.symbol} @ ₹${stock.currentPrice} (${stock.percentageChange > 0 ? '+' : ''}${stock.percentageChange}%)`);
    return { success: true, data: stock };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// Update index in DB
async function updateIndexPrice(indexName) {
  try {
    const liveData = await fetchLiveIndexPrice(indexName);
    if (!liveData) {
      return { success: false, message: `Failed for ${indexName}` };
    }
    
    const index = await Index.findOneAndUpdate(
      { name: liveData.name },
      liveData,
      { new: true, upsert: true }
    );
    
    if (global.io) {
      global.io.emit('indexUpdate', {
        name: index.name,
        data: index,
        timestamp: new Date()
      });
    }
    
    console.log(`✅ DB Updated: ${index.displayName} @ ${index.value} (${index.percentageChange > 0 ? '+' : ''}${index.percentageChange}%)`);
    return { success: true, data: index };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// Update multiple stocks
async function updateMultipleStocks(symbols) {
  const results = [];
  for (const symbol of symbols) {
    const result = await updateStockPrice(symbol);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results.filter(r => r && r.success);
}

// Update all indices
async function updateAllIndices() {
  const indices = ['NIFTY50', 'SENSEX', 'BANKNIFTY', 'NIFTYIT'];
  const results = [];
  for (const indexName of indices) {
    const result = await updateIndexPrice(indexName);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results.filter(r => r && r.success);
}

module.exports = {
  fetchLiveStockPrice,
  fetchLiveIndexPrice,
  updateStockPrice,
  updateIndexPrice,
  updateMultipleStocks,
  updateAllIndices
};
