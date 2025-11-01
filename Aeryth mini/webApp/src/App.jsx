// src/App.jsx
import React, { useEffect, useState, useMemo } from "react";
import CalendarView from "./Components/CalendarView";
import DiaryView from "./Components/DiaryView";
import ExploreView from "./Components/ExploreView";
import RoutineStickyView from "./Components/RoutineStickyView";
import SetGoalPanel from "./Components/SetGoalPanel";
import SettingsPanel from "./Components/SettingsPanel";
import Sidebar from "./Components/Sidebar";
import SidebarToggle from "./Components/shared/SidebarToggle";

import { loadAsync, saveAsync } from "./utils/storage";
import { iso } from "./utils/helpers";
import { callGeminiTemp } from "./utils/ai";
import { scheduleRoutineNotification } from "./utils/notifications";
import { buildAndPersistProfileSummary } from "./utils/personalization";

export default function App() {
  /* persisted state */
  const [settings, setSettings] = useState({ aerythTone: "Friendly (Default)", userInfo: "", routineCriteria: "" });
  const [routines, setRoutines] = useState([]);
  const [diary, setDiary] = useState({});
  const [stickies, setStickies] = useState({});
  const [eventStatuses, setEventStatuses] = useState({});
  const [notifChats, setNotifChats] = useState({});
  const [profileSummary, setProfileSummary] = useState(null);

  /* ephemeral */
  const [exploreBuffer, setExploreBuffer] = useState([]);
  const [currentView, setCurrentView] = useState("explore");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedRoutineId, setSelectedRoutineId] = useState(null);
  const [isAILoading, setIsAILoading] = useState(false);

  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [editingRoutine, setEditingRoutine] = useState(null);

  /* Calendar local edit buffer */
  const [editBuffer, setEditBuffer] = useState({});
  const [activeCalendarDate, setActiveCalendarDate] = useState(null); // ✅ remember scroll position / day

  /* load persisted on mount */
  useEffect(() => {
    (async () => {
      const s = await loadAsync("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" });
      setSettings(s);
      const r = await loadAsync("aeryth_routines", []);
      r.forEach(rr => { if (rr && rr.createdAt && typeof rr.createdAt === "string") rr.createdAt = new Date(rr.createdAt); });
      setRoutines(r);
      setDiary(await loadAsync("aeryth_diary", {}));
      setStickies(await loadAsync("aeryth_stickies", {}));
      setEventStatuses(await loadAsync("aeryth_event_statuses", {}));
      setNotifChats(await loadAsync("aeryth_notif_chats", {}));
      setProfileSummary(await loadAsync("aeryth_profile", null));
    })();
  }, []);

  /* persisters */
  useEffect(() => { saveAsync("aeryth_settings", settings); }, [settings]);
  useEffect(() => { saveAsync("aeryth_diary", diary); }, [diary]);
  useEffect(() => { saveAsync("aeryth_stickies", stickies); }, [stickies]);
  useEffect(() => { saveAsync("aeryth_event_statuses", eventStatuses); }, [eventStatuses]);
  useEffect(() => { saveAsync("aeryth_notif_chats", notifChats); }, [notifChats]);
  useEffect(() => { saveAsync("aeryth_profile", profileSummary); }, [profileSummary]);
  useEffect(() => { saveAsync("aeryth_routines", routines.map(r => ({ ...r, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : r.createdAt }))); }, [routines]);

  // helpers to mutate persisted arrays
  const addRoutine = ({ name, description, startTime, endTime, days, color = "violet" }) => {
    const id = crypto.randomUUID();
    const now = new Date();
    const r = { id, name, description, startTime, endTime, days, color, createdAt: now };
    setRoutines(prev => [r, ...prev]);
    const prevD = iso(new Date(Date.now() - 86400000));
    const curD = iso(new Date());
    const nextD = iso(new Date(Date.now() + 86400000));
    setStickies(prev => ({ ...prev, [id]: { dates: { [prevD]: { text: "", color }, [curD]: { text: "", color }, [nextD]: { text: "", color } } } }));
    setEventStatuses(prev => ({ ...(prev || {}), [id]: { [curD]: "upcoming", [nextD]: "upcoming" } }));
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

  // stickies
  const setStickyText = (rid, dayIso, text) =>
    setStickies(prev => {
      const n = { ...prev };
      n[rid] = n[rid] || { dates: {} };
      n[rid].dates = { ...(n[rid].dates || {}), [dayIso]: { ...(n[rid].dates?.[dayIso] || {}), text } };
      return n;
    });

  const setStickyColor = (rid, dayIso, color) =>
    setStickies(prev => {
      const n = { ...prev };
      n[rid] = n[rid] || { dates: {} };
      n[rid].dates = { ...(n[rid].dates || {}), [dayIso]: { ...(n[rid].dates?.[dayIso] || {}), color } };
      return n;
    });

  // diary helpers
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
      if (head && head.text === text && Math.abs(new Date(head.ts) - d) < 3000) return n;
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

  // chat/explore
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

  const setEventStatus = (rid, dateIso, status) => {
    setEventStatuses(prev => {
      const n = { ...(prev || {}) };
      n[rid] = n[rid] || {};
      n[rid][dateIso] = status;
      return n;
    });
  };

  const scheduleUpcomingNotificationsForRoutine = (routine, daysAhead = 3) => {
    const now = new Date();
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dayIso = iso(d);
      if (routine.createdAt && dayIso < iso(new Date(routine.createdAt))) continue;
      const daysMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
      const wd = d.getDay();
      if (!routine.days || !routine.days.some(dd => daysMap[dd] === wd)) continue;
      scheduleRoutineNotification(routine, dayIso, "start", `${routine.name}: time to start.`);
      scheduleRoutineNotification(routine, dayIso, "end", `${routine.name}: time's up — did you complete it?`);
    }
  };

  const buildAndPersistProfileSummaryLocal = async () => {
    const s = await buildAndPersistProfileSummary({ settings, routines, diary });
    setProfileSummary(s);
  };


  const openRoutineView = (id) => {
    setSelectedRoutineId(id);
    setCurrentView("routineView");
  };

  const sidebarProps = {
    routines,
    setCurrentView,
    handleNewChat,
    setSelectedRoutineId: openRoutineView,
    addRoutine,
    selectedRoutineId,
    editingRoutine,
    setEditingRoutine,
    menuOpenFor,
    setMenuOpenFor,
    updateRoutine,
    removeRoutine
  };

  const MainPanel = useMemo(() => {
    switch (currentView) {
      case "setGoal":
        return <SetGoalPanel addRoutine={addRoutine} setCurrentView={setCurrentView} setSelectedRoutineId={setSelectedRoutineId} />;
      case "routineView":
        return selectedRoutineId ? (
          <RoutineStickyView
            routines={routines}
            selectedRoutineId={selectedRoutineId}
            stickies={stickies}
            setStickyText={setStickyText}
            setStickyColor={setStickyColor}
            setCurrentView={setCurrentView}
            setSelectedRoutineId={setSelectedRoutineId}
          />
        ) : null;
      case "calendar":
        return (
          <CalendarView
            routines={routines}
            setRoutines={setRoutines}
            eventStatuses={eventStatuses}
            setEventStatus={setEventStatus}
            editBuffer={editBuffer}
            setEditBuffer={setEditBuffer}
            activeCalendarDate={activeCalendarDate}
            setActiveCalendarDate={setActiveCalendarDate}
            saveChanges={() => {}}
            hasChanges={(id) => !!editBuffer[id]}
          />
        );
      case "diary":
        return (
          <DiaryView
            diary={diary}
            addDiaryEntry={addDiaryEntry}
            deleteDiaryEntry={deleteDiaryEntry}
            updateDiaryEntry={updateDiaryEntry}
            generateMonthlySummaryIfMissing={() => {}}
          />
        );
      case "settings":
        return <SettingsPanel settings={settings} setSettings={setSettings} setCurrentView={setCurrentView} />;
      default:
        return (
          <ExploreView
            exploreBuffer={exploreBuffer}
            handleExploreSend={handleExploreSend}
            isAILoading={isAILoading}
            settings={settings}
            routines={routines}
            currentView={currentView}
            setCurrentView={setCurrentView}
          />
        );
    }
  }, [currentView, selectedRoutineId, routines, stickies, editBuffer, activeCalendarDate, exploreBuffer, isAILoading, settings,diary]);

  return (
    <div className="flex h-screen w-full font-sans bg-gradient-to-br from-violet-50 to-fuchsia-50 antialiased">
      <div className={`flex-1 min-w-0 transition-all duration-300 ${isSidebarOpen ? "lg:w-[calc(100%-20rem)]" : "w-full"}`}>
        {MainPanel}
      </div>

      <div className={`transition-all duration-300 ${isSidebarOpen ? "w-80" : "w-0"} flex-shrink-0 overflow-hidden`}>
        {isSidebarOpen && <div className="w-80 h-full"><Sidebar {...sidebarProps} /></div>}
      </div>

      {!isSidebarOpen && <div className="fixed right-4 top-6 z-50"><SidebarToggle inside onClick={() => setIsSidebarOpen(true)} /></div>}
      {isSidebarOpen && <div className="fixed right-4 top-6 z-50"><SidebarToggle inside onClick={() => setIsSidebarOpen(false)} /></div>}
    </div>
  );
}
