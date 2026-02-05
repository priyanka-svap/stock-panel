// routes/stocks.js
const express = require('express');
const router = express.Router();
const Stock = require('../models/Stock');
const { updateStockPrice, updateMultipleStocks } = require('../services/liveDataService');

// Get all stocks with pagination and filters
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'percentageChange',
      order = 'desc',
      search = '',
      sector = ''
    } = req.query;

    // Build query
    const query = { isActive: true };
    
    if (search) {
      query.$or = [
        { symbol: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (sector) {
      query.sector = sector;
    }

    // Execute query
    const stocks = await Stock.find(query)
      .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .exec();

    const count = await Stock.countDocuments(query);

    res.json({
      success: true,
      data: stocks,
      pagination: {
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        totalStocks: count,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stocks',
      error: error.message
    });
  }
});

// Get single stock by symbol
router.get('/:symbol', async (req, res) => {
  try {
    const stock = await Stock.findOne({ 
      symbol: req.params.symbol.toUpperCase(),
      isActive: true
    });
    
    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'Stock not found'
      });
    }
    
    res.json({ success: true, data: stock });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock',
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

// Search stocks
router.get('/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    
    const stocks = await Stock.find({
      $or: [
        { symbol: { $regex: query, $options: 'i' } },
        { companyName: { $regex: query, $options: 'i' } }
      ],
      isActive: true
    }).limit(10);
    
    res.json({ success: true, data: stocks });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error searching stocks',
      error: error.message
    });
  }
});

module.exports = router;
