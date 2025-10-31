// src/utils/firebaseInit.js
// Uses Firebase ESM CDN (works in extension + Vite dev).
// Exports: ensureFirebaseAuth, signInWithGoogleToken, signOutUser, auth, db

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithCredential,
  GoogleAuthProvider,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBDDKEf908B2botxBpCAtJWtZJxq7ylaKY",
  authDomain: "aeryth01.firebaseapp.com",
  projectId: "aeryth01",
  storageBucket: "aeryth01.appspot.com",
  messagingSenderId: "789931924901",
  appId: "1:789931924901:web:e09c529c4c814133ca9c4c"
};

// Initialize app safely (multiple imports can happen in dev)
let app;
if (getApps().length > 0) {
  try { app = getApp(); } catch { app = initializeApp(firebaseConfig); }
} else {
  app = initializeApp(firebaseConfig);
}

const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/**
 * Ensure an authenticated user exists.
 * Returns user (anonymous or real).
 */
export async function ensureFirebaseAuth() {
  return new Promise((resolve, reject) => {
    try {
      onAuthStateChanged(auth, async (user) => {
        if (user) return resolve(user);
        // If no user, sign in anonymously for background safe ops
        try {
          const cred = await signInAnonymously(auth);
          return resolve(cred.user);
        } catch (e) {
          return reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Sign in to Firebase using a Google access token.
 * This is used after chrome.identity returns an access token.
 */
export async function signInWithGoogleToken(accessToken) {
  if (!accessToken) throw new Error("Missing accessToken");
  const cred = GoogleAuthProvider.credential(null, accessToken);
  const result = await signInWithCredential(auth, cred);
  return result.user;
}

/**
 * Sign out non-anonymous users (keeps anonymous fallback)
 */
export async function signOutUser() {
  try {
    const u = auth.currentUser;
    if (u && !u.isAnonymous) await signOut(auth);
  } catch (e) {
    console.warn("signOutUser failed", e);
  }
}

export { auth, db, provider };
