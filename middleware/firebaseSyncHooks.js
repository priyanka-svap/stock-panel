// middleware/firebaseSyncHooks.js
// ✅ FIX: userFirebaseService plain object export hai — new() nahi karna
// ✅ FIX: console.log(req) remove (bandwidth + security issue tha)
// ✅ Sirf scheduleUserFirebaseSync use karo — sab data ek debounced call mein push hota hai

const { scheduleUserFirebaseSync } = require('../services/userFirebaseService');

async function onWatchlistChange(userId) {
  try {
    scheduleUserFirebaseSync(userId.toString());
  } catch (error) {
    console.error('Watchlist sync hook error:', error.message);
  }
}

async function onOrderChange(userId) {
  try {
    scheduleUserFirebaseSync(userId.toString());
  } catch (error) {
    console.error('Order sync hook error:', error.message);
  }
}

async function onHoldingChange(userId) {
  try {
    scheduleUserFirebaseSync(userId.toString());
  } catch (error) {
    console.error('Holding sync hook error:', error.message);
  }
}

async function onPositionChange(userId) {
  try {
    scheduleUserFirebaseSync(userId.toString());
  } catch (error) {
    console.error('Position sync hook error:', error.message);
  }
}

async function onUserProfileChange(userId) {
  try {
    scheduleUserFirebaseSync(userId.toString());
  } catch (error) {
    console.error('Profile sync hook error:', error.message);
  }
}

// ✅ FIX: console.log(req) removed — yeh request object print karta tha (performance + security issue)
function autoSyncMiddleware(syncType) {
  return async (req, res, next) => {
    const originalJson = res.json;

    res.json = function(data) {
      originalJson.call(this, data);

      if (data && data.success && req.user && req.user.userId) {
        const userId = req.user.userId;
        // All sync types now use debounced scheduleUserFirebaseSync — fewer Firebase writes
        scheduleUserFirebaseSync(userId.toString());
      }
    };

    next();
  };
}

module.exports = {
  autoSyncMiddleware,
  onWatchlistChange,
  onOrderChange,
  onHoldingChange,
  onPositionChange,
  onUserProfileChange
};
