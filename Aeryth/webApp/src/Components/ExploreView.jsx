// src/components/ExploreView.jsx
import React, { useState } from "react";
import TopPills from "./shared/TopPills";

export default function ExploreView({ exploreBuffer, handleExploreSend, isAILoading, settings, routines, currentView, setCurrentView }) {
  const [input, setInput] = useState("");
  return (
    <div className="flex-1 h-full p-6 overflow-auto">
      <div className="max-w-7xl mx-auto flex flex-col h-full">
        <div className="mb-2 text-center text-gray-500 italic">Aeryth's Tone: <span className="font-semibold text-violet-600">{settings.aerythTone}</span></div>

        <div className="flex-1 overflow-auto space-y-4 pb-6">
          {exploreBuffer.map(m => (
            <div key={m.id} className={`${m.role==="user" ? "flex justify-end" : "flex justify-start"}`}>
              <div className={`${m.role==="user" ? "bg-violet-500 text-white" : m.role==="aeryth" ? "bg-white text-gray-800 border" : "bg-red-50 text-red-600"} inline-block px-4 py-2 rounded-2xl shadow`}>
                <div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            </div>
          ))}

          {isAILoading && <div className="text-gray-500">Aeryth is thinking...</div>}
        </div>

        <div className="pt-4 shadow-2xl rounded-4xl bg-white p-4">
          <TopPills view={currentView} setView={setCurrentView} />
          <form onSubmit={(e)=>{ e.preventDefault(); const v = input.trim(); if (!v) return; handleExploreSend(v); setInput(""); }} className="flex space-x-3">
            <input value={input} onChange={(e)=>setInput(e.target.value)} placeholder={isAILoading ? "Waiting..." : "Start exploring a new task..."} className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-violet-400" />
            <button type="submit" className="px-6 py-3 rounded-xl font-bold bg-violet-500 text-white hover:bg-violet-600">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}
