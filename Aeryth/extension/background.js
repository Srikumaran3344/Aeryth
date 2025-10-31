// extension/background.js
// Service worker - NO Firebase imports here

const NOTIF_META_PREFIX = "notif_meta_";
const ACTIVE_META_PREFIX = "active_notif_meta_";
const ALARM_PREFIX = "aeryth_";
const SNOOZE_TRACKER_PREFIX = "snooze_count_";

console.log("🚀 Aeryth background script loaded");

// ======================= Storage Helpers (Local Only) =======================

async function loadLocal(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] ?? fallback);
    });
  });
}

async function saveLocal(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ======================= Firebase Sync (Delegated to Offscreen) =======================

/**
 * Sync routines from Firebase via offscreen document
 * Offscreen documents CAN use Firebase SDK properly
 */
async function syncAndScheduleAlarms() {
  try {
    console.log("📅 Requesting sync from offscreen document...");
    
    // Send message to offscreen document (or popup) to fetch Firebase data
    const response = await chrome.runtime.sendMessage({ 
      action: "fetchFirebaseData" 
    }).catch(() => null);
    
    if (!response?.success) {
      console.warn("Firebase sync unavailable, using cached data");
      return await scheduleFromCachedData();
    }
    
    const { routines, settings, profile } = response.data;
    
    // Cache locally for offline use
    await saveLocal("cached_routines", routines);
    await saveLocal("cached_settings", settings);
    await saveLocal("cached_profile", profile);
    
    console.log("📅 Syncing routines:", routines.length);
    
    // Clear old alarms
    const allAlarms = await chrome.alarms.getAll();
    const aeryithAlarms = allAlarms.filter(a => a.name.startsWith(ALARM_PREFIX));
    for (const alarm of aeryithAlarms) {
      await chrome.alarms.clear(alarm.name);
    }
    
    // Schedule new alarms
    for (const routine of routines) {
      await scheduleAlarmsForRoutine(routine, 3);
      await scheduleEndAlarmsForRoutine(routine, 3);
    }
    
    console.log("✅ Alarms scheduled successfully");
  } catch (e) {
    console.error("❌ syncAndScheduleAlarms failed:", e);
  }
}

async function scheduleFromCachedData() {
  const routines = await loadLocal("cached_routines", []);
  
  const allAlarms = await chrome.alarms.getAll();
  const aeryithAlarms = allAlarms.filter(a => a.name.startsWith(ALARM_PREFIX));
  for (const alarm of aeryithAlarms) {
    await chrome.alarms.clear(alarm.name);
  }
  
  for (const routine of routines) {
    await scheduleAlarmsForRoutine(routine, 3);
    await scheduleEndAlarmsForRoutine(routine, 3);
  }
}

// ======================= Alarm Scheduling =======================

async function scheduleAlarmsForRoutine(routine, daysAhead = 3) {
  try {
    if (!routine || !routine.startTime) return;
    
    const now = new Date();
    const daysMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dayIso = d.toISOString().slice(0, 10);
      const wd = d.getDay();
      
      if (!routine.days || !routine.days.some(dd => daysMap[dd] === wd)) continue;
      
      const [hh, mm] = (routine.startTime || "00:00").split(":").map(Number);
      const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
      
      if (when <= Date.now()) continue;
      
      const alarmName = `${ALARM_PREFIX}start_${routine.id}_${dayIso}_${when}`;
      const meta = {
        notifId: `aeryth-${routine.id}-${dayIso}-${when}`,
        routineId: routine.id,
        routineName: routine.name,
        routineDescription: routine.description,
        dateIso: dayIso,
        type: "start",
        when: when
      };
      
      await chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${alarmName}`]: meta });
      chrome.alarms.create(alarmName, { when });
      console.log(`⏰ Scheduled start alarm: ${routine.name} at ${routine.startTime} on ${dayIso}`);
    }
  } catch (e) {
    console.warn("scheduleAlarmsForRoutine failed", e);
  }
}

async function scheduleEndAlarmsForRoutine(routine, daysAhead = 3) {
  try {
    if (!routine || !routine.endTime) return;
    
    const now = new Date();
    const daysMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dayIso = d.toISOString().slice(0, 10);
      const wd = d.getDay();
      
      if (!routine.days || !routine.days.some(dd => daysMap[dd] === wd)) continue;
      
      const [hh, mm] = (routine.endTime || "00:00").split(":").map(Number);
      const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
      
      if (when <= Date.now()) continue;
      
      const alarmName = `${ALARM_PREFIX}end_${routine.id}_${dayIso}_${when}`;
      const meta = {
        notifId: `aeryth-end-${routine.id}-${dayIso}-${when}`,
        routineId: routine.id,
        routineName: routine.name,
        dateIso: dayIso,
        type: "end",
        when: when
      };
      
      await chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${alarmName}`]: meta });
      chrome.alarms.create(alarmName, { when });
      console.log(`⏰ Scheduled end alarm: ${routine.name} at ${routine.endTime} on ${dayIso}`);
    }
  } catch (e) {
    console.warn("scheduleEndAlarmsForRoutine failed", e);
  }
}

// ======================= Notification Building =======================

async function buildNotificationOptions(meta, snoozeCount = 0) {
  if (!meta) return null;
  
  const settings = await loadLocal("cached_settings", { aerythTone: "Friendly" });
  
  // Generate notification text (fallback templates since no AI in service worker)
  const aiText = generateSimpleNotificationText(meta, settings.aerythTone, snoozeCount);
  
  if (meta.type === "start") {
    return {
      type: "basic",
      title: "Aeryth",
      message: aiText,
      iconUrl: "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "Start" },
        { title: "Skip" },
        { title: "2 min" },
        { title: "5 min" },
        { title: "10 min" }
      ],
      requireInteraction: true
    };
  } else if (meta.type === "end") {
    return {
      type: "basic",
      title: "Aeryth",
      message: aiText,
      iconUrl: "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "Completed" },
        { title: "Skipped" }
      ],
      requireInteraction: true
    };
  } else if (meta.type === "skip_motivation") {
    return {
      type: "basic",
      title: "Aeryth",
      message: aiText,
      iconUrl: "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "Start" },
        { title: "Skip" }
      ],
      requireInteraction: true
    };
  }
  
  return null;
}

// Simple notification text generator (no AI dependencies)
function generateSimpleNotificationText(meta, tone, snoozeCount) {
  const name = meta.routineName;
  
  if (meta.type === "start") {
    if (snoozeCount >= 2) {
      const messages = {
        "Analyst (Logical)": `${name}: Action required now. Delays compound.`,
        "Companion (Friendly)": `Hey! ${name} is waiting. Let's start together! 💪`,
        "Coach (Motivational)": `${name} TIME! No more delays - START NOW!`,
        "Sage (Wise)": `The moment for ${name} is now. Begin.`
      };
      return messages[tone] || messages["Companion (Friendly)"];
    }
    const messages = {
      "Analyst (Logical)": `Time to start ${name}. Consistent execution yields results.`,
      "Companion (Friendly)": `Hey! Ready to start ${name}? Let's do this! 💪`,
      "Coach (Motivational)": `${name} time! Show up for yourself right now!`,
      "Sage (Wise)": `${name} awaits. Small steps create lasting change.`
    };
    return messages[tone] || messages["Companion (Friendly)"];
  }
  
  if (meta.type === "end") {
    const messages = {
      "Analyst (Logical)": `${name} period complete. Did you accomplish your objective?`,
      "Companion (Friendly)": `Time's up for ${name}! How'd it go? 🌟`,
      "Coach (Motivational)": `${name} done! Did you crush it?!`,
      "Sage (Wise)": `${name} time has passed. Reflect on your effort.`
    };
    return messages[tone] || messages["Companion (Friendly)"];
  }
  
  if (meta.type === "skip_motivation") {
    const messages = {
      "Analyst (Logical)": `Starting ${name} now increases your success probability. Reconsider?`,
      "Companion (Friendly)": `I know it's tough, but ${name} will be worth it. Give it a try? 🙏`,
      "Coach (Motivational)": `Don't quit on yourself! ${name} is your commitment. Start NOW!`,
      "Sage (Wise)": `Every journey begins with a single step. ${name} calls to you.`
    };
    return messages[tone] || messages["Companion (Friendly)"];
  }
  
  return `Time for ${name}!`;
}

// ======================= Event Handlers =======================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("🚀 Aeryth installed/updated", details.reason);
  
  // Test notification
  chrome.notifications.create("aeryth-test", {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Aeryth Installed",
    message: "Notifications are working! ✓",
    priority: 1
  });
  
  await syncAndScheduleAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("🚀 Aeryth starting up");
  await syncAndScheduleAlarms();
});

// Periodic sync
chrome.alarms.create("aeryth_sync", { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "aeryth_sync") {
    console.log("🔄 Periodic sync triggered");
    await syncAndScheduleAlarms();
    return;
  }
  
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  
  try {
    const metaKey = `${NOTIF_META_PREFIX}${alarm.name}`;
    const store = await new Promise(res => chrome.storage.local.get([metaKey], res));
    const meta = store[metaKey];
    
    if (!meta) {
      console.warn("No meta found for alarm", alarm.name);
      return;
    }
    
    const snoozeKey = `${SNOOZE_TRACKER_PREFIX}${meta.routineId}_${meta.dateIso}`;
    const snoozeStore = await new Promise(res => chrome.storage.local.get([snoozeKey], res));
    const snoozeCount = snoozeStore[snoozeKey] || 0;
    
    const options = await buildNotificationOptions(meta, snoozeCount);
    if (!options) return;
    
    const notifId = meta.notifId || `aeryth-notif-${Date.now()}`;
    chrome.notifications.create(notifId, options);
    
    await chrome.storage.local.set({ 
      [`${ACTIVE_META_PREFIX}${notifId}`]: { ...meta, snoozeCount } 
    });
    
    console.log(`🔔 Notification created: ${notifId}`);
  } catch (e) {
    console.error("❌ onAlarm handler error", e);
  }
});

// ======================= Notification Clicks =======================

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  try {
    const metaKey = `${ACTIVE_META_PREFIX}${notificationId}`;
    const store = await new Promise(res => chrome.storage.local.get([metaKey], res));
    const meta = store[metaKey];
    
    if (!meta) {
      chrome.notifications.clear(notificationId);
      return;
    }
    
    const { routineId, dateIso, type, snoozeCount = 0 } = meta;
    const snoozeKey = `${SNOOZE_TRACKER_PREFIX}${routineId}_${dateIso}`;
    
    let action = null;
    
    if (type === "start") {
      const actions = ["start", "skip", "snooze2", "snooze5", "snooze10"];
      action = actions[buttonIndex];
    } else if (type === "end") {
      const actions = ["completed", "skipped"];
      action = actions[buttonIndex];
    } else if (type === "skip_motivation") {
      const actions = ["start", "skip"];
      action = actions[buttonIndex];
    }
    
    console.log(`👆 Button clicked: ${action}`);
    
    if (action?.startsWith("snooze")) {
      const mins = parseInt(action.replace("snooze", ""));
      const newWhen = Date.now() + mins * 60000;
      const newSnoozeCount = snoozeCount + 1;
      
      await chrome.storage.local.set({ [snoozeKey]: newSnoozeCount });
      
      const newAlarmName = `${ALARM_PREFIX}snooze_${routineId}_${dateIso}_${newWhen}`;
      const snoozeMeta = { 
        ...meta, 
        notifId: `${notificationId}-snooze-${mins}`,
        snoozeCount: newSnoozeCount,
        type: "start"
      };
      
      await chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${newAlarmName}`]: snoozeMeta });
      chrome.alarms.create(newAlarmName, { when: newWhen });
      
      // Delegate logging to offscreen/popup
      chrome.runtime.sendMessage({
        action: "logNotification",
        routineId,
        dateIso,
        text: `Snoozed for ${mins} minutes`
      }).catch(() => {});
      
    } else if (action === "start") {
      await chrome.storage.local.remove([snoozeKey]);
      
      // Update status via offscreen
      chrome.runtime.sendMessage({
        action: "updateEventStatus",
        routineId,
        dateIso,
        status: "in-progress"
      }).catch(() => {});
      
    } else if (action === "skip") {
      if (type === "start" && snoozeCount === 0) {
        // Send motivation
        const motivationMeta = { 
          ...meta, 
          type: "skip_motivation",
          notifId: `${notificationId}-motivation`
        };
        
        const motivationOptions = await buildNotificationOptions(motivationMeta, 0);
        if (motivationOptions) {
          chrome.notifications.create(motivationMeta.notifId, motivationOptions);
          await chrome.storage.local.set({ 
            [`${ACTIVE_META_PREFIX}${motivationMeta.notifId}`]: motivationMeta 
          });
        }
      } else {
        await chrome.storage.local.remove([snoozeKey]);
        
        chrome.runtime.sendMessage({
          action: "updateEventStatus",
          routineId,
          dateIso,
          status: "skipped"
        }).catch(() => {});
      }
      
    } else if (action === "completed") {
      await chrome.storage.local.remove([snoozeKey]);
      
      chrome.runtime.sendMessage({
        action: "updateEventStatus",
        routineId,
        dateIso,
        status: "completed"
      }).catch(() => {});
    }
    
    await chrome.storage.local.remove([metaKey]);
    chrome.notifications.clear(notificationId);
    
  } catch (e) {
    console.error("❌ onButtonClicked error", e);
  }
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
  const metaKey = `${ACTIVE_META_PREFIX}${notificationId}`;
  await chrome.storage.local.remove([metaKey]);
});

// Listen for sync requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "syncNow") {
    syncAndScheduleAlarms().then(() => sendResponse({ success: true }));
    return true;
  }
});

console.log("✅ Aeryth background initialized");