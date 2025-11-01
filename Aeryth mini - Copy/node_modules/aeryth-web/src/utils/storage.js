// src/utils/storage.js
// Firebase-based drop-in replacement for local storage.
// Uses existing Firebase initialization from firebaseInit.js.
// API remains identical: loadAsync(key), saveAsync(key, value), getSavedFolderInfo(), pickAndStoreFolder().

import { auth, db } from "./firebaseInit";
import { getDoc, setDoc, doc } from "firebase/firestore";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";

let currentUser = null;
let dataCache = null;
let writeQueue = [];
let isWriting = false;

/* ----------------------- Auth ----------------------- */
async function ensureAuth() {
  if (currentUser) return currentUser;

  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        resolve(user);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          currentUser = cred.user;
          resolve(currentUser);
        } catch (err) {
          console.error("❌ Auth error:", err);
          reject(err);
        }
      }
    });
  });
}

/* ----------------------- Firestore helpers ----------------------- */
async function getUserDocRef() {
  const user = await ensureAuth();
  return doc(db, "aeryth_data", user.uid);
}

async function loadMasterJSON() {
  try {
    const ref = await getUserDocRef();
    const snap = await getDoc(ref);
    if (snap.exists()) {
      console.log("✅ Loaded data from Firestore.");
      return snap.data();
    }

    // If not found, initialize with defaults
    const defaults = {
      aeryth_settings: { aerythTone: "Friendly", userInfo: "", routineCriteria: "" },
      aeryth_routines: [],
      aeryth_diary: {},
      aeryth_stickies: {},
      aeryth_event_statuses: {},
      aeryth_notif_chats: {},
      aeryth_profile: null,
    };
    await setDoc(ref, defaults);
    console.log("🆕 Created new Firestore document.");
    return defaults;
  } catch (e) {
    console.error("loadMasterJSON error:", e);
    return {};
  }
}

/* ----------------------- Safe write queue ----------------------- */
async function saveMasterJSON(newData) {
  writeQueue.push(newData);
  if (isWriting) return;
  isWriting = true;

  while (writeQueue.length > 0) {
    const latest = writeQueue.pop();
    writeQueue = [];
    try {
      const ref = await getUserDocRef();
      console.log("💾 Saving to Firestore:", latest);
      await setDoc(ref, latest, { merge: true });
    } catch (e) {
      console.error("saveMasterJSON failed:", e);
    }
  }

  isWriting = false;
}

/* ----------------------- Public API ----------------------- */
export async function loadAsync(key, fallback) {
  try {
    if (!dataCache) {
      console.log("🌐 Fetching from Firestore...");
      dataCache = await loadMasterJSON();
    }
    return dataCache[key] ?? fallback;
  } catch (e) {
    console.error("loadAsync error:", e);
    return fallback;
  }
}

let saveTimeout = null;
export async function saveAsync(key, value) {
  try {
    dataCache = dataCache || (await loadMasterJSON());
    dataCache[key] = value;

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await saveMasterJSON(dataCache);
    }, 800);
  } catch (e) {
    console.error("saveAsync error:", e);
  }
}

/* ----------------------- Dummy compatibility funcs ----------------------- */
export async function pickAndStoreFolder() {
  // not applicable for Firebase cloud; return pseudo path
  return { handle: null, path: "Firebase Cloud", name: "cloud" };
}

export async function getSavedFolderInfo() {
  return { path: "Firebase Cloud", name: "cloud" };
}
