import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM',
  authDomain: 'pakdu-a26c4.firebaseapp.com',
  databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'pakdu-a26c4',
  storageBucket: 'pakdu-a26c4.firebasestorage.app',
  messagingSenderId: '414809008203',
  appId: '1:414809008203:web:757dceafa78d91900d85ce',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const DOC_ID = 'logic_spy_word_sets';

let authPromise = null;

async function ensureAuthReady() {
  if (!authPromise) {
    authPromise = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (user) {
          unsub();
          resolve();
          return;
        }
        try {
          await signInAnonymously(auth);
        } catch (error) {
          unsub();
          reject(error);
        }
      }, reject);
    });
  }
  await authPromise;
}

export async function getLogicSpyWordSetConfig() {
  await ensureAuthReady();
  const snap = await getDoc(doc(db, 'settings', DOC_ID));
  return snap.exists() ? snap.data() : null;
}

export async function saveLogicSpyWordSetConfig(sets) {
  await ensureAuthReady();
  await setDoc(doc(db, 'settings', DOC_ID), {
    sets,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
