// utils/marginCalculator.js
// Margin Calculator for F&O Trading

/**
 * Calculate margin required for F&O orders
 * Based on SEBI/NSE margin requirements
 */

const MARGIN_RATES = {
  // Index Futures (NIFTY, BANKNIFTY, etc.)
  FUTIDX: {
    span: 0.10,      // 10% SPAN margin
    exposure: 0.05,  // 5% Exposure margin
    total: 0.15      // Total ~15%
  },
  
  // Stock Futures
  FUTSTK: {
    span: 0.15,      // 15% SPAN margin
    exposure: 0.05,  // 5% Exposure margin
    total: 0.20      // Total ~20%
  },
  
  // Index Options - BUY
  OPTIDX_BUY: {
    premium: 1.0     // 100% premium (no additional margin)
  },
  
  // Index Options - SELL
  OPTIDX_SELL: {
    span: 0.12,      // 12% SPAN margin
    exposure: 0.06,  // 6% Exposure margin
    premium: 1.0,    // Plus full premium received
    total: 0.18      // Total ~18% + premium
  },
  
  // Stock Options - BUY
  OPTSTK_BUY: {
    premium: 1.0     // 100% premium
  },
  
  // Stock Options - SELL
  OPTSTK_SELL: {
    span: 0.15,      // 15% SPAN margin
    exposure: 0.08,  // 8% Exposure margin
    premium: 1.0,    // Plus full premium received
    total: 0.23      // Total ~23% + premium
  }
};

/**
 * Calculate margin for F&O order
 * @param {Object} orderDetails - Order details
 * @returns {Object} Margin breakdown
 */
function calculateFOMargin(orderDetails) {
  const {
    instrumentType,
    contractType,
    orderType,
    quantity,
    price,
    lotSize = 1,
    strikePrice
  } = orderDetails;
  
  // For EQUITY, full amount required
  if (instrumentType === 'EQUITY') {
    const totalValue = quantity * price;
    return {
      type: 'EQUITY',
      marginRequired: totalValue,
      spanMargin: 0,
      exposureMargin: 0,
      premium: 0,
      totalValue: totalValue,
      isMarginOrder: false,
      breakdown: 'Full payment required for equity delivery'
    };
  }
  
  const totalQuantity = quantity;
  const contractValue = totalQuantity * price;
  
  // FUTURES MARGIN
  if (contractType === 'FUTURES') {
    const marginKey = instrumentType; // FUTIDX or FUTSTK
    const rates = MARGIN_RATES[marginKey] || MARGIN_RATES.FUTSTK;
    
    const spanMargin = contractValue * rates.span;
    const exposureMargin = contractValue * rates.exposure;
    const marginRequired = spanMargin + exposureMargin;
    
    return {
      type: 'FUTURES',
      contractValue: contractValue,
      marginRequired: marginRequired,
      spanMargin: spanMargin,
      exposureMargin: exposureMargin,
      marginPercent: rates.total * 100,
      isMarginOrder: true,
      breakdown: `SPAN: ₹${spanMargin.toFixed(2)}, Exposure: ₹${exposureMargin.toFixed(2)}`
    };
  }
  
  // OPTIONS MARGIN
  if (contractType === 'CE' || contractType === 'PE') {
    const premium = contractValue; // Option premium
    
    // BUY OPTION - Only premium required
    if (orderType === 'BUY') {
      return {
        type: 'OPTION_BUY',
        premium: premium,
        marginRequired: premium,
        spanMargin: 0,
        exposureMargin: 0,
        isMarginOrder: false,
        breakdown: `Premium payment: ₹${premium.toFixed(2)}`
      };
    }
    
    // SELL OPTION - SPAN + Exposure + Premium received
    const marginKey = `${instrumentType}_SELL`; // OPTIDX_SELL or OPTSTK_SELL
    const rates = MARGIN_RATES[marginKey] || MARGIN_RATES.OPTSTK_SELL;
    
    // Calculate margin based on strike price (notional value)
    const notionalValue = totalQuantity * (strikePrice || price * 10);
    const spanMargin = notionalValue * rates.span;
    const exposureMargin = notionalValue * rates.exposure;
    const marginRequired = spanMargin + exposureMargin;
    
    return {
      type: 'OPTION_SELL',
      notionalValue: notionalValue,
      premium: premium,
      marginRequired: marginRequired,
      spanMargin: spanMargin,
      exposureMargin: exposureMargin,
      premiumReceived: premium,
      netMargin: marginRequired - premium, // Net margin after premium credit
      marginPercent: rates.total * 100,
      isMarginOrder: true,
      breakdown: `SPAN: ₹${spanMargin.toFixed(2)}, Exposure: ₹${exposureMargin.toFixed(2)}, Premium received: ₹${premium.toFixed(2)}`
    };
  }
  
  // Default fallback
  return {
    type: 'UNKNOWN',
    marginRequired: contractValue,
    isMarginOrder: false,
    breakdown: 'Unable to calculate margin'
  };
}

/**
 * Check if user has sufficient margin
 * @param {Number} availableBalance - User's available balance
 * @param {Number} marginRequired - Required margin
 * @returns {Object} Check result
 */
function checkMarginAvailability(availableBalance, marginRequired) {
  const hasMargin = availableBalance >= marginRequired;
  const shortfall = hasMargin ? 0 : marginRequired - availableBalance;
  
  return {
    hasMargin,
    availableBalance,
    marginRequired,
    shortfall,
    utilizationPercent: (marginRequired / availableBalance * 100).toFixed(2)
  };
}

/**
 * Calculate intraday margin (usually lower)
 * @param {Object} orderDetails - Order details
 * @returns {Object} Margin breakdown
 */
function calculateIntradayMargin(orderDetails) {
  const standardMargin = calculateFOMargin(orderDetails);
  
  // Intraday margin is typically 50-60% of delivery margin
  const intradayMultiplier = 0.55;
  
  return {
    ...standardMargin,
    marginRequired: standardMargin.marginRequired * intradayMultiplier,
    spanMargin: standardMargin.spanMargin * intradayMultiplier,
    exposureMargin: standardMargin.exposureMargin * intradayMultiplier,
    intradayDiscount: (1 - intradayMultiplier) * 100,
    breakdown: `${standardMargin.breakdown} (Intraday 45% discount applied)`
  };
}

/**
 * Calculate margin for entire portfolio
 * @param {Array} positions - Array of open positions
 * @returns {Object} Portfolio margin summary
 */
function calculatePortfolioMargin(positions) {
  let totalMarginUsed = 0;
  let totalEquityValue = 0;
  let totalFOValue = 0;
  
  const marginBreakdown = {
    equity: 0,
    futures: 0,
    optionsBuy: 0,
    optionsSell: 0
  };
  
  positions.forEach(position => {
    const margin = calculateFOMargin({
      instrumentType: position.instrumentType,
      contractType: position.contractType,
      orderType: position.type,
      quantity: position.quantity,
      price: position.avgPrice,
      lotSize: position.lotSize,
      strikePrice: position.strikePrice
    });
    
    totalMarginUsed += margin.marginRequired;
    
    if (position.instrumentType === 'EQUITY') {
      totalEquityValue += margin.marginRequired;
      marginBreakdown.equity += margin.marginRequired;
    } else {
      totalFOValue += margin.contractValue || margin.notionalValue || 0;
      
      if (position.contractType === 'FUTURES') {
        marginBreakdown.futures += margin.marginRequired;
      } else if (position.type === 'BUY') {
        marginBreakdown.optionsBuy += margin.marginRequired;
      } else {
        marginBreakdown.optionsSell += margin.marginRequired;
      }
    }
  });
  
  return {
    totalMarginUsed,
    totalEquityValue,
    totalFOValue,
    marginBreakdown,
    positionCount: positions.length
  };
}

/**
 * Format margin details for display
 * @param {Object} marginDetails - Margin calculation result
 * @returns {String} Formatted string
 */
function formatMarginDisplay(marginDetails) {
  if (!marginDetails.isMarginOrder) {
    return `Full payment: ₹${marginDetails.marginRequired.toFixed(2)}`;
  }
  
  const lines = [
    `Contract Value: ₹${(marginDetails.contractValue || marginDetails.notionalValue || 0).toFixed(2)}`,
    `Margin Required: ₹${marginDetails.marginRequired.toFixed(2)} (${marginDetails.marginPercent}%)`,
    marginDetails.breakdown
  ];
  
  if (marginDetails.premiumReceived) {
    lines.push(`Premium Received: ₹${marginDetails.premiumReceived.toFixed(2)}`);
    lines.push(`Net Margin: ₹${marginDetails.netMargin.toFixed(2)}`);
  }
  
  return lines.join('\n');
}

module.exports = {
  calculateFOMargin,
  calculateIntradayMargin,
  checkMarginAvailability,
  calculatePortfolioMargin,
  formatMarginDisplay,
  MARGIN_RATES
};
