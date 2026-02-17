// jobs/userDataSyncJob.js
// ✅ Periodic sync: every 5s syncs ALL users to Firebase
// ✅ Realtime P&L: updates position mark prices → pnl → balance live
// ✅ ONLY pushes: profile, balance, pnl, positions, watchlist

const Position = require('../models/Position');
const Stock    = require('../models/Stock');
const User     = require('../models/User');
const { syncAllUsersToFirebase, syncSingleUserToFirebase, _fbPatch } = require('../services/userFirebaseService');

let syncInterval    = null;
let pnlInterval     = null;

// ─────────────────────────────────────────────
// FAST P&L UPDATE (every 3s)
// Only updates pnl + positions markPrice
// Does NOT re-fetch profile/watchlist (heavier)
// ─────────────────────────────────────────────
async function updateAllUsersPnL() {
  try {
    // Get all open positions grouped by userId
    const positions = await Position.find({ isActive: true }).lean();
    if (!positions.length) return;

    const symbols = [...new Set(positions.map(p => p.symbol))];
    const stocks  = await Stock.find({ symbol: { $in: symbols } }).lean();
    const priceMap = {};
    stocks.forEach(s => { priceMap[s.symbol] = parseFloat(s.currentPrice) || 0; });

    // Group positions by user
    const byUser = {};
    positions.forEach(pos => {
      const uid = pos.userId.toString();
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(pos);
    });

    const fbUpdates = {};

    for (const [uid, userPositions] of Object.entries(byUser)) {
      let totalUnrealized = 0;
      let totalInvestment = 0;

      userPositions.forEach(pos => {
        const markPrice   = priceMap[pos.symbol] || pos.currentPrice;
        const investedVal = pos.investmentValue || (pos.entryPrice * pos.quantity);
        const currentVal  = markPrice * pos.quantity;

        let pnl;
        if (pos.positionType === 'LONG') {
          pnl = currentVal - investedVal - (pos.totalBrokerage || 0);
        } else {
          pnl = investedVal - currentVal - (pos.totalBrokerage || 0);
        }
        const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;

        totalUnrealized += pnl;
        totalInvestment += investedVal;

        // Update just the mark price + pnl for this position in Firebase
        fbUpdates[`users/${uid}/positions/${pos._id}/markPrice`]    = parseFloat(markPrice.toFixed(2));
        fbUpdates[`users/${uid}/positions/${pos._id}/currentValue`] = parseFloat(currentVal.toFixed(2));
        fbUpdates[`users/${uid}/positions/${pos._id}/pnl`]          = parseFloat(pnl.toFixed(2));
        fbUpdates[`users/${uid}/positions/${pos._id}/pnlPercentage`]= parseFloat(pnlPct.toFixed(2));
        fbUpdates[`users/${uid}/positions/${pos._id}/lastUpdated`]  = Date.now();
      });

      // Fetch user for totalPnL
      const user = await User.findById(uid, 'totalPnL todayPnL availableBalance usedMargin marginMultiplier').lean();
      if (user) {
        fbUpdates[`users/${uid}/pnl/unrealizedPnL`]   = parseFloat(totalUnrealized.toFixed(2));
        fbUpdates[`users/${uid}/pnl/totalInvestment`]  = parseFloat(totalInvestment.toFixed(2));
        fbUpdates[`users/${uid}/pnl/openPositions`]    = userPositions.length;
        fbUpdates[`users/${uid}/pnl/totalPnL`]         = parseFloat((user.totalPnL || 0).toFixed(2));
        fbUpdates[`users/${uid}/pnl/todayPnL`]         = parseFloat((user.todayPnL || 0).toFixed(2));
        fbUpdates[`users/${uid}/pnl/lastUpdated`]      = Date.now();

        // Also update balance (margin usage can change)
        const totalMargin = (user.availableBalance || 0) * (user.marginMultiplier || 1);
        fbUpdates[`users/${uid}/balance/usedMargin`]      = parseFloat((user.usedMargin || 0).toFixed(2));
        fbUpdates[`users/${uid}/balance/availableMargin`] = parseFloat((totalMargin - (user.usedMargin || 0)).toFixed(2));
        fbUpdates[`users/${uid}/balance/availableBalance`]= parseFloat((user.availableBalance || 0).toFixed(2));
        fbUpdates[`users/${uid}/balance/lastUpdated`]     = Date.now();
      }
    }

    if (Object.keys(fbUpdates).length > 0) {
      await _fbPatch(fbUpdates);
    }

  } catch (e) {
    console.error('❌ P&L update error:', e.message);
  }
}

// ─────────────────────────────────────────────
// Start jobs
// ─────────────────────────────────────────────
function startUserDataSync(fullSyncIntervalSec = 10, pnlIntervalMs = 3000) {
  if (syncInterval) {
    console.log('⚠️  User sync already running');
    return;
  }

  console.log('\n' + '═'.repeat(55));
  console.log('🔥 USER FIREBASE SYNC STARTED');
  console.log(`   Full sync:  every ${fullSyncIntervalSec}s`);
  console.log(`   P&L update: every ${pnlIntervalMs/1000}s`);
  console.log('   Syncing: profile | balance | pnl | positions | watchlist');
  console.log('═'.repeat(55) + '\n');

  // Immediate first full sync
  syncAllUsersToFirebase();

  // Full sync periodically
  syncInterval = setInterval(syncAllUsersToFirebase, fullSyncIntervalSec * 1000);

  // Fast P&L update
  pnlInterval  = setInterval(updateAllUsersPnL, pnlIntervalMs);

  console.log('✅ User data sync active\n');
}

function stopUserDataSync() {
  if (syncInterval)  { clearInterval(syncInterval);  syncInterval = null; }
  if (pnlInterval)   { clearInterval(pnlInterval);   pnlInterval  = null; }
  console.log('🛑 User data sync stopped');
}

process.on('SIGINT',  () => { stopUserDataSync(); process.exit(0); });
process.on('SIGTERM', () => { stopUserDataSync(); process.exit(0); });

module.exports = {
  startUserDataSync,
  stopUserDataSync,
  syncAllUsersToFirebase,
  syncSingleUserToFirebase,
  updateAllUsersPnL
};