// src/utils/firebaseInit.js
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  signInWithPopup
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBDDKEf908B2botxBpCAtJWtZJxq7ylaKY",
  authDomain: "aeryth01.firebaseapp.com",
  projectId: "aeryth01",
  storageBucket: "aeryth01.appspot.com",
  messagingSenderId: "789931924901",
  appId: "1:789931924901:web:e09c529c4c814133ca9c4c"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();

export function ensureFirebaseAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => resolve(user || null));
  });
}

export async function signInWithGoogleToken(token) {
  if (!token) throw new Error("Missing access token");
  const cred = GoogleAuthProvider.credential(null, token);
  const { user } = await signInWithCredential(auth, cred);
  return user;
}

export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn("signOutUser failed", e);
  }
}
// We also need to export the function itself to be used in popup.jsx
export { signInWithPopup };