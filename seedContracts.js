// seedContracts.js - Generate Sample F&O Contracts
const mongoose = require('mongoose');
const Stock = require('./models/Stock');
require('dotenv').config();

// Helper function to get next expiry dates
function getNextExpiries(count = 3) {
  const expiries = [];
  const now = new Date();
  
  // Find next Thursday (weekly expiry for NIFTY/BANKNIFTY)
  let nextThursday = new Date(now);
  nextThursday.setDate(now.getDate() + ((4 - now.getDay() + 7) % 7));
  
  for (let i = 0; i < count; i++) {
    const expiry = new Date(nextThursday);
    expiry.setDate(nextThursday.getDate() + (i * 7));
    expiry.setHours(15, 30, 0, 0); // 3:30 PM expiry
    expiries.push(expiry);
  }
  
  return expiries;
}

// Helper function to get monthly expiries
function getMonthlyExpiries(count = 3) {
  const expiries = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    // Last Thursday of the month
    const month = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
    let lastThursday = month.getDate();
    
    while (new Date(month.getFullYear(), month.getMonth(), lastThursday).getDay() !== 4) {
      lastThursday--;
    }
    
    const expiry = new Date(month.getFullYear(), month.getMonth(), lastThursday, 15, 30);
    expiries.push(expiry);
  }
  
  return expiries;
}

// Helper to get expiry month name
function getExpiryMonth(date) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const year = date.getFullYear().toString().slice(-2);
  return `${months[date.getMonth()]}${year}`;
}

// Helper to generate strike prices
function generateStrikes(basePrice, count = 20, step = 50) {
  const strikes = [];
  const atmStrike = Math.round(basePrice / step) * step;
  const start = atmStrike - (Math.floor(count / 2) * step);
  
  for (let i = 0; i < count; i++) {
    strikes.push(start + (i * step));
  }
  
  return strikes;
}

async function seedContracts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB');
    console.log('Connected to MongoDB');
    
    // ⚠️ IMPORTANT: Only clear F&O contracts, preserve EQUITY stocks
    const result = await Stock.deleteMany({ 
      instrumentType: { $ne: 'EQUITY' } 
    });
    console.log(`Cleared ${result.deletedCount} existing F&O contracts`);
    console.log('✅ Existing equity stocks preserved');
    
    const contracts = [];
    
    // ===================================
    // NIFTY INDEX OPTIONS & FUTURES
    // ===================================
    console.log('Creating NIFTY contracts...');
    const niftyPrice = 24500;
    const niftyExpiries = getNextExpiries(4);
    const monthlyExpiry = getMonthlyExpiries(1)[0];
    
    // NIFTY Weekly Options
    for (const expiry of niftyExpiries.slice(0, 2)) {
      const strikes = generateStrikes(niftyPrice, 30, 50);
      const expiryMonth = getExpiryMonth(expiry);
      
      for (const strike of strikes) {
        // Call Option
        contracts.push({
          symbol: 'NIFTY',
          companyName: 'NIFTY 50',
          instrumentType: 'OPTIDX',
          contractType: 'CE',
          expiryDate: expiry,
          expiryMonth,
          strikePrice: strike,
          lotSize: 50,
          underlyingSymbol: 'NIFTY',
          exchange: 'NFO',
          currentPrice: '0',
          previousClose: '0',
          isActive: true
        });
        
        // Put Option
        contracts.push({
          symbol: 'NIFTY',
          companyName: 'NIFTY 50',
          instrumentType: 'OPTIDX',
          contractType: 'PE',
          expiryDate: expiry,
          expiryMonth,
          strikePrice: strike,
          lotSize: 50,
          underlyingSymbol: 'NIFTY',
          exchange: 'NFO',
          currentPrice: '0',
          previousClose: '0',
          isActive: true
        });
      }
    }
    
    // NIFTY Monthly Futures
    for (let i = 0; i < 3; i++) {
      const expiry = new Date(monthlyExpiry);
      expiry.setMonth(monthlyExpiry.getMonth() + i);
      const expiryMonth = getExpiryMonth(expiry);
      
      contracts.push({
        symbol: 'NIFTY',
        companyName: 'NIFTY 50',
        instrumentType: 'FUTIDX',
        contractType: 'FUTURES',
        expiryDate: expiry,
        expiryMonth,
        lotSize: 50,
        underlyingSymbol: 'NIFTY',
        exchange: 'NFO',
        currentPrice: '0',
        previousClose: '0',
        isActive: true
      });
    }
    
    // ===================================
    // BANKNIFTY INDEX OPTIONS & FUTURES
    // ===================================
    console.log('Creating BANKNIFTY contracts...');
    const bankNiftyPrice = 52500;
    const bankNiftyExpiries = getNextExpiries(4);
    
    // BANKNIFTY Weekly Options
    for (const expiry of bankNiftyExpiries.slice(0, 2)) {
      const strikes = generateStrikes(bankNiftyPrice, 30, 100);
      const expiryMonth = getExpiryMonth(expiry);
      
      for (const strike of strikes) {
        contracts.push({
          symbol: 'BANKNIFTY',
          companyName: 'NIFTY BANK',
          instrumentType: 'OPTIDX',
          contractType: 'CE',
          expiryDate: expiry,
          expiryMonth,
          strikePrice: strike,
          lotSize: 15,
          underlyingSymbol: 'BANKNIFTY',
          exchange: 'NFO',
          currentPrice: '0',
          previousClose: '0',
          isActive: true
        });
        
        contracts.push({
          symbol: 'BANKNIFTY',
          companyName: 'NIFTY BANK',
          instrumentType: 'OPTIDX',
          contractType: 'PE',
          expiryDate: expiry,
          expiryMonth,
          strikePrice: strike,
          lotSize: 15,
          underlyingSymbol: 'BANKNIFTY',
          exchange: 'NFO',
          currentPrice: '0',
          previousClose: '0',
          isActive: true
        });
      }
    }
    
    // BANKNIFTY Futures
    for (let i = 0; i < 3; i++) {
      const expiry = new Date(monthlyExpiry);
      expiry.setMonth(monthlyExpiry.getMonth() + i);
      const expiryMonth = getExpiryMonth(expiry);
      
      contracts.push({
        symbol: 'BANKNIFTY',
        companyName: 'NIFTY BANK',
        instrumentType: 'FUTIDX',
        contractType: 'FUTURES',
        expiryDate: expiry,
        expiryMonth,
        lotSize: 15,
        underlyingSymbol: 'BANKNIFTY',
        exchange: 'NFO',
        currentPrice: '0',
        previousClose: '0',
        isActive: true
      });
    }
    
    // ===================================
    // STOCK FUTURES & OPTIONS (LIVE PRICES!)
    // ===================================
    console.log('Creating Stock Futures & Options...');
    console.log('📡 Fetching LIVE spot prices from database...');
    
    // Helper function to get live price from database
    const getLivePrice = async (symbol) => {
      try {
        const stock = await Stock.findOne({ 
          symbol: symbol, 
          instrumentType: 'EQUITY',
          isActive: true
        });
        
        if (stock && stock.currentPrice && parseFloat(stock.currentPrice) > 0) {
          const price = parseFloat(stock.currentPrice);
          console.log(`  ✓ ${symbol}: ₹${price.toFixed(2)} (LIVE)`);
          return price;
        }
        
        console.log(`  ⚠ ${symbol}: Using fallback price (run seed.js first for live data)`);
        return null; // Will use fallback
      } catch (err) {
        console.log(`  ✗ ${symbol}: Error fetching price`);
        return null;
      }
    };
    
    // Fetch all live prices in parallel for speed
    console.log('\n🔄 Fetching live prices for all stocks...\n');
    
    const stockFuturesConfig = [
      // NIFTY 50 Stocks (High Volume)
      { symbol: 'RELIANCE', name: 'Reliance Industries', fallbackPrice: 2950, lotSize: 250, sector: 'Energy' },
      { symbol: 'TCS', name: 'Tata Consultancy Services', fallbackPrice: 4200, lotSize: 125, sector: 'IT' },
      { symbol: 'HDFCBANK', name: 'HDFC Bank', fallbackPrice: 1650, lotSize: 550, sector: 'Banking' },
      { symbol: 'INFY', name: 'Infosys Limited', fallbackPrice: 1850, lotSize: 300, sector: 'IT' },
      { symbol: 'ICICIBANK', name: 'ICICI Bank', fallbackPrice: 1150, lotSize: 1375, sector: 'Banking' },
      { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', fallbackPrice: 2400, lotSize: 300, sector: 'FMCG' },
      { symbol: 'ITC', name: 'ITC Limited', fallbackPrice: 465, lotSize: 3200, sector: 'FMCG' },
      { symbol: 'SBIN', name: 'State Bank of India', fallbackPrice: 825, lotSize: 1500, sector: 'Banking' },
      { symbol: 'BHARTIARTL', name: 'Bharti Airtel', fallbackPrice: 1550, lotSize: 575, sector: 'Telecom' },
      { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', fallbackPrice: 1750, lotSize: 400, sector: 'Banking' },
      { symbol: 'LT', name: 'Larsen & Toubro', fallbackPrice: 3600, lotSize: 250, sector: 'Infrastructure' },
      { symbol: 'AXISBANK', name: 'Axis Bank', fallbackPrice: 1150, lotSize: 1200, sector: 'Banking' },
      { symbol: 'BAJFINANCE', name: 'Bajaj Finance', fallbackPrice: 7200, lotSize: 125, sector: 'Finance' },
      { symbol: 'ASIANPAINT', name: 'Asian Paints', fallbackPrice: 2850, lotSize: 300, sector: 'Paints' },
      { symbol: 'MARUTI', name: 'Maruti Suzuki', fallbackPrice: 12500, lotSize: 50, sector: 'Auto' },
      { symbol: 'HCLTECH', name: 'HCL Technologies', fallbackPrice: 1850, lotSize: 500, sector: 'IT' },
      { symbol: 'WIPRO', name: 'Wipro Limited', fallbackPrice: 565, lotSize: 1800, sector: 'IT' },
      { symbol: 'TITAN', name: 'Titan Company', fallbackPrice: 3450, lotSize: 250, sector: 'Consumer Goods' },
      { symbol: 'NESTLEIND', name: 'Nestle India', fallbackPrice: 2600, lotSize: 250, sector: 'FMCG' },
      { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', fallbackPrice: 10500, lotSize: 100, sector: 'Cement' },
      
      // Banking & Finance
      { symbol: 'INDUSINDBK', name: 'IndusInd Bank', fallbackPrice: 1425, lotSize: 900, sector: 'Banking' },
      { symbol: 'BANKBARODA', name: 'Bank of Baroda', fallbackPrice: 245, lotSize: 6000, sector: 'Banking' },
      { symbol: 'PNB', name: 'Punjab National Bank', fallbackPrice: 105, lotSize: 15000, sector: 'Banking' },
      { symbol: 'CANBK', name: 'Canara Bank', fallbackPrice: 105, lotSize: 13000, sector: 'Banking' },
      { symbol: 'IDFCFIRSTB', name: 'IDFC First Bank', fallbackPrice: 75, lotSize: 17500, sector: 'Banking' },
      { symbol: 'FEDERALBNK', name: 'Federal Bank', fallbackPrice: 185, lotSize: 7000, sector: 'Banking' },
      { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', fallbackPrice: 1650, lotSize: 500, sector: 'Finance' },
      { symbol: 'SBILIFE', name: 'SBI Life Insurance', fallbackPrice: 1550, lotSize: 500, sector: 'Insurance' },
      { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance', fallbackPrice: 685, lotSize: 1400, sector: 'Insurance' },
      
      // IT Sector
      { symbol: 'TECHM', name: 'Tech Mahindra', fallbackPrice: 1650, lotSize: 600, sector: 'IT' },
      { symbol: 'LTIM', name: 'LTIMindtree', fallbackPrice: 6100, lotSize: 125, sector: 'IT' },
      { symbol: 'PERSISTENT', name: 'Persistent Systems', fallbackPrice: 5800, lotSize: 125, sector: 'IT' },
      { symbol: 'COFORGE', name: 'Coforge Limited', fallbackPrice: 8200, lotSize: 100, sector: 'IT' },
      { symbol: 'MPHASIS', name: 'Mphasis Limited', fallbackPrice: 2950, lotSize: 250, sector: 'IT' },
      
      // Auto Sector
      { symbol: 'TATAMOTORS', name: 'Tata Motors', fallbackPrice: 1050, lotSize: 1250, sector: 'Auto' },
      { symbol: 'M&M', name: 'Mahindra & Mahindra', fallbackPrice: 2950, lotSize: 300, sector: 'Auto' },
      { symbol: 'EICHERMOT', name: 'Eicher Motors', fallbackPrice: 4850, lotSize: 200, sector: 'Auto' },
      { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', fallbackPrice: 9500, lotSize: 100, sector: 'Auto' },
      { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', fallbackPrice: 4750, lotSize: 175, sector: 'Auto' },
      { symbol: 'ASHOKLEY', name: 'Ashok Leyland', fallbackPrice: 225, lotSize: 6000, sector: 'Auto' },
      { symbol: 'TVSMOTOR', name: 'TVS Motor', fallbackPrice: 2450, lotSize: 400, sector: 'Auto' },
      { symbol: 'BOSCHLTD', name: 'Bosch Limited', fallbackPrice: 32000, lotSize: 25, sector: 'Auto Parts' },
      { symbol: 'MRF', name: 'MRF Limited', fallbackPrice: 128000, lotSize: 10, sector: 'Tyres' },
      { symbol: 'APOLLOTYRE', name: 'Apollo Tyres', fallbackPrice: 485, lotSize: 2750, sector: 'Tyres' },
      
      // Pharma Sector
      { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', fallbackPrice: 1750, lotSize: 600, sector: 'Pharma' },
      { symbol: 'DRREDDY', name: 'Dr Reddys Labs', fallbackPrice: 1250, lotSize: 450, sector: 'Pharma' },
      { symbol: 'CIPLA', name: 'Cipla Limited', fallbackPrice: 1450, lotSize: 700, sector: 'Pharma' },
      { symbol: 'DIVISLAB', name: 'Divis Laboratories', fallbackPrice: 5950, lotSize: 150, sector: 'Pharma' },
      { symbol: 'BIOCON', name: 'Biocon Limited', fallbackPrice: 350, lotSize: 3400, sector: 'Pharma' },
      { symbol: 'LUPIN', name: 'Lupin Limited', fallbackPrice: 2050, lotSize: 500, sector: 'Pharma' },
      { symbol: 'TORNTPHARM', name: 'Torrent Pharma', fallbackPrice: 3300, lotSize: 250, sector: 'Pharma' },
      { symbol: 'AUROPHARMA', name: 'Aurobindo Pharma', fallbackPrice: 1250, lotSize: 750, sector: 'Pharma' },
      
      // Metal & Mining
      { symbol: 'TATASTEEL', name: 'Tata Steel', fallbackPrice: 165, lotSize: 6600, sector: 'Metals' },
      { symbol: 'HINDALCO', name: 'Hindalco Industries', fallbackPrice: 650, lotSize: 1850, sector: 'Metals' },
      { symbol: 'JSWSTEEL', name: 'JSW Steel', fallbackPrice: 950, lotSize: 1250, sector: 'Metals' },
      { symbol: 'COALINDIA', name: 'Coal India', fallbackPrice: 450, lotSize: 2700, sector: 'Mining' },
      { symbol: 'VEDL', name: 'Vedanta Limited', fallbackPrice: 465, lotSize: 2700, sector: 'Metals' },
      { symbol: 'HINDZINC', name: 'Hindustan Zinc', fallbackPrice: 525, lotSize: 2000, sector: 'Metals' },
      { symbol: 'NMDC', name: 'NMDC Limited', fallbackPrice: 245, lotSize: 5200, sector: 'Mining' },
      { symbol: 'SAIL', name: 'SAIL', fallbackPrice: 120, lotSize: 10500, sector: 'Metals' },
      
      // Energy & Power
      { symbol: 'ONGC', name: 'ONGC', fallbackPrice: 285, lotSize: 4200, sector: 'Oil & Gas' },
      { symbol: 'POWERGRID', name: 'Power Grid Corp', fallbackPrice: 325, lotSize: 3850, sector: 'Power' },
      { symbol: 'NTPC', name: 'NTPC Limited', fallbackPrice: 385, lotSize: 3250, sector: 'Power' },
      { symbol: 'BPCL', name: 'Bharat Petroleum', fallbackPrice: 610, lotSize: 1800, sector: 'Oil & Gas' },
      { symbol: 'IOC', name: 'Indian Oil Corp', fallbackPrice: 140, lotSize: 8500, sector: 'Oil & Gas' },
      { symbol: 'GAIL', name: 'GAIL India', fallbackPrice: 200, lotSize: 6300, sector: 'Oil & Gas' },
      { symbol: 'ADANIGREEN', name: 'Adani Green Energy', fallbackPrice: 1850, lotSize: 500, sector: 'Power' },
      { symbol: 'ADANIPOWER', name: 'Adani Power', fallbackPrice: 585, lotSize: 2000, sector: 'Power' },
      { symbol: 'TATAPOWER', name: 'Tata Power', fallbackPrice: 425, lotSize: 2800, sector: 'Power' },
      
      // FMCG & Consumer
      { symbol: 'BRITANNIA', name: 'Britannia Industries', fallbackPrice: 4850, lotSize: 200, sector: 'FMCG' },
      { symbol: 'DABUR', name: 'Dabur India', fallbackPrice: 505, lotSize: 2350, sector: 'FMCG' },
      { symbol: 'GODREJCP', name: 'Godrej Consumer', fallbackPrice: 1150, lotSize: 900, sector: 'FMCG' },
      { symbol: 'MARICO', name: 'Marico Limited', fallbackPrice: 635, lotSize: 1950, sector: 'FMCG' },
      { symbol: 'COLPAL', name: 'Colgate Palmolive', fallbackPrice: 2850, lotSize: 300, sector: 'FMCG' },
      { symbol: 'TATACONSUM', name: 'Tata Consumer', fallbackPrice: 1050, lotSize: 1000, sector: 'FMCG' },
      
      // Infrastructure & Real Estate
      { symbol: 'ADANIPORTS', name: 'Adani Ports', fallbackPrice: 1250, lotSize: 925, sector: 'Infrastructure' },
      { symbol: 'GRASIM', name: 'Grasim Industries', fallbackPrice: 2550, lotSize: 375, sector: 'Cement' },
      { symbol: 'DLF', name: 'DLF Limited', fallbackPrice: 925, lotSize: 1300, sector: 'Real Estate' },
      { symbol: 'GODREJPROP', name: 'Godrej Properties', fallbackPrice: 2750, lotSize: 325, sector: 'Real Estate' },
      { symbol: 'OBEROIRLTY', name: 'Oberoi Realty', fallbackPrice: 1950, lotSize: 500, sector: 'Real Estate' },
      
      // Telecom & Media
      { symbol: 'IDEA', name: 'Vodafone Idea', fallbackPrice: 12, lotSize: 100000, sector: 'Telecom' },
      { symbol: 'ZEEL', name: 'Zee Entertainment', fallbackPrice: 140, lotSize: 8500, sector: 'Media' },
      
      // Retail & E-commerce
      { symbol: 'DMART', name: 'Avenue Supermarts', fallbackPrice: 3850, lotSize: 250, sector: 'Retail' },
      { symbol: 'TRENT', name: 'Trent Limited', fallbackPrice: 6800, lotSize: 125, sector: 'Retail' },
      
      // Miscellaneous
      { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', fallbackPrice: 6950, lotSize: 125, sector: 'Healthcare' },
      { symbol: 'SHRIRAMFIN', name: 'Shriram Finance', fallbackPrice: 3050, lotSize: 300, sector: 'Finance' },
      { symbol: 'ADANIENT', name: 'Adani Enterprises', fallbackPrice: 2850, lotSize: 325, sector: 'Conglomerate' },
      { symbol: 'INDIGO', name: 'InterGlobe Aviation', fallbackPrice: 4350, lotSize: 200, sector: 'Aviation' },
      { symbol: 'PIDILITIND', name: 'Pidilite Industries', fallbackPrice: 3100, lotSize: 300, sector: 'Chemicals' },
      { symbol: 'HAVELLS', name: 'Havells India', fallbackPrice: 1650, lotSize: 600, sector: 'Electricals' },
      { symbol: 'VOLTAS', name: 'Voltas Limited', fallbackPrice: 1650, lotSize: 600, sector: 'Consumer Durables' },
      { symbol: 'DIXON', name: 'Dixon Technologies', fallbackPrice: 15500, lotSize: 50, sector: 'Electronics' },
      { symbol: 'SIEMENS', name: 'Siemens Limited', fallbackPrice: 6850, lotSize: 125, sector: 'Engineering' },
      { symbol: 'ABB', name: 'ABB India', fallbackPrice: 6950, lotSize: 125, sector: 'Engineering' },
      { symbol: 'BERGEPAINT', name: 'Berger Paints', fallbackPrice: 465, lotSize: 2600, sector: 'Paints' },
      { symbol: 'MOTHERSON', name: 'Samvardhana Motherson', fallbackPrice: 165, lotSize: 7200, sector: 'Auto Parts' }
    ];
    
    // 🔥 FETCH LIVE PRICES FOR ALL STOCKS
    console.log('📊 Fetching live prices in batches...\n');
    const stockFutures = [];
    let liveCount = 0;
    let fallbackCount = 0;
    
    for (const config of stockFuturesConfig) {
      const livePrice = await getLivePrice(config.symbol);
      const finalPrice = livePrice || config.fallbackPrice;
      
      if (livePrice) liveCount++;
      else fallbackCount++;
      
      stockFutures.push({
        symbol: config.symbol,
        name: config.name,
        price: finalPrice,
        lotSize: config.lotSize,
        sector: config.sector
      });
    }
    
    console.log(`\n📊 Price Summary:`);
    console.log(`   ✅ Live prices: ${liveCount}`);
    console.log(`   ⚠️  Fallback prices: ${fallbackCount}`);
    console.log(`   💡 Total stocks: ${stockFutures.length}\n`);
    
    if (fallbackCount > 0) {
      console.log('⚠️  Note: Some stocks using fallback prices.');
      console.log('   Run "node seed.js" first to populate equity stocks with live data.\n');
    }
    
    // Create F&O contracts with live/fallback prices
    for (const stock of stockFutures) {
      const monthlyExpiries = getMonthlyExpiries(3);
      
      // Create futures for next 3 months for all stocks
      for (const expiry of monthlyExpiries) {
        const expiryMonth = getExpiryMonth(expiry);
        
        contracts.push({
          symbol: stock.symbol,
          companyName: stock.name,
          instrumentType: 'FUTSTK',
          contractType: 'FUTURES',
          expiryDate: expiry,
          expiryMonth,
          lotSize: stock.lotSize,
          underlyingSymbol: stock.symbol,
          exchange: 'NFO',
          currentPrice: '0',
          previousClose: '0',
          sector: stock.sector,
          isActive: true
        });
      }
      
      // Create options ONLY for top 20 liquid stocks (to reduce database size)
      const topLiquidStocks = [
        'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
        'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT',
        'AXISBANK', 'BAJFINANCE', 'MARUTI', 'TATAMOTORS', 'TATASTEEL',
        'SUNPHARMA', 'ONGC', 'NTPC', 'M&M', 'HCLTECH'
      ];
      
      if (topLiquidStocks.includes(stock.symbol)) {
        // Create options for current month only
        const currentMonthExpiry = monthlyExpiries[0];
        const strikes = generateStrikes(stock.price, 10, stock.price < 500 ? 10 : stock.price < 2000 ? 50 : 100);
        const expiryMonth = getExpiryMonth(currentMonthExpiry);
        
        for (const strike of strikes) {
          contracts.push({
            symbol: stock.symbol,
            companyName: stock.name,
            instrumentType: 'OPTSTK',
            contractType: 'CE',
            expiryDate: currentMonthExpiry,
            expiryMonth,
            strikePrice: strike,
            lotSize: stock.lotSize,
            underlyingSymbol: stock.symbol,
            exchange: 'NFO',
            currentPrice: '0',
            previousClose: '0',
            sector: stock.sector,
            isActive: true
          });
          
          contracts.push({
            symbol: stock.symbol,
            companyName: stock.name,
            instrumentType: 'OPTSTK',
            contractType: 'PE',
            expiryDate: currentMonthExpiry,
            expiryMonth,
            strikePrice: strike,
            lotSize: stock.lotSize,
            underlyingSymbol: stock.symbol,
            exchange: 'NFO',
            currentPrice: '0',
            previousClose: '0',
            sector: stock.sector,
            isActive: true
          });
        }
      }
    }
    
    // ===================================
    // MCX CONTRACTS — Gold, Silver, Crude Oil, Base Metals
    // Ye contracts MCX exchange pe trade hote hain
    // ===================================
    console.log('\nCreating MCX contracts...');

    // MCX monthly expiry = last day of month (commodities ka alag expiry hota hai)
    function getMcxMonthlyExpiries(count = 3) {
      const expiries = [];
      const now = new Date();
      for (let i = 0; i < count; i++) {
        // MCX expiry = 5th of next month (approximate, real expiry calendar se confirm karo)
        const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 5, 23, 55, 0);
        expiries.push(d);
      }
      return expiries;
    }

    const mcxExpiries   = getMcxMonthlyExpiries(3);
    const mcxExpiryStr  = mcxExpiries.map(d => {
      const m = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      return `${m[d.getMonth()]}${d.getFullYear().toString().slice(-2)}`;
    });

    // MCX commodity config — approximate base prices (INR mein)
    const MCX_CONFIG = [
      // Gold
      { symbol: 'GOLD',       name: 'Gold',            unit: '10g',    lotSize: 100,  basePrice: 89500,  category: 'PRECIOUS_METAL' },
      { symbol: 'GOLDM',      name: 'Gold Mini',       unit: '10g',    lotSize: 10,   basePrice: 89500,  category: 'PRECIOUS_METAL' },
      { symbol: 'GOLDPETAL',  name: 'Gold Petal',      unit: '1g',     lotSize: 1,    basePrice: 8950,   category: 'PRECIOUS_METAL' },
      { symbol: 'GOLDGUINEA', name: 'Gold Guinea',     unit: '8g',     lotSize: 8,    basePrice: 71600,  category: 'PRECIOUS_METAL' },
      // Silver
      { symbol: 'SILVER',     name: 'Silver',          unit: '1kg',    lotSize: 30,   basePrice: 102000, category: 'PRECIOUS_METAL' },
      { symbol: 'SILVERM',    name: 'Silver Mini',     unit: '1kg',    lotSize: 5,    basePrice: 102000, category: 'PRECIOUS_METAL' },
      { symbol: 'SILVERMIC',  name: 'Silver Micro',    unit: '1kg',    lotSize: 1,    basePrice: 102000, category: 'PRECIOUS_METAL' },
      // Energy
      { symbol: 'CRUDEOIL',   name: 'Crude Oil',       unit: 'BBL',    lotSize: 100,  basePrice: 6200,   category: 'ENERGY' },
      { symbol: 'CRUDEOILM',  name: 'Crude Oil Mini',  unit: 'BBL',    lotSize: 10,   basePrice: 6200,   category: 'ENERGY' },
      { symbol: 'NATURALGAS', name: 'Natural Gas',     unit: 'MMBTU',  lotSize: 1250, basePrice: 280,    category: 'ENERGY' },
      { symbol: 'NATURALGASM',name: 'Natural Gas Mini',unit: 'MMBTU',  lotSize: 250,  basePrice: 280,    category: 'ENERGY' },
      // Base Metals
      { symbol: 'COPPER',     name: 'Copper',          unit: 'kg',     lotSize: 2500, basePrice: 845,    category: 'BASE_METAL' },
      { symbol: 'COPPERM',    name: 'Copper Mini',     unit: 'kg',     lotSize: 250,  basePrice: 845,    category: 'BASE_METAL' },
      { symbol: 'ZINC',       name: 'Zinc',            unit: 'kg',     lotSize: 5000, basePrice: 265,    category: 'BASE_METAL' },
      { symbol: 'ZINCMINI',   name: 'Zinc Mini',       unit: 'kg',     lotSize: 1000, basePrice: 265,    category: 'BASE_METAL' },
      { symbol: 'LEAD',       name: 'Lead',            unit: 'kg',     lotSize: 5000, basePrice: 185,    category: 'BASE_METAL' },
      { symbol: 'LEADMINI',   name: 'Lead Mini',       unit: 'kg',     lotSize: 1000, basePrice: 185,    category: 'BASE_METAL' },
      { symbol: 'ALUMINIUM',  name: 'Aluminium',       unit: 'kg',     lotSize: 5000, basePrice: 235,    category: 'BASE_METAL' },
      { symbol: 'ALUMINIUMM', name: 'Aluminium Mini',  unit: 'kg',     lotSize: 1000, basePrice: 235,    category: 'BASE_METAL' },
      { symbol: 'NICKEL',     name: 'Nickel',          unit: 'kg',     lotSize: 1500, basePrice: 1425,   category: 'BASE_METAL' },
      { symbol: 'NICKELM',    name: 'Nickel Mini',     unit: 'kg',     lotSize: 100,  basePrice: 1425,   category: 'BASE_METAL' },
    ];

    // MCX contracts create karo — next 3 monthly expiries ke liye
    for (const cfg of MCX_CONFIG) {
      for (let ei = 0; ei < mcxExpiries.length; ei++) {
        const expiry     = mcxExpiries[ei];
        const expiryStr  = mcxExpiryStr[ei];

        // Days to expiry se basis premium calculate karo (commodities)
        const daysToExp    = Math.max(0, Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24)));
        const annualRate   = 0.06; // commodity storage + financing cost
        const premium      = cfg.basePrice * (daysToExp / 365) * annualRate;
        const futurePrice  = parseFloat((cfg.basePrice + premium).toFixed(2));
        const prevClose    = parseFloat((cfg.basePrice * 0.998).toFixed(2)); // slight discount as prev close
        const priceChange  = parseFloat((futurePrice - prevClose).toFixed(2));
        const pctChange    = parseFloat(((priceChange / prevClose) * 100).toFixed(2));

        contracts.push({
          symbol:           `${cfg.symbol}-${expiryStr}`,
          companyName:      cfg.name,
          contractType:     'FUTURE',
          exchange:         'MCX',
          baseSymbol:       cfg.symbol,
          expiryDate:       expiry,
          expiryString:     expiryStr,
          lotSize:          cfg.lotSize,
          currentPrice:     futurePrice,
          previousClose:    prevClose,
          priceChange:      priceChange,
          percentageChange: pctChange,
          dayHigh:          parseFloat((futurePrice * 1.005).toFixed(2)),
          dayLow:           parseFloat((futurePrice * 0.995).toFixed(2)),
          openPrice:        prevClose,
          volume:           0,
          openInterest:     0,
          sector:           cfg.category,
          industry:         'COMMODITY',
          isActive:         true,
        });
      }
    }

    console.log(`🥇 MCX contracts prepared: ${MCX_CONFIG.length} symbols × ${mcxExpiries.length} expiries = ${MCX_CONFIG.length * mcxExpiries.length} contracts`);

    // Insert all contracts
    console.log(`\nInserting ${contracts.length} total contracts (NSE F&O + MCX)...`);
    await Stock.insertMany(contracts);
    
    console.log('✅ Successfully created all F&O + MCX contracts!');
    console.log('\nSummary:');
    
    const summary = await Stock.aggregate([
      { 
        $match: { instrumentType: { $ne: 'EQUITY' } } 
      },
      {
        $group: {
          _id: {
            instrumentType: '$instrumentType',
            contractType: '$contractType'
          },
          count: { $sum: 1 }
        }
      }
    ]);
    
    summary.forEach(item => {
      console.log(`${item._id.instrumentType} ${item._id.contractType}: ${item.count}`);
    });
    
    await mongoose.connection.close();
    
  } catch (error) {
    console.error('Error seeding contracts:', error);
    process.exit(1);
  }
}

// Run the seeder
if (require.main === module) {
  seedContracts();
}

module.exports = seedContracts;