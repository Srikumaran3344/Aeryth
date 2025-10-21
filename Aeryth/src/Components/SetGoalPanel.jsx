// src/components/SetGoalPanel.jsx
import React, { useState } from "react";

export default function SetGoalPanel({ addRoutine, setCurrentView, setSelectedRoutineId }) {
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
