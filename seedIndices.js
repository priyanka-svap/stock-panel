// seedIndices.js
// MongoDB + Firebase mein NIFTY50 + BANKNIFTY seed karo
// Yahoo Finance se independent — placeholder values se start karo
// Server start hone ke baad firebaseUpdateJob live values fetch karega
//
// Usage: node seedIndices.js

const mongoose = require('mongoose');
const Index    = require('./models/Index');
require('dotenv').config();

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// ── Seed data — placeholder values ──
// Ye values sirf initial entry ke liye hain
// firebaseUpdateJob har 15s mein live Yahoo values se replace karega
const INDICES_SEED = [
  {
    name:             'NIFTY 50',
    displayName:      'NIFTY 50',
    value:            24000,
    previousClose:    24000,
    change:           0,
    percentageChange: 0,
    dayHigh:          24000,
    dayLow:           24000,
    openValue:        24000,
    isActive:         true,
    lastUpdated:      new Date()
  },
  {
    name:             'BANK NIFTY',
    displayName:      'BANK NIFTY',
    value:            51000,
    previousClose:    51000,
    change:           0,
    percentageChange: 0,
    dayHigh:          51000,
    dayLow:           51000,
    openValue:        51000,
    isActive:         true,
    lastUpdated:      new Date()
  }
];

async function fbPatch(updates) {
  try {
    const r = await fetch(`${FIREBASE_URL}/.json`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updates)
    });
    return r.ok;
  } catch (e) {
    console.error('Firebase error:', e.message);
    return false;
  }
}

async function seedIndices() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB');
    console.log('✅ MongoDB connected\n');

    // ── Step 1: Purane sab indices delete karo ──
    const before = await Index.countDocuments();
    await Index.deleteMany({});
    console.log(`🗑️  MongoDB: ${before} purane indices delete kiye\n`);

    // ── Step 2: NIFTY50 + BANKNIFTY insert karo ──
    const inserted = await Index.insertMany(INDICES_SEED);
    console.log(`✅ MongoDB: ${inserted.length} indices inserted:`);
    inserted.forEach(i => console.log(`   📊 ${i.displayName} — ₹${i.value} (placeholder)`));

    // ── Step 3: Firebase mein bhi push karo ──
    console.log('\n🔥 Firebase update...');

    // Pehle purane indices ke keys fetch karo aur delete karo
    try {
      const r    = await fetch(`${FIREBASE_URL}/indices.json?shallow=true`);
      const keys = await r.json();
      if (keys && typeof keys === 'object') {
        const oldKeys = Object.keys(keys);
        const keepKeys = ['NIFTY50', 'BANKNIFTY', 'NIFTY_50', 'BANK_NIFTY', 'NIFTY 50', 'BANK NIFTY'];
        const toRemove = oldKeys.filter(k => !keepKeys.some(kk => kk.replace(/\s/g,'').toUpperCase() === k.replace(/[\s_-]/g,'').toUpperCase()));
        
        for (const key of toRemove) {
          await fetch(`${FIREBASE_URL}/indices/${key}.json`, { method: 'DELETE' });
          console.log(`   🗑️  Firebase deleted: indices/${key}`);
        }
      }
    } catch (e) {
      console.log('   ⚠️  Could not clean old Firebase indices:', e.message);
    }

    // Naye indices push karo
    const fbUpdates = {};
    INDICES_SEED.forEach(idx => {
      const key = idx.name.replace(/\s/g, '').toUpperCase(); // "NIFTY50", "BANKNIFTY"
      fbUpdates[`indices/${key}`] = {
        name:             idx.name,
        displayName:      idx.displayName,
        value:            idx.value,
        previousClose:    idx.previousClose,
        change:           idx.change,
        percentageChange: idx.percentageChange,
        dayHigh:          idx.dayHigh,
        dayLow:           idx.dayLow,
        openValue:        idx.openValue,
        lastUpdated:      Date.now()
      };
    });

    const fbOk = await fbPatch(fbUpdates);
    if (fbOk) {
      console.log(`✅ Firebase: ${Object.keys(fbUpdates).length} indices pushed`);
      Object.keys(fbUpdates).forEach(k => console.log(`   🔥 ${k}`));
    } else {
      console.log('⚠️  Firebase push failed (MongoDB updated successfully)');
    }

    console.log('\n✨ Done!');
    console.log('💡 Ab server start karo — firebaseUpdateJob live prices se update karega');

    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

seedIndices();
