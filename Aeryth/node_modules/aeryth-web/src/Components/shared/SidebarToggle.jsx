// src/components/shared/SidebarToggle.jsx
import React from "react";

export default function SidebarToggle({ inside=false, onClick }) {
  return (
    <button onClick={onClick} className={`${inside ? "bg-white text-violet-600" : "bg-violet-500 text-white"} p-2 rounded-full shadow`}>
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
  );
}
