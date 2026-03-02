// cleanIndices.js
// MongoDB + Firebase se unwanted indices delete karo
// Sirf NIFTY50 aur BANKNIFTY rakhne hain
//
// Usage: node cleanIndices.js

const mongoose = require('mongoose');
const Index    = require('./models/Index');
require('dotenv').config();

const FIREBASE_URL = 'https://stockpanelapp-default-rtdb.asia-southeast1.firebasedatabase.app';

// ── Sirf yahi rakhne hain ──
const KEEP_INDICES = ['NIFTY 50', 'BANK NIFTY', 'NIFTY50', 'BANKNIFTY'];

async function fbDelete(path) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, { method: 'DELETE' });
    return r.ok;
  } catch (e) {
    console.error('Firebase DELETE error:', e.message);
    return false;
  }
}

async function getFirebaseIndicesKeys() {
  try {
    const r    = await fetch(`${FIREBASE_URL}/indices.json?shallow=true`);
    const data = await r.json();
    return data ? Object.keys(data) : [];
  } catch (e) {
    console.error('Firebase fetch error:', e.message);
    return [];
  }
}

async function cleanIndices() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB');
    console.log('✅ MongoDB connected\n');

    // ── 1. MongoDB: jo KEEP_INDICES mein nahi hain unhe delete karo ──
    const allIndices = await Index.find({}).lean();
    console.log(`📊 MongoDB mein total indices: ${allIndices.length}`);

    const toDelete = allIndices.filter(idx => {
      const name = (idx.name || '').toUpperCase().replace(/\s/g, '');
      const display = (idx.displayName || '').toUpperCase().replace(/\s/g, '');
      const keepNormalized = KEEP_INDICES.map(k => k.toUpperCase().replace(/\s/g, ''));
      return !keepNormalized.includes(name) && !keepNormalized.includes(display);
    });

    const toKeep = allIndices.filter(idx => !toDelete.includes(idx));

    console.log(`✅ Rakhne wale: ${toKeep.map(i => i.name || i.displayName).join(', ')}`);
    console.log(`🗑️  Delete hone wale: ${toDelete.length} indices`);

    if (toDelete.length > 0) {
      const deleteNames = toDelete.map(i => i.name);
      const result = await Index.deleteMany({ name: { $in: deleteNames } });
      console.log(`✅ MongoDB: ${result.deletedCount} indices deleted`);
      toDelete.forEach(i => console.log(`   🗑️  ${i.name || i.displayName}`));
    } else {
      console.log('ℹ️  MongoDB: kuch delete nahi karna (already clean)');
    }

    // ── 2. Firebase: indices node ke saare keys fetch karo, jo nahi chahiye unhe delete karo ──
    console.log('\n🔥 Firebase indices check...');
    const fbKeys = await getFirebaseIndicesKeys();
    console.log(`📊 Firebase mein total indices: ${fbKeys.length}`);

    const keepNormalized = KEEP_INDICES.map(k => k.toUpperCase().replace(/[\s_-]/g, ''));

    const fbToDelete = fbKeys.filter(key => {
      const keyNorm = key.toUpperCase().replace(/[\s_-]/g, '');
      return !keepNormalized.includes(keyNorm);
    });

    const fbToKeep = fbKeys.filter(k => !fbToDelete.includes(k));
    console.log(`✅ Firebase rakhne wale: ${fbToKeep.join(', ')}`);
    console.log(`🗑️  Firebase delete hone wale: ${fbToDelete.length} keys`);

    for (const key of fbToDelete) {
      const ok = await fbDelete(`indices/${key}`);
      console.log(`   ${ok ? '✅' : '❌'} Firebase deleted: indices/${key}`);
    }

    console.log('\n✨ Clean complete!');
    console.log('💡 Ab sirf NIFTY50 + BANKNIFTY hain — MongoDB aur Firebase dono mein.');

    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

cleanIndices();
