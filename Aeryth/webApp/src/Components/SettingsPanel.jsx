// src/components/SettingsPanel.jsx
import React, { useState, useEffect } from "react";
import { buildAndPersistProfileSummary } from "../utils/personalization";
import { pickAndStoreFolder, getSavedFolderInfo } from "../utils/storage";
import { HelpCircle } from "lucide-react";

export default function SettingsPanel({ settings, setSettings, setCurrentView }) {
  const [form, setForm] = useState(
    settings || { aerythTone: "Friendly", userInfo: "", routineCriteria: "", storagePath: "" }
  );
  const [savedPath, setSavedPath] = useState("");

  useEffect(() => {
    (async () => {
      // load saved folder info (if any) and display pseudo-path
      const saved = await getSavedFolderInfo();
      if (saved?.path) {
        setSavedPath(saved.path);
        setForm(f => ({ ...f, storagePath: saved.path }));
      } else {
        setSavedPath("");
      }
    })();
  }, []);

  const handlePickFolder = async () => {
    const res = await pickAndStoreFolder();
    if (res?.path) {
      setSavedPath(res.path);
      setForm(f => ({ ...f, storagePath: res.path }));
    }
  };

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
              <label className="font-semibold">Routine Criteria</label>
              <input value={form.routineCriteria} onChange={e=>setForm({...form, routineCriteria: e.target.value})} className="w-full mt-1 p-3 border rounded-lg" />
            </div>

            {/* Location */}
            <div>
              <label className="font-semibold flex items-center gap-1">
                Location
                <div className="relative group cursor-pointer">
                  <HelpCircle size={16} className="text-gray-400" />
                  <div className="absolute hidden group-hover:block top-6 left-0 bg-gray-700 text-white text-sm rounded p-2 w-64 z-10">
                    If you need personalised content and to save your data, choose a location in your device.
                    Also choose the same location in the Aeryth extension.
                  </div>
                </div>
              </label>

              <div className="flex mt-1 gap-2">
                <input
                  readOnly
                  value={savedPath || "No location selected"}
                  className="flex-1 p-3 border rounded-lg bg-gray-50 text-gray-700"
                />
                <button
                  onClick={handlePickFolder}
                  className="px-4 py-2 rounded-lg bg-violet-500 text-white font-semibold hover:bg-violet-600"
                >
                  Choose
                </button>
              </div>
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
