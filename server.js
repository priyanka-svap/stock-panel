// server.js - FIREBASE VERSION
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected Successfully'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// Import Routes
const authRoutes = require('./routes/auth');
const stockRoutes = require('./routes/stocks');
const indexRoutes = require('./routes/indices');
const orderRoutes = require('./routes/orders');
const positionRoutes = require('./routes/positions');
const holdingRoutes = require('./routes/holdings');
const watchlistRoutes = require('./routes/watchlist');
const fundsRoutes = require('./routes/funds');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/indices', indexRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/holdings', holdingRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/funds', fundsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    firebase: 'Connected',
    timestamp: new Date()
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Stock Panel API running on port ${PORT}`);
  console.log(`🔥 Firebase Realtime Database ready`);
});

// Start Firebase auto-update jobs
const { startFirebaseStockUpdates, startFirebaseIndexUpdates, startIndexUpdateJob, startStockUpdateJob } = require('./jobs/marketUpdateJob');
startFirebaseStockUpdates();
startFirebaseIndexUpdates();
startIndexUpdateJob();
startStockUpdateJob();