// routes/indices.js
const express = require('express');
const router = express.Router();
const Index = require('../models/Index');
const { updateIndexPrice, updateAllIndices } = require('../services/liveDataService');

// Get all indices
router.get('/', async (req, res) => {
  try {
    const indices = await Index.find({ isActive: true })
      .sort({ name: 1 });
    
    res.json({
      success: true,
      data: indices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching indices',
      error: error.message
    });
  }
});

// Get single index by name
router.get('/:name', async (req, res) => {
  try {
    const index = await Index.findOne({ 
      name: req.params.name.toUpperCase(),
      isActive: true
    });
    
    if (!index) {
      return res.status(404).json({
        success: false,
        message: 'Index not found'
      });
    }
    
    res.json({ success: true, data: index });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching index',
      error: error.message
    });
  }
});

// Refresh single index with live data
router.post('/refresh/:name', async (req, res) => {
  try {
    const result = await updateIndexPrice(req.params.name.toUpperCase());
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error refreshing index',
      error: error.message
    });
  }
});

// Refresh all indices
router.post('/refresh-all', async (req, res) => {
  try {
    const results = await updateAllIndices();
    
    res.json({
      success: true,
      message: `Updated ${results.length} indices`,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error refreshing indices',
      error: error.message
    });
  }
});

module.exports = router;
