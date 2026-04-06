import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const DOC_ID = 'logic_spy_word_sets';
const AUTH_BOOTSTRAP_TIMEOUT_MS = 3500;

let authPromise = null;

async function ensureAuthReady() {
  if (!authPromise) {
    authPromise = new Promise((resolve) => {
      let settled = false;
      let unsub = null;
      let timeoutId = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        if (unsub) unsub();
        resolve();
      };

      timeoutId = window.setTimeout(() => {
        console.warn('Logic Spy auth bootstrap timeout. Continue in guest mode.');
        finish();
      }, AUTH_BOOTSTRAP_TIMEOUT_MS);

      unsub = onAuthStateChanged(auth, async (user) => {
        if (user) {
          finish();
          return;
        }
        try {
          await signInAnonymously(auth);
        } catch (error) {
          const errorCode = String(error?.code || '');
          const isAuthBootstrapIssue = errorCode.includes('auth/anonymous-not-enabled')
            || errorCode.includes('auth/operation-not-allowed')
            || errorCode.includes('auth/admin-restricted-operation')
            || errorCode.includes('auth/unauthorized-domain');
          if (isAuthBootstrapIssue) {
            console.warn('Anonymous auth is unavailable. Continue in guest mode for settings read/write allowed by rules.', error);
            finish();
            return;
          }
          console.error('Logic Spy auth bootstrap failed.', error);
          finish();
        }
      }, (error) => {
        console.error('Logic Spy auth state listener failed.', error);
        finish();
      });
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
