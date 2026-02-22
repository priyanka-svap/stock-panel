// utils/marginCalculator.js
//
// ✅ Cross-margin liquidation price — mathematically verified
//
// LONG derivation:
//   At liqPrice P: unrealizedLoss = (entry - P) × qty
//   Condition when liquidated: walletBalance - loss = maintenanceMargin
//   maintenanceMargin = P × qty × MMR
//   → walletBalance - (entry - P)×qty = P×qty×MMR
//   → walletBalance - entry×qty + P×qty = P×qty×MMR
//   → walletBalance - notional = P×qty×(MMR - 1)
//   → P = (notional - walletBalance) / (qty × (1 - MMR))   ✅
//
// SHORT derivation:
//   unrealizedLoss = (P - entry) × qty
//   walletBalance - (P - entry)×qty = P×qty×MMR
//   → walletBalance + entry×qty = P×qty + P×qty×MMR
//   → walletBalance + notional = P×qty×(1 + MMR)
//   → P = (walletBalance + notional) / (qty × (1 + MMR))   ✅

const MAINTENANCE_MARGIN_RATE = 0.005; // 0.5% — industry standard

/**
 * LONG position liquidation price
 * @param {number} entryPrice    - entry price of the position
 * @param {number} qty           - quantity held
 * @param {number} walletBalance - margin/wallet available (user.availableBalance or pos.marginUsed)
 * @param {number} leverage      - leverage (used in fallback when cross-margin calc > entry)
 * @returns {number}
 */
function crossMarginLiquidationLong(entryPrice, qty, walletBalance, leverage) {
  if (qty <= 0) return 0;
  const notional = entryPrice * qty;
  if (walletBalance >= notional) return 0; // fully funded, no liq risk
  const denom = qty * (1 - MAINTENANCE_MARGIN_RATE);
  if (denom <= 0) return 0;
  const liqCross = (notional - walletBalance) / denom;
  // Fallback: isolated-margin formula if cross result is illogical
  if (liqCross >= entryPrice) {
    return Math.max(0.01, entryPrice * (1 - 1 / leverage + MAINTENANCE_MARGIN_RATE));
  }
  return Math.max(0, liqCross);
}

/**
 * SHORT position liquidation price
 * @param {number} entryPrice    - entry price
 * @param {number} qty           - quantity held
 * @param {number} walletBalance - margin/wallet available
 * @returns {number}
 */
function crossMarginLiquidationShort(entryPrice, qty, walletBalance) {
  if (qty <= 0) return 0;
  const denom = qty * (1 + MAINTENANCE_MARGIN_RATE);
  if (denom <= 0) return 0;
  return (walletBalance + entryPrice * qty) / denom;
}

/**
 * Main entry — get liquidation price for any position
 * @param {number} entryPrice    - entry price
 * @param {number} qty           - quantity held
 * @param {number} walletBalance - wallet/margin balance for this position
 * @param {number} leverage      - leverage multiplier (e.g. 5 for 5x)
 * @param {string} tradeType     - 'LONG'|'BUY'  or  'SHORT'|'SELL'
 * @returns {number} liquidation price (0 = no liquidation risk)
 */
function getLiquidationPrice(entryPrice, qty, walletBalance, leverage, tradeType) {
  const lev = Math.max(1, leverage || 1);
  if (entryPrice <= 0 || qty <= 0) return 0;
  const type = (tradeType || '').toUpperCase();
  if (type === 'BUY'  || type === 'LONG')  return crossMarginLiquidationLong(entryPrice, qty, walletBalance, lev);
  if (type === 'SELL' || type === 'SHORT') return crossMarginLiquidationShort(entryPrice, qty, walletBalance);
  return 0;
}

module.exports = { getLiquidationPrice, crossMarginLiquidationLong, crossMarginLiquidationShort, MAINTENANCE_MARGIN_RATE };
