// routes/admin.js - Complete Admin Panel
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Stock = require('../models/Stock');
const Index = require('../models/Index');
const Order = require('../models/Order');
const Position = require('../models/Position');
const Holding = require('../models/Holding');
const Transaction = require('../models/Transaction');
const Watchlist = require('../models/Watchlist');
const { adminAuth, checkPermission, requireSuperAdmin } = require('../middleware/adminAuth');
const { updateStockPrice, updateIndexPrice } = require('../services/liveDataService');
const { syncSingleUserToFirebase } = require('../services/userFirebaseService');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============================================
// ADMIN AUTHENTICATION
// ============================================

// Admin Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'username and password required'
      });
    }
    
    const admin = await Admin.findOne({ username: username });
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Admin account is inactive'
      });
    }
    
    const isMatch = await admin.comparePassword(password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Update last login
    admin.lastLogin = new Date();
    await admin.save();
    
    // Generate admin token
    const token = jwt.sign(
      { 
        adminId: admin._id, 
        username: admin.username,
        role: admin.role,
        isAdmin: true
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        token,
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          fullName: admin.fullName,
          role: admin.role,
          permissions: admin.permissions
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login error',
      error: error.message
    });
  }
});

// Get Admin Profile
router.get('/profile', adminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId).select('-password');
    res.json({ success: true, data: admin });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// DASHBOARD & ANALYTICS
// ============================================

// Get Dashboard Statistics
router.get('/dashboard/stats', adminAuth, checkPermission('canViewAnalytics'), async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalStocks,
      totalOrders,
      pendingOrders,
      completedOrders,
      totalHoldings,
      totalPositions,
      totalTransactions
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      Stock.countDocuments({ isActive: true }),
      Order.countDocuments(),
      Order.countDocuments({ status: 'PENDING' }),
      Order.countDocuments({ status: 'COMPLETED' }),
      Holding.countDocuments(),
      Position.countDocuments({ isOpen: true }),
      Transaction.countDocuments()
    ]);
    
    // Calculate total trading volume
    const orders = await Order.find({ status: 'COMPLETED' });
    const totalVolume = orders.reduce((sum, order) => sum + order.netAmount, 0);
    
    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          inactive: totalUsers - activeUsers
        },
        stocks: {
          total: totalStocks
        },
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          completed: completedOrders,
          cancelled: totalOrders - (pendingOrders + completedOrders)
        },
        holdings: {
          total: totalHoldings
        },
        positions: {
          open: totalPositions
        },
        transactions: {
          total: totalTransactions
        },
        trading: {
          totalVolume: parseFloat(totalVolume.toFixed(2))
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Recent Activity
router.get('/dashboard/activity', adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const [recentOrders, recentTransactions, recentUsers] = await Promise.all([
      Order.find().sort({ createdAt: -1 }).limit(limit).populate('userId', 'username fullName'),
      Transaction.find().sort({ createdAt: -1 }).limit(limit).populate('userId', 'username fullName'),
      User.find().sort({ createdAt: -1 }).limit(limit).select('-password')
    ]);
    
    res.json({
      success: true,
      data: {
        recentOrders,
        recentTransactions,
        recentUsers
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// USER MANAGEMENT
// ============================================

// Get All Users
router.get('/users', adminAuth, checkPermission('canManageUsers'), async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status } = req.query;
    
    const query = {};
    
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status) {
      query.isActive = status === 'active';
    }
    
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await User.countDocuments(query);
    
    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Single User Details
router.get('/users/:userId', adminAuth, checkPermission('canManageUsers'), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Get user's orders, holdings, positions
    const [orders, holdings, positions, transactions] = await Promise.all([
      Order.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10),
      Holding.find({ userId: user._id }),
      Position.find({ userId: user._id, isOpen: true }),
      Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10)
    ]);
    
    res.json({
      success: true,
      data: {
        user,
        orders,
        holdings,
        positions,
        transactions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// CREATE NEW USER (with margin settings)
// =====================================================

router.post('/users/create', adminAuth, async (req, res) => {
    try {
        const {
            username,
            password,
            email,
            fullName,
            availableBalance,
            marginAllowed,
            marginMultiplier,
            marginEnabled,
            maxLossPerDay
        } = req.body;
        
        // Validate required fields
        if (!username || !password || !email || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'Username, password, email, and fullName are required'
            });
        }
        
        // Check if username exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            });
        }
        
        // Check if email exists
        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }
        
        // Create user
        const user = new User({
            username,
            password,
            email,
            fullName,
            availableBalance: availableBalance || 0,
            marginAllowed: marginAllowed || 0,
            marginMultiplier: marginMultiplier || 1,
            marginEnabled: marginEnabled !== undefined ? marginEnabled : true,
            maxLossPerDay: maxLossPerDay || 0,
            usedMargin: 0,
            totalPnL: 0,
            portfolioValue: 0,
            isActive: true
        });
        
        await user.save();
        
        // Return user without password
        const userObj = user.toObject();
        delete userObj.password;
        
        res.json({
            success: true,
            message: 'User created successfully',
            data: {
                ...userObj,
                totalMargin: user.totalMargin,
                availableMargin: user.availableMargin
            }
        });
        
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// =====================================================
// UPDATE USER (including margin settings)
// =====================================================

router.patch('/users/:id', adminAuth, async (req, res) => {
    try {
        const {
            fullName,
            email,
            availableBalance,
            marginAllowed,
            marginMultiplier,
            marginEnabled,
            maxLossPerDay,
            isActive
        } = req.body;
        
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Update fields if provided
        if (fullName !== undefined) user.fullName = fullName;
        if (email !== undefined) user.email = email;
        if (availableBalance !== undefined) user.availableBalance = availableBalance;
        if (marginAllowed !== undefined) user.marginAllowed = marginAllowed;
        if (marginMultiplier !== undefined) user.marginMultiplier = marginMultiplier;
        if (marginEnabled !== undefined) user.marginEnabled = marginEnabled;
        if (maxLossPerDay !== undefined) user.maxLossPerDay = maxLossPerDay;
        if (isActive !== undefined) user.isActive = isActive;
        
        await user.save();
        
        res.json({
            success: true,
            message: 'User updated successfully',
            data: {
                ...user.toObject(),
                totalMargin: user.totalMargin,
                availableMargin: user.availableMargin,
                marginUtilization: user.marginUtilization
            }
        });
        
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});
router.put('/users/add-funds/:userId', adminAuth, checkPermission('canManageUsers'), async (req, res) => {
  try {
    const { fullName, email, availableBalance, isActive, method, notes } = req.body;
    
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Store old balance to check if it changed
    const oldBalance = user.availableBalance;
    const isBalanceUpdate = availableBalance !== undefined && availableBalance !== oldBalance;
    
    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (availableBalance !== undefined) user.availableBalance = availableBalance;
    if (isActive !== undefined) user.isActive = isActive;
    
    await user.save();
    
    // Create transaction record if balance was updated
    if (isBalanceUpdate) {
      const balanceDiff = availableBalance - oldBalance;
      const transactionType = balanceDiff > 0 ? 'DEPOSIT' : 'WITHDRAWAL';
      const transactionAmount = Math.abs(balanceDiff);
      
      // Create transaction record
      const transaction = new Transaction({
        userId: user._id,
        type: transactionType,
        amount: transactionAmount,
        method: method || 'ADMIN_ADJUSTMENT',
        status: 'COMPLETED',
        description: notes || `Admin ${transactionType.toLowerCase()} - Balance updated from ₹${oldBalance.toFixed(2)} to ₹${availableBalance.toFixed(2)}`,
        referenceId: `ADMIN-${Date.now()}-${user._id.toString().slice(-6).toUpperCase()}`,
        completedAt: new Date()
      });
      
      await transaction.save();
      
      console.log(`✓ Transaction created: ${transactionType} of ₹${transactionAmount} for user ${user.username}`);
    }
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: user,
      transactionCreated: isBalanceUpdate
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// UPDATE MARGIN ONLY (Quick margin adjustment)
// =====================================================

router.patch('/users/:id/margin', adminAuth, async (req, res) => {
    try {
        const { marginAllowed, marginMultiplier, marginEnabled } = req.body;
        
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Update margin settings
        if (marginAllowed !== undefined) {
            user.marginAllowed = Math.max(0, marginAllowed);
        }
        
        if (marginMultiplier !== undefined) {
            user.marginMultiplier = Math.min(Math.max(1, marginMultiplier), 10); // 1x to 10x
        }
        
        if (marginEnabled !== undefined) {
            user.marginEnabled = marginEnabled;
        }
        
        await user.save();
        
        res.json({
            success: true,
            message: 'Margin updated successfully',
            data: {
                userId: user._id,
                username: user.username,
                availableBalance: user.availableBalance,
                marginAllowed: user.marginAllowed,
                marginMultiplier: user.marginMultiplier,
                marginEnabled: user.marginEnabled,
                totalMargin: user.totalMargin,
                availableMargin: user.availableMargin,
                usedMargin: user.usedMargin,
                marginUtilization: user.marginUtilization
            }
        });
        
    } catch (error) {
        console.error('Update margin error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});


// Delete User
router.delete('/users/:userId', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Delete user's data
    await Promise.all([
      Order.deleteMany({ userId: user._id }),
      Holding.deleteMany({ userId: user._id }),
      Position.deleteMany({ userId: user._id }),
      Transaction.deleteMany({ userId: user._id })
    ]);
    
    res.json({
      success: true,
      message: 'User and all associated data deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// STOCK MANAGEMENT
// ============================================

// Get All Stocks
router.get('/stocks', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    
    const query = {};
    if (search) {
      query.$or = [
        { symbol: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } }
      ];
    }
    
    const stocks = await Stock.find(query)
      .sort({ symbol: 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Stock.countDocuments(query);
    
    res.json({
      success: true,
      data: stocks,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add New Stock
router.post('/stocks', adminAuth, checkPermission('canManageStocks'), async (req, res) => {
  try {
    const { symbol, companyName, currentPrice, exchange, sector } = req.body;
    
    if (!symbol || !companyName || !currentPrice) {
      return res.status(400).json({
        success: false,
        message: 'Symbol, company name, and price required'
      });
    }
    
    const existingStock = await Stock.findOne({ symbol: symbol.toUpperCase() });
    if (existingStock) {
      return res.status(400).json({
        success: false,
        message: 'Stock already exists'
      });
    }
    
    const stock = new Stock({
      symbol: symbol.toUpperCase(),
      companyName,
      currentPrice,
      previousClose: currentPrice,
      exchange: exchange || 'NSE',
      sector: sector || 'Unknown'
    });
    
    await stock.save();
    
    res.status(201).json({
      success: true,
      message: 'Stock added successfully',
      data: stock
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Stock Price Manually
router.put('/stocks/:symbol/price', adminAuth, checkPermission('canUpdatePrices'), async (req, res) => {
  try {
    const { currentPrice } = req.body;
    
    if (!currentPrice || currentPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid price required'
      });
    }
    
    const stock = await Stock.findOne({ symbol: req.params.symbol.toUpperCase() });
    
    if (!stock) {
      return res.status(404).json({ success: false, message: 'Stock not found' });
    }
    
    stock.previousClose = stock.currentPrice;
    stock.currentPrice = currentPrice;
    stock.priceChange = currentPrice - stock.previousClose;
    stock.percentageChange = ((currentPrice - stock.previousClose) / stock.previousClose) * 100;
    stock.lastUpdated = new Date();
    
    await stock.save();
    
    // Broadcast update via WebSocket
    if (global.io) {
      global.io.emit('stockUpdate', {
        symbol: stock.symbol,
        data: stock,
        updatedBy: 'admin'
      });
    }
    
    res.json({
      success: true,
      message: 'Stock price updated successfully',
      data: stock
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Stock Details
router.put('/stocks/:symbol', adminAuth, checkPermission('canManageStocks'), async (req, res) => {
  try {
    const stock = await Stock.findOne({ symbol: req.params.symbol.toUpperCase() });
    
    if (!stock) {
      return res.status(404).json({ success: false, message: 'Stock not found' });
    }
    
    const allowedFields = ['companyName', 'sector', 'exchange', 'isActive'];
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        stock[field] = req.body[field];
      }
    });
    
    await stock.save();
    
    res.json({
      success: true,
      message: 'Stock updated successfully',
      data: stock
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Refresh Stock with Live Data
router.post('/stocks/:symbol/refresh', adminAuth, checkPermission('canUpdatePrices'), async (req, res) => {
  try {
    const result = await updateStockPrice(req.params.symbol.toUpperCase());
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Stock
router.delete('/stocks/:symbol', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const stock = await Stock.findOneAndDelete({ symbol: req.params.symbol.toUpperCase() });
    
    if (!stock) {
      return res.status(404).json({ success: false, message: 'Stock not found' });
    }
    
    res.json({
      success: true,
      message: 'Stock deleted successfully',
      data: stock
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// INDEX MANAGEMENT
// ============================================

// Get All Indices
router.get('/indices', adminAuth, async (req, res) => {
  try {
    const indices = await Index.find().sort({ name: 1 });
    res.json({ success: true, data: indices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Index Price Manually
router.put('/indices/:name/price', adminAuth, checkPermission('canUpdatePrices'), async (req, res) => {
  try {
    const { value } = req.body;
    
    if (!value || value <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid value required'
      });
    }
    
    const index = await Index.findOne({ name: req.params.name.toUpperCase() });
    
    if (!index) {
      return res.status(404).json({ success: false, message: 'Index not found' });
    }
    
    index.previousClose = index.value;
    index.value = value;
    index.change = value - index.previousClose;
    index.percentageChange = ((value - index.previousClose) / index.previousClose) * 100;
    index.lastUpdated = new Date();
    
    await index.save();
    
    // Broadcast update
    if (global.io) {
      global.io.emit('indexUpdate', {
        name: index.name,
        data: index,
        updatedBy: 'admin'
      });
    }
    
    res.json({
      success: true,
      message: 'Index updated successfully',
      data: index
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Refresh Index with Live Data
router.post('/indices/:name/refresh', adminAuth, checkPermission('canUpdatePrices'), async (req, res) => {
  try {
    const result = await updateIndexPrice(req.params.name.toUpperCase());
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// ORDER MANAGEMENT
// ============================================

// Get All Orders
router.get('/orders', adminAuth, checkPermission('canManageOrders'), async (req, res) => {
  try {
    const { page = 1, limit = 50, status, userId } = req.query;
    
    const query = {};
    if (status) query.status = status.toUpperCase();
    if (userId) query.userId = userId;
    
    const orders = await Order.find(query)
      .populate('userId', 'username fullName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Order.countDocuments(query);
    
    res.json({
      success: true,
      data: orders,
      pagination: { total, page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Order Status
router.patch('/orders/:orderId/status', adminAuth, checkPermission('canManageOrders'), async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['PENDING', 'COMPLETED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    order.status = status;
    if (status === 'COMPLETED') order.executedAt = new Date();
    if (status === 'CANCELLED') order.cancelledAt = new Date();
    
    await order.save();
    
    res.json({
      success: true,
      message: 'Order status updated',
      data: order
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Order
router.delete('/orders/:orderId', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    res.json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// ADMIN MANAGEMENT (Super Admin Only)
// ============================================

// Get All Transactions
router.get('/transactions', adminAuth, checkPermission('canViewAnalytics'), async (req, res) => {
  try {
    const { page = 1, limit = 100, type, userId } = req.query;
    
    const query = {};
    if (type) query.type = type.toUpperCase();
    if (userId) query.userId = userId;
    
    const transactions = await Transaction.find(query)
      .populate('userId', 'username fullName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Transaction.countDocuments(query);
    
    res.json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions',
      error: error.message
    });
  }
});

// Get All Holdings
router.get('/holdings', adminAuth, checkPermission('canViewAnalytics'), async (req, res) => {
  try {
    const { page = 1, limit = 100, userId } = req.query;
    
    const query = {};
    if (userId) query.userId = userId;
    
    const holdings = await Holding.find(query)
      .populate('userId', 'username fullName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Holding.countDocuments(query);
    
    res.json({
      success: true,
      data: holdings,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching holdings',
      error: error.message
    });
  }
});

// Get All Positions
router.get('/positions', adminAuth, checkPermission('canViewAnalytics'), async (req, res) => {
  try {
    const { page = 1, limit = 100, userId, isOpen = true } = req.query;
    
    const query = {};
    if (userId) query.userId = userId;
    if (isOpen !== undefined) query.isOpen = isOpen === true;
    
    const positions = await Position.find(query)
      .populate('userId', 'username fullName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Position.countDocuments(query);
    
    res.json({
      success: true,
      data: positions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching positions',
      error: error.message
    });
  }
});

// Close User Position (Admin)
router.post(
  '/positions/:positionId/close',
  adminAuth,
  checkPermission('canManageOrders'),
  async (req, res) => {
    try {
      const position = await Position.findOne({
        _id: req.params.positionId,
        isActive: true
      });
      
      if (!position) {
        return res.status(404).json({
          success: false,
          message: 'Active position not found'
        });
      }
      
      const user = await User.findById(position.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found for this position'
        });
      }
      
      const stock = await Stock.findOne({ symbol: position.symbol });
      const exitPrice = req.body.exitPrice
        ? parseFloat(req.body.exitPrice)
        : (stock ? parseFloat(stock.currentPrice) : position.currentPrice);
      
      const exitBrokerage = user.calculateBrokerage
        ? user.calculateBrokerage(position.quantity * exitPrice, position.quantity)
        : 0;
      
      const marginToRelease = position.marginUsed || 0;
      
      position.close(exitPrice, exitBrokerage, 'MANUAL');
      await position.save();
      
      if (marginToRelease > 0 && typeof user.releaseMargin === 'function') {
        user.releaseMargin(marginToRelease);
      }
      
      const realizedPnL = position.realizedPnL || position.pnl || 0;
      
      user.availableBalance += realizedPnL;
      user.availableBalance -= exitBrokerage;
      user.totalPnL = (user.totalPnL || 0) + realizedPnL;
      user.todayPnL = (user.todayPnL || 0) + realizedPnL;
      user.totalBrokeragePaid = (user.totalBrokeragePaid || 0) + exitBrokerage;
      await user.save();
      
      if (typeof syncSingleUserToFirebase === 'function') {
        syncSingleUserToFirebase(user._id.toString()).catch(console.error);
      }
      
      res.json({
        success: true,
        message: 'Position closed successfully by admin',
        data: {
          position,
          exitPrice,
          realizedPnL: parseFloat(realizedPnL.toFixed(2)),
          exitBrokerage: parseFloat(exitBrokerage.toFixed(2))
        },
        userBalance: {
          availableBalance: user.availableBalance,
          usedMargin: user.usedMargin,
          availableMargin: user.availableMargin,
          totalMargin: user.totalMargin,
          remainingMargin: user.remainingMargin,
          totalPnL: user.totalPnL
        }
      });
    } catch (error) {
      console.error('Admin close position error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// Get All Watchlists (Summary)
router.get('/watchlists', adminAuth, checkPermission('canViewAnalytics'), async (req, res) => {
  try {
    const { userId } = req.query;
    
    const query = {};
    if (userId) query.userId = userId;
    
    const watchlists = await Watchlist.find(query)
      .populate('userId', 'username fullName email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: watchlists
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching watchlists',
      error: error.message
    });
  }
});

// Get All Admins
router.get('/admins', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, data: admins });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create New Admin
router.post('/admins', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { username, email, password, fullName, role, permissions } = req.body;
    
    if (!username || !email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'All fields required'
      });
    }
    
    const existingAdmin = await Admin.findOne({ 
      $or: [{ username }, { email }] 
    });
    
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists'
      });
    }
    
    const admin = new Admin({
      username,
      email,
      password,
      fullName,
      role: role || 'admin',
      permissions: permissions || {}
    });
    
    await admin.save();
    
    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: { ...admin.toObject(), password: undefined }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Admin
router.put('/admins/:adminId', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.adminId);
    
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    const allowedFields = ['fullName', 'email', 'role', 'permissions', 'isActive'];
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        admin[field] = req.body[field];
      }
    });
    
    await admin.save();
    
    res.json({
      success: true,
      message: 'Admin updated successfully',
      data: { ...admin.toObject(), password: undefined }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Admin
router.delete('/admins/:adminId', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const admin = await Admin.findByIdAndDelete(req.params.adminId);
    
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    res.json({
      success: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
// Update Order Status
router.patch('/orders/:orderId/status', adminAuth, checkPermission('canManageOrders'), async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['PENDING', 'COMPLETED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const order = await Order.findById(req.params.orderId)
      .populate('userId', 'username fullName email');
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    const oldStatus = order.status;
    order.status = status;
    
    if (status === 'COMPLETED') {
      order.executedAt = new Date();
      
      // ========================================
      // AUTO-CREATE HOLDING OR POSITION
      // ========================================
      
      if (oldStatus !== 'COMPLETED') {
        const stock = await Stock.findOne({ symbol: order.symbol });
        
        if (stock) {
          // Normalize productType (CNC/DELIVERY = DELIVERY, MIS/INTRADAY = INTRADAY)
          const normalizedProductType = ['CNC', 'DELIVERY'].includes(order.productType) ? 'DELIVERY' : 'INTRADAY';
          
          console.log(`📊 Processing order: ${order.symbol} (${order.productType} → ${normalizedProductType})`);
          
          if (normalizedProductType === 'DELIVERY') {
            // DELIVERY/CNC → Create/Update HOLDING
            
            if (order.orderType === 'BUY') {
              let holding = await Holding.findOne({
                userId: order.userId._id,
                symbol: order.symbol
              });
              
              if (holding) {
                // Update existing holding
                console.log(`  ↳ Updating existing holding`);
                
                const totalQty = holding.quantity + order.quantity;
                const totalInvested = (holding.quantity * holding.avgPrice) + (order.quantity * order.price);
                
                holding.quantity = totalQty;
                holding.avgPrice = totalInvested / totalQty;
                holding.investedValue = totalInvested;
                holding.currentPrice = stock.currentPrice;
                holding.currentValue = holding.quantity * holding.currentPrice;
                holding.totalPnL = holding.currentValue - holding.investedValue;
                holding.pnlPercentage = (holding.totalPnL / holding.investedValue) * 100;
                
                await holding.save();
                console.log(`  ✓ Holding updated: ${holding.quantity} shares`);
                
              } else {
                // Create new holding
                console.log(`  ↳ Creating new holding`);
                
                const investedValue = order.quantity * order.price;
                const currentValue = order.quantity * stock.currentPrice;
                const totalPnL = currentValue - investedValue;
                const pnlPercentage = (totalPnL / investedValue) * 100;
                
                await Holding.create({
                  userId: order.userId._id,
                  symbol: order.symbol,
                  companyName: stock.companyName,
                  quantity: order.quantity,
                  avgPrice: order.price,
                  currentPrice: stock.currentPrice,
                  investedValue: investedValue,
                  currentValue: currentValue,
                  totalPnL: totalPnL,
                  pnlPercentage: pnlPercentage
                });
                
                console.log(`  ✓ Holding created: ${order.quantity} shares`);
              }
              
            } else if (order.orderType === 'SELL') {
              // Handle SELL
              let holding = await Holding.findOne({
                userId: order.userId._id,
                symbol: order.symbol
              });
              
              if (holding) {
                holding.quantity -= order.quantity;
                
                if (holding.quantity <= 0) {
                  await Holding.findByIdAndDelete(holding._id);
                  console.log(`  ✓ Holding deleted (all sold)`);
                } else {
                  holding.investedValue = holding.quantity * holding.avgPrice;
                  holding.currentPrice = stock.currentPrice;
                  holding.currentValue = holding.quantity * holding.currentPrice;
                  holding.totalPnL = holding.currentValue - holding.investedValue;
                  holding.pnlPercentage = (holding.totalPnL / holding.investedValue) * 100;
                  await holding.save();
                  console.log(`  ✓ Holding updated: ${holding.quantity} remaining`);
                }
              }
            }
          }
          
          else if (normalizedProductType === 'INTRADAY') {
            // INTRADAY/MIS → Create POSITION
            
            console.log(`  ↳ Creating intraday position`);
            
            let pnl = 0;
            let pnlPercentage = 0;
            
            if (order.orderType === 'BUY') {
              pnl = (stock.currentPrice - order.price) * order.quantity;
              pnlPercentage = ((stock.currentPrice - order.price) / order.price) * 100;
            } else {
              pnl = (order.price - stock.currentPrice) * order.quantity;
              pnlPercentage = ((order.price - stock.currentPrice) / stock.currentPrice) * 100;
            }
            
            await Position.create({
              userId: order.userId._id,
              symbol: order.symbol,
              companyName: stock.companyName,
              type: order.orderType,
              quantity: order.quantity,
              avgPrice: order.price,
              currentPrice: stock.currentPrice,
              pnl: pnl,
              pnlPercentage: pnlPercentage,
              isOpen: true
            });
            
            console.log(`  ✓ Position created: ${order.orderType} ${order.quantity} @ ₹${order.price}`);
          }
          
        } else {
          console.warn(`  ⚠ Stock not found: ${order.symbol}`);
        }
      }
    }
    
    if (status === 'CANCELLED') {
      order.cancelledAt = new Date();
    }
    
    await order.save();
    
    res.json({
      success: true,
      message: `Order ${status.toLowerCase()} successfully`,
      data: order
    });
  } catch (error) {
    console.error('❌ Error updating order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
module.exports = router;
