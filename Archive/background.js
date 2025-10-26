// background.js
// Service worker for extension: listens for alarms, constructs notifications,
// handles button clicks, updates chrome.storage.local event statuses and notification chats.

const STORAGE_KEYS = {
  ROUTINES: "aeryth_routines",
  EVENT_STATUSES: "aeryth_event_statuses",
  NOTIF_CHATS: "aeryth_notif_chats"
};

// Helper to read from chrome.storage.local
function getKeys(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res));
}
function setKeys(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res));
}
function removeKeys(keys) {
  return new Promise((res) => chrome.storage.local.remove(keys, res));
}

// When an alarm fires, we expect metadata saved under key `notif_meta_${alarmName}`
// which contains { notifId, routineId, dateIso, type: 'start'|'end', message, options, snooze }
chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    const metaKey = `notif_meta_${alarm.name}`;
    const store = await getKeys([metaKey]);
    const meta = store[metaKey];
    if (!meta) return;

    // Build notification options
    // For 'start' type, include 4 buttons; for 'end' type, include 2 buttons.
    const buttons = meta.type === "start"
      ? [{ title: "Started" }, { title: "Skipped" }, { title: "2 mins" }, { title: "5 mins" }]
      : [{ title: "Completed" }, { title: "Skipped" }];

    const notifOptions = {
      type: "basic",
      iconUrl: meta.iconUrl || "icon48.png",
      title: "Aeryth",
      message: meta.message || (meta.type === "start" ? "Time to start your routine" : "Did you complete your routine?"),
      priority: 2,
      buttons
    };

    // create notification
    chrome.notifications.create(meta.notifId, notifOptions, () => { /* created */ });

    // Optionally keep meta in storage so onButtonClicked we know type/context
    await setKeys({ [`active_notif_meta_${meta.notifId}`]: meta });
  } catch (e) {
    console.error("onAlarm handler error", e);
  }
});

// Helper to append chat message to notif chats
async function appendNotifChat(routineId, dateIso, messageObj) {
  const key = STORAGE_KEYS.NOTIF_CHATS;
  const store = await getKeys([key]);
  const data = store[key] || {};
  data[routineId] = data[routineId] || {};
  data[routineId][dateIso] = data[routineId][dateIso] || [];
  data[routineId][dateIso].push(messageObj);
  await setKeys({ [key]: data });
}

// Handle button clicks: notificationId and buttonIndex provided
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  try {
    const metaKey = `active_notif_meta_${notificationId}`;
    const store = await getKeys([metaKey]);
    const meta = store[metaKey];
    if (!meta) {
      // If meta missing, try fallback by parsing id pattern: aeryth-{routineId}-{dateIso}...
      console.warn("meta missing for", notificationId);
      return;
    }

    const { routineId, dateIso, type } = meta;

    // Determine action mapping
    // For start notification: buttons [Started, Skipped, 2 mins, 5 mins]
    // For end notification: buttons [Completed, Skipped]
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

    // Update event status accordingly
    const statuses = (await getKeys([STORAGE_KEYS.EVENT_STATUSES]))[STORAGE_KEYS.EVENT_STATUSES] || {};
    statuses[routineId] = statuses[routineId] || {};
    if (action === "started") {
      statuses[routineId][dateIso] = "in-progress";
      await appendNotifChat(routineId, dateIso, { from: "user", text: "Started", ts: new Date().toISOString() });
    } else if (action === "skipped") {
      statuses[routineId][dateIso] = "skipped";
      await appendNotifChat(routineId, dateIso, { from: "user", text: "Skipped", ts: new Date().toISOString() });
    } else if (action === "snooze2" || action === "snooze5") {
      const mins = action === "snooze2" ? 2 : 5;
      // schedule a new short alarm
      const newAlarmName = `snooze-${notificationId}-${Date.now()}`;
      chrome.alarms.create(newAlarmName, { when: Date.now() + mins * 60000 });
      // Save meta for the snooze alarm so when it fires we can recreate notification
      const snoozeMeta = { notifId: `${notificationId}-snooze-${mins}`, routineId, dateIso, type: "start", message: meta.message, snooze: mins, iconUrl: meta.iconUrl };
      await setKeys({ [`notif_meta_${newAlarmName}`]: snoozeMeta });
      await appendNotifChat(routineId, dateIso, { from: "user", text: `Snoozed ${mins}m`, ts: new Date().toISOString() });
    } else if (action === "completed") {
      statuses[routineId][dateIso] = "completed";
      await appendNotifChat(routineId, dateIso, { from: "user", text: "Completed", ts: new Date().toISOString() });
    }

    await setKeys({ [STORAGE_KEYS.EVENT_STATUSES]: statuses });

    // remove saved active meta for this notif
    await removeKeys([metaKey]);

    // clear the notification (visual)
    chrome.notifications.clear(notificationId);

  } catch (e) {
    console.error("notification button click handler error", e);
  }
});

// When notification closed, we remove active meta
chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  try {
    const metaKey = `active_notif_meta_${notificationId}`;
    await removeKeys([metaKey]);
  } catch (e) {
    console.error("onClosed handler error", e);
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://aeryth01.web.app/" });
});

