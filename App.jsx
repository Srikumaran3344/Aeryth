// src/App.jsx
import React, { useEffect, useRef, useState } from "react";

/* ===========================
   LocalStorage helpers
   =========================== */
const reviverDate = (key, value) => {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return new Date(value);
  }
  return value;
};
const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw, reviverDate) : fallback;
  } catch (e) {
    console.error("localStorage load error", e);
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("localStorage save error", e);
  }
};

/* ===========================
   Gemini Nano wrappers
   - Uses window.LanguageModel.create()
   =========================== */
let sessions = {}; // in-memory sessions per routine/chat

const ensureModelAvailable = () =>
  !!(window && window.LanguageModel && window.LanguageModel.create);

async function ensureSession(id, systemPrompt) {
  if (!ensureModelAvailable()) throw new Error("Gemini Nano not available.");
  if (!sessions[id]) {
    sessions[id] = await window.LanguageModel.create({
      initialPrompts: [{ role: "system", content: systemPrompt }],
    });
  }
  return sessions[id];
}

async function callGemini(chatId, chatHistory, userSettings = {}, routines = []) {
  // last message is user's
  const lastMsg = chatHistory.at(-1)?.text || "";
  const system = `You are Aeryth, a personalized AI companion focused on preventing procrastination. Use user context implicitly. End every response with an action-oriented question or command.

User info: ${userSettings?.userInfo || "None"}
Tone: ${userSettings?.aerythTone || "Friendly"}
Active goals: ${
    routines.filter((r) => r.chatId === chatId).map((r) => r.goal).join("; ") ||
    "None"
  }
Conversation length: ${chatHistory.length} turns.`;
  const session = await ensureSession(chatId, system);
  const result = await session.prompt(lastMsg);
  return result?.output ?? result;
}

async function callGeminiDiary(text, task) {
  if (!ensureModelAvailable()) throw new Error("Gemini Nano not available.");
  const systemPrompt =
    task === "summarize"
      ? "Summarize the following diary entry into a concise reflective paragraph focusing on emotions and events."
      : task === "correct_grammar"
      ? "Correct grammar and spelling. Output only corrected text."
      : null;
  if (!systemPrompt) throw new Error("invalid diary task");
  const temp = await window.LanguageModel.create({
    initialPrompts: [{ role: "system", content: systemPrompt }],
  });
  try {
    const res = await temp.prompt(text);
    return res?.output ?? res;
  } finally {
    temp.destroy?.();
  }
}

/* ===========================
   Utility date helpers
   =========================== */
const formatShort = (d) =>
  d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" }); // e.g., 11 Oct 25
const dateKey = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/* ===========================
   App component
   =========================== */
export default function App() {
  // persisted state
  const [userId] = useState(() => load("aeryth_userId", crypto.randomUUID()));
  useEffect(() => save("aeryth_userId", userId), [userId]);

  const [settings, setSettings] = useState(() =>
    load("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" })
  );
  useEffect(() => save("aeryth_settings", settings), [settings]);

  // Routines are persisted. Each routine:
  // { id, name, goal, startTime, endTime, days:[Mon..], color, createdAt }
  const [routines, setRoutines] = useState(() =>
    load("aeryth_routines", [])
  );
  useEffect(() => save("aeryth_routines", routines), [routines]);

  // Sticky notes stored mapping: { [routineId]: { [dateKey]: { text, color } } }
  const [stickyStore, setStickyStore] = useState(() =>
    load("aeryth_sticky", {})
  );
  useEffect(() => save("aeryth_sticky", stickyStore), [stickyStore]);

  // Diary entries persisted: array of { id, originalText, finalText, createdAt, timestamp }
  const [diaryEntries, setDiaryEntries] = useState(() =>
    load("aeryth_diary_entries", [])
  );
  useEffect(() => save("aeryth_diary_entries", diaryEntries), [diaryEntries]);

  // temporary explore chat messages (not persisted)
  const [exploreMessages, setExploreMessages] = useState([]);
  // messagesStore used previously removed. Messages for routines not needed.

  /* UI state */
  const [currentRoutineId, setCurrentRoutineId] = useState(() => (routines[0]?.id ?? null));
  const [currentView, setCurrentView] = useState("explore"); // explore, setGoal, diary, calendar, settings
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAILoading, setIsAILoading] = useState(false);
  const [pendingTrackingStyle, setPendingTrackingStyle] = useState(null);

  // calendar nav: -1 prev, 0 current, 1 next
  const [calendarOffset, setCalendarOffset] = useState(0);

  // diary view navigation
  const [diaryMode, setDiaryMode] = useState("today"); // today, pastDatesList, dateView
  const [diarySelectedDate, setDiarySelectedDate] = useState(null);
  const [diarySearch, setDiarySearch] = useState("");

  // temporary AI grammar state
  const [grammarProcessing, setGrammarProcessing] = useState(false);
  const [grammarOutput, setGrammarOutput] = useState("");

  // UI helpers
  const chatEndRef = useRef(null);
  useEffect(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, [exploreMessages, isAILoading]);

  /* ===========================
     On load cleanup: rotate/delete sticky notes older than yesterday
     =========================== */
  useEffect(() => {
    const today = dateKey(new Date());
    const yesterday = dateKey(addDays(new Date(), -1));
    // Cleanup: remove sticky entries older than yesterday
    const clone = { ...stickyStore };
    let changed = false;
    Object.keys(clone).forEach((rid) => {
      const entries = clone[rid];
      Object.keys(entries).forEach((dk) => {
        if (dk < yesterday) {
          delete entries[dk];
          changed = true;
        }
      });
      // if object is empty leave it (no problem)
    });
    if (changed) setStickyStore(clone);
    // prune routines with no sticky? not necessary
    // ensure calendarOffset within [-1,1]
    setCalendarOffset((n) => Math.max(-1, Math.min(1, n)));
  }, []); // run on mount

  /* ===========================
     Helper functions
     =========================== */
  const updateRoutines = (cb) => setRoutines((prev) => {
    const next = cb(prev.slice());
    save("aeryth_routines", next);
    return next;
  });

  const updateSticky = (routineId, dateStr, patch) => {
    setStickyStore(prev => {
      const next = { ...prev };
      next[routineId] = next[routineId] ? { ...next[routineId] } : {};
      next[routineId][dateStr] = { ...(next[routineId][dateStr] || { text: "", color: "#8b5cf6" }), ...patch };
      save("aeryth_sticky", next);
      return next;
    });
  };

  /* ===========================
     Explore (temporary chat) functions
     =========================== */
  const pushExploreMessage = (m) => setExploreMessages(prev => [...prev, { id: crypto.randomUUID(), ...m }]);

  const handleNewChat = () => {
    // Resets the temporary explore chat
    setExploreMessages([]);
    setCurrentView("explore");
    // keep currentRoutineId unchanged
  };

  const handleSendExplore = async (text) => {
    if (!text?.trim() || isAILoading) return;
    const userMsg = { sender: "user", text: text.trim(), timestamp: new Date() };
    pushExploreMessage(userMsg);

    const up = text.trim().toUpperCase();
    if (up === "EVIDENCE" || up === "REMINDER") {
      setPendingTrackingStyle(up.toLowerCase());
      pushExploreMessage({ sender: "aeryth", text: "Perfect. I've noted your preference. Now use Set Goal and fill details.", timestamp: new Date() });
      return;
    }

    if (!ensureModelAvailable()) {
      pushExploreMessage({ sender: "aeryth", text: "Local Gemini Nano not available in this browser.", timestamp: new Date() });
      return;
    }

    setIsAILoading(true);
    try {
      const chatHistory = [...exploreMessages, userMsg];
      const aiText = await callGemini("explore-temp", chatHistory, settings, routines);
      pushExploreMessage({ sender: "aeryth", text: aiText ?? "No output", timestamp: new Date() });
    } catch (e) {
      console.error("AI failed", e);
      pushExploreMessage({ sender: "system", text: "Aeryth encountered an AI error.", timestamp: new Date() });
    } finally {
      setIsAILoading(false);
    }
  };

  /* ===========================
     Set Goal (Routine) functions
     =========================== */
  const handleCreateRoutine = ({ name, goal, startTime, endTime, days, color }) => {
    const id = crypto.randomUUID();
    const r = { id, name, goal, startTime, endTime, days, color: color || "#8b5cf6", createdAt: new Date() };
    updateRoutines(prev => [r, ...prev]);
    // initialize stickyStore entries for prev/today/next
    const today = dateKey(new Date());
    const prevDay = dateKey(addDays(new Date(), -1));
    const nextDay = dateKey(addDays(new Date(), 1));
    setStickyStore(prev => {
      const next = { ...(prev || {}) };
      next[id] = next[id] || {};
      next[id][prevDay] = next[id][prevDay] || { text: "", color: r.color };
      next[id][today] = next[id][today] || { text: "", color: r.color };
      next[id][nextDay] = next[id][nextDay] || { text: "", color: r.color };
      save("aeryth_sticky", next);
      return next;
    });

    setCurrentRoutineId(id);
    setCurrentView("explore");
  };

  const handleDeleteRoutine = (id) => {
    if (!confirm("Delete routine and its sticky notes?")) return;
    updateRoutines(prev => prev.filter(r => r.id !== id));
    setStickyStore(prev => {
      const next = { ...prev };
      delete next[id];
      save("aeryth_sticky", next);
      return next;
    });
    if (currentRoutineId === id) setCurrentRoutineId(routines[0]?.id ?? null);
  };

  const handleRenameRoutine = (id, newName) => {
    updateRoutines(prev => prev.map(r => (r.id === id ? { ...r, name: newName } : r)));
  };

  /* ===========================
     Calendar functions
     - limited to previous, current, next month
     - routines are shown on days matching their day-of-week membership
     =========================== */
  const getMonthMatrix = (year, month) => {
    // returns array of weeks, each week array of 7 Date objects (or null)
    const first = new Date(year, month, 1);
    const startDay = first.getDay(); // 0 Sun .. 6 Sat
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks = [];
    let cur = 1 - startDay;
    while (cur <= daysInMonth) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        if (cur < 1 || cur > daysInMonth) week.push(null);
        else week.push(new Date(year, month, cur));
        cur++;
      }
      weeks.push(week);
      if (weeks.length > 6) break;
    }
    return weeks;
  };

  const routinesForDate = (date) => {
    if (!date) return [];
    // match by day name
    const dayName = date.toLocaleDateString(undefined, { weekday: "short" }); // Mon, Tue
    return routines.filter((r) => r.days?.includes(dayName));
  };

  const handleCalendarDayClick = (date) => {
    // open day view: show routines for that date
    setCurrentView("calendar");
    setCalendarOffset((off) => off); // keep current month
    // We'll open a modal-like dayPanel inside calendar component (done in JSX)
    // Use state to store selected day
    setCalendarSelectedDate(dateKey(date));
  };

  const [calendarSelectedDate, setCalendarSelectedDate] = useState(null);
  const changeRoutineColor = (rid, newColor) => {
    updateRoutines(prev => prev.map(r => r.id === rid ? { ...r, color: newColor } : r));
    // also update sticky default colors for future sticky notes
    setStickyStore(prev => {
      const next = { ...prev };
      next[rid] = next[rid] ? { ...next[rid] } : {};
      // do not overwrite existing sticky text, only default color for today if exists
      Object.keys(next[rid] || {}).forEach(k => {
        next[rid][k] = { ...next[rid][k], color: newColor };
      });
      save("aeryth_sticky", next);
      return next;
    });
  };

  const changeRoutineTime = (rid, newStart, newEnd) => {
    updateRoutines(prev => prev.map(r => r.id === rid ? { ...r, startTime: newStart, endTime: newEnd } : r));
  };

  /* ===========================
     Diary features
     - structured per day and month
     =========================== */
  const diaryTodayKey = dateKey(new Date());
  const diaryEntriesByDate = diaryEntries.reduce((acc, e) => {
    const k = dateKey(new Date(e.createdAt));
    acc[k] = acc[k] || [];
    acc[k].push(e);
    return acc;
  }, {});

  // returns daily summary placeholder (replace with summarizer API later)
  const getDailySummary = (dateK) => {
    // currently produce a simple concat summary or placeholder
    const entries = diaryEntriesByDate[dateK] || [];
    if (!entries.length) return null;
    return `Summary (${entries.length} entries) — ${entries[0].finalText.slice(0, 60)}${entries[0].finalText.length > 60 ? "..." : ""}`;
  };

  const handleDiaryGrammar = async (text) => {
    if (!text?.trim()) return;
    setGrammarProcessing(true);
    setGrammarOutput("");
    try {
      const out = await callGeminiDiary(text, "correct_grammar").catch(() => null);
      setGrammarOutput(out || "");
    } catch (e) {
      console.error("grammar api", e);
      setGrammarOutput("");
    } finally {
      setGrammarProcessing(false);
    }
  };

  const handleDiarySave = (originalText, finalText) => {
    const doc = { id: crypto.randomUUID(), originalText, finalText, createdAt: new Date(), timestamp: new Date().toISOString() };
    setDiaryEntries(prev => {
      const next = [doc, ...prev];
      save("aeryth_diary_entries", next);
      return next;
    });
  };

  const handleDeleteDiaryEntry = (id) => {
    setDiaryEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      save("aeryth_diary_entries", next);
      return next;
    });
  };

  /* ===========================
     TopPills component — use your exact code with one change for Explore active text color
     =========================== */
  const TopPills = ({ view, setView }) => (
    <div className="flex-1 flex justify-around mb-3 gap-10">
      <button
        onClick={() => setView("explore")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "explore" ? "bg-violet-500 text-black" : "bg-gray-100 hover:bg-violet-100"}`}
      >
        Explore
      </button>

      <button
        onClick={() => setView("setGoal")}
        className={`flex-1 px-4 py-2 rounded-full text-sm font-semibold transition shadow-md ${view === "setGoal" ? "bg-violet-500 text-white" : "bg-gray-100 hover:bg-violet-100"}`}
      >
        Set Goal
      </button>

      <button
        onClick={() => setView("diary")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "diary" ? "bg-violet-500 text-white" : "bg-gray-100 hover:bg-violet-100"}`}
      >
        Diary
      </button>
    </div>
  );

  /* ===========================
     Small components and UI elements
     =========================== */
  const IconMenu = ({ onClick }) => (
    <button onClick={onClick} className="p-2 rounded-full bg-violet-500 text-white hover:bg-violet-600">
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
  );

  /* ===========================
     StickyNote component
     - editable textarea
     - color picker 4 colors
     - saving live to localStorage
     =========================== */
  function StickyNote({ routineId, dateStr, readOnly }) {
    const note = (stickyStore[routineId] && stickyStore[routineId][dateStr]) || { text: "", color: "#8b5cf6" };
    const [text, setText] = useState(note.text || "");
    const [color, setColor] = useState(note.color || "#8b5cf6");

    useEffect(() => {
      // when external stickyStore updated, sync
      const n = (stickyStore[routineId] && stickyStore[routineId][dateStr]) || { text: "", color: "#8b5cf6" };
      setText(n.text || "");
      setColor(n.color || "#8b5cf6");
    }, [routineId, dateStr, stickyStore]);

    // live save with debounce
    useEffect(() => {
      const id = setTimeout(() => {
        updateSticky(routineId, dateStr, { text, color });
      }, 250);
      return () => clearTimeout(id);
    }, [text, color, routineId, dateStr]);

    const colorOptions = ["#8b5cf6", "#06b6d4", "#f97316", "#ef4444"]; // violet, teal, orange, red

    return (
      <div className="rounded-md p-3 shadow-md" style={{ backgroundColor: "#fff", width: "100%" }}>
        <div className="flex justify-between items-start mb-2">
          <div className="font-semibold text-violet-700">Notes</div>
          <div className="flex items-center space-x-2">
            {colorOptions.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={`w-5 h-5 rounded-full border ${c === color ? "ring-2 ring-offset-1 ring-violet-300" : ""}`}
                title="Change color"
              />
            ))}
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!readOnly}
          placeholder={readOnly ? "Read-only (previous day)" : "Type your sticky note here..."}
          className={`w-full min-h-[120px] p-3 rounded-md resize-none border ${readOnly ? "bg-gray-50 text-gray-600" : "bg-white"} `}
          style={{ borderColor: color }}
        />
      </div>
    );
  }

  /* ===========================
     Sidebar component (Routines)
     - Toggle button inside when open (top-left)
     - When closed, a fixed toggle top-right of main panel
     =========================== */
  function Sidebar() {
    const now = new Date();
    const eightHours = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const upcoming = routines.slice(0, 3); // simple

    return (
      <div className="w-80 h-full p-4 flex flex-col bg-white">
        <div className="flex items-center justify-between mb-4 pt-6">
          <div>
            <h3 className="text-2xl font-extrabold text-violet-600">Aeryth</h3>
            <p className="text-sm text-gray-500">Rhythm Partner</p>
          </div>
          {/* toggle inside sidebar */}
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 rounded-full bg-violet-500 text-white hover:bg-violet-600">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* New Chat above New Routine */}
        <div className="mb-3 space-y-2">
          <button onClick={handleNewChat} className="w-full py-3 rounded-lg bg-violet-500 text-white font-bold">+ New Chat</button>
          <button onClick={() => setCurrentView("setGoal")} className="w-full py-3 rounded-lg bg-violet-500 text-white font-bold">+ New Routine</button>
        </div>

        <input placeholder="Search routines..." className="w-full p-3 border rounded-xl mb-3" disabled />


        <div className="pt-4 border-t mt-4 space-y-2">
          <button onClick={() => { setCurrentView("calendar"); setCalendarOffset(0); }} className={`flex items-center w-full p-3 rounded-xl ${currentView === "calendar" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">🗓️</span>Calendar</button>
          <button onClick={() => setCurrentView("diary")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "diary" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">✍️</span>Diary</button>
          <button onClick={() => setCurrentView("settings")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "settings" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">⚙️</span>Settings</button>
        </div>
      </div>
    );
  }

  /* RoutineStrip component with inline 3-dot menu (rename/delete) */
  function RoutineStrip({ r }) {
    const [openMenu, setOpenMenu] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [tempName, setTempName] = useState(r.name);

    useEffect(() => setTempName(r.name), [r.name]);

    return (
      <div className={`flex items-center p-3 rounded-xl ${currentRoutineId === r.id ? "bg-violet-100" : "hover:bg-gray-100"}`}>
        <button onClick={() => { setCurrentRoutineId(r.id); setCurrentView("explore"); }} className="flex-1 text-left font-medium">{renaming ? (
          <input value={tempName} onChange={(e) => setTempName(e.target.value)} onBlur={() => { handleRenameRoutine(r.id, tempName); setRenaming(false); }} className="w-full p-1 border-b" />
        ) : tempName}</button>

        <div className="relative">
          <button onClick={() => setOpenMenu(s => !s)} className="p-1 text-gray-500 hover:text-gray-800">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>

          {openMenu && (
            <div className="absolute right-0 top-6 bg-white rounded-md shadow-lg py-1 w-36 z-40">
              <button onClick={() => { setRenaming(true); setOpenMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50">Rename</button>
              <button onClick={() => { setOpenMenu(false); handleDeleteRoutine(r.id); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600">Delete</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ===========================
     MainPanel content
     =========================== */
  function MainPanel() {
    return (
      <div className="flex-1 h-full p-6 overflow-hidden flex flex-col">
        <TopPills view={currentView} setView={setCurrentView} />

        {currentView === "explore" && (
          <ExploreView />
        )}

        {currentView === "setGoal" && (
          <SetGoalView onCreate={handleCreateRoutine} pendingTrackingStyle={pendingTrackingStyle} />
        )}

        {currentView === "diary" && (
          <DiaryView />
        )}

        {currentView === "calendar" && (
          <CalendarView />
        )}

        {currentView === "settings" && (
          <div className="max-w-2xl mx-auto p-6">
            <div className="bg-white p-6 rounded-xl shadow">
              <h2 className="text-2xl font-bold text-violet-600 mb-3">Aeryth Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="font-semibold">Aeryth's Tone</label>
                  <select value={settings.aerythTone} onChange={e => { setSettings({ ...settings, aerythTone: e.target.value }); save("aeryth_settings", { ...settings, aerythTone: e.target.value }); }} className="w-full mt-1 p-3 border rounded-lg">
                    <option>Friendly</option>
                    <option>Tough Love Coach</option>
                    <option>Gentle Assistant</option>
                    <option>Hyper-Logical Analyst</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold">About You</label>
                  <textarea value={settings.userInfo} onChange={e => { setSettings({ ...settings, userInfo: e.target.value }); }} className="w-full mt-1 p-3 border rounded-lg" rows={3} />
                </div>
                <div>
                  <label className="font-semibold">Routine criteria</label>
                  <input value={settings.routineCriteria} onChange={e => { setSettings({ ...settings, routineCriteria: e.target.value }); }} className="w-full mt-1 p-3 border rounded-lg" />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { save("aeryth_settings", settings); setCurrentView("explore"); }} className="bg-violet-500 text-white py-2 px-4 rounded font-bold">Save</button>
                <button onClick={() => { /* reset local copy */ }} className="py-2 px-4 rounded border">Reset</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ===========================
     Explore View (temporary chat)
     =========================== */
  function ExploreView() {
    const [input, setInput] = useState("");
    return (
      <>
        <div className="flex-1 overflow-y-auto space-y-4 pb-6">
          <div className="text-center text-gray-500 italic mb-4">Aeryth's Tone: <span className="font-semibold text-violet-600">{settings?.aerythTone || "Friendly"}</span></div>
          {exploreMessages.map((m) => <ChatMessage key={m.id} m={m} />)}
          {isAILoading && <div className="flex justify-start"><div className="bg-white text-gray-600 px-4 py-3 rounded-2xl shadow-md flex items-center space-x-2 border"><svg className="animate-spin h-5 w-5 text-violet-500" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg><span>Aeryth is thinking...</span></div></div>}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSendExplore(input); setInput(""); }} className="pt-4 border-t bg-white p-4">
          <div className="flex space-x-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} disabled={isAILoading} placeholder={isAILoading ? "Aeryth is thinking..." : "Start exploring a new task..."} className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-violet-400" />
            <button type="submit" disabled={isAILoading || !input.trim()} className={`px-6 py-3 rounded-xl font-bold ${isAILoading || !input.trim() ? "bg-gray-400 text-white" : "bg-violet-500 text-white hover:bg-violet-600"}`}>{isAILoading ? "..." : "Send"}</button>
          </div>
        </form>
      </>
    );
  }

  const ChatMessage = ({ m }) => {
    const isUser = m.sender === "user";
    const isSystem = m.sender === "system";
    return isSystem ? (
      m.type === "goal_set" ? (
        <div className="flex justify-center my-4">
          <div className="w-full border-t border-violet-200"></div>
          <div className="text-center text-sm font-semibold text-violet-600 bg-violet-100 px-4 py-2 rounded-full mx-4 whitespace-nowrap shadow">🎯 {m.text}</div>
          <div className="w-full border-t border-violet-200"></div>
        </div>
      ) : (
        <div className="flex justify-center"><div className="text-center text-xs text-red-500 bg-red-100 p-2 rounded-lg max-w-sm shadow-md">[SYSTEM]: {m.text}</div></div>
      )
    ) : (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-xs sm:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl shadow-lg ${isUser ? "bg-violet-500 text-white rounded-br-none" : "bg-white text-gray-800 rounded-tl-none border"}`}>
          <p className="whitespace-pre-wrap">{m.text}</p>
          <span className={`block text-xs mt-1 ${isUser ? "text-violet-200" : "text-gray-400"}`}>{m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "..."}</span>
        </div>
      </div>
    );
  };

  /* ===========================
     SetGoalView — direct open to form
     - Days as rounded pills, selected => violet background
     =========================== */
  function SetGoalView({ onCreate, pendingTrackingStyle }) {
    const [name, setName] = useState("");
    const [goal, setGoal] = useState("");
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("10:00");
    const [days, setDays] = useState([]);
    const [color, setColor] = useState("#8b5cf6");
    const [isSaving, setIsSaving] = useState(false);
    const availableDays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const toggleDay = (d) => setDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev,d]);

    const handleSave = async () => {
      if (!name.trim() || !goal.trim() || days.length === 0) { alert("Fill routine name, goal and days"); return; }
      if (!pendingTrackingStyle) { alert("Tell Aeryth EVIDENCE or REMINDER in chat first."); return; }
      setIsSaving(true);
      try {
        await onCreate({ name: name.trim(), goal: goal.trim(), startTime, endTime, days, color });
        setName(""); setGoal(""); setDays([]); setColor("#8b5cf6");
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <div className="max-w-2xl w-full mx-auto">
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-2xl font-bold text-violet-600 mb-3">Create Routine</h2>
          <div className="space-y-4">
            <div>
              <label className="font-semibold">Routine name</label>
              <input value={name} onChange={e=>setName(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" placeholder="e.g., Java, Football, Math..." />
            </div>

            <div>
              <label className="font-semibold">What do you want to achieve by this routine?</label>
              <input value={goal} onChange={e=>setGoal(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" placeholder="e.g., finish chapter 3" />
            </div>

            <div className="flex space-x-3">
              <div className="flex-1">
                <label className="font-semibold">Start</label>
                <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
              </div>
              <div className="flex-1">
                <label className="font-semibold">End</label>
                <input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
              </div>
            </div>

            <div>
              <label className="font-semibold">Repeat on</label>
              <div className="flex gap-2 mt-2">
                {availableDays.map(d => (
                  <button key={d} onClick={() => toggleDay(d)} type="button"
                    className={`w-10 h-10 rounded-full font-bold transition ${days.includes(d) ? "bg-violet-500 text-white" : "bg-gray-200 text-gray-700"}`}>{d[0]}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="font-semibold">Routine color</label>
              <div className="flex gap-2 mt-2">
                {["#8b5cf6","#06b6d4","#f97316","#ef4444"].map(c => (
                  <button key={c} style={{ backgroundColor: c }} onClick={() => setColor(c)} className={`w-8 h-8 rounded-full border ${color===c ? "ring-2 ring-offset-1 ring-violet-300" : ""}`} />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={handleSave} disabled={isSaving} className={`flex-1 py-3 rounded-lg ${isSaving ? "bg-gray-400 text-white" : "bg-violet-500 text-white"} font-bold`}>{isSaving ? "Saving..." : "Create Routine"}</button>
            <button onClick={() => setCurrentView("explore")} className="py-3 px-6 rounded-lg border">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  /* ===========================
     Diary View -- with requested hierarchy
     =========================== */
  function DiaryView() {
    const todayKey = dateKey(new Date());
    const [editorText, setEditorText] = useState("");
    const [selectedEntry, setSelectedEntry] = useState(null); // viewing an entry
    const [showPastDates, setShowPastDates] = useState(false);
    const [selectedDateView, setSelectedDateView] = useState(null); // when viewing a date from past

    useEffect(() => {
      // reset editor when switching to diary today view
      if (diaryMode === "today") {
        setSelectedEntry(null);
      }
    }, [diaryMode]);

    const todaysEntries = (diaryEntries || []).filter(e => dateKey(new Date(e.createdAt)) === todayKey);

    const allDatesSorted = Object.keys(diaryEntries.reduce((acc, e) => {
      const k = dateKey(new Date(e.createdAt));
      acc[k] = true;
      return acc;
    }, {})).sort((a,b)=> (new Date(b) - new Date(a)));

    const pastDates = allDatesSorted.filter(dk => dk !== todayKey);

    const openDateView = (dk) => {
      setSelectedDateView(dk);
      setDiaryMode("dateView");
    };

    const backToDatesList = () => {
      setDiaryMode("pastDatesList");
      setSelectedDateView(null);
    };

    const backToToday = () => {
      setDiaryMode("today");
      setSelectedDateView(null);
    };

    const saveCurrentEntry = () => {
      if (!editorText.trim()) return alert("Cannot save empty entry");
      handleDiarySave(editorText, editorText);
      setEditorText("");
      alert("Saved");
    };

    return (
      <div className="h-full flex">
        {/* Left panel: dates and entries list */}
        <div className="w-1/3 bg-white/80 p-4 border-r overflow-y-auto">
          {diaryMode === "today" && (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-bold text-violet-700">{formatShort(new Date())}</h3>
                </div>
                <div className="text-sm text-violet-600">Status: Saved</div>
              </div>

              <input placeholder="Search date or entry..." value={diarySearch} onChange={e => setDiarySearch(e.target.value)} className="w-full p-2 border rounded mb-3" />

              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setDiaryMode("pastDatesList")} className="py-2 px-3 rounded bg-violet-100 text-violet-700">Past Entries</button>
              </div>

              <div className="space-y-2">
                {todaysEntries.length ? todaysEntries.map(e => (
                  <div key={e.id} className="p-3 rounded-md bg-gray-50 hover:bg-violet-50 relative group">
                    <div className="text-sm">{e.finalText}</div>
                    <div className="text-xs text-gray-500 mt-1">{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    {/* hover delete if same day and before day end */}
                    {dateKey(new Date(e.createdAt)) === todayKey && (
                      <button onClick={() => handleDeleteDiaryEntry(e.id)} className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-red-500">Delete</button>
                    )}
                  </div>
                )) : <p className="text-sm text-gray-500 italic">No entries yet today.</p>}
              </div>
            </>
          )}

          {diaryMode === "pastDatesList" && (
            <>
              <div className="flex items-center mb-3">
                <button onClick={backToToday} className="mr-3 text-violet-600">Back</button>
                <h3 className="font-bold">Past Entries</h3>
              </div>
              <div className="space-y-2">
                {pastDates.length ? pastDates.map(dk => (
                  <div key={dk} onClick={() => openDateView(dk)} className="p-3 rounded-md bg-gray-50 hover:bg-violet-50 cursor-pointer">
                    <div className="font-medium">{new Date(dk).toLocaleDateString()}</div>
                    <div className="text-xs text-gray-500 mt-1">{(diaryEntriesByDate[dk] || []).length} entries</div>
                  </div>
                )) : <p className="text-sm text-gray-500 italic">No past dates</p>}
              </div>
            </>
          )}

          {diaryMode === "dateView" && selectedDateView && (
            <>
              <div className="flex items-center mb-3">
                <button onClick={() => setDiaryMode("pastDatesList")} className="mr-3 text-violet-600">Back</button>
                <h3 className="font-bold">{new Date(selectedDateView).toLocaleDateString()}</h3>
              </div>

              <div className="space-y-2">
                <div className="p-3 bg-indigo-50 rounded">
                  <div className="font-semibold text-indigo-800">Summary</div>
                  <div className="text-sm text-indigo-900 mt-1">{getDailySummary(selectedDateView) || "No summary available."}</div>
                </div>

                {(diaryEntriesByDate[selectedDateView] || []).map(e => (
                  <div className="p-3 rounded-md bg-gray-50" key={e.id}>
                    <div className="text-sm">{e.finalText}</div>
                    <div className="text-xs text-gray-500 mt-1">{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right: editor / viewing pane */}
        <div className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <button onClick={() => setCurrentView("explore")} className="text-violet-600">Back</button>
            </div>
            <div className="text-sm text-gray-500">Diary Editor</div>
          </div>

          <h2 className="text-2xl font-bold text-violet-600 mb-1">{diaryMode === "dateView" && selectedDateView ? new Date(selectedDateView).toLocaleDateString() : (diaryMode==="today"? "New Diary Entry": "Diary")}</h2>
          <p className="text-sm text-gray-500 mb-4">{diaryMode==="today" ? "What's on your mind?" : ""}</p>

          <textarea value={editorText} onChange={(e)=>setEditorText(e.target.value)} className="w-full h-48 p-4 border rounded-lg resize-none" placeholder="Write your entry here..." disabled={grammarProcessing} />

          {/* grammar correction box */}
          <div className="mt-4 flex gap-3">
            <button onClick={() => handleDiaryGrammar(editorText)} disabled={grammarProcessing || !editorText.trim()} className={`py-2 px-4 rounded-lg ${grammarProcessing ? "bg-gray-300" : "bg-blue-100 text-blue-800"} font-semibold`}>{grammarProcessing ? "Checking..." : "Correct Grammar"}</button>
            <button onClick={saveCurrentEntry} disabled={grammarProcessing || !editorText.trim()} className={`py-2 px-4 rounded-lg ${grammarProcessing ? "bg-gray-300" : "bg-violet-500 text-white"} font-bold`}>Save Entry</button>
          </div>

          {grammarOutput && (
            <div className="mt-4 p-4 bg-blue-50 rounded border">
              <h4 className="font-bold text-blue-800">Suggested Correction</h4>
              <p className="text-blue-900 my-2 whitespace-pre-wrap">{grammarOutput}</p>
              <div className="flex gap-2">
                <button onClick={() => { setEditorText(grammarOutput); setGrammarOutput(""); }} className="text-sm text-blue-700">Accept Correction</button>
                <button onClick={() => setGrammarOutput("")} className="text-sm text-gray-600">Back</button>
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  /* ===========================
     CalendarView: three months (prev, current, next)
     - show small colored strips for routines in dates
     - clicking date shows day's routines with color/time editing
     =========================== */
  function CalendarView() {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth() + calendarOffset, 1);
    const prevMonth = new Date(now.getFullYear(), now.getMonth() + calendarOffset - 1, 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + calendarOffset + 1, 1);

    const months = [prevMonth, currentMonth, nextMonth];

    const [selectedDay, setSelectedDay] = useState(calendarSelectedDate ? new Date(calendarSelectedDate) : null);

    const withinAllowed = (off) => off >= -1 && off <= 1;

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button onClick={() => { if (withinAllowed(calendarOffset - 1)) setCalendarOffset(o => o - 1); }} className={`px-3 py-2 rounded ${calendarOffset <= -1 ? "bg-gray-200 cursor-not-allowed" : "bg-white shadow"}`}>◀</button>
            <button onClick={() => { if (withinAllowed(calendarOffset + 1)) setCalendarOffset(o => o + 1); }} className={`px-3 py-2 rounded ${calendarOffset >= 1 ? "bg-gray-200 cursor-not-allowed" : "bg-white shadow"}`}>▶</button>
          </div>
          <div className="text-sm text-gray-500">Only previous, current and next month available</div>
          <div />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {months.map((m, idx) => {
            const year = m.getFullYear();
            const month = m.getMonth();
            const weeks = getMonthMatrix(year, month);
            return (
              <div key={idx} className="bg-white p-3 rounded shadow">
                <div className="text-lg font-semibold mb-2">{m.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
                <div className="grid grid-cols-7 text-center text-xs text-gray-500">
                  {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d} className="py-1">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1 mt-2 text-sm">
                  {weeks.flat().map((d, i) => (
                    <div key={i} className={`h-20 border rounded p-1 ${d ? "bg-white" : "bg-gray-50"}`}>
                      {d ? (
                        <>
                          <div className="text-xs text-gray-600 mb-1">{d.getDate()}</div>
                          <div className="space-y-1 overflow-hidden">
                            {routinesForDate(d).slice(0,3).map(rt => (
                              <div key={rt.id} onClick={() => { setSelectedDay(d); setCalendarSelectedDate(dateKey(d)); }} className="text-xs rounded-sm px-1 py-0.5 truncate cursor-pointer" style={{ backgroundColor: rt.color, color: "#fff" }}>
                                {rt.name}
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Day panel */}
        {calendarSelectedDate && (
          <div className="mt-6 bg-white p-4 rounded shadow">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Day: {new Date(calendarSelectedDate).toLocaleDateString()}</h3>
              <button onClick={() => setCalendarSelectedDate(null)} className="text-gray-600">Close</button>
            </div>
            <div className="mt-3">
              {routinesForDate(new Date(calendarSelectedDate)).length ? routinesForDate(new Date(calendarSelectedDate)).map(r => (
                <div key={r.id} className="p-3 rounded border flex items-center justify-between mb-2">
                  <div>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-xs text-gray-500">{r.startTime} - {r.endTime}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="time" value={r.startTime} onChange={(e) => changeRoutineTime(r.id, e.target.value, r.endTime)} className="p-1 border rounded" />
                    <input type="color" value={r.color} onChange={(e) => changeRoutineColor(r.id, e.target.value)} title="Change color" />
                  </div>
                </div>
              )) : <p className="text-sm text-gray-500">No routines on this date.</p>}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ===========================
     Top-level render
     - Sidebar right. When closed, show toggle at top-right of main panel.
     =========================== */
  return (
    <div className="flex h-screen w-full font-sans bg-gradient-to-br from-violet-50 to-fuchsia-50 antialiased overflow-hidden">
      <div className="flex-1 min-w-0">
        <MainPanel />
      </div>

      <div className={`transition-all duration-300 ${isSidebarOpen ? "w-80" : "w-0"} flex-shrink-0 overflow-hidden border-l`}>
        <div className="w-80 h-full">
          <Sidebar />
        </div>
      </div>

      {!isSidebarOpen && (
        <div className="fixed right-4 top-4 z-50">
          <button onClick={() => setIsSidebarOpen(true)} className="p-3 rounded-full bg-violet-500 text-white shadow-lg">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
