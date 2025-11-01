// src/components/RoutineStickyView.jsx
import React, { useEffect, useState } from "react";
import { iso, fmtShort } from "../utils/helpers";

export default function RoutineStickyView({ routines, selectedRoutineId, stickies, setStickyText, setStickyColor, setCurrentView, setSelectedRoutineId }) {
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

        <div className="grid grid-cols-2 gap-4">
          <div className={`p-4 rounded-xl shadow border ${colorClasses[colorPrev]}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Previous - {fmtShort(new Date(Date.now() - 86400000))}</div>
              {renderColorPicker(colorPrev, setColorPrev, prevKey)}
            </div>
            <textarea value={localPrevText} disabled className="w-full p-3 border rounded h-24 resize-none bg-gray-50" />
          </div>

          <div className={`p-4 rounded-xl shadow border ${colorClasses[colorNext]}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Next - {fmtShort(new Date(Date.now() + 86400000))}</div>
              {renderColorPicker(colorNext, setColorNext, nextKey)}
            </div>
            <textarea value={localNextText} onChange={(e) => setLocalNextText(e.target.value)} onBlur={() => persistText(nextKey, localNextText)} className="w-full p-3 border rounded h-24 resize-none" />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={() => { setCurrentView("explore"); setSelectedRoutineId(null); }} className="px-4 py-2 rounded bg-gray-100">Back</button>
        </div>
      </div>
    </div>
  );
}
