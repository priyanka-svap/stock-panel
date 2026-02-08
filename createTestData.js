const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Holding = require('./models/Holding');
const Position = require('./models/Position');
const Watchlist = require('./models/Watchlist');
const Stock = require('./models/Stock');

async function createTestData() {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock-panel';
    await mongoose.connect(mongoURI);
    console.log('✓ Connected to MongoDB');
    
    // Get demo user
    const user = await User.findOne({ username: 'demo' });
    if (!user) {
      console.log('❌ Demo user not found. Please run: npm run seed');
      process.exit(1);
    }
    console.log(`✓ Found user: ${user.username}`);
    
    // Get stocks
    const stocks = await Stock.find().limit(10);
    if (stocks.length === 0) {
      console.log('❌ No stocks found. Please run: npm run seed');
      process.exit(1);
    }
    console.log(`✓ Found ${stocks.length} stocks`);
    
    // Clear existing test data for demo user
    await Holding.deleteMany({ userId: user._id });
    await Position.deleteMany({ userId: user._id });
    await Watchlist.deleteMany({ userId: user._id });
    console.log('✓ Cleared old test data');
    
    // Create Holdings
    console.log('\n📊 Creating Holdings...');
    for (let i = 0; i < 5; i++) {
      const stock = stocks[i];
      const quantity = Math.floor(Math.random() * 50) + 10; // 10-60 shares
      const avgPrice = stock.currentPrice * (0.95 + Math.random() * 0.1); // ±5% variation
      const currentPrice = stock.currentPrice;
      const investedValue = quantity * avgPrice;
      const currentValue = quantity * currentPrice;
      const totalPnL = currentValue - investedValue;
      const pnlPercentage = (totalPnL / investedValue) * 100;
      
      await Holding.create({
        userId: user._id,
        symbol: stock.symbol,
        companyName: stock.companyName,
        quantity,
        avgPrice,
        currentPrice,
        investedValue,
        currentValue,
        totalPnL,
        pnlPercentage
      });
      
      console.log(`  ✓ ${stock.symbol}: ${quantity} shares @ ₹${avgPrice.toFixed(2)} (P&L: ${totalPnL >= 0 ? '+' : ''}₹${totalPnL.toFixed(2)})`);
    }
    
    // Create Positions (Intraday)
    console.log('\n⚡ Creating Positions...');
    for (let i = 5; i < 8; i++) {
      const stock = stocks[i];
      const type = Math.random() > 0.5 ? 'BUY' : 'SELL';
      const quantity = Math.floor(Math.random() * 30) + 5; // 5-35 shares
      const avgPrice = stock.currentPrice * (0.98 + Math.random() * 0.04); // ±2% variation
      const currentPrice = stock.currentPrice;
      
      let pnl, pnlPercentage;
      if (type === 'BUY') {
        pnl = (currentPrice - avgPrice) * quantity;
        pnlPercentage = ((currentPrice - avgPrice) / avgPrice) * 100;
      } else {
        pnl = (avgPrice - currentPrice) * quantity;
        pnlPercentage = ((avgPrice - currentPrice) / currentPrice) * 100;
      }
      
      await Position.create({
        userId: user._id,
        symbol: stock.symbol,
        companyName: stock.companyName,
        type,
        quantity,
        avgPrice,
        currentPrice,
        pnl,
        pnlPercentage,
        isOpen: true
      });
      
      console.log(`  ✓ ${type} ${stock.symbol}: ${quantity} shares @ ₹${avgPrice.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)})`);
    }
    
    // Create Watchlist
    console.log('\n⭐ Creating Watchlist...');
    const watchlistStocks = stocks.slice(0, 7).map(s => ({
      symbol: s.symbol,
      companyName: s.companyName,
      addedAt: new Date()
    }));
    
    await Watchlist.create({
      userId: user._id,
      stocks: watchlistStocks
    });
    
    console.log(`  ✓ Added ${watchlistStocks.length} stocks to watchlist`);
    watchlistStocks.forEach(s => console.log(`    - ${s.symbol}`));
    
    // Summary
    console.log('\n✅ Test Data Created Successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Holdings: 5`);
    console.log(`⚡ Positions: 3`);
    console.log(`⭐ Watchlist: ${watchlistStocks.length} stocks`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Now refresh your Admin Panel to see the data!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createTestData();
