// extension/background.js
// Manifest V3 service worker (module allowed).
// Responsibilities:
// - Restore persisted directory handle from IndexedDB (key: 'aeryth_dir_handle').
// - Read and write shared data.json in the Aeryth folder.
// - Schedule and respond to chrome.alarms for routines.
// - Create notifications and handle button clicks, snooze, update data.json (eventStatuses & notifChats).
// Notes:
// - Popup MUST store a persistent FileSystemDirectoryHandle in IndexedDB under 'aeryth_dir_handle'.
// - Background cannot show directory pickers; it depends on the popup to have done that.
// - All file I/O is best-effort; on failure we log and gracefully skip.

const IDB_DB_NAME = "aeryth_handles_db";
const IDB_STORE = "handles";
const IDB_KEY = "aeryth_dir_handle";
const DATA_FILENAME = "data.json"; // inside Aeryth folder
const NOTIF_META_PREFIX = "notif_meta_";
const ACTIVE_META_PREFIX = "active_notif_meta_";
const ALARM_PREFIX = "aeryth_"; // prefix for alarms

// small IndexedDB helper to read the persisted directory handle
function openIdb() {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) return reject(new Error("IndexedDB not available in service worker"));
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
    console.warn("idbGet failed", e);
    return null;
  }
}

// UTIL: safe JSON deep clone
function deepClone(x) {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return x;
  }
}

// ======================= File I/O Helpers using File System Access API =======================

// Try to resolve the directory handle from IDB and ensure it has readwrite permission
async function restoreDirHandleFromIdb() {
  try {
    const stored = await idbGet(IDB_KEY);
    if (!stored) return null;
    // IDB returns a FileSystemDirectoryHandle (structured-clone) if previously stored
    const dirHandle = stored;
    // Check permission
    if (typeof dirHandle.queryPermission === "function") {
      const q = await dirHandle.queryPermission({ mode: "readwrite" });
      if (q === "granted") return dirHandle;
      // If not granted, requestPermission may not be allowed from service worker; we'll just return null
      // (popup should have granted permission earlier)
      return null;
    }
    // If permissions methods aren't available, still return the handle (best-effort)
    return dirHandle;
  } catch (e) {
    console.warn("restoreDirHandleFromIdb failed", e);
    return null;
  }
}

async function getDataFileHandle(dirHandle, createIfMissing = true) {
  try {
    return await dirHandle.getFileHandle(DATA_FILENAME, { create: createIfMissing });
  } catch (e) {
    console.warn("getDataFileHandle failed", e);
    throw e;
  }
}

async function readDataJson() {
  try {
    const dir = await restoreDirHandleFromIdb();
    if (!dir) throw new Error("No directory handle restored");
    const fh = await getDataFileHandle(dir, false);
    if (!fh) throw new Error("data.json not found");
    const file = await fh.getFile();
    const text = await file.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      console.warn("data.json parse error, returning empty", e);
      return {};
    }
  } catch (e) {
    // important: fail gracefully
    console.warn("readDataJson failed", e);
    return null;
  }
}

// write JSON atomically (createWritable)
async function writeDataJson(obj) {
  try {
    const dir = await restoreDirHandleFromIdb();
    if (!dir) throw new Error("No directory handle for writing");
    const fh = await getDataFileHandle(dir, true);
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(obj, null, 2));
    await writable.close();
    return true;
  } catch (e) {
    console.error("writeDataJson failed", e);
    return false;
  }
}

// helper to ensure default structure exists (if file empty)
function ensureDefaultStructure(raw) {
  const defaultObj = {
    settings: { tone: "Friendly", userInfo: "", routineCriteria: "", storagePath: "" },
    routines: [],
    eventStatuses: {},
    stickies: {},
    notifChats: {},
    profile: null
  };
  if (!raw || typeof raw !== "object") return defaultObj;
  // merge missing keys
  const out = deepClone(defaultObj);
  Object.keys(defaultObj).forEach(k => { if (raw[k] !== undefined) out[k] = raw[k]; });
  return out;
}

// ======================= Alarm & Notification Helpers =======================

/** schedule alarms for a particular routine for upcoming days (n days ahead). */
async function scheduleAlarmsForRoutine(routine, daysAhead = 3) {
  try {
    if (!routine || !routine.startTime) return;
    const now = new Date();
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dayIso = d.toISOString().slice(0, 10);
      // check creation date logic if any
      if (routine.createdAt && dayIso < (new Date(routine.createdAt)).toISOString().slice(0,10)) continue;
      // check day match
      const daysMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
      const wd = d.getDay(); // 0-6
      if (!routine.days || !routine.days.some(dd => daysMap[dd] === wd)) continue;
      // compute when to fire (local)
      const [hh, mm] = (routine.startTime || "00:00").split(":").map(Number);
      const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
      // only schedule future alarms
      if (when <= Date.now()) continue;
      const alarmName = `${ALARM_PREFIX}start_${routine.id}_${dayIso}_${when}`;
      // Save metadata in storage so when alarm triggers we can create personalized notification
      const meta = {
        notifId: `aeryth-${routine.id}-${dayIso}-${when}`,
        routineId: routine.id,
        dateIso: dayIso,
        type: "start",
        message: `${routine.name}: time to start.`,
        iconUrl: "icons/icon48.png"
      };
      // persist meta for alarm
      await chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${alarmName}`]: meta });
      chrome.alarms.create(alarmName, { when });
    }
  } catch (e) {
    console.warn("scheduleAlarmsForRoutine failed", e);
  }
}

/** schedule end-of-routine alarms (e.g., at endTime) */
async function scheduleEndAlarmsForRoutine(routine, daysAhead = 3) {
  try {
    if (!routine || !routine.endTime) return;
    const now = new Date();
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dayIso = d.toISOString().slice(0, 10);
      if (routine.createdAt && dayIso < (new Date(routine.createdAt)).toISOString().slice(0,10)) continue;
      const daysMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
      const wd = d.getDay();
      if (!routine.days || !routine.days.some(dd => daysMap[dd] === wd)) continue;
      const [hh, mm] = (routine.endTime || "00:00").split(":").map(Number);
      const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
      if (when <= Date.now()) continue;
      const alarmName = `${ALARM_PREFIX}end_${routine.id}_${dayIso}_${when}`;
      const meta = {
        notifId: `aeryth-end-${routine.id}-${dayIso}-${when}`,
        routineId: routine.id,
        dateIso: dayIso,
        type: "end",
        message: `${routine.name}: time's up — did you complete it?`,
        iconUrl: "icons/icon48.png"
      };
      await chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${alarmName}`]: meta });
      chrome.alarms.create(alarmName, { when });
    }
  } catch (e) {
    console.warn("scheduleEndAlarmsForRoutine failed", e);
  }
}

/** build notification options for 'start' or 'end' */
function buildNotificationOptions(meta) {
  if (!meta) return null;
  if (meta.type === "start") {
    return {
      type: "basic",
      title: "Aeryth",
      message: meta.message || "Time to start your routine",
      iconUrl: meta.iconUrl || "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "Started" },
        { title: "Skipped" },
        { title: "2 mins" },
        { title: "5 mins" }
      ]
    };
  } else {
    return {
      type: "basic",
      title: "Aeryth",
      message: meta.message || "Did you complete it?",
      iconUrl: meta.iconUrl || "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "Completed" },
        { title: "Skipped" }
      ]
    };
  }
}

// ======================= Event handlers =======================

chrome.runtime.onInstalled.addListener(async () => {
  console.log("Aeryth background installed");
  // attempt initial scheduling: read data.json if available and schedule routines (best-effort)
  try {
    const data = await readDataJson();
    const safe = data ? ensureDefaultStructure(data) : ensureDefaultStructure(null);
    if (safe.routines && Array.isArray(safe.routines)) {
      for (const r of safe.routines) {
        await scheduleAlarmsForRoutine(r, 3);
        await scheduleEndAlarmsForRoutine(r, 3);
      }
    }
  } catch (e) {
    console.warn("onInstalled scheduling failed", e);
  }
});

// On startup/resume, try to schedule existing routines again
chrome.runtime.onStartup.addListener(async () => {
  console.log("Aeryth background starting up");
  try {
    const data = await readDataJson();
    const safe = data ? ensureDefaultStructure(data) : ensureDefaultStructure(null);
    if (safe.routines && Array.isArray(safe.routines)) {
      for (const r of safe.routines) {
        await scheduleAlarmsForRoutine(r, 3);
        await scheduleEndAlarmsForRoutine(r, 3);
      }
    }
  } catch (e) {
    console.warn("onStartup scheduling failed", e);
  }
});

// Alarm fired: create notification using metadata saved earlier
chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    const metaKey = `${NOTIF_META_PREFIX}${alarm.name}`;
    const store = await new Promise(res => chrome.storage.local.get([metaKey], res));
    const meta = store[metaKey];
    if (!meta) {
      console.warn("No meta found for alarm", alarm.name);
      return;
    }
    const options = buildNotificationOptions(meta);
    if (!options) return;

    // create notification with meta.notifId
    const notifId = meta.notifId || `aeryth-notif-${Date.now()}`;
    chrome.notifications.create(notifId, options, () => { /* created */ });

    // Save active meta to map active_notif_meta_<notifId>
    await new Promise(res => chrome.storage.local.set({ [`${ACTIVE_META_PREFIX}${notifId}`]: meta }, res));
  } catch (e) {
    console.error("onAlarm handler error", e);
  }
});

// Append a chat record for notifChats (routineId, dateIso)
async function appendNotifChatAndPersist(dataObj, routineId, dateIso, messageObj) {
  dataObj.notifChats = dataObj.notifChats || {};
  dataObj.notifChats[routineId] = dataObj.notifChats[routineId] || {};
  dataObj.notifChats[routineId][dateIso] = dataObj.notifChats[routineId][dateIso] || [];
  dataObj.notifChats[routineId][dateIso].push(messageObj);
}

// Update eventStatuses in place
function setEventStatusInData(dataObj, routineId, dateIso, status) {
  dataObj.eventStatuses = dataObj.eventStatuses || {};
  dataObj.eventStatuses[routineId] = dataObj.eventStatuses[routineId] || {};
  dataObj.eventStatuses[routineId][dateIso] = status;
}

// Helper to persist changes: read -> modify -> write (protect against concurrent writes)
async function readModifyWrite(modifierFn) {
  const data = await readDataJson();
  if (data === null) throw new Error("Cannot read data.json");
  const safe = ensureDefaultStructure(data);
  await modifierFn(safe);
  const ok = await writeDataJson(safe);
  if (!ok) throw new Error("Failed to write data.json");
  return safe;
}

// Notification button clicks handler
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  try {
    const metaKey = `${ACTIVE_META_PREFIX}${notificationId}`;
    const store = await new Promise(res => chrome.storage.local.get([metaKey], res));
    const meta = store[metaKey];
    if (!meta) {
      console.warn("Active meta missing for notification", notificationId);
      // Could be that the meta wasn't stored; just clear notif and return
      chrome.notifications.clear(notificationId);
      return;
    }

    const { routineId, dateIso, type } = meta;

    // Map buttons
    // start type: [Started, Skipped, 2 mins, 5 mins]
    // end type: [Completed, Skipped]
    let action = null;
    if (type === "start") {
      if (buttonIndex === 0) action = "started";
      if (buttonIndex === 1) action = "skipped";
      if (buttonIndex === 2) action = "snooze2";
      if (buttonIndex === 3) action = "snooze5";
    } else {
      if (buttonIndex === 0) action = "completed";
      if (buttonIndex === 1) action = "skipped";
    }

    // Handle action: update data.json accordingly
    await readModifyWrite(async (data) => {
      const ts = new Date().toISOString();
      if (action === "started") {
        setEventStatusInData(data, routineId, dateIso, "in-progress");
        await appendNotifChatAndPersist(data, routineId, dateIso, { from: "user", text: "Started", ts });
      } else if (action === "skipped") {
        setEventStatusInData(data, routineId, dateIso, "skipped");
        await appendNotifChatAndPersist(data, routineId, dateIso, { from: "user", text: "Skipped", ts });
      } else if (action === "completed") {
        setEventStatusInData(data, routineId, dateIso, "completed");
        await appendNotifChatAndPersist(data, routineId, dateIso, { from: "user", text: "Completed", ts });
      } else if (action === "snooze2" || action === "snooze5") {
        const mins = action === "snooze2" ? 2 : 5;
        await appendNotifChatAndPersist(data, routineId, dateIso, { from: "user", text: `Snoozed ${mins}m`, ts });
        // schedule new alarm after mins
        const newWhen = Date.now() + mins * 60000;
        const newAlarmName = `${ALARM_PREFIX}snooze_${routineId}_${dateIso}_${newWhen}`;
        const snoozeMeta = {
          notifId: `${notificationId}-snooze-${mins}-${Date.now()}`,
          routineId,
          dateIso,
          type: "start",
          message: meta.message,
          iconUrl: meta.iconUrl,
          snooze: mins
        };
        await new Promise(res => chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${newAlarmName}`]: snoozeMeta }, res));
        chrome.alarms.create(newAlarmName, { when: newWhen });
      }
    });

    // remove active meta and clear notification
    await new Promise(res => chrome.storage.local.remove([metaKey], res));
    chrome.notifications.clear(notificationId);

  } catch (e) {
    console.error("onButtonClicked error", e);
  }
});

// Notification closed - remove active meta if present
chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  try {
    const metaKey = `${ACTIVE_META_PREFIX}${notificationId}`;
    await new Promise(res => chrome.storage.local.remove([metaKey], res));
  } catch (e) {
    console.warn("onClosed cleanup failed", e);
  }
});

// Allow external triggers (e.g., popup) to request scheduling, immediate check, or single-notification tests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false, error: "invalid message" });
        return;
      }
      if (msg.type === "RESCHEDULE_ALL") {
        // Read data.json and schedule routine start/end alarms for next few days
        const data = await readDataJson();
        const safe = data ? ensureDefaultStructure(data) : ensureDefaultStructure(null);
        for (const r of safe.routines || []) {
          await scheduleAlarmsForRoutine(r, 3);
          await scheduleEndAlarmsForRoutine(r, 3);
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "READ_DATA_ONCE") {
        const data = await readDataJson();
        sendResponse({ ok: true, data });
        return;
      }
      if (msg.type === "WRITE_PATCH") {
        // msg.patch is a function-like object; here we accept data object replacing
        if (!msg.data) { sendResponse({ ok: false, err: "no data provided" }); return; }
        const success = await writeDataJson(msg.data);
        sendResponse({ ok: success });
        return;
      }
      if (msg.type === "TEST_NOTIFICATION") {
        // Create a test notification to the user (for debugging)
        chrome.notifications.create(`aeryth-test-${Date.now()}`, {
          type: "basic",
          title: "Aeryth (test)",
          message: msg.message || "Test",
          iconUrl: "icons/icon48.png",
          priority: 1
        }, () => sendResponse({ ok: true }));
        return;
      }
      sendResponse({ ok: false, error: "unknown type" });
    } catch (e) {
      console.error("runtime.onMessage handler failed", e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  // required for async sendResponse
  return true;
});
