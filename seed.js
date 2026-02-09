// seed.js - Seed database with initial data
const mongoose = require('mongoose');
const Stock = require('./models/Stock');
const Index = require('./models/Index');
const User = require('./models/User');
const { updateMultipleStocks, updateAllIndices } = require('./services/liveDataService');
require('dotenv').config();

const stockSymbols = [
  // NIFTY 50 Stocks
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL', 'KOTAKBANK',
  'LT', 'AXISBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI',
  'HCLTECH', 'WIPRO', 'TITAN', 'NESTLEIND', 'ULTRACEMCO',
  'SUNPHARMA', 'ONGC', 'NTPC', 'POWERGRID', 'M&M',
  'TATAMOTORS', 'TATASTEEL', 'ADANIPORTS', 'COALINDIA', 'JSWSTEEL',
  'GRASIM', 'BAJAJFINSV', 'HINDALCO', 'INDUSINDBK', 'DRREDDY',
  'CIPLA', 'EICHERMOT', 'DIVISLAB', 'HEROMOTOCO', 'APOLLOHOSP',
  'TECHM', 'TATACONSUM', 'BRITANNIA', 'SHRIRAMFIN', 'ADANIENT',
  'SBILIFE', 'LTIM', 'BAJAJ-AUTO', 'HDFCLIFE', 'TRENT',
  
  // Other Major Stocks
  'ADANIGREEN', 'ADANIPOWER', 'VEDL', 'BANKBARODA', 'PNB',
  'CANBK', 'UNIONBANK', 'IDFCFIRSTB', 'FEDERALBNK', 'BANDHANBNK',
  'AUBANK', 'RBLBANK', 'YESBANK', 'IDFC', 'CHOLAFIN',
  
  // IT & Tech
  'PERSISTENT', 'COFORGE', 'MPHASIS', 'INFOEDGE', 'ZOMATO',
  'PAYTM', 'NYKAA', 'POLICYBZR', 'ZEEL', 'BHARTIHEXA',
  
  // Pharma
  'BIOCON', 'LUPIN', 'TORNTPHARM', 'ALKEM', 'AUROPHARMA',
  'GLENMARK', 'ZYDUSLIFE', 'IPCALAB', 'LAURUSLABS', 'NATCOPHARM',
  
  // Auto
  'MAHINDRA', 'ASHOKLEY', 'MOTHERSON', 'BALKRISIND', 'MRF',
  'APOLLOTYRE', 'CEAT', 'EXIDEIND', 'AMBUJACEM', 'BOSCHLTD',
  
  // Energy & Power
  'ADANIENSOL', 'ADANITRANS', 'TATAPOWER', 'NHPC', 'SJVN',
  'TORNTPOWER', 'CESC', 'JSPL', 'SAIL', 'NMDC',
  
  // FMCG & Consumer
  'DABUR', 'GODREJCP', 'MARICO', 'EMAMILTD', 'COLPAL',
  'PGHH', 'MCDOWELL-N', 'RADICO', 'VBL', 'TATAELXSI',
  
  // Real Estate & Infrastructure
  'DLF', 'OBEROIRLTY', 'GODREJPROP', 'PRESTIGE', 'BRIGADE',
  'PHOENIXLTD', 'IBREALEST', 'SOBHA', 'SUNTECK', 'MAHLIFE',
  
  // Telecom & Media
  'IDEA', 'ROUTE', 'TTML', 'GTPL', 'HATHWAY',
  
  // Retail & E-commerce
  'DMART', 'ABFRL', 'SHOPERSTOP', 'VMART', 'ADITYA',
  
  // Manufacturing
  'HAVELLS', 'CROMPTON', 'VOLTAS', 'BLUESTARCO', 'WHIRLPOOL',
  'DIXON', 'AMBER', 'KAJARIACER', 'CENTURYPLY', 'GREENPLY'
];

async function seedDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB');
    console.log('✅ Connected to MongoDB\n');
    
    // Clear existing data
    await Stock.deleteMany({});
    await Index.deleteMany({});
    console.log('🗑️  Cleared existing data\n');
    
    // Seed Indices
    console.log('📊 Fetching live index data...');
    await updateAllIndices();
    console.log('✅ Indices seeded with live data\n');
    
    // Seed Stocks
    console.log(`📈 Fetching live data for ${stockSymbols.length} stocks...`);
    const results = await updateMultipleStocks(stockSymbols);
    const successful = results.filter(r => r.success).length;
    console.log(`✅ Successfully seeded ${successful}/${stockSymbols.length} stocks\n`);
    
    // Create demo user
    const demoUser = await User.findOne({ username: 'demo' });
    if (!demoUser) {
      const user = new User({
        username: 'demo',
        password: 'demo123',
        email: 'demo@stockpanel.com',
        fullName: 'Demo User',
        availableBalance: 100000,
        portfolioValue: 50000,
        totalPnL: 2500
      });
      await user.save();
      console.log('👤 Demo user created:');
      console.log('   Username: demo');
      console.log('   Password: demo123\n');
    }
    
    // Display summary
    const stocks = await Stock.find({}).limit(10);
    console.log('📊 Sample Stocks:');
    console.log('━'.repeat(80));
    stocks.forEach(stock => {
      const change = stock.percentageChange > 0 ? `+${stock.percentageChange}%` : `${stock.percentageChange}%`;
      const emoji = stock.percentageChange > 0 ? '🟢' : '🔴';
      console.log(`${emoji} ${stock.symbol.padEnd(12)} ₹${stock.currentPrice.toFixed(2).padStart(10)} ${change.padStart(8)}`);
    });
    console.log('━'.repeat(80));
    
    const indices = await Index.find({});
    console.log('\n📊 Market Indices:');
    console.log('━'.repeat(80));
    indices.forEach(index => {
      const change = index.percentageChange > 0 ? `+${index.percentageChange}%` : `${index.percentageChange}%`;
      const emoji = index.percentageChange > 0 ? '🟢' : '🔴';
      console.log(`${emoji} ${index.displayName.padEnd(15)} ${index.value.toFixed(2).padStart(12)} ${change.padStart(8)}`);
    });
    console.log('━'.repeat(80));
    
    console.log('\n✨ Database seeding completed!');
    console.log('💡 Start the server with: npm start\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    process.exit(1);
  }
}

seedDatabase();
