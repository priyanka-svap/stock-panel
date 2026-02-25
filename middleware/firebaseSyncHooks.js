// middleware/firebaseSyncHooks.js
// ✅ FIX: userFirebaseService plain object export hai — new() nahi karna
// ✅ FIX: console.log(req) remove (bandwidth + security issue tha)
// ✅ Sirf syncSingleUserToFirebase use karo — sab data ek call mein push hota hai

const { syncSingleUserToFirebase } = require('../services/userFirebaseService');

async function onWatchlistChange(userId) {
  try {
    await syncSingleUserToFirebase(userId.toString());
  } catch (error) {
    console.error('Watchlist sync hook error:', error.message);
  }
}

async function onOrderChange(userId) {
  try {
    await syncSingleUserToFirebase(userId.toString());
  } catch (error) {
    console.error('Order sync hook error:', error.message);
  }
}

async function onHoldingChange(userId) {
  try {
    await syncSingleUserToFirebase(userId.toString());
  } catch (error) {
    console.error('Holding sync hook error:', error.message);
  }
}

async function onPositionChange(userId) {
  try {
    await syncSingleUserToFirebase(userId.toString());
  } catch (error) {
    console.error('Position sync hook error:', error.message);
  }
}

async function onUserProfileChange(userId) {
  try {
    await syncSingleUserToFirebase(userId.toString());
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
        // All sync types now use syncSingleUserToFirebase — consistent + fewer Firebase calls
        syncSingleUserToFirebase(userId.toString()).catch(err =>
          console.error(`[autoSyncMiddleware:${syncType}] sync error:`, err.message)
        );
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
