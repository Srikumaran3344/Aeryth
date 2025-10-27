// src/utils/storage.js
// Unified file-based storage with lazy handle restore and write queue.
// Keeps same API: loadAsync(key), saveAsync(key, value), pickAndStoreFolder(), getSavedFolderInfo()

const STORAGE_META_KEY = "aeryth_folder_meta";
const IDB_DB_NAME = "aeryth_handles_db";
const IDB_STORE = "handles";
const IDB_KEY = "aeryth_dir_handle";
const MASTER_FILE = "aeryth_data.json";

let activeHandle = null;
let dataCache = null;
let writeQueue = [];
let isWriting = false;

/* ----------------------- IndexedDB helpers ----------------------- */
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE))
        req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* ----------------------- FS helpers ----------------------- */
function fsSupported() {
  return "showDirectoryPicker" in window;
}

async function ensurePermission(handle, mode = "readwrite") {
  if (!handle) return false;
  const q = await handle.queryPermission?.({ mode });
  if (q === "granted") return true;
  const r = await handle.requestPermission?.({ mode });
  return r === "granted";
}

/* ----------------------- Meta helpers ----------------------- */
function saveMetaPath(pathString) {
  localStorage.setItem(
    STORAGE_META_KEY,
    JSON.stringify({ path: pathString, ts: new Date().toISOString() })
  );
}
function getMetaPath() {
  const raw = localStorage.getItem(STORAGE_META_KEY);
  return raw ? JSON.parse(raw) : null;
}

/* ----------------------- Core: Init folder ----------------------- */
async function createIfMissing(fileHandle) {
  try {
    await fileHandle.getFile();
  } catch {
    const w = await fileHandle.createWritable();
    await w.write("{}");
    await w.close();
  }
}

async function getMasterHandle(dirHandle) {
  const fh = await dirHandle.getFileHandle(MASTER_FILE, { create: true });
  await createIfMissing(fh);
  return fh;
}

async function loadMasterJSON(dirHandle) {
  const fh = await getMasterHandle(dirHandle);
  const file = await fh.getFile();
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/* ----------------------- Restore or pick ----------------------- */
async function restoreStoredHandle() {
  if (!fsSupported()) return null;
  try {
    if (activeHandle) return activeHandle;
    const stored = await idbGet(IDB_KEY);
    if (!stored) return null;
    const ok = await ensurePermission(stored, "readwrite");
    if (!ok) return null;
    activeHandle = stored;
    return stored;
  } catch (e) {
    console.warn("restoreStoredHandle failed", e);
    return null;
  }
}

export async function pickAndStoreFolder() {
  const root = await window.showDirectoryPicker();
  const dir = await root.getDirectoryHandle("Aeryth", { create: true });
  const granted = await ensurePermission(dir, "readwrite");
  if (!granted) return null;
  await idbPut(IDB_KEY, dir);
  saveMetaPath(`${root.name}/Aeryth`);
  activeHandle = dir;

  const fh = await getMasterHandle(dir);
  const file = await fh.getFile();
  if (!file.size) {
    const defaults = {
      aeryth_settings: { aerythTone: "Friendly", userInfo: "", routineCriteria: "" },
      aeryth_routines: [],
      aeryth_diary: {},
      aeryth_stickies: {},
      aeryth_event_statuses: {},
      aeryth_notif_chats: {},
      aeryth_profile: null
    };
    await saveMasterJSON(defaults);
  }
  return { handle: dir, path: `${root.name}/Aeryth`, name: dir.name };
}

/* ----------------------- Safe write queue ----------------------- */
async function saveMasterJSON(newData) {
  writeQueue.push(newData);
  if (isWriting) return;
  isWriting = true;

  while (writeQueue.length > 0) {
    const latest = writeQueue.pop(); // keep only last write
    writeQueue = [];
    try {
      const dir = activeHandle || (await restoreStoredHandle());
      if (!dir) {
        console.warn("No FS handle, skipping file write");
        continue;
      }
      const fh = await getMasterHandle(dir);
      const w = await fh.createWritable();
      await w.write(JSON.stringify(latest, null, 2));
      await w.close();
    } catch (e) {
      console.error("saveMasterJSON failed", e);
    }
  }
  isWriting = false;
}

/* ----------------------- Public load/save API ----------------------- */
export async function loadAsync(key, fallback) {
  try {
    if (!dataCache) {
      const dir = await restoreStoredHandle();
      if (dir) {
        dataCache = await loadMasterJSON(dir);
      } else {
        // fallback to localStorage
        const raw = localStorage.getItem("aeryth_data");
        dataCache = raw ? JSON.parse(raw) : {};
      }
    }
    return dataCache[key] ?? fallback;
  } catch (e) {
    console.error("loadAsync error", e);
    return fallback;
  }
}

let saveTimeout = null;
export async function saveAsync(key, value) {
  dataCache = dataCache || {};
  dataCache[key] = value;
  localStorage.setItem("aeryth_data", JSON.stringify(dataCache));
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    const dir = activeHandle || (await restoreStoredHandle());
    if (dir) await saveMasterJSON(dataCache);
  }, 1000);
}

/* ----------------------- Info helper ----------------------- */
export async function getSavedFolderInfo() {
  const meta = getMetaPath();
  const dir = await restoreStoredHandle();
  if (dir)
    return { path: meta?.path || dir.name || "Aeryth", name: dir.name || "Aeryth" };
  if (meta?.path)
    return { path: meta.path, name: meta.path.split("/").pop() || "Aeryth" };
  return null;
}
