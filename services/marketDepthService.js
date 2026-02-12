// services/marketDepthService.js - FIXED VERSION (No errors)
const axios = require('axios');
const { updateFirebase } = require('./firebaseService');
const Quote = require('../models/Quote');
class MarketDepthService {
    constructor() {
        this.NSE_BASE = 'https://www.nseindia.com/api';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br'
        };
    }

    // =====================================================
    // GET MARKET DEPTH (With Complete Error Handling)
    // =====================================================

    async getMarketDepth(symbol) {
        try {
            const nseSymbol = symbol.replace('.NS', '').replace('.BO', '');

            const response = await axios.get(`${this.NSE_BASE}/quote-equity?symbol=${nseSymbol}`, {
                headers: this.headers,
                timeout: 5000
            });

            const data = response.data;

            // Safe extraction with fallbacks
            const priceInfo = data.priceInfo || {};
            const intraDayHighLow = priceInfo.intraDayHighLow || {};
            const preOpenMarket = data.preOpenMarket || {};
            const marketDepth = data.marketDeptOrderBook || {};

            const ltp = this.safeNumber(priceInfo.lastPrice) || this.safeNumber(priceInfo.close) || 0;
            const prevClose = this.safeNumber(priceInfo.previousClose) || this.safeNumber(priceInfo.close) || ltp;
            const data_save = {
                symbol: symbol,
                ltp: ltp,

                // OHLC - Safe extraction
                open: this.safeNumber(priceInfo.open) || ltp,
                high: this.safeNumber(intraDayHighLow.max) || this.safeNumber(priceInfo.dayHigh) || ltp,
                low: this.safeNumber(intraDayHighLow.min) || this.safeNumber(priceInfo.dayLow) || ltp,
                close: this.safeNumber(priceInfo.close) || ltp,
                previousClose: prevClose,

                // Volume
                volume: this.safeNumber(preOpenMarket.totalTradedVolume) || this.safeNumber(data.totalTradedVolume) || 0,
                totalBuyQuantity: this.safeNumber(marketDepth.totalBuyQuantity) || 0,
                totalSellQuantity: this.safeNumber(marketDepth.totalSellQuantity) || 0,

                // Market Depth
                bid: this.formatDepth(marketDepth.bid || []),
                ask: this.formatDepth(marketDepth.ask || []),

                // Best prices
                bestBid: this.getBestPrice(marketDepth.bid || [], 'bid'),
                bestAsk: this.getBestPrice(marketDepth.ask || [], 'ask'),

                // Spread
                spread: this.calculateSpread(
                    this.getBestPrice(marketDepth.bid || [], 'bid'),
                    this.getBestPrice(marketDepth.ask || [], 'ask')
                ),

                // Change
                change: this.calculateChange(ltp, prevClose),
                percentageChange: this.calculatePercentageChange(ltp, prevClose),

                lastUpdated: Date.now(),
                error: null
            }
            await updateFirebase(`quotes/${symbol}`, data_save)


            // Update or create stock document in MongoDB
            await Quote.findOneAndUpdate(
                { symbol: nseSymbol },
                {
                    $set:data_save
                },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true
                }
            );
            return data_save;

        } catch (error) {
            console.error(`Market depth error for ${symbol}:`, error.message);
            return this.getFallbackData(symbol);
        }
    }

    // =====================================================
    // SAFE NUMBER CONVERSION
    // =====================================================

    safeNumber(val) {
        if (val === null || val === undefined || val === '') return null;
        const num = typeof val === 'number' ? val : parseFloat(val);
        return isNaN(num) ? null : num;
    }

    // =====================================================
    // FORMAT DEPTH
    // =====================================================

    formatDepth(depthArray) {
        if (!Array.isArray(depthArray)) return [];

        return depthArray.map(item => ({
            price: this.safeNumber(item.price) || 0,
            quantity: this.safeNumber(item.quantity) || 0,
            orders: this.safeNumber(item.orders) || 0
        }));
    }

    // =====================================================
    // GET BEST PRICE
    // =====================================================

    getBestPrice(depthArray, type) {
        if (!depthArray || depthArray.length === 0) return 0;

        const prices = depthArray.map(d => this.safeNumber(d.price)).filter(p => p > 0);
        if (prices.length === 0) return 0;

        return type === 'bid' ? Math.max(...prices) : Math.min(...prices);
    }

    // =====================================================
    // CALCULATE SPREAD
    // =====================================================

    calculateSpread(bid, ask) {
        if (!bid || !ask || bid === 0 || ask === 0) return 0;
        return parseFloat((ask - bid).toFixed(2));
    }

    // =====================================================
    // CALCULATE CHANGE
    // =====================================================

    calculateChange(current, previous) {
        if (!current || !previous) return 0;
        return parseFloat((current - previous).toFixed(2));
    }

    calculatePercentageChange(current, previous) {
        if (!current || !previous || previous === 0) return 0;
        return parseFloat(((current - previous) / previous * 100).toFixed(2));
    }

    // =====================================================
    // FALLBACK DATA (When API fails)
    // =====================================================

    getFallbackData(symbol) {
        return {
            symbol: symbol,
            ltp: 0,
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            previousClose: 0,
            volume: 0,
            totalBuyQuantity: 0,
            totalSellQuantity: 0,
            bid: [],
            ask: [],
            bestBid: 0,
            bestAsk: 0,
            spread: 0,
            change: 0,
            percentageChange: 0,
            lastUpdated: Date.now(),
            error: 'Data unavailable - API error or invalid symbol'
        };
    }

    // =====================================================
    // GET SIMPLE QUOTE (Faster)
    // =====================================================

    async getSimpleQuote(symbol) {
        const depth = await this.getMarketDepth(symbol);

        return {
            symbol: depth.symbol,
            ltp: depth.ltp,
            open: depth.open,
            high: depth.high,
            low: depth.low,
            close: depth.close,
            volume: depth.volume,
            bestBid: depth.bestBid,
            bestAsk: depth.bestAsk,
            spread: depth.spread,
            change: depth.change,
            percentageChange: depth.percentageChange,
            error: depth.error
        };
    }

    // =====================================================
    // GET MULTIPLE STOCKS
    // =====================================================

    async getMultipleDepth(symbols) {
        const promises = symbols.map(symbol => this.getMarketDepth(symbol));
        const results = await Promise.all(promises);
        return results; // Returns all, including errors
    }
}

module.exports = MarketDepthService;