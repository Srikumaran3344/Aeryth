// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import CalendarView from "./Components/CalendarView";
import DiaryView from "./Components/DiaryView";
import ExploreView from "./Components/ExploreView";
import RoutineStickyView from "./Components/RoutineStickyView";
import SetGoalPanel from "./Components/SetGoalPanel";
import SettingsPanel from "./Components/SettingsPanel";
import Sidebar from "./Components/Sidebar";
import TopPills from "./Components/shared/TopPills";
import SidebarToggle from "./Components/shared/SidebarToggle";
import { loadAsync, saveAsync } from "./utils/storage";
import { iso } from "./utils/helpers";

export default function App() {
  /* persisted state */
  const [settings, setSettings] = useState({ aerythTone: "Friendly", userInfo: "", routineCriteria: "" });
  const [routines, setRoutines] = useState([]);
  const [diary, setDiary] = useState({});
  const [stickies, setStickies] = useState({});
  const [eventStatuses, setEventStatuses] = useState({});
  const [notifChats, setNotifChats] = useState({});
  const [profileSummary, setProfileSummary] = useState(null);

  /* UI state */
  const [currentView, setCurrentView] = useState("explore");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedRoutineId, setSelectedRoutineId] = useState(null);
  const [editingRoutine, setEditingRoutine] = useState(null);
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  /* calendar edit buffer */
  const [editBuffer, setEditBuffer] = useState({});

  useEffect(() => {
    (async () => {
      const s = await loadAsync("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" });
      setSettings(s);
      const r = await loadAsync("aeryth_routines", []);
      // ensure createdAt typed as Date objects if string
      r.forEach(rr => { if (rr && rr.createdAt && typeof rr.createdAt === "string") rr.createdAt = new Date(rr.createdAt); });
      setRoutines(r);
      setDiary(await loadAsync("aeryth_diary", {}));
      setStickies(await loadAsync("aeryth_stickies", {}));
      setEventStatuses(await loadAsync("aeryth_event_statuses", {}));
      setNotifChats(await loadAsync("aeryth_notif_chats", {}));
      setProfileSummary(await loadAsync("aeryth_profile", null));
    })();
  }, []);

  useEffect(() => { saveAsync("aeryth_settings", settings); }, [settings]);
  useEffect(() => { saveAsync("aeryth_routines", routines.map(r => ({ ...r, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : r.createdAt }))); }, [routines]);
  useEffect(() => { saveAsync("aeryth_diary", diary); }, [diary]);
  useEffect(() => { saveAsync("aeryth_stickies", stickies); }, [stickies]);
  useEffect(() => { saveAsync("aeryth_event_statuses", eventStatuses); }, [eventStatuses]);
  useEffect(() => { saveAsync("aeryth_notif_chats", notifChats); }, [notifChats]);
  useEffect(() => { saveAsync("aeryth_profile", profileSummary); }, [profileSummary]);

  /* basic CRUD helpers (kept minimal here) */
  const addRoutine = (r) => {
    const id = crypto.randomUUID();
    const now = new Date();
    const rr = { ...r, id, createdAt: now };
    setRoutines(prev => [rr, ...prev]);
    return id;
  };
  const updateRoutine = (id, patch) => setRoutines(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRoutine = (id) => {
    setRoutines(prev => prev.filter(r => r.id !== id));
    setStickies(prev => { const n = { ...prev }; delete n[id]; return n; });
    setEventStatuses(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (selectedRoutineId === id) { setSelectedRoutineId(null); setCurrentView("explore"); }
  };

  /* event status setter */
  const setEventStatus = (rid, dateIso, status) => {
    setEventStatuses(prev => { const n = { ...(prev || {}) }; n[rid] = { ...(n[rid] || {}), [dateIso]: status }; return n; });
  };

  /* Main content panel selection */
  const MainPanel = () => {
    if (currentView === "setGoal") return <SetGoalPanel addRoutine={addRoutine} setCurrentView={setCurrentView} setSelectedRoutineId={setSelectedRoutineId} />;
    if (currentView === "routineView" && selectedRoutineId) return <RoutineStickyView routines={routines} selectedRoutineId={selectedRoutineId} stickies={stickies} setStickyText={(rid,d,t)=>{ setStickies(prev=>{ const n={...prev}; n[rid]=n[rid]||{dates:{}}; n[rid].dates[d]= {...(n[rid].dates[d]||{}), text:t}; return n; }); }} setStickyColor={(rid,d,c)=>{ setStickies(prev=>{ const n={...prev}; n[rid]=n[rid]||{dates:{}}; n[rid].dates[d]= {...(n[rid].dates[d]||{}), color:c}; return n; }); }} setCurrentView={setCurrentView} setSelectedRoutineId={setSelectedRoutineId} />;
    if (currentView === "calendar") return <CalendarView routines={routines} setRoutines={setRoutines} eventStatuses={eventStatuses} setEventStatus={setEventStatus} editBuffer={editBuffer} setEditBuffer={setEditBuffer} saveChanges={(id)=>{ if (editBuffer[id]) { updateRoutine(id, editBuffer[id]); setEditBuffer(prev=>{ const n={...prev}; delete n[id]; return n; }); } }} hasChanges={(id)=>!!editBuffer[id]} />;
    if (currentView === "diary") return <DiaryView diary={diary} addDiaryEntry={(t,d)=>{ /* lightweight */ const dd = d ? new Date(d) : new Date(); const mk = `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,"0")}`; const dk = iso(dd); setDiary(prev=>{ const n={...prev}; n[mk]=n[mk]||{}; n[mk][dk]=n[mk][dk]||[]; n[mk][dk]=[{id:crypto.randomUUID(), text:t, ts: new Date().toISOString()}, ...(n[mk][dk]||[])]; return n; }); }} deleteDiaryEntry={()=>{}} updateDiaryEntry={()=>{}} generateMonthlySummaryIfMissing={()=>{}} />;
    if (currentView === "settings") return <SettingsPanel settings={settings} setSettings={setSettings} setCurrentView={setCurrentView} />;
    return <ExploreView exploreBuffer={[]} handleExploreSend={()=>{}} isAILoading={false} settings={settings} routines={routines} />;
  };

  return (
    <div className="flex h-screen w-full font-sans bg-gradient-to-br from-violet-50 to-fuchsia-50 antialiased">
      <div className={`flex-1 min-w-0 transition-all duration-300 ${isSidebarOpen ? "lg:w-[calc(100%-20rem)]" : "w-full"}`}>
        {/* Top pills restored */}
        <div className="p-4 bg-transparent border-b">
          <TopPills view={currentView} setView={setCurrentView} />
        </div>

        {/* Main content */}
        <MainPanel />
      </div>

      {/* Sidebar area */}
      <div className={`transition-all duration-300 ${isSidebarOpen ? "w-80" : "w-0"} flex-shrink-0 overflow-hidden`}>
        {isSidebarOpen && <div className="w-80 h-full"><Sidebar routines={routines} setCurrentView={setCurrentView} handleNewChat={()=>{}} setSelectedRoutineId={setSelectedRoutineId} addRoutine={addRoutine} selectedRoutineId={selectedRoutineId} editingRoutine={editingRoutine} setEditingRoutine={setEditingRoutine} menuOpenFor={menuOpenFor} setMenuOpenFor={setMenuOpenFor} updateRoutine={updateRoutine} removeRoutine={removeRoutine} /></div>}
      </div>

      {/* Floating toggle when sidebar closed */}
      {!isSidebarOpen && <div className="fixed right-4 top-6 z-50"><SidebarToggle inside onClick={() => setIsSidebarOpen(true)} /></div>}
      {/* When sidebar open show a small toggle near top-right to close */}
      {isSidebarOpen && <div className="fixed right-4 top-6 z-50"><SidebarToggle inside onClick={() => setIsSidebarOpen(false)} /></div>}
    </div>
  );
}