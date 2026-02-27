// server.js - Firebase via REST API (No Admin SDK needed!)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// ROUTES
// ============================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));
app.use('/api/stocks', require('./routes/stocks'));
app.use('/api/indices', require('./routes/indices'));
const ordersModule = require('./routes/orders');
app.use('/api/orders', ordersModule.router);
// app.use('/api/holdings', require('./routes/holdings'));
app.use('/api/positions', require('./routes/positions'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/funds', require('./routes/funds'));
app.use('/api/market', require('./routes/marketDepthRoutes'));
app.use('/api/contracts', require('./routes/contracts'));
// app.js / server.js
const transactionHistory = require('./routes/transactionHistory');
app.use('/api/transactions', transactionHistory);
// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    firebase: {
      initialized: global.firebaseService?.initialized || false,
      marketOpen: global.firebaseService?.isMarketOpen() || false
    }
  });
});

// ============================================
// DATABASE CONNECTION
// ============================================


// Add this to your server.js - AFTER mongoose.connect

// =====================================================
// FIREBASE REAL-TIME UPDATES (No Admin SDK!)
// =====================================================
const { startContinuousUpdates, stopContinuousUpdates } = require('./jobs/firebaseUpdateJob');
const { startUserDataSync }       = require('./jobs/userDataSyncJob');
const { startSLTPMonitoring }     = require('./jobs/sltpMonitorJob');
const { startPendingOrderMonitor }= require('./jobs/pendingOrderMonitorJob');

// ──────────────────────────────────────────
// DATABASE + START
// ──────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://svappriyankaladhani:Dvvx3tY2XWwhByH0@cluster0.imo5b3m.mongodb.net/stocksDB')
  .then(() => {
    console.log('✅ MongoDB connected');

    // 1. Stock/Index price updates → Firebase  (every 2s)
    startContinuousUpdates();

    // 2. User data → Firebase: full sync every 10s + P&L every 3s
    startUserDataSync(10, 3000);

    // 3. PENDING order monitor: LIMIT/SL/SL-M execution  (every 2s)
    startPendingOrderMonitor(2000);

    // 4. SL/TP auto-exit monitor  (every 3s)
    startSLTPMonitoring(3000);

    console.log('\n' + '═'.repeat(55));
    console.log('🚀 All systems running:');
    console.log('   📈 Stock price updates  → every 2s');
    console.log('   👤 User P&L (Firebase)  → every 3s');
    console.log('   ⚡ Pending order check  → every 2s');
    console.log('   🎯 SL/TP monitor        → every 3s');
    console.log('   🔄 Full user sync       → every 10s');
    console.log('═'.repeat(55) + '\n');
  })
  .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('━'.repeat(60));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 Firebase Realtime Database (REST API)`);
  console.log(`⚡ Updates every 1-2 seconds!`);
  console.log(`📡 No Admin SDK needed!`);
  console.log(`🌐 Health: http://localhost:${PORT}/health`);
  console.log('━'.repeat(60));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️  Shutting down gracefully...');
  stopContinuousUpdates();
  mongoose.connection.close(() => {
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  });
});



// // server.js - FIREBASE VERSION
// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// require('dotenv').config();

// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json());

// // MongoDB Connection
// mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB', {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// })
// .then(() => console.log('✅ MongoDB Connected Successfully'))
// .catch(err => console.error('❌ MongoDB Connection Error:', err));

// // Import Routes
// const authRoutes = require('./routes/auth');
// const stockRoutes = require('./routes/stocks');
// const indexRoutes = require('./routes/indices');
// const orderRoutes = require('./routes/orders');
// const positionRoutes = require('./routes/positions');
// const holdingRoutes = require('./routes/holdings');
// const watchlistRoutes = require('./routes/watchlist');
// const fundsRoutes = require('./routes/funds');
// const userRoutes = require('./routes/users');
// const adminRoutes = require('./routes/admin');

// // Use Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/stocks', stockRoutes);
// app.use('/api/indices', indexRoutes);
// app.use('/api/orders', orderRoutes);
// app.use('/api/positions', positionRoutes);
// app.use('/api/holdings', holdingRoutes);
// app.use('/api/watchlist', watchlistRoutes);
// app.use('/api/funds', fundsRoutes);
// app.use('/api/users', userRoutes);
// app.use('/api/admin', adminRoutes);

// // Health check
// app.get('/api/health', (req, res) => {
//   res.json({ 
//     status: 'Server is running', 
//     database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
//     firebase: 'Connected',
//     timestamp: new Date()
//   });
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`🚀 Stock Panel API running on port ${PORT}`);
//   console.log(`🔥 Firebase Realtime Database ready`);
// });

// // Start Firebase auto-update jobs
// const { startFirebaseStockUpdates, startFirebaseIndexUpdates, startIndexUpdateJob, startStockUpdateJob } = require('./jobs/marketUpdateJob');
// startFirebaseStockUpdates();
// startFirebaseIndexUpdates();
// startIndexUpdateJob();
// startStockUpdateJob();