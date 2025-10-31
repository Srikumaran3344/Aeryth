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
 * Sync routines from Firebase via popup/offscreen
 * This runs independently - doesn't require popup to be open
 */
async function syncAndScheduleAlarms() {
  try {
    console.log("📅 Attempting to sync routines...");
    
    // Try to get fresh data from popup if it's open
    let response = null;
    try {
      response = await Promise.race([
        chrome.runtime.sendMessage({ action: "fetchFirebaseData" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000))
      ]);
    } catch (e) {
      console.log("Popup not available, using cached data");
    }
    
    let routines, settings;
    
    if (response?.success) {
      routines = response.data.routines;
      settings = response.data.settings;
      
      // Cache for future use
      await saveLocal("cached_routines", routines);
      await saveLocal("cached_settings", settings);
      await saveLocal("cached_profile", response.data.profile);
    } else {
      // Use cached data
      routines = await loadLocal("cached_routines", []);
      settings = await loadLocal("cached_settings", { aerythTone: "Companion (Friendly)" });
    }
    
    if (!routines || routines.length === 0) {
      console.log("No routines to schedule");
      return;
    }
    
    console.log("📅 Syncing routines:", routines.length);
    
    // Clear old alarms
    const allAlarms = await chrome.alarms.getAll();
    const aeryithAlarms = allAlarms.filter(a => a.name.startsWith(ALARM_PREFIX));
    for (const alarm of aeryithAlarms) {
      await chrome.alarms.clear(alarm.name);
    }
    
    // Schedule new alarms for next 7 days
    for (const routine of routines) {
      await scheduleAlarmsForRoutine(routine, 7);
      await scheduleEndAlarmsForRoutine(routine, 7);
    }
    
    console.log("✅ Alarms scheduled successfully");
  } catch (e) {
    console.error("❌ syncAndScheduleAlarms failed:", e);
  }
}

// ======================= Alarm Scheduling =======================

async function scheduleAlarmsForRoutine(routine, daysAhead = 7) {
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

async function scheduleEndAlarmsForRoutine(routine, daysAhead = 7) {
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
  
  const settings = await loadLocal("cached_settings", { aerythTone: "Companion (Friendly)" });
  
  // Generate notification text matching saved tone
  const aiText = generateNotificationText(meta, settings.aerythTone, snoozeCount);
  
  if (meta.type === "start") {
    return {
      type: "basic",
      title: "⏰ Aeryth",
      message: aiText,
      iconUrl: "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "✅ Start" },
        { title: "⏭️ Skip" },
        { title: "⏰ 2min" },
        { title: "⏰ 5min" },
        { title: "⏰ 10min" }
      ],
      requireInteraction: true,
      silent: false
    };
  } else if (meta.type === "end") {
    return {
      type: "basic",
      title: "⏰ Aeryth",
      message: aiText,
      iconUrl: "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "✅ Done" },
        { title: "⏭️ Skip" }
      ],
      requireInteraction: true,
      silent: false
    };
  } else if (meta.type === "skip_motivation") {
    return {
      type: "basic",
      title: "💪 Aeryth",
      message: aiText,
      iconUrl: "icons/icon48.png",
      priority: 2,
      buttons: [
        { title: "✅ Start Now" },
        { title: "❌ Skip" }
      ],
      requireInteraction: true,
      silent: false
    };
  }
  
  return null;
}

// Enhanced notification text generator with personality
function generateNotificationText(meta, tone, snoozeCount) {
  const name = meta.routineName;
  const desc = meta.routineDescription || "";
  
  // Normalize tone
  const toneKey = tone || "Companion (Friendly)";
  
  if (meta.type === "start") {
    if (snoozeCount >= 2) {
      // Deep motivation after multiple snoozes
      const messages = {
        "Analyst (Logical)": `📊 ${name}: Each delay reduces success probability by 23%. Take action now for optimal results.`,
        "Companion (Friendly)": `Hey friend! 💜 I know ${name} feels hard right now, but you've got this! Let's do it together - no more waiting!`,
        "Coach (Motivational)": `🔥 ${name} - THIS IS YOUR MOMENT! Stop thinking, start DOING! Winners show up even when it's hard. BE THAT WINNER!`,
        "Sage (Wise)": `🌅 The path of ${name} calls to you once more. Each moment of hesitation is a moment lost to growth. Begin now, friend.`
      };
      return messages[toneKey] || messages["Companion (Friendly)"];
    }
    
    // Regular start notification
    const messages = {
      "Analyst (Logical)": `📈 ${name} scheduled for now. ${desc ? 'Goal: ' + desc + '. ' : ''}Consistent execution yields 3.2x better outcomes. Begin?`,
      "Companion (Friendly)": `Hey there! 😊 It's ${name} time! ${desc ? "Remember - " + desc + "! " : ""}Ready to make today awesome? Let's go!`,
      "Coach (Motivational)": `💪 TIME FOR ${name.toUpperCase()}! ${desc ? desc + ' - ' : ''}This is YOUR time to shine! Show up and DOMINATE!`,
      "Sage (Wise)": `🍃 The hour for ${name} arrives. ${desc ? desc + '. ' : ''}Small consistent steps lead to profound transformation. Shall we begin?`
    };
    return messages[toneKey] || messages["Companion (Friendly)"];
  }
  
  if (meta.type === "end") {
    const messages = {
      "Analyst (Logical)": `⏱️ ${name} session concluded. Please log completion status for accurate tracking and pattern analysis.`,
      "Companion (Friendly)": `Time's up for ${name}! 🎉 How did it go? I'm proud of you for showing up today! Mark it as done?`,
      "Coach (Motivational)": `🏆 ${name} TIME IS UP! Did you CRUSH IT?! Mark your victory and let's keep this momentum rolling!`,
      "Sage (Wise)": `⌛ The ${name} period has passed. Take a moment to reflect on your effort and intention. How did you honor this time?`
    };
    return messages[toneKey] || messages["Companion (Friendly)"];
  }
  
  if (meta.type === "skip_motivation") {
    const messages = {
      "Analyst (Logical)": `⚠️ Data shows: Starting ${name} now increases weekly goal completion by 67%. Reconsider your choice?`,
      "Companion (Friendly)": `Wait! 🥺 I believe in you and your ${name} goal. I know it's tough, but you'll feel SO good after! One more chance?`,
      "Coach (Motivational)": `HOLD UP! ✋ You didn't come this far to QUIT on ${name}! Champions aren't made by skipping - they're made by SHOWING UP! Let's GO!`,
      "Sage (Wise)": `⏳ Pause, friend. ${name} represents your commitment to growth. The easy path rarely leads to the summit. Will you choose the path of intention?`
    };
    return messages[toneKey] || messages["Companion (Friendly)"];
  }
  
  return `⏰ Time for ${name}!`;
}

// ======================= Event Handlers =======================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("🚀 Aeryth installed/updated", details.reason);
  
  // Test notification to verify it works
  chrome.notifications.create("aeryth-test", {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "✅ Aeryth Active",
    message: "Notifications are working! Your routines will alert you even when Chrome is closed.",
    priority: 1
  });
  
  // Initial sync
  await syncAndScheduleAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("🚀 Aeryth starting up");
  await syncAndScheduleAlarms();
});

// Periodic sync every 30 minutes to stay updated
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
      
      // Try to log but don't fail if popup is closed
      chrome.runtime.sendMessage({
        action: "logNotification",
        routineId,
        dateIso,
        text: `Snoozed for ${mins} minutes`
      }).catch(() => console.log("Popup closed, log skipped"));
      
    } else if (action === "start") {
      await chrome.storage.local.remove([snoozeKey]);
      
      chrome.runtime.sendMessage({
        action: "updateEventStatus",
        routineId,
        dateIso,
        status: "in-progress"
      }).catch(() => console.log("Popup closed, status update skipped"));
      
    } else if (action === "skip") {
      if (type === "start" && snoozeCount === 0) {
        // Send motivation notification
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
        }).catch(() => console.log("Popup closed, status update skipped"));
      }
      
    } else if (action === "completed") {
      await chrome.storage.local.remove([snoozeKey]);
      
      chrome.runtime.sendMessage({
        action: "updateEventStatus",
        routineId,
        dateIso,
        status: "completed"
      }).catch(() => console.log("Popup closed, status update skipped"));
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

// Listen for sync requests from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "syncNow") {
    syncAndScheduleAlarms().then(() => sendResponse({ success: true }));
    return true;
  }
});

console.log("✅ Aeryth background initialized - notifications will work even when browser is closed");