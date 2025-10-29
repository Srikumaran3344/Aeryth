// src/utils/firebaseInit.js
// ✅ Firebase initialization for Chrome Extension + Vite build

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBDDKEf908B2botxBpCAtJWtZJxq7ylaKY",
  authDomain: "aeryth01.firebaseapp.com",
  projectId: "aeryth01",
  storageBucket: "aeryth01.appspot.com",
  messagingSenderId: "789931924901",
  appId: "1:789931924901:web:e09c529c4c814133ca9c4c",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/**
 * ✅ Ensures Firebase user exists (anonymous fallback if needed)
 */
export async function ensureFirebaseAuth() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      try {
        if (user) return resolve(user);
        const cred = await signInAnonymously(auth);
        if (!cred || !cred.user) throw new Error("Anonymous sign-in failed");
        resolve(cred.user);
      } catch (err) {
        console.error("ensureFirebaseAuth failed:", err);
        reject(err);
      }
    });
  });
}

/**
 * ✅ Sign in with Google
 */
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (e) {
    console.error("Google sign-in failed:", e);
    throw e;
  }
}

/**
 * ✅ Sign out (only if not anonymous)
 */
export async function signOutUser() {
  try {
    const user = auth.currentUser;
    if (user && !user.isAnonymous) {
      await signOut(auth);
    }
  } catch (e) {
    console.error("Sign out failed:", e);
  }
}

export { app, auth, db };
