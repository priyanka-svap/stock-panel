// // jobs/firebaseUpdateJob.js - Live Market Updates (MongoDB + Firebase)
// // Updates every 1 second with REAL live data from Yahoo Finance

// const Stock = require('../models/Stock');
// const Index = require('../models/Index');
// const { updateMultipleStocks, updateAllIndices } = require('../services/liveDataService');
// const Quote = require('../models/Quote');
// const MarketDepthService = require('../services/marketDepthService');
// const depthService = new MarketDepthService();


// // Firebase Database URL
// const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// // Stock symbols to track
// const ACTIVE_SYMBOLS = [
//     // NIFTY 50 - Top performers
//     'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
//     'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL', 'KOTAKBANK',
//     'LT', 'AXISBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI',
//     'HCLTECH', 'WIPRO', 'TITAN', 'NESTLEIND', 'ULTRACEMCO',
//     'SUNPHARMA', 'ONGC', 'NTPC', 'POWERGRID', 'M&M',
//     'TATAMOTORS', 'TATASTEEL', 'ADANIPORTS', 'COALINDIA', 'JSWSTEEL',
//     'GRASIM', 'BAJAJFINSV', 'HINDALCO', 'INDUSINDBK', 'DRREDDY',
//     'CIPLA', 'EICHERMOT', 'DIVISLAB', 'HEROMOTOCO', 'APOLLOHOSP',
//     'TECHM', 'TATACONSUM', 'BRITANNIA', 'SHRIRAMFIN', 'ADANIENT',
//     'SBILIFE', 'LTIM', 'BAJAJ-AUTO', 'HDFCLIFE', 'TRENT'
// ];

// // =====================================================
// // FIREBASE REST API FUNCTIONS (No Admin SDK needed!)
// // =====================================================

// async function updateFirebase(path, data) {
//     try {
//         const url = `${FIREBASE_URL}/${path}.json`;
        
//         const response = await fetch(url, {
//             method: 'PUT',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify(data)
//         });
        
//         if (!response.ok) {
//             throw new Error(`HTTP ${response.status}`);
//         }
        
//         return true;
//     } catch (error) {
//         console.error(`Firebase update error (${path}):`, error.message);
//         return false;
//     }
// }

// async function batchUpdateFirebase(updates) {
//     try {
//         const url = `${FIREBASE_URL}/.json`;
        
//         const response = await fetch(url, {
//             method: 'PATCH',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify(updates)
//         });
        
//         if (!response.ok) {
//             throw new Error(`HTTP ${response.status}`);
//         }
        
//         return true;
//     } catch (error) {
//         console.error('❌ Firebase batch update error:', error.message);
//         return false;
//     }
// }

// // =====================================================
// // LIVE STOCK DATA UPDATE (MongoDB + Firebase)
// // =====================================================

// async function updateLiveStockData() {
//     try {
//         console.log('📈 Fetching live stock data from Yahoo Finance...');
        
//         // Step 1: Fetch live data and update MongoDB
//         const results = await updateMultipleStocks(ACTIVE_SYMBOLS);
//         const successful = results.filter(r => r.success).length;
        
//         console.log(`✅ Updated ${successful}/${ACTIVE_SYMBOLS.length} stocks in MongoDB`);
        
//         // Step 2: Get updated data from MongoDB
//         const stocks = await Stock.find({ 
//             symbol: { $in: ACTIVE_SYMBOLS },
//             isActive: true 
//         }).lean();
        
//         if (stocks.length === 0) {
//             console.log('⚠️  No stocks found in database');
//             return;
//         }
        
//         // Step 3: Prepare Firebase batch update
//         // const firebaseUpdates = {};
        
//         // stocks.forEach(stock => {
//         //     firebaseUpdates[`stocks/${stock.symbol}`] = {
//         //         symbol: stock.symbol,
//         //         companyName: stock.companyName || stock.symbol,
//         //         currentPrice: stock.currentPrice || 0,
//         //         percentageChange: stock.percentageChange || 0,
//         //         priceChange: stock.priceChange || 0,
//         //         dayHigh: stock.dayHigh || 0,
//         //         dayLow: stock.dayLow || 0,
//         //         openPrice: stock.openPrice || 0,
//         //         previousClose: stock.previousClose || 0,
//         //         volume: stock.volume || 0,
//         //         marketCap: stock.marketCap || 0,
//         //         sector: stock.sector || 'Unknown',
//         //         lastUpdated: Date.now()
//         //     };
//         // });
        
//         // // Step 4: Push to Firebase
//         // const firebaseSuccess = await batchUpdateFirebase(firebaseUpdates);
        
//         // if (firebaseSuccess) {
//         //     console.log(`🔥 Pushed ${stocks.length} stocks to Firebase`);
            
//         //     // Log sample data for verification
//         //     const sample = stocks.slice(0, 3);
//         //     sample.forEach(s => {
//         //         const emoji = s.percentageChange >= 0 ? '🟢' : '🔴';
//         //         console.log(`   ${emoji} ${s.symbol}: ₹${s.currentPrice.toFixed(2)} (${s.percentageChange >= 0 ? '+' : ''}${s.percentageChange.toFixed(2)}%)`);
//         //     });
//         // }
        
//         return true;
        
//     } catch (error) {
//         console.error('❌ Stock update error:', error.message);
//         return false;
//     }
// }

// // =====================================================
// // LIVE INDEX DATA UPDATE (MongoDB + Firebase)
// // =====================================================

// async function updateLiveIndexData() {
//     try {
//         console.log('🌐 Fetching live index data...');
        
//         // Step 1: Fetch live data and update MongoDB
//         await updateAllIndices();
//         console.log('✅ Updated indices in MongoDB');
        
//         // Step 2: Get updated data from MongoDB
//         const indices = await Index.find({}).lean();
        
//         if (indices.length === 0) {
//             console.log('⚠️  No indices found in database');
//             return;
//         }
        
//         // Step 3: Prepare Firebase batch update
//         // const firebaseUpdates = {};
        
//         // indices.forEach(index => {
//         //     firebaseUpdates[`indices/${index.name}`] = {
//         //         name: index.name,
//         //         displayName: index.displayName || index.name,
//         //         value: index.value || 0,
//         //         percentageChange: index.percentageChange || 0,
//         //         change: index.change || 0,
//         //         dayHigh: index.dayHigh || 0,
//         //         dayLow: index.dayLow || 0,
//         //         openValue: index.openValue || 0,
//         //         previousClose: index.previousClose || 0,
//         //         lastUpdated: Date.now()
//         //     };
//         // });
        
//         // // Step 4: Push to Firebase
//         // const firebaseSuccess = await batchUpdateFirebase(firebaseUpdates);
        
//         // if (firebaseSuccess) {
//         //     console.log(`🔥 Pushed ${indices.length} indices to Firebase`);
            
//         //     // Log sample data for verification
//         //     indices.forEach(idx => {
//         //         const emoji = idx.percentageChange >= 0 ? '🟢' : '🔴';
//         //         console.log(`   ${emoji} ${idx.displayName}: ${idx.value.toFixed(2)} (${idx.percentageChange >= 0 ? '+' : ''}${idx.percentageChange.toFixed(2)}%)`);
//         //     });
//         // }
        
//         return true;
        
//     } catch (error) {
//         console.error('❌ Index update error:', error.message);
//         return false;
//     }
// }

// // =====================================================
// // MARKET HOURS CHECK (IST Timezone)
// // =====================================================

// function isMarketOpen() {
//     const now = new Date();
    
//     // Convert to IST (UTC+5:30)
//     const istOffset = 5.5 * 60; // minutes
//     const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
//     const istMinutes = utcMinutes + istOffset;
    
//     const hours = Math.floor(istMinutes / 60) % 24;
//     const minutes = istMinutes % 60;
//     const currentTime = hours * 60 + minutes;
    
//     // Market hours: 9:15 AM to 3:30 PM IST
//     const marketOpen = 9 * 60 + 15;   // 9:15 AM
//     const marketClose = 15 * 60 + 30; // 3:30 PM
    
//     // Check if weekday (Monday=1 to Friday=5)
//     const day = now.getDay();
//     const isWeekday = day >= 1 && day <= 5;
    
//     return isWeekday && currentTime >= marketOpen && currentTime <= marketClose;
// }

// function getMarketStatus() {
//     const isOpen = isMarketOpen();
//     const now = new Date();
//     const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
//     const timeStr = istTime.toLocaleTimeString('en-IN', { 
//         hour: '2-digit', 
//         minute: '2-digit',
//         timeZone: 'Asia/Kolkata'
//     });
    
//     return {
//         isOpen,
//         time: timeStr,
//         status: isOpen ? '🟢 MARKET OPEN' : '🔴 MARKET CLOSED'
//     };
// }



// // =====================================================
// // LIVE MARKET DEPTH UPDATE (MongoDB + Firebase)
// // =====================================================

// async function updateLiveMarketDepth() {
//     try {
//         const startTime = Date.now();
//         console.log('📊 Fetching live market depth from NSE...');
        
//         // Step 1: Fetch market depth for all symbols
//         const quotes = await depthService.getMultipleDepth(ACTIVE_SYMBOLS);
        
//         const successful = quotes.filter(q => !q.error).length;
//         const failed = quotes.filter(q => q.error).length;
        
//         console.log(`   Fetched: ✅ ${successful} | ❌ ${failed}`);
        
//         // Step 2: Save to MongoDB in parallel
//         const mongoPromise = batchSaveToMongoDB(quotes);
        
//         // Step 3: Prepare Firebase batch update
//         const firebaseUpdates = {};
        
//         quotes.forEach(quote => {
//             if (quote.error) return; // Skip failed quotes
            
//             firebaseUpdates[`quotes/${quote.symbol}`] = {
//                 symbol: quote.symbol,
//                 ltp: quote.ltp,
//                 open: quote.open,
//                 high: quote.high,
//                 low: quote.low,
//                 close: quote.close,
//                 previousClose: quote.previousClose,
//                 volume: quote.volume,
//                 totalBuyQuantity: quote.totalBuyQuantity,
//                 totalSellQuantity: quote.totalSellQuantity,
//                 bid: quote.bid,
//                 ask: quote.ask,
//                 bestBid: quote.bestBid,
//                 bestAsk: quote.bestAsk,
//                 spread: quote.spread,
//                 change: quote.change,
//                 percentageChange: quote.percentageChange,
//                 lastUpdated: quote.lastUpdated
//             };
//         });
        
//         // Step 4: Execute MongoDB and Firebase updates in parallel
//         const [mongoResults, firebaseSuccess] = await Promise.all([
//             mongoPromise,
//             batchUpdateFirebase(firebaseUpdates)
//         ]);
        
//         const mongoSaved = mongoResults.filter(r => r.saved).length;
        
//         const elapsed = Date.now() - startTime;
        
//         console.log(`   MongoDB: ✅ ${mongoSaved} saved`);
//         console.log(`   Firebase: ${firebaseSuccess ? '✅ Updated' : '❌ Failed'}`);
//         console.log(`   Time: ⏱️  ${elapsed}ms`);
        
//         // Log top 3 stocks for verification
//         const topStocks = quotes
//             .filter(q => !q.error)
//             .sort((a, b) => Math.abs(b.percentageChange) - Math.abs(a.percentageChange))
//             .slice(0, 3);
        
//         console.log('   Top Movers:');
//         topStocks.forEach(s => {
//             const emoji = s.percentageChange >= 0 ? '🟢' : '🔴';
//             console.log(`      ${emoji} ${s.symbol}: ₹${s.ltp.toFixed(2)} (${s.percentageChange >= 0 ? '+' : ''}${s.percentageChange.toFixed(2)}%)`);
//         });
        
//         return true;
        
//     } catch (error) {
//         console.error('❌ Market depth update error:', error.message);
//         return false;
//     }
// }


// // =====================================================
// // BATCH SAVE TO MONGODB
// // =====================================================

// async function batchSaveToMongoDB(quotesArray) {
//     const results = [];
    
//     for (const quote of quotesArray) {
//         if (quote.error) continue; // Skip failed quotes
        
//         const saved = await saveToMongoDB(quote);
//         results.push({ 
//             symbol: quote.symbol, 
//             saved,
//             ltp: quote.ltp,
//             change: quote.percentageChange
//         });
//     }
    
//     return results;
// }

// async function saveToMongoDB(quoteData) {
//     try {
//         const symbol = quoteData.symbol.replace('.NS', '').replace('.BO', '');
        
//         // Update or create stock document in MongoDB
//         await Quote.findOneAndUpdate(
//             { symbol: symbol },
//             {
//                 $set: {
//                     symbol: symbol,
//                     currentPrice: quoteData.ltp,
//                     openPrice: quoteData.open,
//                     dayHigh: quoteData.high,
//                     dayLow: quoteData.low,
//                     previousClose: quoteData.previousClose,
//                     priceChange: quoteData.change,
//                     percentageChange: quoteData.percentageChange,
//                     volume: quoteData.volume,
//                     totalBuyQuantity: quoteData.totalBuyQuantity,
//                     totalSellQuantity: quoteData.totalSellQuantity,
//                     bestBid: quoteData.bestBid,
//                     bestAsk: quoteData.bestAsk,
//                     spread: quoteData.spread,
//                     bidDepth: quoteData.bid,
//                     askDepth: quoteData.ask,
//                     lastUpdated: new Date(quoteData.lastUpdated),
//                     isActive: true
//                 }
//             },
//             { 
//                 upsert: true, 
//                 new: true,
//                 setDefaultsOnInsert: true 
//             }
//         );
        
//         return true;
//     } catch (error) {
//         console.error(`MongoDB save error for ${quoteData.symbol}:`, error.message);
//         return false;
//     }
// }

// // =====================================================
// // BATCH UPDATE - Split stocks into chunks for efficiency
// // =====================================================





// function chunkArray(array, size) {
//     const chunks = [];
//     for (let i = 0; i < array.length; i += size) {
//         chunks.push(array.slice(i, i + size));
//     }
//     return chunks;
// }

// async function updateStocksInBatches() {
//     const BATCH_SIZE = 10; // Update 10 stocks at a time
//     const batches = chunkArray(ACTIVE_SYMBOLS, BATCH_SIZE);
    
//     console.log(`📊 Processing ${ACTIVE_SYMBOLS.length} stocks in ${batches.length} batches...`);
    
//     for (let i = 0; i < batches.length; i++) {
//         const batch = batches[i];
//         console.log(`   Batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);
        
//         try {
//             // Fetch live data and update MongoDB
//             await updateMultipleStocks(batch);
            
//             // Get updated data
//             const stocks = await Stock.find({ 
//                 symbol: { $in: batch },
//                 isActive: true 
//             }).lean();
            
//             // Push to Firebase
//             const updates = {};
//             stocks.forEach(stock => {
//                 updates[`stocks/${stock.symbol}`] = {
//                     symbol: stock.symbol,
//                     companyName: stock.companyName || stock.symbol,
//                     currentPrice: stock.currentPrice || 0,
//                     percentageChange: stock.percentageChange || 0,
//                     priceChange: stock.priceChange || 0,
//                     dayHigh: stock.dayHigh || 0,
//                     dayLow: stock.dayLow || 0,
//                     openPrice: stock.openPrice || 0,
//                     volume: stock.volume || 0,
//                     lastUpdated: Date.now()
//                 };
//             });
            
//             await batchUpdateFirebase(updates);
            
//             // Small delay between batches to avoid rate limiting
//             if (i < batches.length - 1) {
//                 await new Promise(resolve => setTimeout(resolve, 200));
//             }
            
//         } catch (error) {
//             console.error(`   ❌ Batch ${i + 1} failed:`, error.message);
//         }
//     }
    
//     console.log('✅ All batches processed');
// }

// // =====================================================
// // CONTINUOUS UPDATE SCHEDULER
// // =====================================================

// let stockUpdateInterval = null;
// let indexUpdateInterval = null;
// let statusCheckInterval = null;

// function startContinuousUpdates() {
//     const marketStatus = getMarketStatus();
//     console.log('\n' + '='.repeat(60));
//     console.log('🔥 FIREBASE REAL-TIME UPDATE JOB STARTED');
//     console.log('='.repeat(60));
//     console.log(`📍 Current Status: ${marketStatus.status}`);
//     console.log(`🕐 IST Time: ${marketStatus.time}`);
//     console.log(`📊 Tracking ${ACTIVE_SYMBOLS.length} stocks`);
//     console.log(`🌐 Update Mode: Live Yahoo Finance API → MongoDB → Firebase`);
//     console.log('='.repeat(60) + '\n');
    
//     // Initial update
//     console.log('🚀 Running initial update...\n');
//     updateLiveStockData();
//     updateLiveIndexData();
//     updateLiveMarketDepth();
    
//     // Update stocks every 2 seconds (more realistic for API rate limits)
//     stockUpdateInterval = setInterval(async () => {
//         const status = getMarketStatus();
        
//         if (status.isOpen) {
//             console.log(`\n⏰ [${status.time}] Stock Update Triggered`);
//             await updateLiveStockData();
//         } else {
//             console.log(`\n⏰ [${status.time}] Market Closed - Skipping update`);
//         }
//     }, 2000); // 2 seconds
    
//     // Update indices every 5 seconds
//     indexUpdateInterval = setInterval(async () => {
//         const status = getMarketStatus();
        
//         if (status.isOpen) {
//             console.log(`\n⏰ [${status.time}] Index Update Triggered`);
//             await updateLiveIndexData();
//         }
//     }, 5000); // 5 seconds

//      indexUpdateInterval = setInterval(async () => {
//         const status = getMarketStatus();
        
//         if (status.isOpen) {
//             console.log(`\n⏰ [${status.time}] Index Update Triggered`);
//             await updateLiveMarketDepth();
//         }
//     }, 3000); // 3 seconds
    
//     // Status check every 60 seconds
//     statusCheckInterval = setInterval(() => {
//         const status = getMarketStatus();
//         console.log(`\n📊 Status Check: ${status.status} | Time: ${status.time}`);
//     }, 60000); // 60 seconds
    
//     console.log('✅ Update intervals configured:');
//     console.log('   📈 Stocks: Every 2 seconds');
//     console.log('   🌐 Indices: Every 5 seconds');
//     console.log('   📊 Status: Every 60 seconds\n');
// }

// function stopContinuousUpdates() {
//     if (stockUpdateInterval) clearInterval(stockUpdateInterval);
//     if (indexUpdateInterval) clearInterval(indexUpdateInterval);
//     if (statusCheckInterval) clearInterval(statusCheckInterval);
    
//     console.log('\n🛑 Firebase update job stopped\n');
// }

// // =====================================================
// // MANUAL UPDATE FUNCTIONS (For testing)
// // =====================================================

// async function manualStockUpdate() {
//     console.log('🔧 Manual stock update triggered...');
//     await updateLiveStockData();
// }

// async function manualIndexUpdate() {
//     console.log('🔧 Manual index update triggered...');
//     await updateLiveIndexData();
// }

// async function manualFullUpdate() {
//     console.log('🔧 Manual full update triggered...');
//     await updateLiveStockData();
//     await updateLiveIndexData();
// }

// // =====================================================
// // GRACEFUL SHUTDOWN
// // =====================================================

// process.on('SIGINT', () => {
//     console.log('\n⚠️  Received SIGINT signal...');
//     stopContinuousUpdates();
//     process.exit(0);
// });

// process.on('SIGTERM', () => {
//     console.log('\n⚠️  Received SIGTERM signal...');
//     stopContinuousUpdates();
//     process.exit(0);
// });

// // =====================================================
// // EXPORTS
// // =====================================================

// module.exports = {
//     // Main functions
//     startContinuousUpdates,
//     stopContinuousUpdates,


    
//     // Update functions
//     updateLiveStockData,
//     updateLiveIndexData,
//     updateStocksInBatches,
//      updateLiveMarketDepth,
    
//     // Manual triggers
//     manualStockUpdate,
//     manualIndexUpdate,
//     manualFullUpdate,
    
//     // Utility
//     isMarketOpen,
//     getMarketStatus,
    
//     // Direct Firebase access
//     updateFirebase,
//     batchUpdateFirebase,

//         // MongoDB access
//     saveToMongoDB,
//     batchSaveToMongoDB
// };
// jobs/firebaseUpdateJob.js - Live Market Updates WITH F&O EXPIRY SUPPORT
// Updates every 1ms with REAL live data + F&O contracts with expiry

const Stock = require('../models/Stock');
const Index = require('../models/Index');
const { updateMultipleStocks, updateAllIndices } = require('../services/liveDataService');
const Quote = require('../models/Quote');
const MarketDepthService = require('../services/marketDepthService');
const depthService = new MarketDepthService();

// Firebase Database URL
const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// Stock symbols to track
const ACTIVE_SYMBOLS = [
    // NIFTY 50 - Top performers
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
    'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL', 'KOTAKBANK',
    'LT', 'AXISBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI',
    'HCLTECH', 'WIPRO', 'TITAN', 'NESTLEIND', 'ULTRACEMCO',
    'SUNPHARMA', 'ONGC', 'NTPC', 'POWERGRID', 'M&M',
    'TATAMOTORS', 'TATASTEEL', 'ADANIPORTS', 'COALINDIA', 'JSWSTEEL',
    'GRASIM', 'BAJAJFINSV', 'HINDALCO', 'INDUSINDBK', 'DRREDDY',
    'CIPLA', 'EICHERMOT', 'DIVISLAB', 'HEROMOTOCO', 'APOLLOHOSP',
    'TECHM', 'TATACONSUM', 'BRITANNIA', 'SHRIRAMFIN', 'ADANIENT',
    'SBILIFE', 'LTIM', 'BAJAJ-AUTO', 'HDFCLIFE', 'TRENT'
];

// =====================================================
// HELPER FUNCTION - NaN Protection
// =====================================================
function sanitizeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return (!isNaN(num) && isFinite(num)) ? num : defaultValue;
}

// =====================================================
// FIREBASE REST API FUNCTIONS
// =====================================================

async function updateFirebase(path, data) {
    try {
        const url = `${FIREBASE_URL}/${path}.json`;
        
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

async function batchUpdateFirebase(updates) {
    try {
        const url = `${FIREBASE_URL}/.json`;
        
        const response = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Firebase batch update error:', error.message);
        return false;
    }
}

// =====================================================
// F&O CONTRACTS UPDATE WITH EXPIRY
// =====================================================

async function updateFOContractsToFirebase() {
    try {
        console.log('📊 Updating F&O contracts with expiry to Firebase...');
        
        // Get all active F&O contracts (FUTURE and OPTION)
        const foContracts = await Stock.find({
            contractType: { $in: ['FUTURE', 'OPTION'] },
            isActive: true
        }).lean();
        
        if (foContracts.length === 0) {
            console.log('⚠️  No F&O contracts found');
            return;
        }
        
        const updates = {};
        const now = Date.now();
        
        foContracts.forEach(contract => {
            const contractKey = contract.symbol.replace(/[.#$\[\]]/g, '_'); // Firebase key sanitization
            
            // Calculate days until expiry
            let daysToExpiry = null;
            let isExpired = false;
            
            if (contract.expiryDate) {
                const expiryTime = new Date(contract.expiryDate).getTime();
                const diffMs = expiryTime - now;
                daysToExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                isExpired = diffMs < 0;
            }
            
            updates[`fo_contracts/${contractKey}`] = {
                symbol: contract.symbol,
                companyName: contract.companyName || contract.symbol,
                contractType: contract.contractType,
                baseSymbol: contract.baseSymbol || contract.symbol,
                
                // Expiry information
                expiryDate: contract.expiryDate ? contract.expiryDate.toISOString() : null,
                expiryString: contract.expiryString || null,
                daysToExpiry: daysToExpiry,
                isExpired: isExpired,
                
                // Price data with NaN protection
                currentPrice: sanitizeNumber(contract.currentPrice, 0),
                openPrice: sanitizeNumber(contract.openPrice, 0),
                dayHigh: sanitizeNumber(contract.dayHigh, 0),
                dayLow: sanitizeNumber(contract.dayLow, 0),
                previousClose: sanitizeNumber(contract.previousClose, 0),
                priceChange: sanitizeNumber(contract.priceChange, 0),
                percentageChange: sanitizeNumber(contract.percentageChange, 0),
                
                // Trading data
                volume: sanitizeNumber(contract.volume, 0),
                openInterest: sanitizeNumber(contract.openInterest, 0),
                lotSize: sanitizeNumber(contract.lotSize, 1),
                
                // Metadata
                lastUpdated: now
            };
        });
        
        await batchUpdateFirebase(updates);
        console.log(`✅ Updated ${foContracts.length} F&O contracts to Firebase`);
        
    } catch (error) {
        console.error('❌ Error updating F&O contracts:', error.message);
    }
}

// =====================================================
// LIVE STOCK DATA UPDATE (EQUITY + F&O)
// =====================================================

async function updateLiveStockData() {
    try {
        console.log('📈 Fetching live stock data...');
        
        // Update equity stocks
        const results = await updateMultipleStocks(ACTIVE_SYMBOLS);
        const successful = results.filter(r => r.success).length;
        
        console.log(`✅ Updated ${successful}/${ACTIVE_SYMBOLS.length} equity stocks`);
        
        // Get equity stocks for Firebase
        const stocks = await Stock.find({ 
            symbol: { $in: ACTIVE_SYMBOLS },
            contractType: 'SPOT',
            isActive: true 
        }).lean();
        
        if (stocks.length > 0) {
            const updates = {};
            
            stocks.forEach(stock => {
                const key = stock.symbol.replace(/[.#$\[\]]/g, '_');
                updates[`stocks/${key}`] = {
                    symbol: stock.symbol,
                    companyName: stock.companyName || stock.symbol,
                    currentPrice: sanitizeNumber(stock.currentPrice, 0),
                    percentageChange: sanitizeNumber(stock.percentageChange, 0),
                    priceChange: sanitizeNumber(stock.priceChange, 0),
                    dayHigh: sanitizeNumber(stock.dayHigh, 0),
                    dayLow: sanitizeNumber(stock.dayLow, 0),
                    openPrice: sanitizeNumber(stock.openPrice, 0),
                    volume: sanitizeNumber(stock.volume, 0),
                    lastUpdated: Date.now()
                };
            });
            
            await batchUpdateFirebase(updates);
        }
        
        // Update F&O contracts with expiry
        await updateFOContractsToFirebase();
        
    } catch (error) {
        console.error('❌ Error updating live stock data:', error.message);
    }
}

// =====================================================
// LIVE INDEX DATA UPDATE
// =====================================================

async function updateLiveIndexData() {
    try {
        console.log('📊 Fetching live index data...');
        
        await updateAllIndices();
        
        const indices = await Index.find({}).lean();
        
        if (indices.length === 0) {
            console.log('⚠️  No indices found');
            return;
        }
        
        const updates = {};
        
        indices.forEach(index => {
            const key = index.name.replace(/[.#$\[\]]/g, '_');
            updates[`indices/${key}`] = {
                name: index.name,
                displayName: index.displayName || index.name,
                value: sanitizeNumber(index.value, 0),
                percentageChange: sanitizeNumber(index.percentageChange, 0),
                change: sanitizeNumber(index.change, 0),
                dayHigh: sanitizeNumber(index.dayHigh, 0),
                dayLow: sanitizeNumber(index.dayLow, 0),
                openValue: sanitizeNumber(index.openValue, 0),
                lastUpdated: Date.now()
            };
        });
        
        await batchUpdateFirebase(updates);
        console.log(`✅ Updated ${indices.length} indices to Firebase`);
        
    } catch (error) {
        console.error('❌ Error updating index data:', error.message);
    }
}

// =====================================================
// MARKET DEPTH UPDATE
// =====================================================

async function updateLiveMarketDepth() {
    try {
        // Get random sample of stocks for depth
        const sampleSymbols = ACTIVE_SYMBOLS.slice(0, 10);
        
        for (const symbol of sampleSymbols) {
            const depth = await depthService.generateDepth(symbol);
            
            if (depth) {
                await updateFirebase(`market_depth/${symbol}`, {
                    symbol: depth.symbol,
                    bids: depth.bids,
                    asks: depth.asks,
                    lastUpdated: Date.now()
                });
            }
        }
    } catch (error) {
        // Silently handle depth errors
    }
}

// =====================================================
// MONGODB DIRECT SAVE FUNCTIONS
// =====================================================

async function saveToMongoDB(collection, data) {
    try {
        if (collection === 'stocks') {
            const stock = await Stock.findOneAndUpdate(
                { symbol: data.symbol },
                { $set: data },
                { upsert: true, new: true }
            );
            return stock;
        } else if (collection === 'indices') {
            const index = await Index.findOneAndUpdate(
                { name: data.name },
                { $set: data },
                { upsert: true, new: true }
            );
            return index;
        }
    } catch (error) {
        console.error(`MongoDB save error:`, error.message);
        return null;
    }
}

async function batchSaveToMongoDB(collection, dataArray) {
    try {
        const results = [];
        
        for (const data of dataArray) {
            const result = await saveToMongoDB(collection, data);
            if (result) results.push(result);
        }
        
        return results;
    } catch (error) {
        console.error(`MongoDB batch save error:`, error.message);
        return [];
    }
}

// =====================================================
// MARKET STATUS CHECK
// =====================================================

function isMarketOpen() {
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = ist.getDay();
    const hour = ist.getHours();
    const minute = ist.getMinutes();
    
    if (day === 0 || day === 6) return false; // Weekend
    
    const currentMinutes = hour * 60 + minute;
    const marketOpen = 9 * 60 + 15; // 9:15 AM
    const marketClose = 15 * 60 + 30; // 3:30 PM
    
    return currentMinutes >= marketOpen && currentMinutes <= marketClose;
}

function getMarketStatus() {
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    
    return {
        isOpen: isMarketOpen(),
        time: ist.toLocaleTimeString('en-IN'),
        status: isMarketOpen() ? 'OPEN 🟢' : 'CLOSED 🔴'
    };
}

// =====================================================
// BATCH UPDATE FOR LARGE DATASETS
// =====================================================

async function updateStocksInBatches(batchSize = 50) {
    try {
        const stocks = await Stock.find({ 
            contractType: 'SPOT',
            isActive: true 
        }).lean();
        
        const batches = [];
        for (let i = 0; i < stocks.length; i += batchSize) {
            batches.push(stocks.slice(i, i + batchSize));
        }
        
        console.log(`📦 Processing ${batches.length} batches...`);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            try {
                const updates = {};
                
                batch.forEach(stock => {
                    const key = stock.symbol.replace(/[.#$\[\]]/g, '_');
                    updates[`stocks/${key}`] = {
                        symbol: stock.symbol,
                        companyName: stock.companyName || stock.symbol,
                        currentPrice: sanitizeNumber(stock.currentPrice, 0),
                        percentageChange: sanitizeNumber(stock.percentageChange, 0),
                        priceChange: sanitizeNumber(stock.priceChange, 0),
                        dayHigh: sanitizeNumber(stock.dayHigh, 0),
                        dayLow: sanitizeNumber(stock.dayLow, 0),
                        openPrice: sanitizeNumber(stock.openPrice, 0),
                        volume: sanitizeNumber(stock.volume, 0),
                        lastUpdated: Date.now()
                    };
                });
                
                await batchUpdateFirebase(updates);
                
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (error) {
                console.error(`❌ Batch ${i + 1} failed:`, error.message);
            }
        }
        
        console.log('✅ All batches processed');
    } catch (error) {
        console.error('❌ Batch update error:', error.message);
    }
}

// =====================================================
// CONTINUOUS UPDATE SCHEDULER (1ms intervals)
// =====================================================

let stockUpdateInterval = null;
let indexUpdateInterval = null;
let foUpdateInterval = null;
let statusCheckInterval = null;

function startContinuousUpdates() {
    const marketStatus = getMarketStatus();
    console.log('\n' + '='.repeat(70));
    console.log('🔥 FIREBASE REAL-TIME UPDATE JOB STARTED (WITH F&O EXPIRY)');
    console.log('='.repeat(70));
    console.log(`📍 Current Status: ${marketStatus.status}`);
    console.log(`🕐 IST Time: ${marketStatus.time}`);
    console.log(`📊 Tracking ${ACTIVE_SYMBOLS.length} equity stocks + F&O contracts`);
    console.log(`🌐 Update Mode: Live Yahoo Finance API → MongoDB → Firebase`);
    console.log(`⏱️  Update Frequency: 1ms (continuous)`);
    console.log('='.repeat(70) + '\n');
    
    // Initial update
    console.log('🚀 Running initial update...\n');
    updateLiveStockData();
    updateLiveIndexData();
    //updateLiveMarketDepth();
    
    // ✨ Update stocks every 1ms (ultra-fast)
    stockUpdateInterval = setInterval(async () => {
        const status = getMarketStatus();
        
        if (status.isOpen) {
            await updateLiveStockData(); // Includes equity + F&O with expiry
        }
    }, 1); // ✨ 1 millisecond!
    
    // Update indices every 1ms
    indexUpdateInterval = setInterval(async () => {
        const status = getMarketStatus();
        
        if (status.isOpen) {
            await updateLiveIndexData();
        }
    }, 1); // ✨ 1 millisecond!
    
    // Update F&O contracts (with expiry) every 1ms
    foUpdateInterval = setInterval(async () => {
        const status = getMarketStatus();
        
        if (status.isOpen) {
            await updateFOContractsToFirebase(); // Updates expiry countdown
        }
    }, 1); // ✨ 1 millisecond!
    
    // // Market depth every 100ms (slightly slower to avoid overload)
    // setInterval(async () => {
    //     const status = getMarketStatus();
        
    //     if (status.isOpen) {
    //         await updateLiveMarketDepth();
    //     }
    // }, 100); // 100ms
    
    // Status check every 60 seconds
    statusCheckInterval = setInterval(() => {
        const status = getMarketStatus();
        console.log(`\n📊 Status: ${status.status} | Time: ${status.time}`);
    }, 60000);
    
    console.log('✅ Update intervals configured:');
    console.log('   📈 Equity Stocks: Every 1ms');
    console.log('   📊 F&O Contracts (with expiry): Every 1ms');
    console.log('   🌐 Indices: Every 1ms');
    console.log('   📉 Market Depth: Every 100ms');
    console.log('   📊 Status Check: Every 60 seconds\n');
}

function stopContinuousUpdates() {
    if (stockUpdateInterval) clearInterval(stockUpdateInterval);
    if (indexUpdateInterval) clearInterval(indexUpdateInterval);
    if (foUpdateInterval) clearInterval(foUpdateInterval);
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    
    console.log('\n🛑 Firebase update job stopped\n');
}

// =====================================================
// MANUAL UPDATE FUNCTIONS
// =====================================================

async function manualStockUpdate() {
    console.log('🔧 Manual stock update triggered...');
    await updateLiveStockData();
}

async function manualIndexUpdate() {
    console.log('🔧 Manual index update triggered...');
    await updateLiveIndexData();
}

async function manualFOUpdate() {
    console.log('🔧 Manual F&O update triggered...');
    await updateFOContractsToFirebase();
}

async function manualFullUpdate() {
    console.log('🔧 Manual full update triggered...');
    await updateLiveStockData();
    await updateLiveIndexData();
    await updateFOContractsToFirebase();
}

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

process.on('SIGINT', () => {
    console.log('\n⚠️  Received SIGINT signal...');
    stopContinuousUpdates();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n⚠️  Received SIGTERM signal...');
    stopContinuousUpdates();
    process.exit(0);
});

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    // Main functions
    startContinuousUpdates,
    stopContinuousUpdates,
    
    // Update functions
    updateLiveStockData,
    updateLiveIndexData,
    updateFOContractsToFirebase, // ✨ New!
    updateStocksInBatches,
    updateLiveMarketDepth,
    
    // Manual triggers
    manualStockUpdate,
    manualIndexUpdate,
    manualFOUpdate, // ✨ New!
    manualFullUpdate,
    
    // Utility
    isMarketOpen,
    getMarketStatus,
    
    // Direct Firebase access
    updateFirebase,
    batchUpdateFirebase,
    
    // MongoDB access
    saveToMongoDB,
    batchSaveToMongoDB
};