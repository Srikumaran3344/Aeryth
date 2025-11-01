// src/utils/firebaseInit.js
import { initializeApp, getApps, getApp, deleteApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ✅ Your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyBDDKEf908B2botxBpCAtJWtZJxq7ylaKY",
  authDomain: "aeryth01.firebaseapp.com",
  projectId: "aeryth01",
  storageBucket: "aeryth01.appspot.com",
  messagingSenderId: "789931924901",
  appId: "1:789931924901:web:e09c529c4c814133ca9c4c",
};

// ✅ Initialize app safely
let firebaseApp;
const apps = getApps();

if (apps.length > 0) {
  const existingApp = apps[0];
  // Check if the existing app’s config matches your real project
  if (existingApp.options?.projectId !== firebaseConfig.projectId) {
    console.warn("⚠️ Existing Firebase app had mismatched config. Reinitializing...");
    deleteApp(existingApp).then(() => {
      firebaseApp = initializeApp(firebaseConfig);
    });
  } else {
    firebaseApp = existingApp;
  }
} else {
  firebaseApp = initializeApp(firebaseConfig);
}

// ✅ Export shared instances
export const app = firebaseApp;
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

/**
 * Initializes Firebase Auth for the current session.
 * Ensures anonymous sign-in if no user exists.
 */
export async function initFirebase() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        resolve({ user, db });
      } else {
        try {
          const cred = await signInAnonymously(auth);
          resolve({ user: cred.user, db });
        } catch (err) {
          console.error("Firebase anonymous sign-in failed:", err);
          reject(err);
        }
      }
    });
  });
}
