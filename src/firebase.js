import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCkBTFdGJwG8ffX-OBEitZ-XVy8pYExz2o",
  authDomain: "rpl-auction-590bc.firebaseapp.com",
  databaseURL: "https://rpl-auction-590bc-default-rtdb.firebaseio.com",
  projectId: "rpl-auction-590bc",
  storageBucket: "rpl-auction-590bc.firebasestorage.app",
  messagingSenderId: "619361162141",
  appId: "1:619361162141:web:3c7f1711faeab1a5c29574",
  measurementId: "G-TD33YT64K2"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export const storage = {
  async get(key) {
    try {
      const snapshot = await get(ref(db, `auction/${key}`));
      if (snapshot.exists()) return { key, value: snapshot.val() };
      return null;
    } catch (e) { console.error('Firebase get error:', e); return null; }
  },
  async set(key, value) {
    try { await set(ref(db, `auction/${key}`), value); return { key, value }; }
    catch (e) { console.error('Firebase set error:', e); return null; }
  },
  subscribe(key, callback) {
    return onValue(ref(db, `auction/${key}`), (snapshot) => {
      if (snapshot.exists()) callback({ key, value: snapshot.val() });
    });
  }
};

export default storage;
