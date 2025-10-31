// extension/background.js
import { loadAsync, saveAsync } from "./utils/storage.js";
import { ensureFirebaseAuth } from "./utils/firebaseInit.js";
import { generateNotificationText } from "./utils/aiNotifications.js";

const NOTIF_META_PREFIX = "notif_meta_";
const ACTIVE_META_PREFIX = "active_notif_meta_";
const ALARM_PREFIX = "aeryth_";
const SNOOZE_TRACKER_PREFIX = "snooze_count_";

// ======================= Firebase Sync & Alarm Scheduling =======================

/** Sync routines from Firebase and schedule alarms */
async function syncAndScheduleAlarms() {
  try {
    await ensureFirebaseAuth();
    const routines = await loadAsync("aeryth_routines", []);
    const settings = await loadAsync("aeryth_settings", { aerythTone: "Friendly" });
    const profile = await loadAsync("aeryth_profile", "");
    
    console.log("📅 Syncing routines from Firebase:", routines.length);
    
    // Clear old alarms
    const allAlarms = await chrome.alarms.getAll();
    const aeryithAlarms = allAlarms.filter(a => a.name.startsWith(ALARM_PREFIX));
    for (const alarm of aeryithAlarms) {
      await chrome.alarms.clear(alarm.name);
    }
    
    // Schedule new alarms for upcoming days
    for (const routine of routines) {
      await scheduleAlarmsForRoutine(routine, 3);
      await scheduleEndAlarmsForRoutine(routine, 3);
    }
    
    console.log("✅ Alarms scheduled successfully");
  } catch (e) {
    console.error("❌ syncAndScheduleAlarms failed:", e);
  }
}

/** Schedule start alarms for a routine (n days ahead) */
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

/** Schedule end alarms for a routine */
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

/** Build notification options with AI-generated text */
async function buildNotificationOptions(meta, snoozeCount = 0) {
  if (!meta) return null;
  
  const settings = await loadAsync("aeryth_settings", { aerythTone: "Friendly" });
  const profile = await loadAsync("aeryth_profile", "");
  const routines = await loadAsync("aeryth_routines", []);
  const routine = routines.find(r => r.id === meta.routineId);
  const notifChats = await loadAsync("aeryth_notif_chats", {});
  const history = (notifChats[meta.routineId] || {})[meta.dateIso] || [];
  
  // Generate personalized AI text
  const aiText = await generateNotificationText({
    type: meta.type,
    routineName: meta.routineName,
    routineDescription: meta.routineDescription || routine?.description,
    tone: settings.aerythTone || "Friendly",
    profile,
    snoozeCount,
    history,
    userGoal: routine?.description
  });
  
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

// ======================= Event Handlers =======================

chrome.runtime.onInstalled.addListener(async () => {
  console.log("🚀 Aeryth background installed");
  await syncAndScheduleAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("🚀 Aeryth background starting up");
  await syncAndScheduleAlarms();
});

// Periodic sync (every 30 minutes)
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
    
    // Get snooze count
    const snoozeKey = `${SNOOZE_TRACKER_PREFIX}${meta.routineId}_${meta.dateIso}`;
    const snoozeStore = await new Promise(res => chrome.storage.local.get([snoozeKey], res));
    const snoozeCount = snoozeStore[snoozeKey] || 0;
    
    const options = await buildNotificationOptions(meta, snoozeCount);
    if (!options) return;
    
    const notifId = meta.notifId || `aeryth-notif-${Date.now()}`;
    chrome.notifications.create(notifId, options, () => {
      console.log(`🔔 Notification created: ${notifId}`);
    });
    
    // Store active notification metadata
    await new Promise(res => chrome.storage.local.set({ 
      [`${ACTIVE_META_PREFIX}${notifId}`]: { ...meta, snoozeCount } 
    }, res));
    
    // Log to notification chat
    await logNotificationEvent(meta.routineId, meta.dateIso, "system", `Reminder sent: ${options.message}`);
  } catch (e) {
    console.error("❌ onAlarm handler error", e);
  }
});

// ======================= Notification Button Clicks =======================

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
    
    console.log(`👆 Button clicked: ${action} for ${routineId} on ${dateIso}`);
    
    // Handle snooze actions
    if (action?.startsWith("snooze")) {
      const mins = parseInt(action.replace("snooze", ""));
      const newWhen = Date.now() + mins * 60000;
      const newSnoozeCount = snoozeCount + 1;
      
      // Store updated snooze count
      await chrome.storage.local.set({ [snoozeKey]: newSnoozeCount });
      
      const newAlarmName = `${ALARM_PREFIX}snooze_${routineId}_${dateIso}_${newWhen}`;
      const snoozeMeta = { 
        ...meta, 
        notifId: `${notificationId}-snooze-${mins}`,
        snoozeCount: newSnoozeCount,
        type: newSnoozeCount >= 2 ? "start" : "start" // Keep type but AI will adjust
      };
      
      await chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${newAlarmName}`]: snoozeMeta });
      chrome.alarms.create(newAlarmName, { when: newWhen });
      
      await logNotificationEvent(routineId, dateIso, "user", `Snoozed for ${mins} minutes`);
      
    } else if (action === "start") {
      // User started the routine
      await updateEventStatus(routineId, dateIso, "in-progress");
      await logNotificationEvent(routineId, dateIso, "user", "Started");
      
      // Reset snooze count
      await chrome.storage.local.remove([snoozeKey]);
      
      // Schedule end-time notification if not already scheduled
      const routines = await loadAsync("aeryth_routines", []);
      const routine = routines.find(r => r.id === routineId);
      if (routine?.endTime) {
        const [hh, mm] = routine.endTime.split(":").map(Number);
        const endWhen = new Date(dateIso + "T" + routine.endTime + ":00").getTime();
        
        if (endWhen > Date.now()) {
          const endAlarmName = `${ALARM_PREFIX}end_${routineId}_${dateIso}_${endWhen}`;
          const endMeta = {
            notifId: `aeryth-end-${routineId}-${dateIso}-${endWhen}`,
            routineId,
            routineName: routine.name,
            dateIso,
            type: "end",
            when: endWhen
          };
          
          await chrome.storage.local.set({ [`${NOTIF_META_PREFIX}${endAlarmName}`]: endMeta });
          chrome.alarms.create(endAlarmName, { when: endWhen });
        }
      }
      
    } else if (action === "skip") {
      // First skip on start notification - send motivation
      if (type === "start" && snoozeCount === 0) {
        await logNotificationEvent(routineId, dateIso, "user", "Skipped (1st time)");
        
        // Send immediate motivation notification
        const motivationMeta = { 
          ...meta, 
          type: "skip_motivation",
          notifId: `${notificationId}-motivation`
        };
        
        const motivationOptions = await buildNotificationOptions(motivationMeta, 0);
        if (motivationOptions) {
          chrome.notifications.create(motivationMeta.notifId, motivationOptions, () => {});
          await chrome.storage.local.set({ 
            [`${ACTIVE_META_PREFIX}${motivationMeta.notifId}`]: motivationMeta 
          });
        }
      } else {
        // Final skip - update status
        await updateEventStatus(routineId, dateIso, "skipped");
        await logNotificationEvent(routineId, dateIso, "user", "Skipped (final)");
        
        // Reset snooze count
        await chrome.storage.local.remove([snoozeKey]);
      }
      
    } else if (action === "completed") {
      await updateEventStatus(routineId, dateIso, "completed");
      await logNotificationEvent(routineId, dateIso, "user", "Completed");
      
      // Reset snooze count
      await chrome.storage.local.remove([snoozeKey]);
    }
    
    // Clear notification
    await chrome.storage.local.remove([metaKey]);
    chrome.notifications.clear(notificationId);
    
  } catch (e) {
    console.error("❌ onButtonClicked error", e);
  }
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
  try {
    const metaKey = `${ACTIVE_META_PREFIX}${notificationId}`;
    await chrome.storage.local.remove([metaKey]);
  } catch (e) {
    console.warn("onClosed cleanup failed", e);
  }
});

// ======================= Helper Functions =======================

/** Update event status in Firebase */
async function updateEventStatus(routineId, dateIso, status) {
  try {
    const eventStatuses = await loadAsync("aeryth_event_statuses", {});
    eventStatuses[routineId] = eventStatuses[routineId] || {};
    eventStatuses[routineId][dateIso] = status;
    await saveAsync("aeryth_event_statuses", eventStatuses);
    console.log(`✅ Updated status: ${routineId} on ${dateIso} → ${status}`);
  } catch (e) {
    console.error("updateEventStatus failed", e);
  }
}

/** Log notification event to chat history */
async function logNotificationEvent(routineId, dateIso, from, text) {
  try {
    const notifChats = await loadAsync("aeryth_notif_chats", {});
    notifChats[routineId] = notifChats[routineId] || {};
    notifChats[routineId][dateIso] = notifChats[routineId][dateIso] || [];
    
    notifChats[routineId][dateIso].push({
      from,
      text,
      ts: new Date().toISOString()
    });
    
    await saveAsync("aeryth_notif_chats", notifChats);
  } catch (e) {
    console.error("logNotificationEvent failed", e);
  }
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "syncNow") {
    syncAndScheduleAlarms().then(() => sendResponse({ success: true }));
    return true; // Keep channel open for async response
  }
});

// background.js

chrome.runtime.onInstalled.addListener(() => {
  console.log("Service worker active ✅");

  // Simple test notification
  chrome.notifications.create("test", {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Test Notification",
    message: "If you see this, notifications work!",
  });
});
