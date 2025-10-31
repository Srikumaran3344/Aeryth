// src/utils/storage.js
// Firestore-based storage used by popup & background.
// Exports: loadAsync(key, fallback), saveAsync(key, value)

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, ensureFirebaseAuth } from "./firebaseInit.js";

let cache = null;

export async function loadAsync(key, fallback) {
  try {
    const user = await ensureFirebaseAuth();
    if (!user || !user.uid) throw new Error("No firebase user");
    if (!cache) {
      const ref = doc(db, "aeryth_data", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) cache = snap.data();
      else {
        cache = {
          aeryth_settings: { aerythTone: "Friendly", userInfo: "", routineCriteria: "" },
          aeryth_routines: [],
          aeryth_diary: {},
          aeryth_stickies: {},
          aeryth_event_statuses: {},
          aeryth_notif_chats: {},
          aeryth_profile: null
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

let saveTimeout = null;
export async function saveAsync(key, value) {
  try {
    const user = await ensureFirebaseAuth();
    if (!user || !user.uid) throw new Error("No firebase user");
    const ref = doc(db, "aeryth_data", user.uid);
    cache = cache || (await loadAsync({}, {}));
    cache[key] = value;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        await setDoc(ref, cache, { merge: true });
      } catch (e) {
        console.error("saveAsync setDoc failed", e);
      }
    }, 1000);
  } catch (e) {
    console.error("Extension saveAsync failed:", e);
  }
}
