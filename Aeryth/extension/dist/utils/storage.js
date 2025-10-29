// src/utils/storage.js
// ✅ Cloud-based storage using Firestore. Works for both webapp and extension.

import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db, ensureFirebaseAuth } from "/firebaseInit.js";

let cache = null;

/**
 * ✅ Load user's Firestore data
 */
export async function loadAsync(key, fallback) {
  try {
    const user = await ensureFirebaseAuth();
    if (!user || !user.uid) throw new Error("No valid user for loadAsync");

    if (!cache) {
      const ref = doc(db, "aeryth_data", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        cache = snap.data();
      } else {
        cache = {
          aeryth_settings: { aerythTone: "Friendly", userInfo: "", routineCriteria: "" },
          aeryth_routines: [],
          aeryth_diary: {},
          aeryth_stickies: {},
          aeryth_event_statuses: {},
          aeryth_notif_chats: {},
          aeryth_profile: null,
        };
        await setDoc(ref, cache);
      }
    }

    return cache[key] ?? fallback;
  } catch (e) {
    console.error("Extension loadAsync failed:", e);
    return fallback;
  }
}

/**
 * ✅ Save to Firestore (debounced)
 */
let saveTimeout = null;
export async function saveAsync(key, value) {
  try {
    const user = await ensureFirebaseAuth();
    if (!user || !user.uid) throw new Error("No valid user for saveAsync");

    const ref = doc(db, "aeryth_data", user.uid);
    cache = cache || (await loadAsync({}, {}));
    cache[key] = value;

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await setDoc(ref, cache, { merge: true });
    }, 1000);
  } catch (e) {
    console.error("Extension saveAsync failed:", e);
  }
}
