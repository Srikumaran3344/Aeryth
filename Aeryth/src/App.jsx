// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";

/* -----------------------
   Utilities (storage changed)
   ----------------------- */

/**
 * Storage helpers:
 * - If chrome.storage.local is available (extension environment) use it (async).
 * - Otherwise fall back to localStorage (sync).
 *
 * We keep JSON (and date reviver) semantics compatible with your original code.
 */
const reviverDate = (k, v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v;

const _hasChromeStorage = () => typeof chrome !== "undefined" && chrome?.storage?.local;
async function chromeGet(key) {
  return new Promise((res) => {
    chrome.storage.local.get([key], (o) => {
      res(o[key]);
    });
  });
}
async function chromeSet(key, value) {
  return new Promise((res, rej) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => res());
    } catch (e) { rej(e); }
  });
}

const loadSync = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw, reviverDate) : fallback;
  } catch (e) {
    console.error("loadSync", e);
    return fallback;
  }
};
const saveSync = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error("saveSync", e); }
};

// Async wrappers used in the app
const loadAsync = async (k, fallback) => {
  if (_hasChromeStorage()) {
    try {
      const val = await chromeGet(k);
      return val === undefined ? fallback : JSON.parse(JSON.stringify(val), reviverDate);
    } catch (e) {
      console.error("chrome load failed", e);
      return fallback;
    }
  } else {
    return loadSync(k, fallback);
  }
};
const saveAsync = async (k, v) => {
  if (_hasChromeStorage()) {
    try {
      // store a plain JSON-able copy
      await chromeSet(k, JSON.parse(JSON.stringify(v)));
    } catch (e) { console.error("chrome save failed", e); }
  } else {
    saveSync(k, v);
  }
};

const iso = (d) => d.toISOString().slice(0, 10);
const fmtShort = (d) => `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" }).slice(0,3)} ${String(d.getFullYear()).slice(2)}`;

/* -----------------------
   Gemini Nano wrappers (unchanged)
   ----------------------- */
let sessions = {};
const availableModel = () => !!(window && window.LanguageModel && window.LanguageModel.create);

async function ensureSession(id, prompt) {
  if (!availableModel()) throw new Error("Gemini Nano not available.");
  if (!sessions[id]) sessions[id] = await window.LanguageModel.create({ initialPrompts: [{ role: "system", content: prompt }] });
  return sessions[id];
}
async function callGeminiTemp(id, history, settings, routines) {
  const last = history.at(-1)?.text || "";
  const system = `You are Aeryth. Tone:${settings?.aerythTone||"Friendly"}.`;
  const s = await ensureSession(id, system);
  const r = await s.prompt(last);
  return r?.output ?? r;
}
async function callGeminiDiary(text) {
  if (!availableModel()) throw new Error("Gemini Nano not available.");
  const s = await window.LanguageModel.create({ initialPrompts: [{ role: "system", content: "Correct grammar and spelling. Output only corrected text." }] });
  try {
    const r = await s.prompt(text);
    return r?.output ?? r;
  } finally { s.destroy?.(); }
}

/* Local grammar-corrector (fallback) */
function localGrammarCorrect(text) {
  if (!text) return "";
  let out = text.trim();
  out = out.replace(/\s+/g, " ");
  out = out.replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase());
  out = out.replace(/\bi\b/g, "I");
  if (!/[.!?]$/.test(out)) out = out + ".";
  return out;
}

/* -----------------------
   App
   ----------------------- */
export default function App() {
  /* ---- persisted state (initialize to sensible defaults, then load async) ---- */
  const [settings, setSettings] = useState({ aerythTone: "Friendly", userInfo: "", routineCriteria: "" });
  const [routines, setRoutines] = useState([]);
  // diary structure: { "YYYY-M": { "YYYY-MM-DD": [{id,text,ts}], monthlySummary: "..." } }
  const [diary, setDiary] = useState({});
  // stickies unchanged
  const [stickies, setStickies] = useState({});
  // eventStatuses: { routineId: { "YYYY-MM-DD": "upcoming" | "in-progress" | "completed" | "skipped" } }
  const [eventStatuses, setEventStatuses] = useState({});
  // notification chat history per routine/day (keeps transient notification chat until day ends)
  const [notifChats, setNotifChats] = useState({}); // { routineId: { "YYYY-MM-DD": [ {from:'aeryth'|'user', text, ts} ] } }

  // personalization cache
  const [profileSummary, setProfileSummary] = useState(null); // compact personalization info for Aeryth

  /* ephemeral UI state */
  const [exploreBuffer, setExploreBuffer] = useState([]);
  const [currentView, setCurrentView] = useState("explore");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedRoutineId, setSelectedRoutineId] = useState(null);
  const [isAILoading, setIsAILoading] = useState(false);

  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [editingRoutine, setEditingRoutine] = useState(null);

  /* calendar */
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarViewMonth, setCalendarViewMonth] = useState(new Date());

  /* chat scroll */
  const chatEndRef = useRef(null);
  useEffect(() => { setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 60); }, [exploreBuffer, isAILoading]);

  /* ---- load persisted state on mount (async) ---- */
  useEffect(() => {
    (async () => {
      const _settings = await loadAsync("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" });
      setSettings(_settings);

      const _routines = await loadAsync("aeryth_routines", []);
      // Ensure createdAt dates are Date objects
      _routines.forEach(r => {
        if (r && r.createdAt && typeof r.createdAt === "string") r.createdAt = new Date(r.createdAt);
      });
      setRoutines(_routines);

      const _diary = await loadAsync("aeryth_diary", {});
      setDiary(_diary);

      const _stickies = await loadAsync("aeryth_stickies", {});
      setStickies(_stickies);

      const _eventStatuses = await loadAsync("aeryth_event_statuses", {});
      setEventStatuses(_eventStatuses || {});

      const _notifChats = await loadAsync("aeryth_notif_chats", {});
      setNotifChats(_notifChats || {});

      const _profile = await loadAsync("aeryth_profile", null);
      setProfileSummary(_profile || null);
    })();
  }, []);

  /* ---- persisters: whenever certain states change, save them ---- */
  useEffect(() => { saveAsync("aeryth_settings", settings); }, [settings]);
  useEffect(() => { saveAsync("aeryth_routines", routines); }, [routines]);
  useEffect(() => { saveAsync("aeryth_diary", diary); }, [diary]);
  useEffect(() => { saveAsync("aeryth_stickies", stickies); }, [stickies]);
  useEffect(() => { saveAsync("aeryth_event_statuses", eventStatuses); }, [eventStatuses]);
  useEffect(() => { saveAsync("aeryth_notif_chats", notifChats); }, [notifChats]);
  useEffect(() => { saveAsync("aeryth_profile", profileSummary); }, [profileSummary]);

  /* Helpers to set status */
  const setEventStatus = (routineId, dateIso, status) => {
    setEventStatuses(prev => {
      const n = { ...(prev || {}) };
      n[routineId] = { ...(n[routineId] || {}) };
      n[routineId][dateIso] = status;
      return n;
    });
  };

  /* ---- routines CRUD (unchanged except createdAt usage) ---- */
  const addRoutine = ({ name, description, startTime, endTime, days, color="violet" }) => {
    const id = crypto.randomUUID();
    const now = new Date();
    const r = { id, name, description, startTime, endTime, days, color, createdAt: now };
    setRoutines(prev => [r, ...prev]);
    // init a few stickies as before
    const prevD = iso(new Date(Date.now() - 86400000));
    const curD = iso(new Date());
    const nextD = iso(new Date(Date.now() + 86400000));
    setStickies(prev => ({ ...prev, [id]: { dates: { [prevD]: { text: "", color }, [curD]: { text: "", color }, [nextD]: { text: "", color } } } }));
    // initialize status for upcoming next day only (we won't populate past days)
    setEventStatuses(prev => {
      const n = { ...(prev || {}) };
      n[id] = n[id] || {};
      n[id][curD] = n[id][curD] || "upcoming";
      n[id][nextD] = n[id][nextD] || "upcoming";
      return n;
    });
    // schedule notifications for next occurrences (scaffold)
    scheduleUpcomingNotificationsForRoutine(r);
    return id;
  };

  const updateRoutine = (id, patch) => {
    setRoutines(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };
  const removeRoutine = (id) => {
    setRoutines(prev => prev.filter(r => r.id !== id));
    setStickies(prev => { const n = { ...prev }; delete n[id]; return n; });
    setEventStatuses(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (selectedRoutineId === id) { setSelectedRoutineId(null); setCurrentView("explore"); }
  };

  /* stickies update helpers (unchanged) */
  const setStickyText = (rid, dayIso, text) => setStickies(prev => { const n = { ...prev }; n[rid] = n[rid] || { dates: {} }; n[rid].dates = { ...(n[rid].dates || {}), [dayIso]: { ...(n[rid].dates?.[dayIso] || {}), text } }; return n; });
  const setStickyColor = (rid, dayIso, color) => setStickies(prev => { const n = { ...prev }; n[rid] = n[rid] || { dates: {} }; n[rid].dates = { ...(n[rid].dates || {}), [dayIso]: { ...(n[rid].dates?.[dayIso] || {}), color } }; return n; });

  /* diary helpers (unchanged) */
  const addDiaryEntry = (text, onDate = null) => {
    if (!text?.trim()) return;
    const d = onDate ? new Date(onDate) : new Date();
    const dayKey = iso(d);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    setDiary(prev => {
      const n = { ...prev };
      n[monthKey] = n[monthKey] || {};
      n[monthKey][dayKey] = n[monthKey][dayKey] || [];

      const head = n[monthKey][dayKey][0];
      if (head && head.text === text && Math.abs(new Date(head.ts) - d) < 3000) {
        return n;
      }

      n[monthKey][dayKey] = [{ id: crypto.randomUUID(), text, ts: d.toISOString() }, ...n[monthKey][dayKey]];
      return n;
    });
  };
  const deleteDiaryEntry = (monthKey, dayKey, entryId) => {
    setDiary(prev => {
      const n = { ...prev };
      n[monthKey] = { ...(n[monthKey] || {}) };
      n[monthKey][dayKey] = (n[monthKey][dayKey] || []).filter(x => x.id !== entryId);
      return n;
    });
  };
  const updateDiaryEntry = (monthKey, dayKey, entryId, newText) => {
    setDiary(prev => {
      const n = { ...prev };
      if (!n[monthKey] || !n[monthKey][dayKey]) return prev;
      n[monthKey] = { ...n[monthKey] };
      n[monthKey][dayKey] = n[monthKey][dayKey].map(e => e.id === entryId ? { ...e, text: newText, editedAt: new Date().toISOString() } : e);
      return n;
    });
  };

  /* monthly summary generation now attempts to use Gemini (Aeryth) to rewrite/condense texts */
  const generateMonthlySummaryIfMissing = async (monthKey) => {
    setDiary(prev => {
      const n = { ...prev };
      const month = n[monthKey] || {};
      if (!month) return n;
      if (month.monthlySummary) return n;
      // Gather all texts in month
      const texts = Object.keys(month)
        .filter(k => k !== "monthlySummary")
        .flatMap(day => (month[day] || []).map(e => e.text));
      const initial = texts.join(" ").slice(0, 5000) || "No events for this month.";
      // set a placeholder while we call the model
      n[monthKey] = { ...(n[monthKey] || {}), monthlySummary: "Generating summary..." };
      // async call outside of state setter
      (async () => {
        try {
          let corrected;
          if (availableModel && availableModel()) {
            // ask Aeryth (Gemini) to rewrite/condense as a command-like short summary
            const prompt = `You are Aeryth. Condense and rewrite the following user's monthly notes into a short monthly summary (max 120 words). Keep tone aligned with the user's Aeryth tone. Text:\n\n${initial}`;
            corrected = await callGeminiDiary(prompt); // re-using callGeminiDiary as a lightweight wrapper for corrected text
          } else {
            corrected = localGrammarCorrect(initial).slice(0, 800);
          }
          setDiary(prev2 => ({ ...(prev2 || {}), [monthKey]: { ...(prev2[monthKey] || {}), monthlySummary: corrected.slice(0, 800) } }));
        } catch (err) {
          console.error("Summary generation failed", err);
          setDiary(prev2 => ({ ...(prev2 || {}), [monthKey]: { ...(prev2[monthKey] || {}), monthlySummary: initial.slice(0, 800) } }));
        }
      })();
      return n;
    });
  };

  /* ---- Chat / Explore sessions (unchanged) ---- */
  const [chatSessionId, setChatSessionId] = useState(0);
  const handleNewChat = () => {
    setChatSessionId(prev => prev + 1);
    setExploreBuffer([]);
    setIsAILoading(false);
    setCurrentView("explore");
  };
  const handleExploreSend = async (text) => {
    const currentSession = chatSessionId;
    setIsAILoading(true);
    const userMsg = { id: crypto.randomUUID(), role: "user", text };
    setExploreBuffer(prev => [...prev, userMsg]);

    const aiText = await callGeminiTemp("explore-temp", [...exploreBuffer, userMsg], settings, routines);
    if (currentSession === chatSessionId) {
      setExploreBuffer(prev => [...prev, { id: crypto.randomUUID(), role: "aeryth", text: aiText }]);
    }
    setIsAILoading(false);
  };

  /* -----------------------
     Calendar events mapping (respect routine.createdAt)
     ----------------------- */
  const calendarEvents = (() => {
    const events = {}; // iso -> [{routineId,name,color,time}]
    const getRangeDates = (base) => {
      const arr = [];
      const start = new Date(base.getFullYear(), base.getMonth()-1, 1);
      const end = new Date(base.getFullYear(), base.getMonth()+2, 0);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) arr.push(new Date(d));
      return arr;
    };
    const daysMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
    getRangeDates(calendarViewMonth).forEach(d => events[iso(d)] = []);
    routines.forEach(r => {
      if (!r.days || !r.startTime) return;
      const createdAtIso = r.createdAt ? iso(new Date(r.createdAt)) : null;
      Object.keys(events).forEach(dayIso => {
        if (createdAtIso && dayIso < createdAtIso) return; // respect createdAt: don't generate events before creation
        const d = new Date(dayIso + "T00:00:00Z");
        const wd = d.getUTCDay();
        if (r.days.some(dd => daysMap[dd] === wd)) {
          events[dayIso].push({ routineId: r.id, name: r.name || r.goal || "Routine", color: r.color || "violet", time: r.startTime });
        }
      });
    });
    Object.keys(events).forEach(k => events[k].sort((a,b) => (a.time||"") > (b.time||"") ? 1 : -1));
    return events;
  })();

  /* -----------------------
     Notification system scaffolding
     - scheduleUpcomingNotificationsForRoutine(routine)
     - scheduleRoutineNotification(routine, dateIso)
     - handlers for notification actions (started/skipped/snooze)
     NOTE: full reliability across browser restarts requires a background service worker (manifest + background.js)
     ----------------------- */
  // build a short personalized message via Gemini (or fallback)
  const buildReminderMessage = async (routine, dateIso) => {
    const tone = settings?.aerythTone || "Friendly";
    const base = `${routine.name} — ${routine.description || ""}`;
    const prompt = `You are Aeryth. Using a ${tone} tone, produce a short (max two lines) reminder message to nudge the user about this routine: "${base}". Keep it actionable and personalized with user's goal if available.`;
    try {
      if (availableModel && availableModel()) {
        const out = await callGeminiTemp("notif-temp", [{ role: "user", text: prompt }], settings, routines);
        // ensure short
        return (typeof out === "string" ? out : String(out)).split("\n").slice(0,2).join(" ").slice(0,160);
      } else {
        // fallback
        return `${routine.name}: time to start — ${routine.description || ""}`.slice(0,160);
      }
    } catch (e) {
      console.error("buildReminderMessage failed", e);
      return `${routine.name}: time to start.`;
    }
  };

  // schedule a single notification for a routine on a specific date.
  const scheduleRoutineNotification = async (routine, dateIso) => {
    try {
      const targetDate = new Date(`${dateIso}T${routine.startTime || "09:00"}:00`);
      // don't schedule if target is in the past
      if (targetDate.getTime() < Date.now()) return;
      // build message
      const message = await buildReminderMessage(routine, dateIso);

      // Compose options and action buttons
      const notifId = `aeryth-${routine.id}-${dateIso}`;
      const options = {
        type: "basic",
        title: "Aeryth",
        message, // main body - two lines max
        iconUrl: "/icon.png",
        buttons: [
          { title: "Started" },
          { title: "Skipped" },
          { title: "2 mins" },
          { title: "5 mins" },
        ],
        priority: 2,
      };

      // If chrome.alarms + chrome.notifications available, create an alarm for the timestamp and let background worker show notification.
      if (typeof chrome !== "undefined" && chrome?.alarms && chrome?.notifications) {
        // Create an alarm; background worker should listen to alarms and show notifications.
        const alarmName = `alarm-${notifId}`;
        chrome.alarms.create(alarmName, { when: targetDate.getTime() });
        // Persist details (so background can lookup and craft notif if needed)
        await saveAsync(`notif_meta_${alarmName}`, { notifId, routineId: routine.id, dateIso, options });
      } else {
        // Fallback: setTimeout and then show notification with web Notification API (works while page open)
        const ms = Math.max(0, targetDate.getTime() - Date.now());
        setTimeout(async () => {
          // If Notification API available
          if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
            if (Notification.permission !== "granted") await Notification.requestPermission();
            new Notification("Aeryth", { body: message });
            // For action buttons we cannot rely on web Notification in some browsers — so we keep a local in-page fallback:
            // Record that notification was shown so UI can reflect it if user opens app
            setNotifChats(prev => {
              const n = { ...(prev || {}) };
              n[routine.id] = { ...(n[routine.id] || {}) };
              n[routine.id][dateIso] = n[routine.id][dateIso] || [];
              n[routine.id][dateIso].push({ from: "aeryth", text: message, ts: new Date().toISOString() });
              return n;
            });
          } else {
            // Last fallback: update chat log only.
            setNotifChats(prev => {
              const n = { ...(prev || {}) };
              n[routine.id] = { ...(n[routine.id] || {}) };
              n[routine.id][dateIso] = n[routine.id][dateIso] || [];
              n[routine.id][dateIso].push({ from: "aeryth", text: message, ts: new Date().toISOString() });
              return n;
            });
          }
        }, ms);
      }
    } catch (e) {
      console.error("scheduleRoutineNotification failed", e);
    }
  };

  // schedule upcoming notifications (e.g., for next N days) for a routine
  const scheduleUpcomingNotificationsForRoutine = (routine, daysAhead = 3) => {
    const now = new Date();
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dayIso = iso(d);
      // Respect createdAt
      if (routine.createdAt && dayIso < iso(new Date(routine.createdAt))) continue;
      // check if routine applies that weekday
      const daysMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
      const wd = d.getUTCDay();
      if (!routine.days || !routine.days.some(dd => daysMap[dd] === wd)) continue;
      scheduleRoutineNotification(routine, dayIso);
    }
  };

  // handle notification action clicked (this is best handled in the background worker)
  // but we include a helper to be called from background or page.
  const handleNotificationAction = async ({ routineId, dateIso, action }) => {
    // action can be "started", "skipped", "snooze2", "snooze5", "confirmCompleted", ...
    if (action === "started") {
      // mark in-progress then later will be completed via user action or end-of-run check
      setEventStatus(routineId, dateIso, "in-progress");
      // add chat log
      setNotifChats(prev => {
        const n = { ...(prev || {}) };
        n[routineId] = { ...(n[routineId] || {}) };
        n[routineId][dateIso] = n[routineId][dateIso] || [];
        n[routineId][dateIso].push({ from: "user", text: "Started", ts: new Date().toISOString() });
        return n;
      });
    } else if (action === "skipped") {
      setEventStatus(routineId, dateIso, "skipped");
      setNotifChats(prev => {
        const n = { ...(prev || {}) };
        n[routineId] = { ...(n[routineId] || {}) };
        n[routineId][dateIso] = n[routineId][dateIso] || [];
        n[routineId][dateIso].push({ from: "user", text: "Skipped", ts: new Date().toISOString() });
        return n;
      });
    } else if (action === "snooze2" || action === "snooze5") {
      const mins = action === "snooze2" ? 2 : 5;
      // schedule a new notification after mins
      const routine = routines.find(r => r.id === routineId);
      if (!routine) return;
      // create a short temp alarm
      const date = new Date(Date.now() + mins * 60000);
      const alarmName = `snooze-${routineId}-${dateIso}-${Date.now()}`;
      if (typeof chrome !== "undefined" && chrome.alarms) {
        chrome.alarms.create(alarmName, { when: date.getTime() });
        await saveAsync(`notif_meta_${alarmName}`, { notifId: `snooze-${routineId}-${dateIso}`, routineId, dateIso, snooze: mins });
      } else {
        // fallback setTimeout — show a notification via Notification API when fired
        setTimeout(async () => {
          const msg = `Snooze ${mins} minutes: ${routine.name}`;
          setNotifChats(prev => {
            const n = { ...(prev || {}) };
            n[routineId] = { ...(n[routineId] || {}) };
            n[routineId][dateIso] = n[routineId][dateIso] || [];
            n[routineId][dateIso].push({ from: "aeryth", text: msg, ts: new Date().toISOString() });
            return n;
          });
        }, mins * 60000);
      }
      // record snooze in chat
      setNotifChats(prev => {
        const n = { ...(prev || {}) };
        n[routineId] = { ...(n[routineId] || {}) };
        n[routineId][dateIso] = n[routineId][dateIso] || [];
        n[routineId][dateIso].push({ from: "user", text: `Snooze ${mins}m`, ts: new Date().toISOString() });
        return n;
      });
    }
  };

  /* -----------------------
     UI components (unchanged look) including added status UI in CalendarView's event cards
     ----------------------- */

  const TopPills = ({ view, setView }) => (
    <div className="flex-1 flex justify-around mb-3 gap-10">
      <button onClick={() => setView("explore")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "explore" ? "bg-violet-500 text-black" : "bg-gray-100 hover:bg-violet-100"}`}>
        Explore
      </button>

      <button onClick={() => setView("setGoal")}
        className={`flex-1 px-4 py-2 rounded-full text-sm font-semibold transition shadow-md ${view === "setGoal" ? "bg-violet-500 text-white" : "bg-gray-100 hover:bg-violet-100"}`}>
        Set Goal
      </button>

      <button onClick={() => setView("diary")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "diary" ? "bg-violet-500 text-white" : "bg-gray-100 hover:bg-violet-100"}`}>
        Diary
      </button>
    </div>
  );

  const SidebarToggle = ({ inside=false }) => (
    <button onClick={() => setIsSidebarOpen(s => !s)} className={`${inside ? "bg-white text-violet-600" : "bg-violet-500 text-white"} p-2 rounded-full shadow`}>
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
  );

  const RoutineStrip = ({ r }) => {
    const selected = selectedRoutineId === r.id;
    return (
      <div className={`flex items-center p-3 rounded-xl ${selected ? "bg-violet-100" : "hover:bg-gray-100"} relative`}>
        {editingRoutine === r.id ? (
          <input
            defaultValue={r.name}
            className="flex-1 p-1 border rounded"
            onBlur={(e) => { updateRoutine(r.id, { name: e.target.value }); setEditingRoutine(null); }}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
            autoFocus
          />
        ) : (
          <button onClick={() => { setSelectedRoutineId(r.id); setCurrentView("routineView"); }} className="flex-1 text-left font-medium">{r.name}</button>
        )}

        <div className="flex items-center gap-1">
          <button onClick={() => setMenuOpenFor(menuOpenFor === r.id ? null : r.id)} className="p-1 text-gray-400 hover:text-gray-700">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
          </button>
          {menuOpenFor === r.id && (
            <div className="absolute right-3 top-12 bg-white border rounded shadow-md w-36 z-50">
              <button onClick={() => { setEditingRoutine(r.id); setMenuOpenFor(null); }} className="w-full text-left px-3 py-2 hover:bg-gray-50">Rename</button>
              <button onClick={() => { removeRoutine(r.id); setMenuOpenFor(null); }} className="w-full text-left px-3 py-2 text-red-600 hover:bg-gray-50">Delete</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* Panels (unchanged) */
  function MainPanel() {
    if (currentView === "setGoal") return <SetGoalPanel />;
    if (currentView === "routineView" && selectedRoutineId) return <RoutineStickyView />;
    if (currentView === "calendar") return <CalendarView />;
    if (currentView === "diary") return <DiaryView />;
    if (currentView === "settings") return <SettingsPanel />;
    return <ExploreView />;
  }

  function SetGoalPanel() {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("10:00");
    const [days, setDays] = useState([]);
    const availableDays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const toggleDay = (d) => setDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev,d]);

    const handleSave = () => {
      if (!name.trim()) { alert("Routine name required"); return; }
      const id = addRoutine({ name: name.trim(), description: description.trim(), startTime, endTime, days, color: "violet" });
      setSelectedRoutineId(id);
      // schedule upcoming notifications for new routine
      const routine = routines.find(r => r.id === id) || null;
      // We already scheduled inside addRoutine
      setCurrentView("routineView");
    };

    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white p-6 rounded-xl shadow">
            <h2 className="text-2xl font-bold text-violet-700 mb-4">Create Routine</h2>

            <div className="space-y-4">
              <div>
                <label className="font-semibold">Routine name</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Java, Football, Math..." className="w-full mt-1 p-3 border rounded-lg" />
              </div>

              <div>
                <label className="font-semibold">What do you want to achieve?</label>
                <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe goal for this routine" className="w-full mt-1 p-3 border rounded-lg" />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="font-semibold">Start time</label>
                  <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
                </div>
                <div className="flex-1">
                  <label className="font-semibold">End time</label>
                  <input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
                </div>
              </div>

              <div>
                <label className="font-semibold">Repeat on</label>
                <div className="flex gap-2 mt-2">
                  {availableDays.map(d => (
                    <button key={d} type="button" onClick={() => toggleDay(d)}
                      className={`w-10 h-10 rounded-full font-bold transition ${days.includes(d) ? "bg-violet-500 text-white" : "bg-gray-200 text-gray-700"}`}>
                      {d[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={handleSave} className="flex-1 py-3 rounded-lg bg-violet-500 text-white font-bold">Save Routine</button>
              <button onClick={() => setCurrentView("explore")} className="py-3 px-6 rounded-lg border">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function RoutineStickyView() {
    const r = routines.find(x => x.id === selectedRoutineId);
    if (!r) return <div className="p-6">Routine not found.</div>;

    const prevKey = iso(new Date(Date.now() - 86400000));
    const curKey = iso(new Date());
    const nextKey = iso(new Date(Date.now() + 86400000));

    const datesMap = (stickies[selectedRoutineId] && stickies[selectedRoutineId].dates) || {};
    const getSticky = (d) => ({ ...(datesMap[d] || { text: "", color: r.color || "violet" }) });

    const [localPrevText, setLocalPrevText] = useState(getSticky(prevKey).text);
    const [localText, setLocalText] = useState(getSticky(curKey).text);
    const [localNextText, setLocalNextText] = useState(getSticky(nextKey).text);
    const [colorPrev, setColorPrev] = useState(getSticky(prevKey).color || "violet");
    const [colorCur, setColorCur] = useState(getSticky(curKey).color || "violet");
    const [colorNext, setColorNext] = useState(getSticky(nextKey).color || "violet");

    useEffect(() => {
      setLocalPrevText(getSticky(prevKey).text);
      setLocalText(getSticky(curKey).text);
      setLocalNextText(getSticky(nextKey).text);
      setColorPrev(getSticky(prevKey).color || "violet");
      setColorCur(getSticky(curKey).color || "violet");
      setColorNext(getSticky(nextKey).color || "violet");
    }, [selectedRoutineId, stickies, r]);

    const persistText = (d, txt) => setStickyText(selectedRoutineId, d, txt);
    const persistColor = (d, c) => setStickyColor(selectedRoutineId, d, c);

    const colors = ["amber", "violet", "green", "rose"];
    const colorClasses = {
      amber: "bg-amber-100 border-amber-300",
      violet: "bg-violet-100 border-violet-300",
      green: "bg-green-100 border-green-300",
      rose: "bg-rose-100 border-rose-300"
    };

    const renderColorPicker = (currentColor, setColor, persistKey) => (
      <div className="flex gap-2">
        {colors.map(c => (
          <button
            key={c}
            onClick={() => {
              setColor(c);
              persistColor(persistKey, c);
            }}
            className={`w-5 h-5 rounded-full border-2 ${c === currentColor ? "ring-2 ring-violet-500" : ""} ${
              c === "amber" ? "bg-amber-400"
              : c === "violet" ? "bg-violet-500"
              : c === "green" ? "bg-green-400"
              : "bg-rose-400"
            }`}
            aria-label={`Set color ${c}`}
          />
        ))}
      </div>
    );

    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-violet-700 mb-2">{r.name}</h2>
          <p className="text-sm text-gray-500 mb-4">{r.description}</p>

          {/* Current Sticky */}
          <div className={`p-4 rounded-xl shadow mb-4 border ${colorClasses[colorCur]}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Current - {fmtShort(new Date())}</div>
              {renderColorPicker(colorCur, setColorCur, curKey)}
            </div>

            <textarea
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={() => persistText(curKey, localText)}
              className="w-full p-3 border rounded h-28 resize-none bg-white/70"
            />
          </div>

          {/* Previous and Next */}
          <div className="grid grid-cols-2 gap-4">
            {/* Previous */}
            <div className={`p-4 rounded-xl shadow border ${colorClasses[colorPrev]}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Previous - {fmtShort(new Date(Date.now() - 86400000))}</div>
                {renderColorPicker(colorPrev, setColorPrev, prevKey)}
              </div>
              <textarea
                value={localPrevText}
                disabled
                className="w-full p-3 border rounded h-24 resize-none bg-gray-50"
              />
            </div>

            {/* Next */}
            <div className={`p-4 rounded-xl shadow border ${colorClasses[colorNext]}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Next - {fmtShort(new Date(Date.now() + 86400000))}</div>
                {renderColorPicker(colorNext, setColorNext, nextKey)}
              </div>
              <textarea
                value={localNextText}
                onChange={(e) => setLocalNextText(e.target.value)}
                onBlur={() => persistText(nextKey, localNextText)}
                className="w-full p-3 border rounded h-24 resize-none"
              />
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => { setCurrentView("explore"); setSelectedRoutineId(null); }}
              className="px-4 py-2 rounded bg-gray-100"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  function CalendarView() {
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [calendarViewMonth, setCalendarViewMonth] = useState(new Date());
    const [editBuffer, setEditBuffer] = useState({}); // Local edits before saving

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const isPrevDisabled =
      calendarViewMonth.getFullYear() < currentYear ||
      (calendarViewMonth.getFullYear() === currentYear &&
        calendarViewMonth.getMonth() <= currentMonth - 1);

    const isNextDisabled =
      calendarViewMonth.getFullYear() > currentYear ||
      (calendarViewMonth.getFullYear() === currentYear &&
        calendarViewMonth.getMonth() >= currentMonth + 1);

    const onActiveStartDateChange = ({ activeStartDate }) =>
      setCalendarViewMonth(activeStartDate);

    // ---- Build Events Map (respecting routine.createdAt) ----
    const calendarEventsLocal = (() => {
      const events = {};
      const getRangeDates = (base) => {
        const arr = [];
        const start = new Date(base.getFullYear(), base.getMonth() - 1, 1);
        const end = new Date(base.getFullYear(), base.getMonth() + 2, 0);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
          arr.push(new Date(d));
        return arr;
      };
      const daysMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

      getRangeDates(calendarViewMonth).forEach(
        (d) => (events[iso(d)] = [])
      );

      routines.forEach((r) => {
        if (!r.days || !r.startTime) return;
        const createdAtIso = r.createdAt ? iso(new Date(r.createdAt)) : null;
        Object.keys(events).forEach((dayIso) => {
          if (createdAtIso && dayIso < createdAtIso) return; // don't create events before createdAt
          const d = new Date(dayIso + "T00:00:00Z");
          const weekDay = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][(d.getUTCDay()+1)%7];
          if (r.days.some((dd) => dd === weekDay)) {
            events[dayIso].push({
              routineId: r.id,
              name: r.name || "Routine",
              color: r.color || "violet",
              time: r.startTime,
              days: r.days,
            });
          }
        });
      });
      Object.keys(events).forEach((k) =>
        events[k].sort((a, b) => (a.time || "") > (b.time || "") ? 1 : -1)
      );
      return events;
    })();

    const availableDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // --- Handle Local Edits ---
    const handleLocalChange = (id, field, value) => {
      setEditBuffer((prev) => ({
        ...prev,
        [id]: { ...(prev[id] || {}), [field]: value },
      }));
    };

    const saveChanges = (id) => {
      const patch = editBuffer[id];
      if (!patch) return;
      // When saving days/time/color we should not retroactively change past dates statuses.
      // The routines array itself is changed (future render will reflect it), but eventStatuses remain unchanged for past dates.
      updateRoutine(id, patch);
      // Reschedule notifications for next days
      const r = routines.find(x => x.id === id);
      if (r) scheduleUpcomingNotificationsForRoutine({ ...r, ...patch });
      setEditBuffer((prev) => {
        const newBuf = { ...prev };
        delete newBuf[id];
        return newBuf;
      });
    };

    const hasChanges = (id) => !!editBuffer[id];

    // helper: check if a date is editable (past dates cannot be edited)
    const isDateInPast = (dateIso) => {
      return dateIso < iso(new Date());
    };

    // helper: get status for a routineId/dateIso
    const getStatus = (routineId, dateIso) => (eventStatuses[routineId] || {})[dateIso] || "upcoming";

    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-violet-700">Calendar</h2>
          </div>

          {/* Month Navigation */}
          <div className="flex gap-2 justify-center mb-4">
            <button
              onClick={() =>
                setCalendarViewMonth(
                  new Date(
                    calendarViewMonth.getFullYear(),
                    calendarViewMonth.getMonth() - 1,
                    1
                  )
                )
              }
              className={`px-3 py-2 rounded font-semibold transition ${
                isPrevDisabled
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              disabled={isPrevDisabled}
            >
              Prev
            </button>
            <button
              onClick={() => setCalendarViewMonth(new Date())}
              className="px-3 py-2 rounded bg-violet-500 text-white font-semibold hover:bg-violet-600 transition"
            >
              Today
            </button>
            <button
              onClick={() =>
                setCalendarViewMonth(
                  new Date(
                    calendarViewMonth.getFullYear(),
                    calendarViewMonth.getMonth() + 1,
                    1
                  )
                )
              }
              className={`px-3 py-2 rounded font-semibold transition ${
                isNextDisabled
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              disabled={isNextDisabled}
            >
              Next
            </button>
          </div>

          {/* Calendar */}
          <div className="mx-auto w-full h-[600px] flex justify-center">
            <Calendar
              onChange={setCalendarDate}
              value={calendarDate}
              activeStartDate={calendarViewMonth}
              onActiveStartDateChange={onActiveStartDateChange}
              className="w-full h-full border border-gray-200 rounded-lg shadow-lg"
              prevLabel={null}
              nextLabel={null}
              prev2Label={null}
              next2Label={null}
              tileContent={({ date }) => {
                const isoDay = iso(date);
                const ev = calendarEventsLocal[isoDay] || [];
                if (!ev.length) return null;
                const shown = ev.slice(0, 2);
                const remaining = ev.length - shown.length;
                return (
                  <div className="mt-1 space-y-0">
                    {shown.map((e, i) => (
                      <div
                        key={i}
                        className={`text-[10px] truncate rounded-sm px-1 ${
                          e.color === "violet"
                            ? "bg-violet-500 text-white"
                            : e.color === "green"
                            ? "bg-green-400 text-white"
                            : e.color === "rose"
                            ? "bg-rose-400 text-white"
                            : "bg-amber-400 text-black"
                        }`}
                      >
                        {e.name}
                      </div>
                    ))}
                    {remaining > 0 && (
                      <div className="text-[9px] text-gray-500 font-medium">
                        +{remaining} more
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>

          {/* Events Section */}
          <div className="mt-8 bg-white p-4 rounded-xl shadow">
            <h3 className="font-semibold text-lg text-gray-800">
              Events on {fmtShort(new Date(calendarDate))}
            </h3>
            <div className="mt-3 space-y-3">
              {(calendarEventsLocal[iso(calendarDate)] || []).map((ev, idx) => {
                const local = editBuffer[ev.routineId] || {};
                const currentTime = local.startTime ?? ev.time ?? "";
                const currentDays = local.days ?? ev.days ?? [];
                const dateIso = iso(calendarDate);
                const inPast = isDateInPast(dateIso);
                const status = getStatus(ev.routineId, dateIso);

                const toggleDayLocal = (day) => {
                  const newDays = currentDays.includes(day)
                    ? currentDays.filter((d) => d !== day)
                    : [...currentDays, day];
                  handleLocalChange(ev.routineId, "days", newDays);
                };

                // Determine if routine start time has arrived for today
                const hasStartedTime = (() => {
                  if (dateIso !== iso(new Date())) return false;
                  if (!currentTime) return false;
                  const [hh, mm] = (currentTime || "00:00").split(":").map(Number);
                  const now = new Date();
                  return now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
                })();

                return (
                  <div
                    key={idx}
                    className="p-3 border border-gray-100 rounded-lg shadow-sm flex flex-col gap-3"
                  >
                    <div className="flex justify-between items-center">
                      <div className="font-medium text-lg">{ev.name}</div>
                      {hasChanges(ev.routineId) && !inPast && (
                        <button
                          onClick={() => saveChanges(ev.routineId)}
                          className="px-3 py-1 bg-violet-500 text-white text-sm font-semibold rounded hover:bg-violet-600 transition"
                        >
                          Save
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      {/* Days Selector */}
                      <div>
                        <label className="text-sm font-medium text-gray-600 block mb-1">
                          Repeat on
                        </label>
                        <div className="flex gap-1">
                          {availableDays.map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => toggleDayLocal(d)}
                              disabled={inPast}
                              className={`w-8 h-8 rounded-full text-xs font-bold transition flex items-center justify-center ${
                                currentDays.includes(d)
                                  ? "bg-violet-500 text-white shadow"
                                  : "bg-violet-100 text-violet-500 hover:bg-violet-200"
                              }`}
                            >
                              {d[0]}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Time Input */}
                      <div>
                        <label className="text-sm font-medium text-gray-600 block mb-1">
                          Time
                        </label>
                        <input
                          type="time"
                          value={currentTime}
                          onChange={(e) =>
                            handleLocalChange(
                              ev.routineId,
                              "startTime",
                              e.target.value
                            )
                          }
                          disabled={inPast}
                          className="p-1 border rounded-lg text-sm"
                        />
                      </div>

                      {/* Color Picker */}
                      <div>
                        <label className="text-sm font-medium text-gray-600 block mb-1">
                          Color
                        </label>
                        <div className="flex gap-1">
                          {["violet", "green", "rose", "amber"].map((c) => (
                            <button
                              key={c}
                              onClick={() =>
                                handleLocalChange(ev.routineId, "color", c)
                              }
                              disabled={inPast}
                              className={`w-5 h-5 rounded-full border-2 border-transparent hover:border-violet-700 transition ${
                                c === "violet"
                                  ? "bg-violet-500"
                                  : c === "green"
                                  ? "bg-green-400"
                                  : c === "rose"
                                  ? "bg-rose-400"
                                  : "bg-amber-400"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Status area: below the Save button area */}
                    <div className="flex items-center gap-3 justify-end">
                      {/* If past - show status readonly */}
                      {inPast ? (
                        <div className="text-sm text-gray-500">Status: <span className="font-semibold">{status}</span></div>
                      ) : (
                        <>
                          {/* upcoming -> show small pill; if time arrived show Completed/Skipped buttons */}
                          {status === "upcoming" && !hasStartedTime && <div className="text-sm text-gray-500">Status: <span className="font-semibold">upcoming</span></div>}
                          {status === "in-progress" && <div className="text-sm text-gray-500">Status: <span className="font-semibold">in-progress</span></div>}
                          {status === "completed" && <div className="text-sm text-green-600 font-semibold">Status: completed</div>}
                          {status === "skipped" && <div className="text-sm text-red-600 font-semibold">Status: skipped</div>}

                          {/* If start time has arrived (or user marks started) display action buttons */}
                          {hasStartedTime && status !== "completed" && status !== "skipped" && (
                            <div className="flex flex-col gap-2">
                              <button onClick={() => { setEventStatus(ev.routineId, dateIso, "completed"); handleNotificationAction({ routineId: ev.routineId, dateIso, action: "confirmCompleted" }); }} className="px-3 py-1 rounded bg-green-500 text-white">Completed</button>
                              <button onClick={() => { setEventStatus(ev.routineId, dateIso, "skipped"); handleNotificationAction({ routineId: ev.routineId, dateIso, action: "skipped" }); }} className="px-3 py-1 rounded bg-red-100 text-red-700 border">Skipped</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {!(calendarEventsLocal[iso(calendarDate)] || []).length && (
                <div className="text-sm text-gray-500 p-2">
                  No routines scheduled for this day.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* -----------------------
     DiaryView (keeps your improved features) - unchanged except we call generateMonthlySummaryIfMissing which now uses Gemini
     ----------------------- */
  function DiaryView() {
    const today = new Date();
    const todayMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const todayKey = iso(today);

    const [entryText, setEntryText] = useState("");
    const [showPast, setShowPast] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [grammarPreview, setGrammarPreview] = useState(null);
    const [isPreviewVisible, setIsPreviewVisible] = useState(false);
    const [diarySearchResults, setDiarySearchResults] = useState([]);
    const [highlightTerm, setHighlightTerm] = useState("");
    const [isAILoadingLocal, setIsAILoadingLocal] = useState(false);

    const thisMonthObj = diary[todayMonthKey] || {};
    const todaysEntries = (thisMonthObj && thisMonthObj[todayKey]) || [];

    const openNewEntry = () => {
      setShowPast(false);
      setSelectedDate(null);
      setEntryText("");
      setGrammarPreview(null);
      setIsPreviewVisible(false);
      setHighlightTerm("");
    };

    const handleSave = () => {
      if (!entryText.trim()) return;
      addDiaryEntry(entryText.trim());
      setEntryText("");
      setGrammarPreview(null);
      setIsPreviewVisible(false);
    };

    const handleGrammarCheck = async () => {
      if (!entryText.trim()) return alert("Write something first");
      setIsAILoadingLocal(true);
      try {
        let corrected;
        if (availableModel && availableModel()) {
          corrected = await callGeminiDiary(entryText);
        } else {
          corrected = localGrammarCorrect(entryText);
        }
        setGrammarPreview({ correctedText: corrected });
        setIsPreviewVisible(true);
      } catch (err) {
        console.error("Grammar check failed", err);
        const fallback = localGrammarCorrect(entryText);
        setGrammarPreview({ correctedText: fallback });
        setIsPreviewVisible(true);
      } finally {
        setIsAILoadingLocal(false);
      }
    };

    const acceptGrammarChanges = () => {
      if (grammarPreview?.correctedText != null) {
        setEntryText(grammarPreview.correctedText);
      }
      setIsPreviewVisible(false);
      setGrammarPreview(null);
    };

    const cancelGrammarPreview = () => {
      setIsPreviewVisible(false);
      setGrammarPreview(null);
    };

    const allDateKeys = [];
    Object.keys(diary).forEach(mk => {
      Object.keys(diary[mk]).forEach(dk => {
        if (dk === "monthlySummary") return;
        allDateKeys.push({ monthKey: mk, dayKey: dk });
      });
    });
    allDateKeys.sort((a, b) => b.dayKey.localeCompare(a.dayKey));

    const monthsMap = {};
    allDateKeys.forEach(({ monthKey, dayKey }) => {
      monthsMap[monthKey] = monthsMap[monthKey] || { days: [] };
      monthsMap[monthKey].days.push(dayKey);
    });

    useEffect(() => {
      const now = new Date();
      Object.keys(monthsMap).forEach(mk => {
        const [y, m] = mk.split("-").map(Number);
        if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) {
          generateMonthlySummaryIfMissing(mk);
        }
      });
    }, [diary]); // eslint-disable-line

    const openPastDate = (monthKey, dayKey) => {
      setSelectedDate({ monthKey, dayKey });
      setShowPast(true);
      setHighlightTerm(searchTerm.trim());
    };

    const handleBack = () => {
      if (selectedDate) {
        setSelectedDate(null);
        setHighlightTerm("");
      } else {
        setShowPast(false);
        setSearchTerm("");
        setHighlightTerm("");
      }
    };

    const runDiarySearch = (term) => {
      const t = term.trim().toLowerCase();
      setHighlightTerm(t);
      if (!t) {
        setDiarySearchResults([]);
        return;
      }

      const results = [];
      Object.keys(diary).forEach(mk => {
        const monthDisplay = new Date(`${mk}-01`).toLocaleString(undefined, { month: "long", year: "numeric" }).toLowerCase();
        Object.keys(diary[mk]).forEach(dk => {
          if (dk === "monthlySummary") return;
          const entries = diary[mk][dk] || [];
          if (dk.includes(t) || monthDisplay.includes(t)) {
            results.push({ monthKey: mk, dayKey: dk, entries });
            return;
          }
          const matching = entries.filter(e => {
            const timeStr = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
            return (e.text || "").toLowerCase().includes(t) || timeStr.includes(t);
          });
          if (matching.length) results.push({ monthKey: mk, dayKey: dk, entries: matching });
        });
      });
      setDiarySearchResults(results);
    };

    useEffect(() => {
      const handler = setTimeout(() => runDiarySearch(searchTerm), 250);
      return () => clearTimeout(handler);
    }, [searchTerm, diary]);

    const canEditDay = (dayKey) => dayKey === todayKey;
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const renderEntryTextWithHighlight = (text, term) => {
      if (!term) return text;
      const re = new RegExp(`(${escapeRegExp(term)})`, "ig");
      const parts = text.split(re);
      return parts.map((p, i) =>
        re.test(p)
          ? <span key={i} className="bg-purple-200 rounded px-1">{p}</span>
          : <span key={i}>{p}</span>
      );
    };

    const handleEditEntry = (monthKey, dayKey, entryId, newText) => {
      if (!canEditDay(dayKey)) return;
      updateDiaryEntry(monthKey, dayKey, entryId, newText);
    };

    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-4xl mx-auto flex">
          {/* Left Pane */}
          <div className="w-1/3 bg-white/80 p-4 border-r h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <div><h3 className="font-bold text-violet-700">{fmtShort(today)}</h3></div>
            </div>

            <div className="mb-3">
              <button onClick={openNewEntry} className="w-full py-2 rounded bg-violet-500 text-white mb-2">New entry</button>
              <div className="flex gap-2">
                <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search date / month / text / time" className="flex-1 p-2 border rounded" />
                <button onClick={() => { setShowPast(s => !s); setSelectedDate(null); }} className="px-3 py-2 rounded bg-gray-100">{showPast ? "Back" : "Past Entries"}</button>
              </div>
            </div>

            {!showPast && (
              <div className="space-y-2">
                {todaysEntries.map(e => (
                  <div key={e.id} className="p-3 bg-white rounded shadow group relative cursor-pointer" onClick={() => { setSelectedDate({ monthKey: todayMonthKey, dayKey: todayKey }); }}>
                    <div className="text-sm">{renderEntryTextWithHighlight(e.text, highlightTerm)}</div>
                    <div className="text-xs text-gray-400 mt-1">{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100">
                      <button onClick={(ev) => { ev.stopPropagation(); if (confirm("Delete entry?")) deleteDiaryEntry(todayMonthKey, todayKey, e.id); }} className="text-red-500">Delete</button>
                    </div>
                  </div>
                ))}
                {!todaysEntries.length && <div className="text-sm text-gray-500">No entries for today yet.</div>}
              </div>
            )}

            {showPast && (
              <div className="space-y-3">
                {searchTerm ? (
                  diarySearchResults.length ? diarySearchResults.map(r => (
                    <div key={`${r.monthKey}-${r.dayKey}`} className="p-3 bg-white rounded shadow flex justify-between items-center">
                      <div>
                        <div className="font-medium">{new Date(r.dayKey).toLocaleDateString()}</div>
                        <div className="text-xs text-gray-500">{r.monthKey}</div>
                      </div>
                      <button onClick={() => openPastDate(r.monthKey, r.dayKey)} className="px-3 py-2 rounded bg-violet-500 text-white">Open</button>
                    </div>
                  )) : <div className="text-sm text-gray-500">No results</div>
                ) : (
                  Object.keys(monthsMap).length ? Object.keys(monthsMap).map(mk => (
                    <div key={mk} className="bg-white p-3 rounded shadow">
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <div className="font-semibold">{new Date(`${mk}-01`).toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
                          <div className="text-xs text-gray-500">{mk}</div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {(monthsMap[mk].days || []).map(dayKey => (
                          <div key={dayKey} className="flex justify-between items-center p-2 border rounded hover:bg-gray-50">
                            <div>
                              <div className="font-medium">{new Date(dayKey).toLocaleDateString()}</div>
                              <div className="text-xs text-gray-500">{(diary[mk][dayKey] || []).length} entries</div>
                            </div>
                            <button onClick={() => openPastDate(mk, dayKey)} className="px-3 py-1 rounded bg-violet-500 text-white">Open</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )) : <div className="text-sm text-gray-500">No past entries yet.</div>
                )}
              </div>
            )}
          </div>

          {/* Right Pane */}
          <div className="flex-1 p-6 h-[80vh] overflow-auto">
            {!selectedDate && (
              <>
                <h2 className="text-2xl font-bold text-violet-700 mb-1">{fmtShort(today)}</h2>
                <p className="text-sm text-gray-500 mb-4">What's on your mind?</p>
                <textarea value={entryText} onChange={e => setEntryText(e.target.value)} className="w-full h-64 p-4 border rounded-lg resize-none" />

                {/* Grammar correction preview panel (integrated) */}
                {isPreviewVisible && grammarPreview && (
                  <div className="mt-4 bg-white border rounded p-4 shadow">
                    <div className="font-semibold mb-2">Grammar correction preview</div>
                    <div className="whitespace-pre-wrap text-sm p-2 border rounded bg-gray-50" style={{ minHeight: 80 }}>{grammarPreview.correctedText}</div>
                    <div className="flex gap-3 mt-3">
                      <button onClick={acceptGrammarChanges} className="flex-1 py-2 rounded-lg bg-violet-500 text-white font-bold">Accept Changes</button>
                      <button onClick={cancelGrammarPreview} className="flex-1 py-2 rounded-lg border">Back</button>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 mt-4">
                  <button onClick={handleGrammarCheck} className="flex-1 py-2 rounded-lg bg-blue-100 text-blue-800 font-semibold">{isAILoadingLocal ? "..." : "Correct Grammar"}</button>
                  <button onClick={handleSave} className="flex-1 py-2 rounded-lg bg-violet-500 text-white font-bold">Save Entry</button>
                </div>
              </>
            )}

            {selectedDate && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <button onClick={handleBack} className="px-3 py-2 rounded bg-gray-100">Back</button>
                  <h3 className="text-lg font-semibold">{new Date(selectedDate.dayKey).toLocaleDateString()}</h3>
                </div>

                <div className="bg-white p-4 rounded shadow mb-3">
                  <div className="font-bold">Summary (auto)</div>
                  <div className="text-sm text-gray-600 mt-2">
                    {diary[selectedDate.monthKey]?.monthlySummary || "[Monthly/daily summary will appear here]"}
                  </div>
                </div>

                <div className="space-y-2">
                  {(diary[selectedDate.monthKey]?.[selectedDate.dayKey] || []).map(e => (
                    <div key={e.id} className="bg-white p-3 rounded shadow">
                      <div className="text-sm">
                        {canEditDay(selectedDate.dayKey) ? (
                          <EditableEntry
                            initialText={e.text}
                            onSave={(newText) => handleEditEntry(selectedDate.monthKey, selectedDate.dayKey, e.id, newText)}
                            highlight={highlightTerm}
                          />
                        ) : (
                          <div>{renderEntryTextWithHighlight(e.text, highlightTerm)}</div>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  function EditableEntry({ initialText, onSave, highlight }) {
    const [text, setText] = useState(initialText || "");
    useEffect(() => setText(initialText || ""), [initialText]);

    const save = () => {
      if (!text.trim()) return;
      onSave(text.trim());
    };

    return (
      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full p-2 border rounded resize-none"
          rows={3}
        />
        <div className="flex gap-2 mt-2">
          <button onClick={save} className="px-3 py-1 rounded bg-violet-500 text-white">Save</button>
        </div>
      </div>
    );
  }

  function SettingsPanel() {
    const [form, setForm] = useState(settings);
    const saveSettings = () => {
      setSettings(form);
      // update personalization profile
      buildAndPersistProfileSummary(form);
      setCurrentView("explore");
    };
    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white p-6 rounded-xl shadow">
            <h2 className="text-2xl font-bold text-violet-700 mb-3">Aeryth Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="font-semibold">Aeryth's Tone</label>
                <select value={form.aerythTone} onChange={e=>setForm({...form, aerythTone: e.target.value})} className="w-full mt-1 p-3 border rounded-lg">
                  <option>Friendly</option>
                  <option>Tough Love Coach</option>
                  <option>Gentle Assistant</option>
                  <option>Hyper-Logical Analyst</option>
                </select>
              </div>
              <div>
                <label className="font-semibold">About You</label>
                <textarea value={form.userInfo} onChange={e=>setForm({...form, userInfo: e.target.value})} className="w-full mt-1 p-3 border rounded-lg" rows={3} />
              </div>
              <div>
                <label className="font-semibold">Routine criteria</label>
                <input value={form.routineCriteria} onChange={e=>setForm({...form, routineCriteria: e.target.value})} className="w-full mt-1 p-3 border rounded-lg" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={saveSettings} className="bg-violet-500 text-white py-2 px-4 rounded font-bold">Save</button>
              <button onClick={() => setForm(settings)} className="py-2 px-4 rounded border">Reset</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* -----------------------
     Personalization helper - create a compact profile summary for Aeryth and persist
     - When profile becomes too large, summarise it (here we do a simple screenshot; later you can call Gemini to summarize)
     ----------------------- */
  const buildAndPersistProfileSummary = async (explicitForm = null) => {
    try {
      const form = explicitForm || settings;
      // basic profile content
      const base = {
        tone: form?.aerythTone,
        userInfo: form?.userInfo,
        routineCriteria: form?.routineCriteria,
        recentGoals: routines.slice(0, 10).map(r => ({ name: r.name, desc: r.description })),
        diarySamples: Object.keys(diary).slice(-3).flatMap(k => Object.keys(diary[k] || {}).slice(0,3).flatMap(d => (diary[k][d]||[]).map(e => e.text))).slice(0,20),
      };
      // If large, condense using local heuristics or Gemini if available
      let summary = JSON.stringify(base);
      if (summary.length > 1500 && availableModel && availableModel()) {
        // ask Gemini to summarize the profile into 500 chars
        try {
          const prompt = `You are Aeryth. Summarize the following user profile into a short persona (max 400 chars) that will be used as an initial personalization prompt:\n\n${summary}`;
          const s = await callGeminiTemp("profile-summarizer", [{ role: "user", text: prompt }], settings, routines);
          summary = String(s).slice(0, 500);
        } catch (e) {
          summary = summary.slice(0, 500);
        }
      } else {
        summary = summary.slice(0, 500);
      }
      setProfileSummary(summary);
    } catch (e) {
      console.error("buildAndPersistProfileSummary failed", e);
    }
  };

  /* -----------------------
     ExploreView (unchanged)
     ----------------------- */
  function ExploreView() {
    const [input, setInput] = useState("");
    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-4xl mx-auto flex flex-col h-full">
          <div className="mb-2 text-center text-gray-500 italic">Aeryth's Tone: <span className="font-semibold text-violet-600">{settings.aerythTone}</span></div>

          <div className="flex-1 overflow-auto space-y-4 pb-6">
            {exploreBuffer.map(m => (
              <div key={m.id} className={`${m.role==="user" ? "flex justify-end" : "flex justify-start"}`}>
                <div className={`${m.role==="user" ? "bg-violet-500 text-white" : m.role==="aeryth" ? "bg-white text-gray-800 border" : "bg-red-50 text-red-600"} inline-block px-4 py-2 rounded-2xl shadow`}>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                </div>
              </div>
            ))}

            {isAILoading && <div className="text-gray-500">Aeryth is thinking...</div>}
            <div ref={chatEndRef} />
          </div>

          <div className="pt-4 border-t bg-white p-4">
            <TopPills view={currentView} setView={setCurrentView} />
            <form onSubmit={(e)=>{ e.preventDefault(); const v = input.trim(); if (!v) return; handleExploreSend(v); setInput(""); }} className="flex space-x-3">
              <input value={input} onChange={(e)=>setInput(e.target.value)} placeholder={isAILoading ? "Waiting..." : "Start exploring a new task..."} className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-violet-400" />
              <button type="submit" className="px-6 py-3 rounded-xl font-bold bg-violet-500 text-white hover:bg-violet-600">Send</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  /* Sidebar (unchanged layout) */
  function Sidebar() {
    const [searchRoutines, setSearchRoutines] = useState("");

    const filteredRoutines = routines.filter(r => r.name?.toLowerCase().includes(searchRoutines.trim().toLowerCase()));

    return (
      <div className="w-80 h-full p-4 flex flex-col bg-white border-l">
        <div className="flex items-center justify-between mb-4 pt-1">
          <div>
            <h3 className="text-2xl font-extrabold text-violet-600">Routines</h3>
            <p className="text-sm text-gray-500">Your daily rhythm</p>
          </div>

          <div className="flex items-center gap-2">
            <SidebarToggle inside />
          </div>
        </div>
        <button onClick={handleNewChat} className="w-full mb-2 py-2 rounded-lg bg-violet-500 text-white font-bold">+ New Chat</button>
        <button onClick={() => setCurrentView("setGoal")} className="w-full mb-2 py-2 rounded-lg bg-violet-500 text-white font-bold">+ New Routine</button>

        <input value={searchRoutines} onChange={(e) => setSearchRoutines(e.target.value)} placeholder="Search routines..." className="w-full p-2 border rounded-xl mb-3" />

        <div className="mb-4 flex flex-col gap-2">

          {filteredRoutines.length > 0 && (() => {
            const upcoming = filteredRoutines
              .map(r => {
                const daysMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
                const d = new Date();
                const wd = d.getUTCDay();
                if (r.days && r.days.some(dd => daysMap[dd] === wd)) return r;
                return null;
              })
              .filter(Boolean);
            if (!upcoming.length) return null;

              return <div>
                <h4 className="text-sm font-semibold text-gray-800">Upcoming...</h4>
                <div className="mt-1 space-y-2">
                  {upcoming.length ? upcoming.slice(0,1).map(r => (
                    <div key={r.id} className="p-2 bg-violet-50 rounded-xl border-l-2 border-violet-400">
                      <div className="font-bold text-violet-800 truncate">{r.name}</div>
                      <div className="text-xs text-violet-600 mt-1">At {r.startTime}</div>
                    </div>
                  )) : <p className="text-sm text-gray-500 italic mt-2">No routines</p>}
                </div>
              </div>


          })()}
        </div>
        <h4 className="text-sm font-bold text-gray-800 w-full ">Routines:</h4>
        <div className="flex-1 overflow-auto space-y-3">
          <div>
            <div className="mt-2 space-y-2 w-full">
              {filteredRoutines.length ? filteredRoutines.map(r => <RoutineStrip key={r.id} r={r} />) : <div className="text-sm text-gray-500">No routines yet</div>}
            </div>
          </div>
        </div>

        <div className="pt-2 border-t mt-3 space-y-1">
          <button onClick={() => setCurrentView("calendar")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "calendar" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">🗓️</span>Calendar</button>
          <button onClick={() => setCurrentView("diary")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "diary" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">✍️</span>Diary</button>
          <button onClick={() => setCurrentView("settings")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "settings" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">⚙️</span>Settings</button>
        </div>
      </div>
    );
  }

  const FloatingToggle = () => (
    <div className="fixed right-4 top-6 z-50">
      <SidebarToggle />
    </div>
  );

  /* Layout */
  return (
    <div className="flex h-screen w-full font-sans bg-gradient-to-br from-violet-50 to-fuchsia-50 antialiased">
      <div className={`flex-1 min-w-0 transition-all duration-300 ${isSidebarOpen ? "lg:w-[calc(100%-20rem)]" : "w-full"}`}>
        <MainPanel />
      </div>

      <div className={`transition-all duration-300 ${isSidebarOpen ? "w-80" : "w-0"} flex-shrink-0 overflow-hidden`}>
        {isSidebarOpen && <div className="w-80 h-full"><Sidebar /></div>}
      </div>

      {!isSidebarOpen && <FloatingToggle />}
    </div>
  );
}
