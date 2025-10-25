// src/components/SettingsPanel.jsx
import React, { useState } from "react";
import { buildAndPersistProfileSummary } from "../utils/personalization";

export default function SettingsPanel({ settings, setSettings, setCurrentView }) {
  const [form, setForm] = useState(settings || { aerythTone: "Friendly", userInfo: "", routineCriteria: "" });
  const saveSettings = async () => {
    setSettings(form);
    await buildAndPersistProfileSummary({ settings: form, routines: [], diary: {} });
    setCurrentView("explore");
  };
  return (
    <div className="flex items-center justify-center h-full p-6 overflow-auto">
      <div className="max-w-2xl w-full mx-auto">
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
