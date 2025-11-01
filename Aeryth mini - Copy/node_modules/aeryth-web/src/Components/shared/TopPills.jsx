// src/components/shared/TopPills.jsx
import React from "react";

export default function TopPills({ view, setView }) {
  return (
    <div className="flex-1 flex justify-around mb-3 gap-10">
      <button onClick={() => setView("explore")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "explore" ? "bg-violet-500 text-black" : "bg-gray-100 hover:bg-violet-100"}`}>
        Explore
      </button>

      <button onClick={() => setView("setGoal")}
        className={`flex-1 px-4 py-2 rounded-full text-sm font-semibold transition shadow-md ${view === "setGoal" ? "bg-violet-500 text-white" : "bg-gray-100 hover:bg-violet-100"}`}>
        Set Routine
      </button>

      <button onClick={() => setView("diary")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "diary" ? "bg-violet-500 text-white" : "bg-gray-100 hover:bg-violet-100"}`}>
        Diary
      </button>
    </div>
  );
}
