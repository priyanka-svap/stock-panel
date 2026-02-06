// server.js - Main Server File
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

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

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  
  socket.on('subscribe', (symbols) => {
    console.log(`📊 Client ${socket.id} subscribed to:`, symbols);
    symbols.forEach(symbol => socket.join(symbol));
  });
  
  socket.on('unsubscribe', (symbols) => {
    symbols.forEach(symbol => socket.leave(symbol));
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Make io available globally
global.io = io;

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
    timestamp: new Date()
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Stock Panel API running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
});

// Start auto-update jobs
const { startIndexUpdateJob, startStockUpdateJob } = require('./jobs/marketUpdateJob');
startIndexUpdateJob();
startStockUpdateJob();

module.exports = { io };
