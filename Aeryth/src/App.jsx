// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";

/* -----------------------
   Utilities: localStorage + date helpers
   ----------------------- */
const reviverDate = (k, v) => {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) {
    return new Date(v);
  }
  return v;
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
const fmtShort = (d) =>
  `${d.getDate().toString().padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" }).slice(0,3)} ${d.getFullYear().toString().slice(2)}`;
const iso = (d) => d.toISOString().slice(0,10);

/* -----------------------
   Gemini Nano wrappers
   (safe guards, transient sessions)
   ----------------------- */
let sessions = {};
const ensureModelAvailable = () =>
  !!(window && window.LanguageModel && window.LanguageModel.create);

async function ensureSession(chatId, systemPrompt) {
  if (!ensureModelAvailable()) throw new Error("Gemini Nano not available.");
  if (!sessions[chatId]) {
    sessions[chatId] = await window.LanguageModel.create({
      initialPrompts: [{ role: "system", content: systemPrompt }],
    });
  }
  return sessions[chatId];
}

async function callGemini(chatId, chatHistory, userSettings, routines) {
  const lastMsg = chatHistory.at(-1)?.text || "";
  const system = `You are Aeryth, a personalized AI companion focused on preventing procrastination. Use user context implicitly. End every response with an action-oriented question or command.

User info: ${userSettings?.userInfo || "None"}
Tone: ${userSettings?.aerythTone || "Friendly"}
Active goals: ${
    routines.filter((r) => r.id && r.id === chatId).map((r) => r.goal).join("; ") || "None"
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

/* -----------------------
   App
   ----------------------- */
export default function App() {
  /* persisted */
  const [settings, setSettings] = useState(() =>
    load("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" })
  );
  useEffect(() => save("aeryth_settings", settings), [settings]);

  const [routines, setRoutines] = useState(() =>
    load("aeryth_routines", [])
  );
  useEffect(() => save("aeryth_routines", routines), [routines]);

  const [diary, setDiary] = useState(() =>
    load("aeryth_diary", {})
  );
  useEffect(() => save("aeryth_diary", diary), [diary]);

  const [stickies, setStickies] = useState(() =>
    load("aeryth_stickies", {}) // keyed by routineId -> { dates: { isoDate: {text,color} } }
  );
  useEffect(() => save("aeryth_stickies", stickies), [stickies]);

  /* ephemeral (temporary explore chat only) */
  const [exploreBuffer, setExploreBuffer] = useState([]); // ephemeral messages, not persisted

  /* UI state */
  const [currentView, setCurrentView] = useState("explore"); // explore, setGoal, diary, calendar, settings, routineView
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedRoutineId, setSelectedRoutineId] = useState(null); // clicked routine opens sticky notes
  const [isAILoading, setIsAILoading] = useState(false);

  /* sidebar toggle anim control */
  const [sidebarAnimating, setSidebarAnimating] = useState(false);

  /* for rename inline */
  const [editingRoutine, setEditingRoutine] = useState(null);
  /* for three-dot menu */
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  /* calendar state */
  const today = new Date();
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarViewMonth, setCalendarViewMonth] = useState(new Date());
  const calRef = useRef(null);

  /* syncing helpers */
  useEffect(() => {
    // auto-rotate sticky notes daily: shift day buckets if date changed
    const checkRotation = () => {
      const saved = load("__aeryth_meta_date__", { last: iso(new Date()) });
      const last = saved.last;
      const nowIso = iso(new Date());
      if (last !== nowIso) {
        // simple rotation: for each routine, ensure there are entries for prev/current/next dates
        setStickies(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(rid => {
            const dates = next[rid].dates || {};
            // ensure keys present
            const dPrev = iso(new Date(Date.now() - 86400000));
            const dCur = iso(new Date());
            const dNext = iso(new Date(Date.now() + 86400000));
            dates[dPrev] = dates[dPrev] || { text: "", color: "amber" };
            dates[dCur] = dates[dCur] || { text: "", color: "amber" };
            dates[dNext] = dates[dNext] || { text: "", color: "amber" };
            next[rid].dates = dates;
          });
          return next;
        });
        save("__aeryth_meta_date__", { last: nowIso });
      }
    };
    checkRotation();
    const id = setInterval(checkRotation, 60_000);
    return () => clearInterval(id);
  }, []);

  /* helpers: routines */
  const addRoutine = (r) => {
    const id = crypto.randomUUID();
    const newR = { ...r, id, createdAt: new Date() };
    setRoutines(prev => [newR, ...prev]);
    // initialize stickies for that routine: prev,cur,next
    const prevD = iso(new Date(Date.now() - 86400000));
    const curD = iso(new Date());
    const nextD = iso(new Date(Date.now() + 86400000));
    setStickies(prev => ({
      ...prev,
      [id]: {
        dates: {
          [prevD]: { text: "", color: "amber" },
          [curD]: { text: "", color: "amber" },
          [nextD]: { text: "", color: "amber" },
        },
      },
    }));
    return id;
  };
  const updateRoutine = (id, patch) => setRoutines(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const deleteRoutine = (id) => {
    setRoutines(prev => prev.filter(r => r.id !== id));
    setStickies(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedRoutineId === id) setSelectedRoutineId(null);
  };

  /* sticky note edits: inline typing */
  const setStickyText = (rid, isoDate, text) => {
    setStickies(prev => {
      const next = { ...prev };
      next[rid] = next[rid] || { dates: {} };
      next[rid].dates = { ...(next[rid].dates || {}), [isoDate]: { ...(next[rid].dates?.[isoDate] || {}), text } };
      return next;
    });
  };
  const setStickyColor = (rid, isoDate, color) => {
    setStickies(prev => {
      const next = { ...prev };
      next[rid] = next[rid] || { dates: {} };
      next[rid].dates = { ...(next[rid].dates || {}), [isoDate]: { ...(next[rid].dates?.[isoDate] || {}), color } };
      return next;
    });
  };

  /* Diary functions */
  // diary stored as: { "2025-10": { "2025-10-18": [ {id,text,ts}, ... ], monthlySummary: "..." } }
  const addDiaryEntry = (text) => {
    const d = new Date();
    const isoDay = iso(d);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    setDiary(prev => {
      const next = { ...prev };
      next[monthKey] = next[monthKey] || {};
      next[monthKey][isoDay] = next[monthKey][isoDay] || [];
      next[monthKey][isoDay].unshift({ id: crypto.randomUUID(), text, ts: d.toISOString() });
      return next;
    });
  };
  const deleteDiaryEntry = (monthKey, dayKey, entryId) => {
    setDiary(prev => {
      const next = { ...prev };
      next[monthKey] = { ...next[monthKey] };
      next[monthKey][dayKey] = next[monthKey][dayKey].filter(e => e.id !== entryId);
      return next;
    });
  };

  /* Explore chat ephemeral send */
  const handleExploreSend = async (text) => {
    if (!text?.trim()) return;
    const userMsg = { id: crypto.randomUUID(), role: "user", text, ts: new Date().toISOString() };
    setExploreBuffer(prev => [...prev, userMsg]);
    if (!ensureModelAvailable()) {
      setExploreBuffer(prev => [...prev, { id: crypto.randomUUID(), role: "aeryth", text: "Local Gemini Nano not available.", ts: new Date().toISOString() }]);
      return;
    }
    setIsAILoading(true);
    try {
      // send a transient session keyed to a short-live id
      const tempChatId = `explore_${crypto.randomUUID()}`;
      const ai = await callGemini(tempChatId, [...exploreBuffer, userMsg], settings, routines);
      setExploreBuffer(prev => [...prev, { id: crypto.randomUUID(), role: "aeryth", text: ai ?? "No response", ts: new Date().toISOString() }]);
    } catch (e) {
      console.error(e);
      setExploreBuffer(prev => [...prev, { id: crypto.randomUUID(), role: "system", text: "AI error", ts: new Date().toISOString() }]);
    } finally {
      setIsAILoading(false);
    }
  };

  /* Calendar helpers: prepare events (routines) mapping */
  const calendarEvents = (() => {
    // each routine has days property in set goal. We will add event on dates between createdAt and maybe repeating logic is simplified:
    // For simplicity, treat each routine's startTime as time and attach to its next occurrence(s) based on days[].
    // We'll compute events for prev/current/next month visible windows.
    const events = {}; // isoDate -> [{ routineId, name, color, time }]
    const visibleMonths = [];
    const cm = new Date(calendarViewMonth.getFullYear(), calendarViewMonth.getMonth(), 1);
    const prevM = new Date(cm.getFullYear(), cm.getMonth() - 1, 1);
    const nextM = new Date(cm.getFullYear(), cm.getMonth() + 1, 1);
    visibleMonths.push(prevM, cm, nextM);
    const getMonthDates = (m) => {
      const year = m.getFullYear(), month = m.getMonth();
      const d0 = new Date(year, month, 1);
      const dLast = new Date(year, month + 1, 0).getDate();
      const dates = [];
      for (let d = 1; d <= dLast; d++) dates.push(new Date(year, month, d));
      return dates;
    };
    visibleMonths.forEach(m => {
      getMonthDates(m).forEach(dayDate => {
        const isoDay = iso(dayDate);
        events[isoDay] = events[isoDay] || [];
      });
    });
    // Fill events from routines based on routine.days (array of weekday names like Mon,Tue,...)
    routines.forEach(r => {
      if (!r.days || !r.startTime) return;
      // map day names to weekday number
      const mapDay = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
      Object.keys(events).forEach(isoDay => {
        const dayDate = new Date(isoDay + "T00:00:00");
        const wd = dayDate.getDay();
        const foundDay = r.days.some(dn => mapDay[dn] === wd);
        if (foundDay) {
          events[isoDay].push({
            routineId: r.id,
            name: r.name || r.goal || "Routine",
            color: r.color || "violet",
            time: r.startTime,
          });
        }
      });
    });
    // order by time
    Object.keys(events).forEach(k => {
      events[k].sort((a,b) => (a.time || "") > (b.time || "") ? 1 : -1);
    });
    return events;
  })();

  /* UI small components (TopPills per your exact structure but Explore active text black) */
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

  /* Sidebar Toggle button that moves with sidebar */
  const SidebarToggle = ({ inside = false }) => {
    // inside=true -> placed inside sidebar top-left, else top-right fixed on main panel
    return (
      <button
        onClick={() => {
          setSidebarAnimating(true);
          setIsSidebarOpen(prev => !prev);
          // after animation time clear animating flag
          setTimeout(() => setSidebarAnimating(false), 320);
        }}
        className={`flex items-center justify-center rounded-full p-3 shadow-lg transform transition-all duration-300 ${inside ? "bg-white text-violet-600 hover:bg-violet-50" : "bg-violet-500 text-white hover:bg-violet-600"}`}
        title="Toggle sidebar"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    );
  };

  /* Routines sidebar entry with inline menu */
  const RoutineStrip = ({ r }) => {
    const isSelected = selectedRoutineId === r.id;
    return (
      <div className={`flex items-center p-3 rounded-xl ${isSelected ? "bg-violet-100" : "hover:bg-gray-100"} relative`}>
        <button onClick={() => { setSelectedRoutineId(r.id); setCurrentView("routineView"); }} className="flex-1 text-left font-medium">{editingRoutine===r.id ? null : r.name || r.goal || "Routine"}</button>

        {editingRoutine === r.id ? (
          <input
            className="w-40 p-1 border rounded"
            defaultValue={r.name || r.goal || ""}
            onBlur={(e) => { updateRoutine(r.id, { name: e.target.value }); setEditingRoutine(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.target.blur(); } }}
            autoFocus
          />
        ) : (
          <>
            <div className="flex items-center gap-1">
              <button onClick={() => {
                setMenuOpenFor(menuOpenFor === r.id ? null : r.id);
              }} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
              </button>
              {menuOpenFor === r.id && (
                <div className="absolute right-3 top-12 bg-white border rounded shadow-md w-36 z-40">
                  <button onClick={() => { setEditingRoutine(r.id); setMenuOpenFor(null); }} className="w-full text-left px-3 py-2 hover:bg-gray-50">Rename</button>
                  <button onClick={() => { deleteRoutine(r.id); setMenuOpenFor(null); }} className="w-full text-left px-3 py-2 text-red-600 hover:bg-gray-50">Delete</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  /* Main panel views */
  function MainPanel() {
    const [exploreInput, setExploreInput] = useState("");
    // selected routine sticky view handles dates
    if (currentView === "routineView" && selectedRoutineId) {
      const r = routines.find(x => x.id === selectedRoutineId);
      if (!r) {
        return <div className="p-6">Routine not found.</div>;
      }
      const prevD = iso(new Date(Date.now() - 86400000));
      const curD = iso(new Date());
      const nextD = iso(new Date(Date.now() + 86400000));
      const dates = stickies[selectedRoutineId]?.dates || {};
      const stickyFor = (d) => dates[d] || { text: "", color: "amber" };
      const colors = ["amber", "violet", "green", "rose"];
      return (
        <div className="flex-1 h-full p-6 overflow-auto">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-violet-700 mb-3">{r.name || r.goal}</h2>
            <p className="text-sm text-gray-500 mb-4">{r.description || r.goal || ""}</p>

            <div className="grid grid-cols-1 gap-4">
              <div className="bg-white p-4 rounded-xl shadow">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Current Day - {fmtShort(new Date())}</div>
                  <div className="flex items-center gap-2">
                    {colors.map(c => (
                      <button key={c} onClick={() => setStickyColor(selectedRoutineId, curD, c)} className={`w-4 h-4 rounded-full border ${c==="amber"?"bg-amber-400":c==="violet"?"bg-violet-500":c==="green"?"bg-green-400":"bg-rose-400"}`} />
                    ))}
                  </div>
                </div>
                <textarea
                  value={stickyFor(curD).text}
                  onChange={(e) => setStickyText(selectedRoutineId, curD, e.target.value)}
                  className="w-full p-3 border rounded h-28 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-xl shadow">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">Previous Day - {fmtShort(new Date(Date.now()-86400000))}</div>
                    <div className="flex items-center gap-2">
                      {colors.map(c => (
                        <button key={c} onClick={() => setStickyColor(selectedRoutineId, prevD, c)} className={`w-4 h-4 rounded-full border ${c==="amber"?"bg-amber-400":c==="violet"?"bg-violet-500":c==="green"?"bg-green-400":"bg-rose-400"}`} />
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={stickyFor(prevD).text}
                    onChange={(e) => setStickyText(selectedRoutineId, prevD, e.target.value)}
                    className="w-full p-3 border rounded h-24 resize-none"
                    disabled
                  />
                </div>

                <div className="bg-white p-4 rounded-xl shadow">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">Next Day - {fmtShort(new Date(Date.now()+86400000))}</div>
                    <div className="flex items-center gap-2">
                      {colors.map(c => (
                        <button key={c} onClick={() => setStickyColor(selectedRoutineId, nextD, c)} className={`w-4 h-4 rounded-full border ${c==="amber"?"bg-amber-400":c==="violet"?"bg-violet-500":c==="green"?"bg-green-400":"bg-rose-400"}`} />
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={stickyFor(nextD).text}
                    onChange={(e) => setStickyText(selectedRoutineId, nextD, e.target.value)}
                    className="w-full p-3 border rounded h-24 resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => { setCurrentView("explore"); setSelectedRoutineId(null); }} className="px-4 py-2 rounded bg-gray-100">Back</button>
            </div>
          </div>
        </div>
      );
    }

    if (currentView === "calendar") {
      const onActiveStartDateChange = ({ activeStartDate }) => {
        setCalendarViewMonth(activeStartDate);
      };
      return (
        <div className="flex-1 h-full p-6 overflow-auto">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-violet-700">Calendar</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setCalendarViewMonth(new Date(calendarViewMonth.getFullYear(), calendarViewMonth.getMonth()-1, 1))} className="px-3 py-2 rounded bg-gray-100">Prev</button>
                <button onClick={() => setCalendarViewMonth(new Date())} className="px-3 py-2 rounded bg-gray-100">Today</button>
                <button onClick={() => setCalendarViewMonth(new Date(calendarViewMonth.getFullYear(), calendarViewMonth.getMonth()+1, 1))} className="px-3 py-2 rounded bg-gray-100">Next</button>
              </div>
            </div>

            <Calendar
              onChange={setCalendarDate}
              value={calendarDate}
              activeStartDate={calendarViewMonth}
              onActiveStartDateChange={onActiveStartDateChange}
              tileContent={({ date }) => {
                const isoDay = iso(date);
                const evs = calendarEvents[isoDay] || [];
                if (!evs.length) return null;
                return (
                  <div className="mt-1 space-y-0">
                    {evs.slice(0,3).map((ev, idx) => (
                      <div key={idx} className={`text-[10px] truncate rounded-sm px-1 ${ev.color === "violet" ? "bg-violet-500 text-white" : ev.color==="green" ? "bg-green-400 text-white" : ev.color==="rose" ? "bg-rose-400 text-white" : "bg-amber-400 text-black"}`}>
                        {ev.name}
                      </div>
                    ))}
                  </div>
                );
              }}
            />

            <div className="mt-4 bg-white p-4 rounded shadow">
              <h3 className="font-semibold">Events on {fmtShort(new Date(calendarDate))}</h3>
              <div className="mt-2">
                {(calendarEvents[iso(calendarDate)] || []).map((ev, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 border rounded mb-1">
                    <div>
                      <div className="font-medium">{ev.name}</div>
                      <div className="text-xs text-gray-500">{ev.time}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="time" value={ev.time} onChange={(e) => {
                        // update routine time
                        updateRoutine(ev.routineId, { startTime: e.target.value });
                      }} className="p-1 border rounded" />
                      <div className="flex gap-1">
                        <button onClick={() => updateRoutine(ev.routineId, { color: "violet" })} className="w-4 h-4 rounded-sm bg-violet-500" />
                        <button onClick={() => updateRoutine(ev.routineId, { color: "green" })} className="w-4 h-4 rounded-sm bg-green-400" />
                        <button onClick={() => updateRoutine(ev.routineId, { color: "rose" })} className="w-4 h-4 rounded-sm bg-rose-400" />
                        <button onClick={() => updateRoutine(ev.routineId, { color: "amber" })} className="w-4 h-4 rounded-sm bg-amber-400" />
                      </div>
                    </div>
                  </div>
                ))}
                {!(calendarEvents[iso(calendarDate)] || []).length && <div className="text-sm text-gray-500">No routines.</div>}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (currentView === "diary") {
      const [showPast, setShowPast] = useState(false);
      const [selectedDate, setSelectedDate] = useState(null);
      const [entryText, setEntryText] = useState("");
      const monthKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
      const todayKey = iso(new Date());
      const todaysEntries = (diary[monthKey]?.[todayKey]) || [];

      const searchDates = () => {
        // returns array of {monthKey, dayKey}
        const keys = [];
        Object.keys(diary).forEach(mk => {
          Object.keys(diary[mk]).forEach(dk => {
            if (dk === "monthlySummary") return;
            keys.push({ monthKey: mk, dayKey: dk });
          });
        });
        keys.sort((a,b) => b.dayKey.localeCompare(a.dayKey));
        return keys;
      };

      return (
        <div className="flex-1 h-full p-6 overflow-auto">
          <div className="max-w-4xl mx-auto">
            {!showPast && !selectedDate && (
              <>
                <h2 className="text-2xl font-bold text-violet-700 mb-2">{fmtShort(new Date())}</h2>
                <div className="mb-3">
                  <input placeholder="Search date / month / time" className="w-full p-3 border rounded" />
                </div>
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => setShowPast(true)} className="py-2 px-4 rounded bg-gray-100">Past Entries</button>
                </div>

                <div className="space-y-3">
                  {todaysEntries.map(e => (
                    <div key={e.id} className="bg-white p-3 rounded shadow group relative">
                      <div className="text-sm">{e.text}</div>
                      <div className="text-xs text-gray-400 mt-1">{new Date(e.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                      <button onClick={() => {
                        const confirmDel = confirm("Delete entry? (only allowed today)");
                        if (!confirmDel) return;
                        deleteDiaryEntry(monthKey, todayKey, e.id);
                      }} className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 text-red-500">Delete</button>
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <textarea value={entryText} onChange={(e) => setEntryText(e.target.value)} placeholder="Write a new diary entry..." className="w-full p-3 border rounded h-36" />
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => { if (!entryText.trim()) return; addDiaryEntry(entryText.trim()); setEntryText(""); }} className="px-4 py-2 rounded bg-violet-500 text-white">Save Entry</button>
                    <button onClick={() => setEntryText("")} className="px-4 py-2 rounded border">Clear</button>
                  </div>
                </div>
              </>
            )}

            {showPast && !selectedDate && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <button onClick={() => setShowPast(false)} className="px-3 py-2 rounded bg-gray-100">Back</button>
                  <h3 className="text-lg font-semibold">Past Entries</h3>
                </div>
                <div className="space-y-2">
                  {searchDates().map(k => (
                    <div key={`${k.monthKey}-${k.dayKey}`} className="p-3 bg-white rounded shadow flex justify-between items-center">
                      <div>
                        <div className="font-medium">{new Date(k.dayKey).toLocaleDateString()}</div>
                        <div className="text-xs text-gray-500">{k.monthKey}</div>
                      </div>
                      <button onClick={() => setSelectedDate(k)} className="px-3 py-2 rounded bg-violet-500 text-white">Open</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {selectedDate && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <button onClick={() => setSelectedDate(null)} className="px-3 py-2 rounded bg-gray-100">Back</button>
                  <h3 className="text-lg font-semibold">{new Date(selectedDate.dayKey).toLocaleDateString()}</h3>
                </div>

                <div className="bg-white p-4 rounded shadow mb-3">
                  <div className="font-bold">Summary (auto)</div>
                  <div className="text-sm text-gray-600 mt-2">[Daily summary placeholder — auto-generated server-side in final product]</div>
                </div>

                <div className="space-y-2">
                  {(diary[selectedDate.monthKey]?.[selectedDate.dayKey] || []).map(e => (
                    <div key={e.id} className="bg-white p-3 rounded shadow">
                      <div className="text-sm">{e.text}</div>
                      <div className="text-xs text-gray-400 mt-1">{new Date(e.ts).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    /* default Explore view */
    return (
      <div className="flex-1 h-full p-6 overflow-auto">
        <div className="max-w-4xl mx-auto flex flex-col h-full">
          <div className="mb-2 text-center text-gray-500 italic">Aeryth's Tone: <span className="font-semibold text-violet-600">{settings.aerythTone}</span></div>

          <div className="flex-1 overflow-auto space-y-4 pb-6">
            {exploreBuffer.map(m => (
              <div key={m.id} className={`max-w-full ${m.role==="user" ? "ml-auto" : ""}`}>
                <div className={`inline-block px-4 py-2 rounded-2xl shadow ${m.role==="user" ? "bg-violet-500 text-white" : m.role==="aeryth" ? "bg-white text-gray-800 border" : "bg-red-50 text-red-600"}`}>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                </div>
              </div>
            ))}

            {isAILoading && (
              <div className="flex items-center gap-2 text-gray-500">
                <svg className="animate-spin w-4 h-4 text-violet-500" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/><path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
                <div>Aeryth is thinking...</div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t bg-white p-4">
            <TopPills view={currentView} setView={setCurrentView} />
            <form onSubmit={(e) => { e.preventDefault(); handleExploreSend(e.target.elements.exploreInput.value); e.target.elements.exploreInput.value = ""; }} className="flex space-x-3">
              <input name="exploreInput" placeholder={isAILoading ? "Waiting..." : "Start exploring a task..."} className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-violet-400" />
              <button type="submit" className="px-6 py-3 rounded-xl font-bold bg-violet-500 text-white hover:bg-violet-600">Send</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  /* Sidebar */
  function Sidebar() {
    const upcoming = routines.slice(0,10); // simple list
    return (
      <div className="w-80 h-full p-4 flex flex-col bg-white border-l">
        <div className="flex items-center justify-between mb-4 pt-4">
          <div>
            <h3 className="text-2xl font-extrabold text-violet-600">Routines</h3>
            <p className="text-sm text-gray-500">Your daily rhythm</p>
          </div>

          <div className="flex items-center gap-2">
            <SidebarToggle inside />
          </div>
        </div>

        <button onClick={() => { setCurrentView("setGoal"); }} className="w-full mb-3 py-3 rounded-lg bg-violet-500 text-white font-bold">+ New Routine</button>

        <input placeholder="Search routines..." className="w-full p-3 border rounded-xl mb-3" />

        <div className="flex-1 overflow-auto space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-800">Sticky quick view</h4>
            <div className="mt-2 space-y-2">
              {upcoming.length ? upcoming.map(r => <RoutineStrip key={r.id} r={r} />) : <div className="text-sm text-gray-500">No routines yet</div>}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t mt-4 space-y-2">
          <button onClick={() => { setCurrentView("calendar"); setSelectedRoutineId(null); }} className={`flex items-center w-full p-3 rounded-xl ${currentView === "calendar" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">🗓️</span>Calendar</button>
          <button onClick={() => { setCurrentView("diary"); setSelectedRoutineId(null); }} className={`flex items-center w-full p-3 rounded-xl ${currentView === "diary" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">✍️</span>Diary</button>
          <button onClick={() => { setCurrentView("settings"); setSelectedRoutineId(null); }} className={`flex items-center w-full p-3 rounded-xl ${currentView === "settings" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">⚙️</span>Settings</button>
        </div>
      </div>
    );
  }

  /* Right-edge toggle when sidebar closed - button follows behaviour */
  const ToggleFloating = () => {
    return (
      <div className="fixed right-4 top-6 z-50">
        <SidebarToggle />
      </div>
    );
  };

  /* Layout: main stretches full width, sidebar occupies 1/4 when open (w-80), main shrinks automatically */
  return (
    <div className="flex h-screen w-full font-sans bg-gradient-to-br from-violet-50 to-fuchsia-50 antialiased">
      <div className={`flex-1 min-w-0 transition-all duration-300 ${isSidebarOpen ? "lg:w-[calc(100%-20rem)]" : "w-full"}`}>
        <MainPanel />
      </div>

      <div className={`transition-all duration-300 ${isSidebarOpen ? "w-80" : "w-0"} flex-shrink-0 overflow-hidden`}>
        {isSidebarOpen && (
          <div className="w-80 h-full">
            <Sidebar />
          </div>
        )}
      </div>

      {!isSidebarOpen && <ToggleFloating />}
    </div>
  );
}
