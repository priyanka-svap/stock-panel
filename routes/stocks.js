// // routes/stocks.js
// const express = require('express');
// const router = express.Router();
// const Stock     = require('../models/Stock');
const Watchlist  = require('../models/Watchlist');
const auth        = require('../middleware/auth');
 const { updateStockPrice, updateMultipleStocks } = require('../services/liveDataService');

// // Get all stocks with pagination and filters
// router.get('/', async (req, res) => {
//   try {
//     const {
//       page = 1,
//       limit = 20,
//       sortBy = 'percentageChange',
//       order = 'desc',
//       search = '',
//       sector = ''
//     } = req.query;

//     // Build query
//     const query = { isActive: true };
    
//     if (search) {
//       query.$or = [
//         { symbol: { $regex: search, $options: 'i' } },
//         { companyName: { $regex: search, $options: 'i' } }
//       ];
//     }
    
//     if (sector) {
//       query.sector = sector;
//     }

//     // Execute query
//     const stocks = await Stock.find(query)
//       .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
//       .limit(parseInt(limit))
//       .skip((parseInt(page) - 1) * parseInt(limit))
//       .exec();

//     const count = await Stock.countDocuments(query);

//     res.json({
//       success: true,
//       data: stocks,
//       pagination: {
//         totalPages: Math.ceil(count / limit),
//         currentPage: parseInt(page),
//         totalStocks: count,
//         limit: parseInt(limit)
//       }
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching stocks',
//       error: error.message
//     });
//   }
// });

// // Get single stock by symbol
// router.get('/:symbol', async (req, res) => {
//   try {
//     const stock = await Stock.findOne({ 
//       symbol: req.params.symbol.toUpperCase(),
//       isActive: true
//     });
    
//     if (!stock) {
//       return res.status(404).json({
//         success: false,
//         message: 'Stock not found'
//       });
//     }
    
//     res.json({ success: true, data: stock });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching stock',
//       error: error.message
//     });
//   }
// });



// routes/stocks.js - Stock Routes with Futures Support
const express = require('express');
const router = express.Router();
const Stock     = require('../models/Stock');

// =====================================================
// SPOT STOCKS ROUTES
// =====================================================

/**
 * GET /api/stocks/spot
 * Get all active spot stocks
 */
router.get('/spot', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      sortBy = 'symbol',
      sortOrder = 'asc' 
    } = req.query;

    const query = {
      contractType: 'SPOT',
      isActive: true
    };

    // Add search filter
    if (search) {
      query.$or = [
        { symbol: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const stocks = await Stock.find(query)
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Stock.countDocuments(query);

    res.json({
      success: true,
      data: stocks,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalStocks: count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching spot stocks',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/spot/:symbol
 * Get a specific spot stock — full data + isWatchlisted status
 * Auth optional: if token present, isWatchlisted is accurate
 */
router.get('/spot/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    const stock = await Stock.findOne({
      symbol,
      contractType: 'SPOT',
      isActive: true
    }).lean();

    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'Stock not found'
      });
    }

    // ── Ask / Bid auto-calculate if not stored ──
    // (Fallback agar liveDataService ne abhi update nahi kiya)
    let askPrice = parseFloat(stock.askPrice || 0);
    let bidPrice = parseFloat(stock.bidPrice || 0);
    let spread   = parseFloat(stock.spread   || 0);

    if (askPrice === 0 && stock.currentPrice > 0) {
      const cp    = parseFloat(stock.currentPrice);
      const pct   = cp < 500 ? 0.0004 : cp < 5000 ? 0.000125 : 0.000075;
      const half  = cp * pct;
      const tick  = 0.05;
      askPrice = parseFloat((Math.round((cp + half) / tick) * tick).toFixed(2));
      bidPrice = parseFloat((Math.round((cp - half) / tick) * tick).toFixed(2));
      spread   = parseFloat((askPrice - bidPrice).toFixed(2));
    }

    // ── isWatchlisted check (optional auth) ──
    let isWatchlisted = false;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const jwt     = require('jsonwebtoken');
        const decoded = jwt.verify(
          authHeader.split(' ')[1],
          process.env.JWT_SECRET || 'your-secret-key'
        );
        const userId  = decoded.userId || decoded.id || decoded._id;
        if (userId) {
          const wl = await Watchlist.findOne({ userId }).lean();
          if (wl && wl.stocks) {
            isWatchlisted = wl.stocks.some(s => s.symbol === symbol);
          }
        }
      }
    } catch (_) {
      // Token invalid / not present — isWatchlisted stays false
    }

    res.json({
      success: true,
      data: {
        // ── Identity ──
        _id:              stock._id,
        symbol:           stock.symbol,
        companyName:      stock.companyName,
        contractType:     stock.contractType,
        exchange:         stock.exchange || 'NSE',
        sector:           stock.sector   || '',
        industry:         stock.industry || '',

        // ── Price ──
        currentPrice:     parseFloat(stock.currentPrice  || 0),
        openPrice:        parseFloat(stock.openPrice     || 0),
        previousClose:    parseFloat(stock.previousClose || 0),
        dayHigh:          parseFloat(stock.dayHigh       || 0),
        dayLow:           parseFloat(stock.dayLow        || 0),

        // ── Change ──
        priceChange:      parseFloat(stock.priceChange      || 0),
        percentageChange: parseFloat(stock.percentageChange || 0),

        // ── Order Book ──
        askPrice,
        bidPrice,
        spread,

        // ── Volume / OI ──
        volume:           parseFloat(stock.volume       || 0),
        openInterest:     parseFloat(stock.openInterest || 0),

        // ── Status ──
        isActive:         stock.isActive,
        isWatchlisted,          // ✅ NEW — true/false based on logged-in user
        lastUpdated:      stock.lastUpdated
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock',
      error: error.message
    });
  }
});

// =====================================================
// FUTURES CONTRACTS ROUTES
// =====================================================

/**
 * GET /api/stocks/futures
 * Get all active future contracts
 */
router.get('/futures', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      baseSymbol = '',
      expiryMonth = '' // Format: "JAN25", "FEB25"
    } = req.query;

    const query = {
      contractType: 'FUTURE',
      isActive: true,
      expiryDate: { $gte: new Date() } // Only non-expired contracts
    };

    // Filter by base symbol
    if (baseSymbol) {
      query.baseSymbol = baseSymbol.toUpperCase();
    }

    // Filter by expiry month
    if (expiryMonth) {
      query.expiryString = expiryMonth.toUpperCase();
    }

    const futures = await Stock.find(query)
      .sort({ baseSymbol: 1, expiryDate: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Stock.countDocuments(query);

    res.json({
      success: true,
      data: futures,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalContracts: count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching futures',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/futures/:symbol
 * Get a specific future contract by its full symbol
 */
router.get('/futures/:symbol', async (req, res) => {
  try {
    const future = await Stock.findOne({
      symbol: req.params.symbol.toUpperCase(),
      contractType: 'FUTURE',
      isActive: true
    });

    if (!future) {
      return res.status(404).json({
        success: false,
        message: 'Future contract not found'
      });
    }

    // Add additional info
    const daysUntilExpiry = future.daysUntilExpiry();

    res.json({
      success: true,
      data: {
        ...future.toObject(),
        daysUntilExpiry,
        isExpired: future.isExpired()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching future contract',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/futures/symbol/:baseSymbol
 * Get all future contracts for a specific base symbol
 */
router.get('/futures/symbol/:baseSymbol', async (req, res) => {
  try {
    const futures = await Stock.getFuturesBySymbol(
      req.params.baseSymbol.toUpperCase()
    );

    // Get spot price for comparison
    const spotStock = await Stock.findOne({
      symbol: req.params.baseSymbol.toUpperCase(),
      contractType: 'SPOT',
      isActive: true
    });

    res.json({
      success: true,
      data: {
        baseSymbol: req.params.baseSymbol.toUpperCase(),
        spotPrice: spotStock ? spotStock.currentPrice : null,
        futures: futures.map(f => ({
          ...f.toObject(),
          daysUntilExpiry: f.daysUntilExpiry(),
          premium: spotStock 
            ? ((f.currentPrice - spotStock.currentPrice) / spotStock.currentPrice * 100).toFixed(2)
            : null
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching futures for symbol',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/futures/current-month
 * Get current month futures
 */
router.get('/futures/current-month', async (req, res) => {
  try {
    const futures = await Stock.getCurrentMonthFutures();

    res.json({
      success: true,
      data: futures,
      count: futures.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching current month futures',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/futures/next-month
 * Get next month futures
 */
router.get('/futures/next-month', async (req, res) => {
  try {
    const futures = await Stock.getNextMonthFutures();

    res.json({
      success: true,
      data: futures,
      count: futures.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching next month futures',
      error: error.message
    });
  }
});

// =====================================================
// COMBINED ROUTES
// =====================================================

/**
 * GET /api/stocks/all
 * Get both spot and futures (with filters)
 */
router.get('/all', async (req, res) => {
  try {
    const { 
      contractType = 'SPOT', // SPOT, FUTURE, or ALL
      page = 1, 
      limit = 50 
    } = req.query;

    let query = { isActive: true };

    if (contractType !== 'ALL') {
      query.contractType = contractType;
    }

    if (contractType === 'FUTURE' || contractType === 'ALL') {
      query.expiryDate = { $gte: new Date() };
    }

    const stocks = await Stock.find(query)
      .sort({ contractType: 1, symbol: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Stock.countDocuments(query);

    res.json({
      success: true,
      data: stocks,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stocks',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/:symbol/details
 * Get complete details for a symbol (spot + all futures)
 */
router.get('/:symbol/details', async (req, res) => {
  try {
    const baseSymbol = req.params.symbol.toUpperCase();

    // Get spot stock
    const spotStock = await Stock.findOne({
      symbol: baseSymbol,
      contractType: 'SPOT',
      isActive: true
    });

    // Get all futures for this symbol
    const futures = await Stock.getFuturesBySymbol(baseSymbol);

    if (!spotStock && futures.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found'
      });
    }

    res.json({
      success: true,
      data: {
        spot: spotStock,
        futures: futures.map(f => ({
          ...f.toObject(),
          daysUntilExpiry: f.daysUntilExpiry(),
          premium: spotStock 
            ? ((f.currentPrice - spotStock.currentPrice) / spotStock.currentPrice * 100).toFixed(2)
            : null
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching symbol details',
      error: error.message
    });
  }
});

// =====================================================
// UTILITY ROUTES
// =====================================================

/**
 * POST /api/stocks/futures/deactivate-expired
 * Deactivate expired futures (scheduled job endpoint)
 */
router.post('/futures/deactivate-expired', async (req, res) => {
  try {
    const result = await Stock.deactivateExpiredContracts();

    res.json({
      success: true,
      message: 'Expired contracts deactivated',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deactivating expired contracts',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/stats
 * Get statistics about stocks and futures
 */
router.get('/stats', async (req, res) => {
  try {
    const spotCount = await Stock.countDocuments({ 
      contractType: 'SPOT', 
      isActive: true 
    });
    
    const futureCount = await Stock.countDocuments({ 
      contractType: 'FUTURE', 
      isActive: true,
      expiryDate: { $gte: new Date() }
    });
    
    const expiredCount = await Stock.countDocuments({ 
      contractType: 'FUTURE',
      expiryDate: { $lt: new Date() }
    });

    res.json({
      success: true,
      data: {
        totalSpotStocks: spotCount,
        totalActiveFutures: futureCount,
        totalExpiredFutures: expiredCount,
        totalInstruments: spotCount + futureCount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});
// Refresh single stock with live data
router.post('/refresh/:symbol', async (req, res) => {
  try {
    const result = await updateStockPrice(req.params.symbol.toUpperCase());
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error refreshing stock',
      error: error.message
    });
  }
});

// Refresh all stocks
router.post('/refresh-all', async (req, res) => {
  try {
    const stocks = await Stock.find({ isActive: true });
    const symbols = stocks.map(s => s.symbol);
    
    const results = await updateMultipleStocks(symbols);
    
    res.json({
      success: true,
      message: `Updated ${results.length} stocks`,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error refreshing stocks',
      error: error.message
    });
  }
});

// Get top gainers
router.get('/market/gainers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    const gainers = await Stock.find({ 
      percentageChange: { $gt: 0 },
      isActive: true
    })
      .sort({ percentageChange: -1 })
      .limit(limit);
    
    res.json({ success: true, data: gainers });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching top gainers',
      error: error.message
    });
  }
});

// Get top losers
router.get('/market/losers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    const losers = await Stock.find({ 
      percentageChange: { $lt: 0 },
      isActive: true
    })
      .sort({ percentageChange: 1 })
      .limit(limit);
    
    res.json({ success: true, data: losers });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching top losers',
      error: error.message
    });
  }
});

/**
 * GET /api/stocks/search?q=RELIANCE
 * Full-featured search — symbol + companyName match
 * Returns SPOT + NSE Futures + MCX contracts — sabhi ek saath
 * Results sorted: exact match first, phir SPOT, phir Futures
 *
 * Query params:
 *   q      — search term (symbol or company name) [required]
 *   limit  — max results, default 20, max 50
 *   type   — ALL | SPOT | FUTURE | MCX  (default: ALL)
 */
router.get('/search', async (req, res) => {
  try {
    const { q = '', limit = 20, type = 'ALL' } = req.query;

    const term = q.trim();
    if (!term) {
      return res.status(400).json({
        success: false,
        message: 'Search term "q" is required. e.g. /api/stocks/search?q=RELIANCE'
      });
    }

    const maxLimit = Math.min(parseInt(limit) || 20, 50);

    // ── Build query — $and to safely combine search + type filters ──
    const typeUpper   = type.toUpperCase();
    const searchMatch = {
      $or: [
        { symbol:      { $regex: term, $options: 'i' } },
        { companyName: { $regex: term, $options: 'i' } }
      ]
    };

    let typeMatch;
    if (typeUpper === 'SPOT') {
      typeMatch = { contractType: 'SPOT', isActive: true };
    } else if (typeUpper === 'FUTURE') {
      typeMatch = { contractType: 'FUTURE', exchange: { $ne: 'MCX' }, expiryDate: { $gte: new Date() }, isActive: true };
    } else if (typeUpper === 'MCX') {
      typeMatch = { exchange: 'MCX', isActive: true };
    } else {
      // ALL — SPOT + active NSE/MCX futures, expired futures skip
      typeMatch = {
        isActive: true,
        $or: [
          { contractType: 'SPOT' },
          { contractType: 'FUTURE', expiryDate: { $gte: new Date() } }
        ]
      };
    }

    // $and combines: search condition AND type condition — no $or conflict
    const dbQuery = { $and: [ searchMatch, typeMatch ] };

    // ── Fetch stocks ──
    const stocks = await Stock.find(dbQuery)
      .sort({ contractType: 1, expiryDate: 1, symbol: 1 })
      .limit(maxLimit)
      .lean();

    if (!stocks.length) {
      return res.json({
        success: true,
        query:   term,
        total:   0,
        data:    []
      });
    }

    // ── isWatchlisted check (optional auth) ──
    let watchlistedSet = new Set();
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const jwt     = require('jsonwebtoken');
        const decoded = jwt.verify(
          authHeader.split(' ')[1],
          process.env.JWT_SECRET || 'your-secret-key'
        );
        const userId = decoded.userId || decoded.id || decoded._id;
        if (userId) {
          const wl = await Watchlist.findOne({ userId }).lean();
          if (wl && wl.stocks) {
            wl.stocks.forEach(s => watchlistedSet.add(s.symbol));
          }
        }
      }
    } catch (_) { /* token absent/invalid — isWatchlisted = false for all */ }

    // ── Build response ──
    const data = stocks.map(stock => {
      const cp = parseFloat(stock.currentPrice || 0);

      // Ask/Bid — use stored value or auto-calculate
      let ask  = parseFloat(stock.askPrice || 0);
      let bid  = parseFloat(stock.bidPrice || 0);
      let sprd = parseFloat(stock.spread   || 0);
      if (ask === 0 && cp > 0) {
        const tick  = stock.exchange === 'MCX' ? 0.1 : 0.05;
        const pct   = cp < 500 ? 0.0004 : cp < 5000 ? 0.000125 : 0.000075;
        const half  = cp * pct;
        ask  = parseFloat((Math.round((cp + half) / tick) * tick).toFixed(2));
        bid  = parseFloat((Math.round((cp - half) / tick) * tick).toFixed(2));
        sprd = parseFloat((ask - bid).toFixed(2));
      }

      // Exact symbol match ko top pe show karo
      const isExact = stock.symbol.toUpperCase() === term.toUpperCase();

      return {
        // ── Identity ──
        _id:              stock._id,
        symbol:           stock.symbol,
        companyName:      stock.companyName,
        contractType:     stock.contractType,
        exchange:         stock.exchange  || 'NSE',
        sector:           stock.sector    || '',
        industry:         stock.industry  || '',

        // ── Price ──
        currentPrice:     cp,
        openPrice:        parseFloat(stock.openPrice     || 0),
        previousClose:    parseFloat(stock.previousClose || 0),
        dayHigh:          parseFloat(stock.dayHigh       || 0),
        dayLow:           parseFloat(stock.dayLow        || 0),

        // ── Change ──
        priceChange:      parseFloat(stock.priceChange      || 0),
        percentageChange: parseFloat(stock.percentageChange || 0),

        // ── Order Book ──
        askPrice:         ask,
        bidPrice:         bid,
        spread:           sprd,

        // ── Volume / OI ──
        volume:           parseFloat(stock.volume       || 0),
        openInterest:     parseFloat(stock.openInterest || 0),

        // ── Futures specific (null for SPOT) ──
        baseSymbol:       stock.baseSymbol   || null,
        expiryDate:       stock.expiryDate   || null,
        expiryString:     stock.expiryString || null,
        lotSize:          stock.lotSize      || null,
        daysToExpiry:     stock.expiryDate
          ? Math.max(0, Math.ceil((new Date(stock.expiryDate) - new Date()) / 86400000))
          : null,

        // ── Status ──
        isActive:         stock.isActive,
        isWatchlisted:    watchlistedSet.has(stock.symbol),  // ✅
        isExactMatch:     isExact,                            // ✅ exact symbol match flag
        lastUpdated:      stock.lastUpdated
      };
    });

    // Sort: exact match first, then alphabetical
    data.sort((a, b) => {
      if (a.isExactMatch && !b.isExactMatch) return -1;
      if (!a.isExactMatch && b.isExactMatch) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    res.json({
      success: true,
      query:   term,
      type:    typeUpper,
      total:   data.length,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error searching stocks',
      error:   error.message
    });
  }
});

// Keep old route for backward compatibility
router.get('/search/:query', async (req, res) => {
  req.query.q = req.params.query;
  // Forward to new search handler logic
  const q = req.params.query.trim();
  if (!q) return res.status(400).json({ success: false, message: 'Query required' });

  try {
    const stocks = await Stock.find({
      isActive: true,
      $or: [
        { symbol:      { $regex: q, $options: 'i' } },
        { companyName: { $regex: q, $options: 'i' } }
      ],
      contractType: 'SPOT'
    }).limit(10).lean();

    res.json({ success: true, data: stocks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;