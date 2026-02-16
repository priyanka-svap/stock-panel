// routes/contracts.js - F&O Contract Management
const express = require('express');
const router = express.Router();
const Stock = require('../models/Stock');
const auth = require('../middleware/auth');

// ===================================
// GET ALL CONTRACTS WITH FILTERS
// ===================================
router.get('/list', auth, async (req, res) => {
  try {
    const { 
      instrumentType, 
      contractType, 
      underlyingSymbol, 
      expiryMonth,
      includeExpired 
    } = req.query;
    
    let filter = {};
    
    if (instrumentType) {
      filter.instrumentType = instrumentType;
    }
    
    if (contractType) {
      filter.contractType = contractType;
    }
    
    if (underlyingSymbol) {
      filter.underlyingSymbol = underlyingSymbol.toUpperCase();
    }
    
    if (expiryMonth) {
      filter.expiryMonth = expiryMonth.toUpperCase();
    }
    
    // Exclude expired contracts by default
    if (!includeExpired || includeExpired === 'false') {
      filter.isExpired = false;
    }
    
    const contracts = await Stock.find(filter)
      .sort({ expiryDate: 1, strikePrice: 1 })
      .select('-createdAt -updatedAt -__v');
    
    res.json({
      success: true,
      count: contracts.length,
      contracts
    });
    
  } catch (error) {
    console.error('Error fetching contracts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// GET OPTION CHAIN
// ===================================
router.get('/option-chain/:symbol', auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { expiryDate } = req.query;
    
    let filter = {
      underlyingSymbol: symbol.toUpperCase(),
      instrumentType: { $in: ['OPTIDX', 'OPTSTK'] },
      isExpired: false
    };
    
    if (expiryDate) {
      filter.expiryDate = new Date(expiryDate);
    } else {
      // Get nearest expiry
      const nearestExpiry = await Stock.findOne(filter)
        .sort({ expiryDate: 1 })
        .select('expiryDate');
      
      if (nearestExpiry) {
        filter.expiryDate = nearestExpiry.expiryDate;
      }
    }
    
    const options = await Stock.find(filter).sort({ strikePrice: 1 });
    
    // Organize into option chain format
    const optionChain = {};
    
    options.forEach(option => {
      const strike = option.strikePrice;
      
      if (!optionChain[strike]) {
        optionChain[strike] = {
          strikePrice: strike,
          call: null,
          put: null
        };
      }
      
      if (option.contractType === 'CE') {
        optionChain[strike].call = {
          tradingSymbol: option.tradingSymbol,
          ltp: option.currentPrice,
          change: option.priceChange,
          changePercent: option.percentageChange,
          volume: option.volume,
          oi: option.openInterest,
          oiChange: option.oiChange,
          iv: option.impliedVolatility,
          greeks: option.greeks
        };
      } else if (option.contractType === 'PE') {
        optionChain[strike].put = {
          tradingSymbol: option.tradingSymbol,
          ltp: option.currentPrice,
          change: option.priceChange,
          changePercent: option.percentageChange,
          volume: option.volume,
          oi: option.openInterest,
          oiChange: option.oiChange,
          iv: option.impliedVolatility,
          greeks: option.greeks
        };
      }
    });
    
    res.json({
      success: true,
      underlyingSymbol: symbol.toUpperCase(),
      expiryDate: filter.expiryDate,
      optionChain: Object.values(optionChain)
    });
    
  } catch (error) {
    console.error('Error fetching option chain:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// GET FUTURES CONTRACTS
// ===================================
router.get('/futures/:symbol', auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const futures = await Stock.find({
      underlyingSymbol: symbol.toUpperCase(),
      contractType: 'FUTURES',
      isExpired: false
    }).sort({ expiryDate: 1 });
    
    res.json({
      success: true,
      underlyingSymbol: symbol.toUpperCase(),
      count: futures.length,
      futures
    });
    
  } catch (error) {
    console.error('Error fetching futures:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// GET EXPIRY DATES
// ===================================
router.get('/expiry-dates/:symbol', auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { instrumentType } = req.query;
    
    let filter = {
      $or: [
        { symbol: symbol.toUpperCase() },
        { underlyingSymbol: symbol.toUpperCase() }
      ],
      isExpired: false,
      expiryDate: { $exists: true }
    };
    
    if (instrumentType) {
      filter.instrumentType = instrumentType;
    }
    
    const contracts = await Stock.find(filter)
      .distinct('expiryDate');
    
    const expiryDates = contracts
      .map(date => new Date(date))
      .sort((a, b) => a - b)
      .map(date => ({
        date: date.toISOString(),
        formatted: date.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      }));
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      expiryDates
    });
    
  } catch (error) {
    console.error('Error fetching expiry dates:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// GET STRIKE PRICES
// ===================================
router.get('/strikes/:symbol', auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { expiryDate } = req.query;
    
    let filter = {
      underlyingSymbol: symbol.toUpperCase(),
      instrumentType: { $in: ['OPTIDX', 'OPTSTK'] },
      isExpired: false,
      strikePrice: { $exists: true }
    };
    
    if (expiryDate) {
      filter.expiryDate = new Date(expiryDate);
    }
    
    const strikes = await Stock.find(filter)
      .distinct('strikePrice');
    
    const sortedStrikes = strikes
      .map(Number)
      .sort((a, b) => a - b);
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      strikes: sortedStrikes
    });
    
  } catch (error) {
    console.error('Error fetching strike prices:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// GET CONTRACT BY TRADING SYMBOL
// ===================================
router.get('/contract/:tradingSymbol', auth, async (req, res) => {
  try {
    const { tradingSymbol } = req.params;
    
    const contract = await Stock.findOne({
      tradingSymbol: tradingSymbol.toUpperCase()
    });
    
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: 'Contract not found'
      });
    }
    
    res.json({
      success: true,
      contract
    });
    
  } catch (error) {
    console.error('Error fetching contract:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// CREATE NEW CONTRACT (ADMIN ONLY)
// ===================================
router.post('/create', auth, async (req, res) => {
  try {
    const {
      symbol,
      companyName,
      instrumentType,
      contractType,
      expiryDate,
      expiryMonth,
      strikePrice,
      lotSize,
      underlyingSymbol,
      exchange
    } = req.body;
    
    // Validate required fields
    if (!symbol || !companyName) {
      return res.status(400).json({
        success: false,
        message: 'Symbol and company name are required'
      });
    }
    
    // Create contract
    const contract = new Stock({
      symbol: symbol.toUpperCase(),
      companyName,
      instrumentType: instrumentType || 'EQUITY',
      contractType: contractType || 'SPOT',
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      expiryMonth: expiryMonth?.toUpperCase(),
      strikePrice,
      lotSize: lotSize || 1,
      underlyingSymbol: underlyingSymbol?.toUpperCase() || symbol.toUpperCase(),
      exchange: exchange || 'NSE',
      currentPrice: '0',
      previousClose: '0',
      isActive: true
    });
    
    await contract.save();
    
    res.status(201).json({
      success: true,
      message: 'Contract created successfully',
      contract
    });
    
  } catch (error) {
    console.error('Error creating contract:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// BULK CREATE OPTION CHAIN (ADMIN ONLY)
// ===================================
router.post('/create-option-chain', auth, async (req, res) => {
  try {
    const {
      underlyingSymbol,
      expiryDate,
      expiryMonth,
      strikes,
      lotSize,
      companyName,
      instrumentType
    } = req.body;
    
    if (!underlyingSymbol || !expiryDate || !strikes || !Array.isArray(strikes)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    const contracts = [];
    const expiry = new Date(expiryDate);
    
    for (const strike of strikes) {
      // Create Call Option
      const callOption = new Stock({
        symbol: underlyingSymbol,
        companyName: companyName || underlyingSymbol,
        instrumentType: instrumentType || 'OPTIDX',
        contractType: 'CE',
        expiryDate: expiry,
        expiryMonth: expiryMonth?.toUpperCase(),
        strikePrice: strike,
        lotSize: lotSize || 1,
        underlyingSymbol: underlyingSymbol.toUpperCase(),
        exchange: 'NFO',
        currentPrice: '0',
        previousClose: '0',
        isActive: true
      });
      
      // Create Put Option
      const putOption = new Stock({
        symbol: underlyingSymbol,
        companyName: companyName || underlyingSymbol,
        instrumentType: instrumentType || 'OPTIDX',
        contractType: 'PE',
        expiryDate: expiry,
        expiryMonth: expiryMonth?.toUpperCase(),
        strikePrice: strike,
        lotSize: lotSize || 1,
        underlyingSymbol: underlyingSymbol.toUpperCase(),
        exchange: 'NFO',
        currentPrice: '0',
        previousClose: '0',
        isActive: true
      });
      
      contracts.push(callOption, putOption);
    }
    
    // Bulk insert
    await Stock.insertMany(contracts);
    
    res.status(201).json({
      success: true,
      message: `Created ${contracts.length} option contracts`,
      count: contracts.length
    });
    
  } catch (error) {
    console.error('Error creating option chain:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

// ===================================
// MARK EXPIRED CONTRACTS
// ===================================
router.post('/mark-expired', auth, async (req, res) => {
  try {
    const now = new Date();
    
    const result = await Stock.updateMany(
      {
        expiryDate: { $lt: now },
        isExpired: false
      },
      {
        $set: { 
          isExpired: true,
          isActive: false 
        }
      }
    );
    
    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} contracts as expired`,
      count: result.modifiedCount
    });
    
  } catch (error) {
    console.error('Error marking expired contracts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
});

module.exports = router;
