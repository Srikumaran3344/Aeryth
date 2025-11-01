// src/components/Sidebar.jsx
import React, { useState } from "react";
import SidebarToggle from "./shared/SidebarToggle";
import RoutineStrip from "./shared/RoutineStrip";

export default function Sidebar({
  routines, setCurrentView, handleNewChat, setSelectedRoutineId, addRoutine,
  selectedRoutineId, editingRoutine, setEditingRoutine, menuOpenFor, setMenuOpenFor, updateRoutine, removeRoutine
}) {
  const [searchRoutines, setSearchRoutines] = useState("");

  const filteredRoutines = routines.filter(r => r.name?.toLowerCase().includes(searchRoutines.trim().toLowerCase()));
  

  // Calculate upcoming event for today — if events remaining show next one else "No more work today"
  const todayIso = (d => d.toISOString().slice(0,10))(new Date());
  const now = new Date();

  // Helper to convert routine days to numeric weekday index local: Mon:1..Sun:0
  const dayNameToIdx = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };

  // find today's routines sorted by startTime
  const todays = filteredRoutines
    .filter(r => (r.days || []).some(dd => dayNameToIdx[dd] === new Date().getDay()))
    .map(r => ({ ...r }))
    .sort((a,b) => (a.startTime||"00:00") > (b.startTime||"00:00") ? 1 : -1);

  // find next upcoming: first with startTime > now, else if none and there were items then "No more work today"
  let upcomingItem = null;
  for (const r of todays) {
    const [hh, mm] = (r.startTime || "00:00").split(":").map(Number);
    const startDate = new Date(); startDate.setHours(hh, mm, 0, 0);
    if (startDate.getTime() > now.getTime()) { upcomingItem = r; break; }
  }

  return (
    <div className="w-80 h-full p-4 flex flex-col bg-white border-l">
      <div className="flex items-center justify-between mb-4 pt-1">
        <div>
          <h3 className="text-2xl font-extrabold text-violet-600">Routines</h3>
          <p className="text-sm text-gray-500">Your daily rhythm</p>
        </div>

      </div>
      <button onClick={handleNewChat} className="w-full mb-2 py-2 rounded-lg bg-violet-500 text-white font-bold">+ New Chat</button>
      <button onClick={() => setCurrentView("setGoal")} className="w-full mb-2 py-2 rounded-lg bg-violet-500 text-white font-bold">+ New Routine</button>

      <input value={searchRoutines} onChange={(e) => setSearchRoutines(e.target.value)} placeholder="Search routines..." className="w-full p-2 border rounded-xl mb-3" />

      <div className="mb-4 flex flex-col gap-2">
        {upcomingItem ? (
          <div>
            <h4 className="text-sm font-semibold text-gray-800">Upcoming...</h4>
            <div className="mt-1 space-y-2">
              <div className="p-2 bg-violet-50 rounded-xl border-l-2 border-violet-400">
                <div className="font-bold text-violet-800 truncate">{upcomingItem.name}</div>
                <div className="text-xs text-violet-600 mt-1">At {upcomingItem.startTime}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500 italic mt-2">No more work today</div>
        )}
      </div>

      <h4 className="text-sm font-bold text-gray-800 w-full ">Routines:</h4>
      <div className="flex-1 overflow-auto space-y-3">
        <div className="mt-2 space-y-2 w-full">
          {filteredRoutines.length ? filteredRoutines.map(r => (
            <RoutineStrip key={r.id} r={r} selectedRoutineId={selectedRoutineId} setSelectedRoutineId={setSelectedRoutineId}
              editingRoutine={editingRoutine} setEditingRoutine={setEditingRoutine}
              menuOpenFor={menuOpenFor} setMenuOpenFor={setMenuOpenFor} updateRoutine={updateRoutine} removeRoutine={removeRoutine}
            />
          )) : <div className="text-sm text-gray-500">No routines yet</div>}
        </div>
      </div>

      <div className="pt-2 border-t mt-3 space-y-1">
        <button onClick={() => setCurrentView("calendar")} className={`flex items-center w-full p-3 rounded-xl hover:bg-gray-100`}><span className="mr-3 text-xl">🗓️</span>Calendar</button>
        <button onClick={() => setCurrentView("diary")} className={`flex items-center w-full p-3 rounded-xl hover:bg-gray-100`}><span className="mr-3 text-xl">✍️</span>Diary</button>
        <button onClick={() => setCurrentView("settings")} className={`flex items-center w-full p-3 rounded-xl hover:bg-gray-100`}><span className="mr-3 text-xl">⚙️</span>Settings</button>
      </div>
    </div>
  );
}
