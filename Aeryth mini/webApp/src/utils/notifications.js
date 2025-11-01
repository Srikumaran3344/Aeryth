// src/utils/notifications.js
// App-side helpers to schedule notifications (persist alarm meta for background service worker).
import { saveAsync, loadAsync } from "./storage"; // we will import from storage.js - note ESM named import
// but to avoid circular import issues with prior code, loadAsync/saveAsync will be imported from utils/storage.js via relative path

// We'll use keys: `notif_meta_${alarmName}` to store meta so background can access when alarm triggers

// Schedule an alarm in chrome.alarms (or fallback setTimeout while page is open)
export async function scheduleRoutineNotification(routine, dateIso, type = "start", message = "", iconUrl = "/icon48.png") {
  // type: 'start' or 'end'
  try {
    const timeStr = type === "start" ? (routine.startTime || "09:00") : (routine.endTime || routine.startTime || "09:00");
    const [hh, mm] = timeStr.split(":").map(Number);
    const [y, mon, d] = dateIso.split("-").map(Number);
    // Build local Date object
    const target = new Date(y, mon - 1, d, hh, mm, 0, 0);
    if (target.getTime() < Date.now()) return; // don't schedule past dates

    const alarmName = `alarm-aeryth-${routine.id}-${dateIso}-${type}-${Date.now()}`;
    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.create(alarmName, { when: target.getTime() });
      const meta = { notifId: `aeryth-${routine.id}-${dateIso}-${type}-${Date.now()}`, routineId: routine.id, dateIso, type, message, iconUrl };
      await saveAsync(`notif_meta_${alarmName}`, meta);
    } else {
      // fallback: setTimeout local
      const ms = target.getTime() - Date.now();
      setTimeout(() => {
        // show browser Notification if allowed (no action buttons)
        if (window.Notification && Notification.permission !== "denied") {
          if (Notification.permission !== "granted") Notification.requestPermission();
          new Notification("Aeryth", { body: message });
        }
      }, ms);
    }
  } catch (e) {
    console.error("scheduleRoutineNotification error", e);
  }
}
