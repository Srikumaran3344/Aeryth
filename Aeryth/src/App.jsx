// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";

/* -----------------------
   Utilities
   ----------------------- */
const reviverDate = (k, v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v;
const load = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw, reviverDate) : fallback;
  } catch (e) {
    console.error("load", e);
    return fallback;
  }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error("save", e); }
};
const iso = (d) => d.toISOString().slice(0, 10);
const fmtShort = (d) => `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" }).slice(0,3)} ${String(d.getFullYear()).slice(2)}`;

/* -----------------------
   Gemini Nano wrappers (guarded)
   (left unchanged, used as before)
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

/* -----------------------
   Local grammar-corrector (placeholder)
   Does not call external APIs — returns a lightly "corrected" string.
   You can replace this with your real API later.
   ----------------------- */
function localGrammarCorrect(text) {
  if (!text) return "";
  // Very naive corrections (placeholder)
  let out = text.trim();
  // Fix multiple spaces
  out = out.replace(/\s+/g, " ");
  // Capitalize first letter of sentences (very naive)
  out = out.replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase());
  // Fix common mistakes
  out = out.replace(/\bi\b/g, "I");
  // Ensure ending punctuation
  if (!/[.!?]$/.test(out)) out = out + ".";
  return out;
}

/* -----------------------
   App
   ----------------------- */
export default function App() {
  /* persisted state */
  const [settings, setSettings] = useState(() => load("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" }));
  useEffect(() => save("aeryth_settings", settings), [settings]);

  const [routines, setRoutines] = useState(() => load("aeryth_routines", []));
  useEffect(() => save("aeryth_routines", routines), [routines]);

  // diary structure: { "YYYY-M": { "YYYY-MM-DD": [{id,text,ts}], monthlySummary: "..." } }
  const [diary, setDiary] = useState(() => load("aeryth_diary", {}));
  useEffect(() => save("aeryth_diary", diary), [diary]);

  // stickies: { routineId: { dates: { "YYYY-MM-DD": { text, color } } } }
  const [stickies, setStickies] = useState(() => load("aeryth_stickies", {}));
  useEffect(() => save("aeryth_stickies", stickies), [stickies]);

  // ephemeral temp chat for Explore (not persisted)
  const [exploreBuffer, setExploreBuffer] = useState([]);

  /* UI state */
  const [currentView, setCurrentView] = useState("explore"); // explore,setGoal,diary,calendar,settings,routineView
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedRoutineId, setSelectedRoutineId] = useState(null);
  const [isAILoading, setIsAILoading] = useState(false);

  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [editingRoutine, setEditingRoutine] = useState(null);

  /* calendar */
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarViewMonth, setCalendarViewMonth] = useState(new Date());
  
  useEffect(() => {
    const saved = localStorage.getItem("calendarEvents");
    if (saved) setCalendarEvents(JSON.parse(saved));
  }, []);

  /* misc */
  const chatEndRef = useRef(null);
  useEffect(() => { setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 60); }, [exploreBuffer, isAILoading]);

  /* Helpers */
  const addRoutine = ({ name, description, startTime, endTime, days, color="violet" }) => {
    const id = crypto.randomUUID();
    const r = { id, name, description, startTime, endTime, days, color, createdAt: new Date() };
    setRoutines(prev => [r, ...prev]);
    // init 3 stickies: prev/current/next
    const prevD = iso(new Date(Date.now() - 86400000));
    const curD = iso(new Date());
    const nextD = iso(new Date(Date.now() + 86400000));
    setStickies(prev => ({ ...prev, [id]: { dates: { [prevD]: { text: "", color }, [curD]: { text: "", color }, [nextD]: { text: "", color } } } }));
    return id;
  };
  const updateRoutine = (id, patch) => setRoutines(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  
  const removeRoutine = (id) => {
    setRoutines(prev => prev.filter(r => r.id !== id));
    setStickies(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (selectedRoutineId === id) { setSelectedRoutineId(null); setCurrentView("explore"); }
  };

  /* stickies */
  const setStickyText = (rid, dayIso, text) => setStickies(prev => { const n = { ...prev }; n[rid] = n[rid] || { dates: {} }; n[rid].dates = { ...(n[rid].dates || {}), [dayIso]: { ...(n[rid].dates?.[dayIso] || {}), text } }; return n; });
  const setStickyColor = (rid, dayIso, color) => setStickies(prev => { const n = { ...prev }; n[rid] = n[rid] || { dates: {} }; n[rid].dates = { ...(n[rid].dates || {}), [dayIso]: { ...(n[rid].dates?.[dayIso] || {}), color } }; return n; });

  /* diary */
  // addDiaryEntry: dedupe quick duplicates and insert at head
  const addDiaryEntry = (text, onDate = null) => {
    if (!text?.trim()) return;
    const d = onDate ? new Date(onDate) : new Date();
    const dayKey = iso(d);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    setDiary(prev => {
      const n = { ...prev };
      n[monthKey] = n[monthKey] || {};
      n[monthKey][dayKey] = n[monthKey][dayKey] || [];

      // Prevent accidental duplicate: if last saved entry text identical and timestamp within 3 seconds, skip
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
  // update an existing diary entry's text (persisted)
  const updateDiaryEntry = (monthKey, dayKey, entryId, newText) => {
    setDiary(prev => {
      const n = { ...prev };
      if (!n[monthKey] || !n[monthKey][dayKey]) return prev;
      n[monthKey] = { ...n[monthKey] };
      n[monthKey][dayKey] = n[monthKey][dayKey].map(e => e.id === entryId ? { ...e, text: newText, editedAt: new Date().toISOString() } : e);
      return n;
    });
  };

  // ensure monthly summary exists (naively generate) for past months when viewed
  const generateMonthlySummaryIfMissing = (monthKey) => {
    setDiary(prev => {
      const n = { ...prev };
      const month = n[monthKey] || {};
      if (!month) return n;
      if (month.monthlySummary) return n;
      // Gather all texts in month and create a naive summary (first 300 chars)
      const texts = Object.keys(month)
        .filter(k => k !== "monthlySummary")
        .flatMap(day => (month[day] || []).map(e => e.text));
      const summary = texts.join(" ").slice(0, 800) || "No events for this month.";
      n[monthKey] = { ...(n[monthKey] || {}), monthlySummary: summary };
      return n;
    });
  };

  const [chatSessionId, setChatSessionId] = useState(0);

  const handleNewChat = () => {
    setChatSessionId(prev => prev + 1); // invalidate previous AI responses
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

    // Only update if this response matches the latest session
    if (currentSession === chatSessionId) {
      setExploreBuffer(prev => [...prev, { id: crypto.randomUUID(), role: "aeryth", text: aiText }]);
    }
    setIsAILoading(false);
  };

  /* calendar events mapping */
  const calendarEvents = (() => {
    const events = {}; // iso -> [{routineId,name,color,time}]
    const getRangeDates = (base) => {
      const arr = [];
      const start = new Date(base.getFullYear(), base.getMonth()-1, 1);
      const end = new Date(base.getFullYear(), base.getMonth()+2, 0);
      for (let d = start; d <= end; d.setDate(d.getDate()+1)) arr.push(new Date(d));
      return arr;
    };
    const daysMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
    getRangeDates(calendarViewMonth).forEach(d => events[iso(d)] = []);
    routines.forEach(r => {
      if (!r.days || !r.startTime) return;
      Object.keys(events).forEach(dayIso => {
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

  /* UI components */
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

  /* Panels */
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

    // controlled local state for current text to avoid losing focus
    const prevKey = iso(new Date(Date.now() - 86400000));
    const curKey = iso(new Date());
    const nextKey = iso(new Date(Date.now() + 86400000));

    // read existing stickies safely
    const datesMap = (stickies[selectedRoutineId] && stickies[selectedRoutineId].dates) || {};

    // utility to get current sticky object safely
    const getSticky = (d) => ({ ...(datesMap[d] || { text: "", color: r.color || "violet" }) });

    // local state per date so textarea is controlled and doesn't lose focus
    const [localText, setLocalText] = useState(getSticky(curKey).text);
    const [localPrevText, setLocalPrevText] = useState(getSticky(prevKey).text);
    const [localNextText, setLocalNextText] = useState(getSticky(nextKey).text);
    const [localColor, setLocalColor] = useState(getSticky(curKey).color || r.color || "violet");

    // keep local state in sync if external stickies change (e.g. on mount or external edits)
    useEffect(() => {
      setLocalText(getSticky(curKey).text);
      setLocalPrevText(getSticky(prevKey).text);
      setLocalNextText(getSticky(nextKey).text);
      setLocalColor(getSticky(curKey).color || r.color || "violet");
    }, [selectedRoutineId, stickies, r]);

    // Persist helpers - update global stickies state
    const persistText = (d, txt) => {
      setStickyText(selectedRoutineId, d, txt);
    };
    const persistColor = (d, c) => {
      setStickyColor(selectedRoutineId, d, c);
    };

    const colors = ["amber","violet","green","rose"];

    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-violet-700 mb-2">{r.name}</h2>
          <p className="text-sm text-gray-500 mb-4">{r.description}</p>

          <div className="bg-white p-4 rounded-xl shadow mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Current - {fmtShort(new Date())}</div>
              <div className="flex gap-2">
                {colors.map(c => (
                  <button
                    key={c}
                    onClick={() => { setLocalColor(c); persistColor(curKey, c); }}
                    className={`w-4 h-4 rounded-full ${c==="amber"?"bg-amber-400":c==="violet"?"bg-violet-500":c==="green"?"bg-green-400":"bg-rose-400"}`}
                    aria-label={`Set color ${c}`}
                  />
                ))}
              </div>
            </div>
            <textarea
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={() => persistText(curKey, localText)}
              className="w-full p-3 border rounded h-28 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Previous - {fmtShort(new Date(Date.now()-86400000))}</div>
              </div>
              <textarea
                value={localPrevText}
                onChange={(e) => setLocalPrevText(e.target.value)}
                onBlur={() => persistText(prevKey, localPrevText)}
                className="w-full p-3 border rounded h-24 resize-none"
                // previous is typically read-only in your original design; keep it disabled to prevent editing unless you want it
                disabled
              />
            </div>

            <div className="bg-white p-4 rounded-xl shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Next - {fmtShort(new Date(Date.now()+86400000))}</div>
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
            <button onClick={() => { setCurrentView("explore"); setSelectedRoutineId(null); }} className="px-4 py-2 rounded bg-gray-100">Back</button>
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

  // ---- Build Events Map ----
  const calendarEvents = (() => {
    const events = {};
    const getRangeDates = (base) => {
      const arr = [];
      const start = new Date(base.getFullYear(), base.getMonth() - 1, 1);
      const end = new Date(base.getFullYear(), base.getMonth() + 2, 0);
      for (let d = start; d <= end; d.setDate(d.getDate() + 1))
        arr.push(new Date(d));
      return arr;
    };
    const daysMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    getRangeDates(calendarViewMonth).forEach(
      (d) => (events[iso(d)] = [])
    );

    routines.forEach((r) => {
      if (!r.days || !r.startTime) return;
      Object.keys(events).forEach((dayIso) => {
        const d = new Date(dayIso + "T00:00:00Z");
        if (r.days.some((dd) => daysMap[dd] === (d.getUTCDay()+1)%7)) {
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
    updateRoutine(id, patch);
    setEditBuffer((prev) => {
      const newBuf = { ...prev };
      delete newBuf[id];
      return newBuf;
    });
  };

  const hasChanges = (id) => !!editBuffer[id];

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
        <div className="mx-auto w-full h-[550px] flex justify-center">
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
              const ev = calendarEvents[isoDay] || [];
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
            {(calendarEvents[iso(calendarDate)] || []).map((ev, idx) => {
              const local = editBuffer[ev.routineId] || {};
              const currentTime = local.startTime ?? ev.time ?? "";
              const currentDays = local.days ?? ev.days ?? [];

              const toggleDayLocal = (day) => {
                const newDays = currentDays.includes(day)
                  ? currentDays.filter((d) => d !== day)
                  : [...currentDays, day];
                handleLocalChange(ev.routineId, "days", newDays);
              };

              return (
                <div
                  key={idx}
                  className="p-3 border border-gray-100 rounded-lg shadow-sm flex flex-col gap-3"
                >
                  <div className="flex justify-between items-center">
                    <div className="font-medium text-lg">{ev.name}</div>
                    {hasChanges(ev.routineId) && (
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
                </div>
              );
            })}

            {!(calendarEvents[iso(calendarDate)] || []).length && (
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
   DiaryView (rewritten with requested features)
   - Fixes double-save
   - Today's entries editable; past entries read-only
   - New Entry button
   - Past Entries navigation, monthly grouping and summaries
   - Grammar-correction preview panel (local)
   - Hover-delete for same-day entries (only allowed while still same day)
   - Search bar for date/month/text/time
   ----------------------- */
  function DiaryView() {
    const today = new Date();
    const todayMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const todayKey = iso(today);

    // UI state
    const [entryText, setEntryText] = useState("");
    const [showPast, setShowPast] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [grammarPreview, setGrammarPreview] = useState(null);
    const [isPreviewVisible, setIsPreviewVisible] = useState(false);
    const [diarySearchResults, setDiarySearchResults] = useState([]);
    const [highlightTerm, setHighlightTerm] = useState("");

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
      setIsAILoading(true);
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
        setIsAILoading(false);
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

    // build list of months
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

    // Integrated search logic (from old version)
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
          if (matching.length) {
            results.push({ monthKey: mk, dayKey: dk, entries: matching });
          }
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

            {/* Past Entries View */}
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
                  <button onClick={handleGrammarCheck} className="flex-1 py-2 rounded-lg bg-blue-100 text-blue-800 font-semibold">{isAILoading ? "..." : "Correct Grammar"}</button>
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
                  {((searchTerm && highlightTerm)
                    ? (diary[selectedDate.monthKey]?.[selectedDate.dayKey] || []).filter(e =>
                        (e.text || "").toLowerCase().includes(highlightTerm))
                    : (diary[selectedDate.monthKey]?.[selectedDate.dayKey] || [])
                  ).map(e => (
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
    // Keep local changes even if parent re-renders
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
    const saveSettings = () => { setSettings(form); setCurrentView("explore"); };
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

  /* Sidebar */
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
            // Find next upcoming routine (based on current weekday)
            const todayIso = iso(new Date());
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

  /* floating toggle when sidebar closed */
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
