// src/utils/storage.js
import { auth, db } from "./firebaseInit.js";
import { getDoc, setDoc, doc } from "firebase/firestore";

let currentUser = null;
let dataCache = null;
let writeQueue = [];
let isWriting = false;

async function ensureAuth() {
  if (currentUser) return currentUser;

  return new Promise((resolve, reject) => {
    const unsub = auth.onAuthStateChanged((user) => {
      unsub();
      if (user) {
        currentUser = user;
        resolve(user);
      } else {
        reject(new Error("No signed-in user"));
      }
    });
  });
}

async function getUserDocRef() {
  const user = await ensureAuth();
  return doc(db, "aeryth_data", user.uid);
}

async function loadMasterJSON() {
  try {
    const ref = await getUserDocRef();
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();

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
    return defaults;
  } catch (e) {
    console.error("loadMasterJSON error:", e);
    return {};
  }
}

async function saveMasterJSON(newData) {
  writeQueue.push(newData);
  if (isWriting) return;
  isWriting = true;

  while (writeQueue.length > 0) {
    const latest = writeQueue.pop();
    writeQueue = [];
    try {
      const ref = await getUserDocRef();
      await setDoc(ref, latest, { merge: true });
    } catch (e) {
      console.error("saveMasterJSON failed:", e);
    }
  }

  isWriting = false;
}

export async function loadAsync(key, fallback) {
  try {
    if (!dataCache) dataCache = await loadMasterJSON();
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

export async function pickAndStoreFolder() {
  return { handle: null, path: "Firebase Cloud", name: "cloud" };
}
export async function getSavedFolderInfo() {
  return { path: "Firebase Cloud", name: "cloud" };
}
