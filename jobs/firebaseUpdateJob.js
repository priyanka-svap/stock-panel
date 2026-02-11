// jobs/firebaseUpdateJob.js - Live Market Updates (MongoDB + Firebase)
// Updates every 1 second with REAL live data from Yahoo Finance

const Stock = require('../models/Stock');
const Index = require('../models/Index');
const { updateMultipleStocks, updateAllIndices } = require('../services/liveDataService');

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
// FIREBASE REST API FUNCTIONS (No Admin SDK needed!)
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
// LIVE STOCK DATA UPDATE (MongoDB + Firebase)
// =====================================================

async function updateLiveStockData() {
    try {
        console.log('📈 Fetching live stock data from Yahoo Finance...');
        
        // Step 1: Fetch live data and update MongoDB
        const results = await updateMultipleStocks(ACTIVE_SYMBOLS);
        const successful = results.filter(r => r.success).length;
        
        console.log(`✅ Updated ${successful}/${ACTIVE_SYMBOLS.length} stocks in MongoDB`);
        
        // Step 2: Get updated data from MongoDB
        const stocks = await Stock.find({ 
            symbol: { $in: ACTIVE_SYMBOLS },
            isActive: true 
        }).lean();
        
        if (stocks.length === 0) {
            console.log('⚠️  No stocks found in database');
            return;
        }
        
        // Step 3: Prepare Firebase batch update
        // const firebaseUpdates = {};
        
        // stocks.forEach(stock => {
        //     firebaseUpdates[`stocks/${stock.symbol}`] = {
        //         symbol: stock.symbol,
        //         companyName: stock.companyName || stock.symbol,
        //         currentPrice: stock.currentPrice || 0,
        //         percentageChange: stock.percentageChange || 0,
        //         priceChange: stock.priceChange || 0,
        //         dayHigh: stock.dayHigh || 0,
        //         dayLow: stock.dayLow || 0,
        //         openPrice: stock.openPrice || 0,
        //         previousClose: stock.previousClose || 0,
        //         volume: stock.volume || 0,
        //         marketCap: stock.marketCap || 0,
        //         sector: stock.sector || 'Unknown',
        //         lastUpdated: Date.now()
        //     };
        // });
        
        // // Step 4: Push to Firebase
        // const firebaseSuccess = await batchUpdateFirebase(firebaseUpdates);
        
        // if (firebaseSuccess) {
        //     console.log(`🔥 Pushed ${stocks.length} stocks to Firebase`);
            
        //     // Log sample data for verification
        //     const sample = stocks.slice(0, 3);
        //     sample.forEach(s => {
        //         const emoji = s.percentageChange >= 0 ? '🟢' : '🔴';
        //         console.log(`   ${emoji} ${s.symbol}: ₹${s.currentPrice.toFixed(2)} (${s.percentageChange >= 0 ? '+' : ''}${s.percentageChange.toFixed(2)}%)`);
        //     });
        // }
        
        return true;
        
    } catch (error) {
        console.error('❌ Stock update error:', error.message);
        return false;
    }
}

// =====================================================
// LIVE INDEX DATA UPDATE (MongoDB + Firebase)
// =====================================================

async function updateLiveIndexData() {
    try {
        console.log('🌐 Fetching live index data...');
        
        // Step 1: Fetch live data and update MongoDB
        await updateAllIndices();
        console.log('✅ Updated indices in MongoDB');
        
        // Step 2: Get updated data from MongoDB
        const indices = await Index.find({}).lean();
        
        if (indices.length === 0) {
            console.log('⚠️  No indices found in database');
            return;
        }
        
        // Step 3: Prepare Firebase batch update
        // const firebaseUpdates = {};
        
        // indices.forEach(index => {
        //     firebaseUpdates[`indices/${index.name}`] = {
        //         name: index.name,
        //         displayName: index.displayName || index.name,
        //         value: index.value || 0,
        //         percentageChange: index.percentageChange || 0,
        //         change: index.change || 0,
        //         dayHigh: index.dayHigh || 0,
        //         dayLow: index.dayLow || 0,
        //         openValue: index.openValue || 0,
        //         previousClose: index.previousClose || 0,
        //         lastUpdated: Date.now()
        //     };
        // });
        
        // // Step 4: Push to Firebase
        // const firebaseSuccess = await batchUpdateFirebase(firebaseUpdates);
        
        // if (firebaseSuccess) {
        //     console.log(`🔥 Pushed ${indices.length} indices to Firebase`);
            
        //     // Log sample data for verification
        //     indices.forEach(idx => {
        //         const emoji = idx.percentageChange >= 0 ? '🟢' : '🔴';
        //         console.log(`   ${emoji} ${idx.displayName}: ${idx.value.toFixed(2)} (${idx.percentageChange >= 0 ? '+' : ''}${idx.percentageChange.toFixed(2)}%)`);
        //     });
        // }
        
        return true;
        
    } catch (error) {
        console.error('❌ Index update error:', error.message);
        return false;
    }
}

// =====================================================
// MARKET HOURS CHECK (IST Timezone)
// =====================================================

function isMarketOpen() {
    const now = new Date();
    
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60; // minutes
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = utcMinutes + istOffset;
    
    const hours = Math.floor(istMinutes / 60) % 24;
    const minutes = istMinutes % 60;
    const currentTime = hours * 60 + minutes;
    
    // Market hours: 9:15 AM to 3:30 PM IST
    const marketOpen = 9 * 60 + 15;   // 9:15 AM
    const marketClose = 15 * 60 + 30; // 3:30 PM
    
    // Check if weekday (Monday=1 to Friday=5)
    const day = now.getDay();
    const isWeekday = day >= 1 && day <= 5;
    
    return isWeekday && currentTime >= marketOpen && currentTime <= marketClose;
}

function getMarketStatus() {
    const isOpen = isMarketOpen();
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const timeStr = istTime.toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Asia/Kolkata'
    });
    
    return {
        isOpen,
        time: timeStr,
        status: isOpen ? '🟢 MARKET OPEN' : '🔴 MARKET CLOSED'
    };
}

// =====================================================
// BATCH UPDATE - Split stocks into chunks for efficiency
// =====================================================

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

async function updateStocksInBatches() {
    const BATCH_SIZE = 10; // Update 10 stocks at a time
    const batches = chunkArray(ACTIVE_SYMBOLS, BATCH_SIZE);
    
    console.log(`📊 Processing ${ACTIVE_SYMBOLS.length} stocks in ${batches.length} batches...`);
    
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`   Batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);
        
        try {
            // Fetch live data and update MongoDB
            await updateMultipleStocks(batch);
            
            // Get updated data
            const stocks = await Stock.find({ 
                symbol: { $in: batch },
                isActive: true 
            }).lean();
            
            // Push to Firebase
            const updates = {};
            stocks.forEach(stock => {
                updates[`stocks/${stock.symbol}`] = {
                    symbol: stock.symbol,
                    companyName: stock.companyName || stock.symbol,
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
            
            await batchUpdateFirebase(updates);
            
            // Small delay between batches to avoid rate limiting
            if (i < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
        } catch (error) {
            console.error(`   ❌ Batch ${i + 1} failed:`, error.message);
        }
    }
    
    console.log('✅ All batches processed');
}

// =====================================================
// CONTINUOUS UPDATE SCHEDULER
// =====================================================

let stockUpdateInterval = null;
let indexUpdateInterval = null;
let statusCheckInterval = null;

function startContinuousUpdates() {
    const marketStatus = getMarketStatus();
    console.log('\n' + '='.repeat(60));
    console.log('🔥 FIREBASE REAL-TIME UPDATE JOB STARTED');
    console.log('='.repeat(60));
    console.log(`📍 Current Status: ${marketStatus.status}`);
    console.log(`🕐 IST Time: ${marketStatus.time}`);
    console.log(`📊 Tracking ${ACTIVE_SYMBOLS.length} stocks`);
    console.log(`🌐 Update Mode: Live Yahoo Finance API → MongoDB → Firebase`);
    console.log('='.repeat(60) + '\n');
    
    // Initial update
    console.log('🚀 Running initial update...\n');
    updateLiveStockData();
    updateLiveIndexData();
    
    // Update stocks every 2 seconds (more realistic for API rate limits)
    stockUpdateInterval = setInterval(async () => {
        const status = getMarketStatus();
        
        if (status.isOpen) {
            console.log(`\n⏰ [${status.time}] Stock Update Triggered`);
            await updateLiveStockData();
        } else {
            console.log(`\n⏰ [${status.time}] Market Closed - Skipping update`);
        }
    }, 2000); // 2 seconds
    
    // Update indices every 5 seconds
    indexUpdateInterval = setInterval(async () => {
        const status = getMarketStatus();
        
        if (status.isOpen) {
            console.log(`\n⏰ [${status.time}] Index Update Triggered`);
            await updateLiveIndexData();
        }
    }, 5000); // 5 seconds
    
    // Status check every 60 seconds
    statusCheckInterval = setInterval(() => {
        const status = getMarketStatus();
        console.log(`\n📊 Status Check: ${status.status} | Time: ${status.time}`);
    }, 60000); // 60 seconds
    
    console.log('✅ Update intervals configured:');
    console.log('   📈 Stocks: Every 2 seconds');
    console.log('   🌐 Indices: Every 5 seconds');
    console.log('   📊 Status: Every 60 seconds\n');
}

function stopContinuousUpdates() {
    if (stockUpdateInterval) clearInterval(stockUpdateInterval);
    if (indexUpdateInterval) clearInterval(indexUpdateInterval);
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    
    console.log('\n🛑 Firebase update job stopped\n');
}

// =====================================================
// MANUAL UPDATE FUNCTIONS (For testing)
// =====================================================

async function manualStockUpdate() {
    console.log('🔧 Manual stock update triggered...');
    await updateLiveStockData();
}

async function manualIndexUpdate() {
    console.log('🔧 Manual index update triggered...');
    await updateLiveIndexData();
}

async function manualFullUpdate() {
    console.log('🔧 Manual full update triggered...');
    await updateLiveStockData();
    await updateLiveIndexData();
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
    updateStocksInBatches,
    
    // Manual triggers
    manualStockUpdate,
    manualIndexUpdate,
    manualFullUpdate,
    
    // Utility
    isMarketOpen,
    getMarketStatus,
    
    // Direct Firebase access
    updateFirebase,
    batchUpdateFirebase
};
