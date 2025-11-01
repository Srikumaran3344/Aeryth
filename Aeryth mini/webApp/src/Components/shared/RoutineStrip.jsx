// src/components/shared/RoutineStrip.jsx
import React from "react";

export default function RoutineStrip({ r, selectedRoutineId, setSelectedRoutineId, editingRoutine, setEditingRoutine, menuOpenFor, setMenuOpenFor, updateRoutine, removeRoutine }) {
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
        <button onClick={() => { setSelectedRoutineId(r.id); }} className="flex-1 text-left font-medium">{r.name}</button>
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
}
