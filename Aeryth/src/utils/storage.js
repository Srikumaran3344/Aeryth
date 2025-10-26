// src/utils/storage.js
// Robust storage: File System Access (preferred) + IndexedDB handle persistence + localStorage fallback.
// Exports:
// - loadAsync(key, fallback)
// - saveAsync(key, value)
// - pickAndStoreFolder() -> { handle, path } | null
// - getSavedFolderInfo() -> { path, name } | null

const STORAGE_META_KEY = "aeryth_folder_meta";
const IDB_DB_NAME = "aeryth_handles_db";
const IDB_STORE = "handles";
const IDB_KEY = "aeryth_dir_handle";

// Keys used by your app (created when folder picked)
const APP_KEYS = [
  "aeryth_settings",
  "aeryth_routines",
  "aeryth_diary",
  "aeryth_stickies",
  "aeryth_event_statuses",
  "aeryth_notif_chats",
  "aeryth_profile"
];

/* ----------------------- IndexedDB small helper ----------------------- */
function openIdb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB not supported"));
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key, value) {
  try {
    const db = await openIdb();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const r = store.put(value, key);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  } catch (e) {
    console.warn("idbPut failed", e);
    return false;
  }
}
async function idbGet(key) {
  try {
    const db = await openIdb();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const r = store.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } catch (e) {
    return null;
  }
}

/* ----------------------- FS helpers ----------------------- */
function fsSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function ensurePermission(handle, mode = "readwrite") {
  try {
    if (!handle) return false;
    if (typeof handle.queryPermission === "function") {
      const q = await handle.queryPermission({ mode });
      if (q === "granted") return true;
    }
    if (typeof handle.requestPermission === "function") {
      const r = await handle.requestPermission({ mode });
      return r === "granted";
    }
    // if neither exists, assume accessible
    return true;
  } catch (e) {
    console.warn("ensurePermission error", e);
    return false;
  }
}

function saveMetaPath(pathString) {
  try {
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ path: pathString, ts: new Date().toISOString() }));
  } catch (e) {
    console.warn("saveMetaPath failed", e);
  }
}
function getMetaPath() {
  try {
    const raw = localStorage.getItem(STORAGE_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/* ----------------------- Public: pick folder & persist ----------------------- */
export async function pickAndStoreFolder() {
  if (!fsSupported()) {
    console.warn("File System Access API not supported in this browser");
    return null;
  }
  try {
    const rootDir = await window.showDirectoryPicker();
    // Ensure /Aeryth exists
    const aerythDir = await rootDir.getDirectoryHandle("Aeryth", { create: true });

    const granted = await ensurePermission(aerythDir, "readwrite");
    if (!granted) {
      console.warn("Permission not granted for chosen folder");
      return null;
    }

    // store handle in IDB (structured clone)
    try {
      await idbPut(IDB_KEY, aerythDir);
    } catch (e) {
      console.warn("Storing folder handle failed", e);
    }

    // store human-readable pseudo path
    const pseudoPath = `${rootDir.name}/Aeryth`;
    saveMetaPath(pseudoPath);

    // create initial files if missing using defaults from app where possible
    await createInitialAppFiles(aerythDir);

    return { handle: aerythDir, path: pseudoPath, name: aerythDir.name };
  } catch (e) {
    console.warn("pickAndStoreFolder cancelled/failed", e);
    return null;
  }
}

/* create default JSON files for keys (if not present) */
async function createInitialAppFiles(dirHandle) {
  const defaults = {
    "aeryth_settings": { aerythTone: "Friendly", userInfo: "", routineCriteria: "" },
    "aeryth_routines": [],
    "aeryth_diary": {},
    "aeryth_stickies": {},
    "aeryth_event_statuses": {},
    "aeryth_notif_chats": {},
    "aeryth_profile": null
  };
  for (const key of APP_KEYS) {
    try {
      // if file exists, skip
      await dirHandle.getFileHandle(`${key}.json`, { create: false });
      // exists -> continue
    } catch {
      // not exists -> create with default
      try {
        const fh = await dirHandle.getFileHandle(`${key}.json`, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(defaults[key], null, 2));
        await w.close();
      } catch (e) {
        // ignore write errors (will fallback to localStorage later)
        console.warn("createInitialAppFiles write error for", key, e);
      }
    }
  }
}

/* ----------------------- Internal: restore handle ----------------------- */
async function restoreStoredHandle() {
  if (!fsSupported()) return null;
  try {
    const stored = await idbGet(IDB_KEY);
    const meta = getMetaPath();
    if (!stored) return null;
    const ok = await ensurePermission(stored, "readwrite");
    if (!ok) return null;
    return { handle: stored, path: meta?.path || stored.name || "Aeryth" };
  } catch (e) {
    console.warn("restoreStoredHandle failed", e);
    return null;
  }
}

/* ----------------------- Public read/write API ----------------------- */

/** loadAsync(key, fallback) */
export async function loadAsync(key, fallback) {
  try {
    const restored = await restoreStoredHandle();
    if (restored && restored.handle) {
      try {
        const fh = await restored.handle.getFileHandle(`${key}.json`, { create: false });
        const file = await fh.getFile();
        const text = await file.text();
        return JSON.parse(text);
      } catch (e) {
        // file missing or unreadable -> try localStorage fallback
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : fallback;
        } catch {
          return fallback;
        }
      }
    } else {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }
  } catch (e) {
    console.error("loadAsync unexpected error", e);
    return fallback;
  }
}

/** saveAsync(key, value) */
export async function saveAsync(key, value) {
  try {
    const restored = await restoreStoredHandle();
    if (restored && restored.handle) {
      try {
        const fh = await restored.handle.getFileHandle(`${key}.json`, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(value, null, 2));
        await w.close();
        // also mirror to localStorage as a quick cache
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
        return;
      } catch (e) {
        console.warn("file write failed, falling back to localStorage", e);
      }
    }
    // fallback
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("saveAsync unexpected error", e);
  }
}

/* ----------------------- Public helper: getSavedFolderInfo ----------------------- */
export async function getSavedFolderInfo() {
  try {
    const meta = getMetaPath();
    const restored = await restoreStoredHandle();
    if (restored) return { path: restored.path, name: restored.handle?.name || "Aeryth" };
    if (meta?.path) return { path: meta.path, name: meta.path.split("/").pop() || "Aeryth" };
    return null;
  } catch (e) {
    return null;
  }
}
