// routes/marketDepth.js - API endpoints for Bid/Ask data
const express = require('express');
const router = express.Router();
const MarketDepthService = require('../services/marketDepthService');
const auth = require('../middleware/auth');

const depthService = new MarketDepthService();

// =====================================================
// GET MARKET DEPTH FOR SINGLE STOCK
// =====================================================

router.get('/depth/:symbol', auth, async (req, res) => {
    try {
        const { symbol } = req.params;

        const depth = await depthService.getMarketDepth(symbol);

        if (!depth) {
            return res.status(404).json({
                success: false,
                message: 'Market depth not available'
            });
        }

        res.json({
            success: true,
            data: depth
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// =====================================================
// GET SIMPLE QUOTE (Faster)
// =====================================================

router.get('/quote/:symbol', auth, async (req, res) => {
    try {
        const { symbol } = req.params;

        const quote = await depthService.getSimpleQuote(symbol);

        if (!quote) {
            return res.status(404).json({
                success: false,
                message: 'Quote not available'
            });
        }

        res.json({
            success: true,
            data: quote
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// =====================================================
// GET MULTIPLE STOCKS DEPTH
// =====================================================

router.post('/depth/batch', auth, async (req, res) => {
    try {
        const symbols = [
            "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
            "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK",
            "LT", "AXISBANK", "BAJFINANCE", "ASIANPAINT", "MARUTI",
            "HCLTECH", "WIPRO", "TITAN", "NESTLEIND", "ULTRACEMCO",
            "SUNPHARMA", "ONGC", "NTPC", "POWERGRID", "M&M",
            "TATAMOTORS", "TATASTEEL", "ADANIPORTS", "COALINDIA", "JSWSTEEL",
            "GRASIM", "BAJAJFINSV", "HINDALCO", "INDUSINDBK", "DRREDDY",
            "CIPLA", "EICHERMOT", "DIVISLAB", "HEROMOTOCO", "APOLLOHOSP",
            "TECHM", "TATACONSUM", "BRITANNIA", "SHRIRAMFIN", "ADANIENT",
            "SBILIFE", "LTIM", "BAJAJ-AUTO", "HDFCLIFE", "TRENT",
            "ADANIGREEN", "ADANIPOWER", "VEDL", "BANKBARODA", "PNB",
            "CANBK", "UNIONBANK", "IDFCFIRSTB", "FEDERALBNK", "BANDHANBNK",
            "AUBANK", "RBLBANK", "YESBANK", "IDFC", "CHOLAFIN",
            "PERSISTENT", "COFORGE", "MPHASIS", "INFOEDGE", "ZOMATO",
            "PAYTM", "NYKAA", "POLICYBZR", "ZEEL", "BHARTIHEXA",
            "BIOCON", "LUPIN", "TORNTPHARM", "ALKEM", "AUROPHARMA",
            "GLENMARK", "ZYDUSLIFE", "IPCALAB", "LAURUSLABS", "NATCOPHARM",
            "MAHINDRA", "ASHOKLEY", "MOTHERSON", "BALKRISIND", "MRF",
            "APOLLOTYRE", "CEAT", "EXIDEIND", "AMBUJACEM", "BOSCHLTD",
            "ADANIENSOL", "ADANITRANS", "TATAPOWER", "NHPC", "SJVN",
            "TORNTPOWER", "CESC", "JSPL", "SAIL", "NMDC",
            "DABUR", "GODREJCP", "MARICO", "EMAMILTD", "COLPAL",
            "PGHH", "MCDOWELL-N", "RADICO", "VBL", "TATAELXSI",
            "DLF", "OBEROIRLTY", "GODREJPROP", "PRESTIGE", "BRIGADE",
            "PHOENIXLTD", "IBREALEST", "SOBHA", "SUNTECK", "MAHLIFE",
            "IDEA", "ROUTE", "TTML", "GTPL", "HATHWAY",
            "DMART", "ABFRL", "SHOPERSTOP", "VMART", "ADITYA",
            "HAVELLS", "CROMPTON", "VOLTAS", "BLUESTARCO", "WHIRLPOOL",
            "DIXON", "AMBER", "KAJARIACER", "CENTURYPLY", "GREENPLY"
        ];

        if (!symbols || !Array.isArray(symbols)) {
            return res.status(400).json({
                success: false,
                message: 'Symbols array required'
            });
        }

        const depths = await depthService.getMultipleDepth(symbols);

        res.json({
            success: true,
            data: depths
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
