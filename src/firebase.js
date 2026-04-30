// ============================================================
// FIREBASE SETUP INSTRUCTIONS
// ============================================================
// 1. Go to https://console.firebase.google.com
// 2. Click "Create a project" → name it "rpl-auction"
// 3. Go to Build → Realtime Database → Create Database
//    - Select your region
//    - Start in TEST MODE (allows read/write for 30 days)
// 4. Go to Project Settings → General → scroll down
//    - Click "Add app" → Web → register app
//    - Copy the firebaseConfig object
// 5. Replace the config below with YOUR config
// ============================================================

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue } from 'firebase/database';

// ⚠️ REPLACE THIS with your Firebase config from step 5 above
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ── Storage API (same interface as Claude artifacts) ──

export const storage = {
  async get(key) {
    try {
      const snapshot = await get(ref(db, `auction/${key}`));
      if (snapshot.exists()) {
        return { key, value: snapshot.val() };
      }
      return null;
    } catch (e) {
      console.error('Firebase get error:', e);
      return null;
    }
  },

  async set(key, value) {
    try {
      await set(ref(db, `auction/${key}`), value);
      return { key, value };
    } catch (e) {
      console.error('Firebase set error:', e);
      return null;
    }
  },

  // Real-time listener (bonus — better than polling!)
  subscribe(key, callback) {
    const unsubscribe = onValue(ref(db, `auction/${key}`), (snapshot) => {
      if (snapshot.exists()) {
        callback({ key, value: snapshot.val() });
      }
    });
    return unsubscribe;
  }
};

export default storage;
