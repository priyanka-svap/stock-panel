// services/liveDataService.js - COMPREHENSIVE with ALL Global Indices
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

// ============================================
// FETCH FROM YAHOO FINANCE (NSE Stocks)
// ============================================
async function fetchFromYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS`;
    const response = await axios.get(url, {
      params: { interval: '1d', range: '1d' },
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
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
        sector: meta.quoteType === 'EQUITY' ? 'Equity' : 'Unknown',
        lastUpdated: new Date()
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

// ============================================
// FETCH LIVE STOCK PRICE
// ============================================
async function fetchLiveStockPrice(symbol) {
  console.log(`📡 Fetching ${symbol}...`);
  const data = await fetchFromYahoo(symbol);
  if (data) {
    console.log(`✅ ${symbol} @ ₹${data.currentPrice} (${data.percentageChange > 0 ? '+' : ''}${data.percentageChange}%)`);
    return data;
  }
  console.error(`❌ Failed: ${symbol}`);
  return null;
}

// ============================================
// ALL GLOBAL INDICES MAPPING
// ============================================
const GLOBAL_INDICES = {
  // Indian Indices
  'NIFTY50': { yahoo: '^NSEI', name: 'NIFTY 50' },
  'NIFTY_50': { yahoo: '^NSEI', name: 'NIFTY 50' },
  'SENSEX': { yahoo: '^BSESN', name: 'SENSEX' },
  'BANKNIFTY': { yahoo: '^NSEBANK', name: 'BANK NIFTY' },
  'BANK_NIFTY': { yahoo: '^NSEBANK', name: 'BANK NIFTY' },
  'NIFTYIT': { yahoo: '^CNXIT', name: 'NIFTY IT' },
  'NIFTY_IT': { yahoo: '^CNXIT', name: 'NIFTY IT' },
  'NIFTYPHARMA': { yahoo: '^CNXPHARMA', name: 'NIFTY PHARMA' },
  'NIFTY_PHARMA': { yahoo: '^CNXPHARMA', name: 'NIFTY PHARMA' },
  'NIFTYFMCG': { yahoo: '^CNXFMCG', name: 'NIFTY FMCG' },
  'NIFTY_FMCG': { yahoo: '^CNXFMCG', name: 'NIFTY FMCG' },
  'NIFTYAUTO': { yahoo: '^CNXAUTO', name: 'NIFTY AUTO' },
  'NIFTY_AUTO': { yahoo: '^CNXAUTO', name: 'NIFTY AUTO' },
  'NIFTYMETAL': { yahoo: '^CNXMETAL', name: 'NIFTY METAL' },
  'NIFTY_METAL': { yahoo: '^CNXMETAL', name: 'NIFTY METAL' },
  'NIFTYREALTY': { yahoo: '^CNXREALTY', name: 'NIFTY REALTY' },
  'NIFTY_REALTY': { yahoo: '^CNXREALTY', name: 'NIFTY REALTY' },
  'NIFTYPSE': { yahoo: '^CNXPSE', name: 'NIFTY PSE' },
  'NIFTY_PSE': { yahoo: '^CNXPSE', name: 'NIFTY PSE' },
  'NIFTYMIDCAP': { yahoo: '^NSEMDCP50', name: 'NIFTY MIDCAP 50' },
  'NIFTY_MIDCAP': { yahoo: '^NSEMDCP50', name: 'NIFTY MIDCAP 50' },
  'NIFTYSMALLCAP': { yahoo: '^CNXSMALLCAP', name: 'NIFTY SMALLCAP' },
  'NIFTY_SMALLCAP': { yahoo: '^CNXSMALLCAP', name: 'NIFTY SMALLCAP' },
  
  // US Indices
  'DOW': { yahoo: '^DJI', name: 'DOW JONES' },
  'DOW_JONES': { yahoo: '^DJI', name: 'DOW JONES' },
  'SP500': { yahoo: '^GSPC', name: 'S&P 500' },
  'S&P500': { yahoo: '^GSPC', name: 'S&P 500' },
  'NASDAQ': { yahoo: '^IXIC', name: 'NASDAQ' },
  'RUSSELL2000': { yahoo: '^RUT', name: 'RUSSELL 2000' },
  
  // European Indices
  'FTSE': { yahoo: '^FTSE', name: 'FTSE 100' },
  'FTSE100': { yahoo: '^FTSE', name: 'FTSE 100' },
  'DAX': { yahoo: '^GDAXI', name: 'DAX' },
  'CAC40': { yahoo: '^FCHI', name: 'CAC 40' },
  'STOXX50': { yahoo: '^STOXX50E', name: 'EURO STOXX 50' },
  'IBEX35': { yahoo: '^IBEX', name: 'IBEX 35' },
  'FTSE_MIB': { yahoo: 'FTSEMIB.MI', name: 'FTSE MIB' },
  
  // Asian Indices
  'NIKKEI': { yahoo: '^N225', name: 'NIKKEI 225' },
  'NIKKEI225': { yahoo: '^N225', name: 'NIKKEI 225' },
  'HANGSENG': { yahoo: '^HSI', name: 'HANG SENG' },
  'HANG_SENG': { yahoo: '^HSI', name: 'HANG SENG' },
  'SHANGHAI': { yahoo: '000001.SS', name: 'SHANGHAI COMPOSITE' },
  'SHANGHAI_COMPOSITE': { yahoo: '000001.SS', name: 'SHANGHAI COMPOSITE' },
  'KOSPI': { yahoo: '^KS11', name: 'KOSPI' },
  'TAIWAN': { yahoo: '^TWII', name: 'TAIWAN WEIGHTED' },
  'STRAITS_TIMES': { yahoo: '^STI', name: 'STRAITS TIMES' },
  'ASX200': { yahoo: '^AXJO', name: 'ASX 200' },
  
  // Other Global Indices
  'BOVESPA': { yahoo: '^BVSP', name: 'BOVESPA' },
  'BRAZIL': { yahoo: '^BVSP', name: 'BOVESPA' },
  'MERVAL': { yahoo: '^MERV', name: 'MERVAL' },
  'MEXICO': { yahoo: '^MXX', name: 'IPC MEXICO' },
  'JSE': { yahoo: '^J203.JO', name: 'JSE TOP 40' },
  'SOUTH_AFRICA': { yahoo: '^J203.JO', name: 'JSE TOP 40' },
  
  // Commodity Indices
  'GOLD': { yahoo: 'GC=F', name: 'GOLD' },
  'SILVER': { yahoo: 'SI=F', name: 'SILVER' },
  'CRUDE_OIL': { yahoo: 'CL=F', name: 'CRUDE OIL' },
  'BRENT_OIL': { yahoo: 'BZ=F', name: 'BRENT OIL' },
  'NATURAL_GAS': { yahoo: 'NG=F', name: 'NATURAL GAS' },
  
  // Currency Indices
  'DXY': { yahoo: 'DX-Y.NYB', name: 'US DOLLAR INDEX' },
  'DOLLAR_INDEX': { yahoo: 'DX-Y.NYB', name: 'US DOLLAR INDEX' },
  
  // Crypto Indices
  'BITCOIN': { yahoo: 'BTC-USD', name: 'BITCOIN' },
  'ETHEREUM': { yahoo: 'ETH-USD', name: 'ETHEREUM' }
};

// ============================================
// FETCH LIVE INDEX PRICE
// ============================================
async function fetchLiveIndexPrice(indexName) {
  try {
    const indexKey = indexName.toUpperCase().replace(' ', '_');
    const indexConfig = GLOBAL_INDICES[indexKey];
    
    if (!indexConfig) {
      throw new Error(`Unknown index: ${indexName}`);
    }
    
    const { yahoo: yahooSymbol, name: displayName } = indexConfig;
    
    console.log(`📊 Fetching ${displayName}...`);
    
    const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`, {
      params: { interval: '1d', range: '1d' },
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.data?.chart?.result?.[0]) {
      const result = response.data.chart.result[0];
      const meta = result.meta;
      
      const value = parseFloat(meta.regularMarketPrice?.toFixed(2));
      const previousClose = parseFloat(meta.chartPreviousClose?.toFixed(2));
      const change = parseFloat((value - previousClose).toFixed(2));
      const percentageChange = parseFloat(((change / previousClose) * 100).toFixed(2));
      
      const data = {
        name: indexKey,
        displayName,
        value,
        previousClose,
        change,
        percentageChange,
        dayHigh: parseFloat(meta.regularMarketDayHigh?.toFixed(2)),
        dayLow: parseFloat(meta.regularMarketDayLow?.toFixed(2)),
        openValue: parseFloat(meta.regularMarketOpen?.toFixed(2)),
        lastUpdated: new Date()
      };
      
      console.log(`✅ ${displayName} @ ${value} (${percentageChange > 0 ? '+' : ''}${percentageChange}%)`);
      return data;
    }
    return null;
  } catch (error) {
    console.error(`❌ Failed: ${indexName} - ${error.message}`);
    return null;
  }
}

// ============================================
// UPDATE STOCK IN DATABASE
// ============================================
// async function updateStockPrice(symbol) {
//   try {
//     const liveData = await fetchLiveStockPrice(symbol);
//     if (!liveData) {
//       return { success: false, message: `Failed for ${symbol}` };
//     }
    
//     const stock = await Stock.findOneAndUpdate(
//       { symbol: liveData.symbol },
//       liveData,
//       { new: true, upsert: true }
//     );
    
//     // Emit WebSocket update
//     if (global.io) {
//       global.io.to(stock.symbol).emit('stockUpdate', {
//         symbol: stock.symbol,
//         data: stock,
//         timestamp: new Date()
//       });
//     }
    
//     return { success: true, data: stock };
//   } catch (error) {
//     return { success: false, message: error.message };
//   }
// }

// In services/liveDataService.js
const { updateFirebase } = require('./firebaseService');
const { sanitizeFilter } = require('mongoose');

async function updateStockPrice(symbol) {
  const liveData = await fetchLiveStockPrice(symbol);
  if (!liveData) {
      return { success: false, message: `Failed for ${symbol}` };
    }
     await updateFirebase(`stocks/${symbol}`,liveData)
    const stock = await Stock.findOneAndUpdate(
      { symbol: liveData.symbol },
      liveData,
      { new: true, upsert: true }
    );
  
  // 2. Push to Firebase (for real-time sync)
 
  
  return { success: true };
}
// ============================================
// UPDATE INDEX IN DATABASE
// ============================================
async function updateIndexPrice(indexName) {
  try {
    const liveData = await fetchLiveIndexPrice(indexName);
    if (!liveData) {
      return { success: false, message: `Failed for ${indexName}` };
    }
    await updateFirebase(`indices/${liveData.name }`,liveData)
    const index = await Index.findOneAndUpdate(
      { name: liveData.name },
      liveData,
      { new: true, upsert: true }
    );
    
    // Emit WebSocket update
 
    
    return { success: true, data: index };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
function isValidNumber(value) {
  return value !== null && 
         value !== undefined && 
         !isNaN(value) && 
         isFinite(value) && 
         typeof value === 'number';
}

function sanitizeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return isValidNumber(num) ? num : defaultValue;
}
// ============================================
// UPDATE MULTIPLE STOCKS
// ============================================
async function updateMultipleStocks(symbols) {
  const results = [];
  for (const symbol of symbols) {
  
    const result = await updateStockPrice(symbol);
    results.push(result);
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results;
}

// ============================================
// UPDATE ALL INDICES
// ============================================
async function updateAllIndices() {
  // Default indices to update
  const defaultIndices = [
    // Indian
    'NIFTY50', 'SENSEX', 'BANKNIFTY', 'NIFTYIT', 
    'NIFTYPHARMA', 'NIFTYFMCG', 'NIFTYAUTO',
    
    // US
    'DOW', 'SP500', 'NASDAQ',
    
    // European
    'FTSE', 'DAX', 'CAC40',
    
    // Asian
    'NIKKEI', 'HANGSENG', 'SHANGHAI',
    
    // Commodities
    'GOLD', 'SILVER', 'CRUDE_OIL'
  ];
  
  const results = [];
  for (const indexName of defaultIndices) {
    const result = await updateIndexPrice(indexName);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results.filter(r => r && r.success);
}

// ============================================
// GET AVAILABLE INDICES
// ============================================
function getAvailableIndices() {
  return Object.keys(GLOBAL_INDICES).map(key => ({
    key,
    name: GLOBAL_INDICES[key].name,
    yahoo: GLOBAL_INDICES[key].yahoo
  }));
}

module.exports = {
  fetchLiveStockPrice,
  fetchLiveIndexPrice,
  updateStockPrice,
  updateIndexPrice,
  updateMultipleStocks,
  updateAllIndices,
  getAvailableIndices,
  GLOBAL_INDICES
};
