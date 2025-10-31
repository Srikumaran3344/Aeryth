// src/popup.jsx
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Loader2, X } from "lucide-react";
import { auth, signInWithGoogleToken, signOutUser } from "./utils/firebaseInit.js";
import { loadAsync, saveAsync } from "./utils/storage.js";

// ======================= Firebase Bridge for Background Worker =======================
// This allows the service worker to request Firebase data since it can't import Firebase directly

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchFirebaseData") {
    handleFetchFirebaseData().then(sendResponse);
    return true; // Keep channel open for async response
  }
  
  if (message.action === "updateEventStatus") {
    handleUpdateEventStatus(message).then(sendResponse);
    return true;
  }
  
  if (message.action === "logNotification") {
    handleLogNotification(message).then(sendResponse);
    return true;
  }
});

async function handleFetchFirebaseData() {
  try {
    const routines = await loadAsync("aeryth_routines", []);
    const settings = await loadAsync("aeryth_settings", { aerythTone: "Friendly" });
    const profile = await loadAsync("aeryth_profile", "");
    
    return {
      success: true,
      data: { routines, settings, profile }
    };
  } catch (error) {
    console.error("Firebase fetch failed:", error);
    return { success: false, error: error.message };
  }
}

async function handleUpdateEventStatus({ routineId, dateIso, status }) {
  try {
    const eventStatuses = await loadAsync("aeryth_event_statuses", {});
    eventStatuses[routineId] = eventStatuses[routineId] || {};
    eventStatuses[routineId][dateIso] = status;
    await saveAsync("aeryth_event_statuses", eventStatuses);
    return { success: true };
  } catch (error) {
    console.error("Update status failed:", error);
    return { success: false };
  }
}

async function handleLogNotification({ routineId, dateIso, text }) {
  try {
    const notifChats = await loadAsync("aeryth_notif_chats", {});
    notifChats[routineId] = notifChats[routineId] || {};
    notifChats[routineId][dateIso] = notifChats[routineId][dateIso] || [];
    
    notifChats[routineId][dateIso].push({
      from: "user",
      text,
      ts: new Date().toISOString()
    });
    
    await saveAsync("aeryth_notif_chats", notifChats);
    return { success: true };
  } catch (error) {
    console.error("Log notification failed:", error);
    return { success: false };
  }
}

// ======================= Utility Functions =======================

// ✅ Correct local ISO date (prevents off-by-one day bug)
function iso(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().split("T")[0];
}

const weekdayNameFromIso = (isoDate) => {
  const d = new Date(isoDate + "T12:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
};

// ======================= Main Popup Component =======================

const Popup = () => {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState("settings");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (u) {
        setUser(u);
        await fetchData();
      } else {
        setUser(null);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const routines = await loadAsync("aeryth_routines", []);
      const settings = await loadAsync("aeryth_settings", {});
      setData({ routines, settings });
      
      // Notify background worker to sync (optional - triggers alarm scheduling)
      chrome.runtime.sendMessage({ action: "syncNow" }).catch(() => {
        console.log("Background worker not ready yet");
      });
    } catch (e) {
      console.error("Failed to load data", e);
      setError("Failed to load data from Firebase");
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError || !token) {
            reject(chrome.runtime.lastError || new Error("No token"));
          } else {
            resolve(token);
          }
        });
      });

      const user = await signInWithGoogleToken(token);
      if (!user) throw new Error("Sign-in failed");
      setUser(user);
      await fetchData();
    } catch (e) {
      console.error("Google sign-in failed", e);
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setLoading(true);
    await signOutUser();
    setUser(null);
    setData(null);
    setView("settings");
    setLoading(false);
  }

  if (loading) {
    return (
      <div style={{ width: 320, height: 420, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#8b5cf6,#7c3aed)", color: "white", fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <Loader2 className="animate-spin" size={28} />
          <div style={{ marginTop: 8 }}>Connecting to Firebase...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ width: 320, height: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#8b5cf6,#7c3aed)", color: "white", fontFamily: "system-ui", textAlign: "center", padding: 16 }}>
        <h3>Welcome to Aeryth</h3>
        <p style={{ opacity: 0.85 }}>Sign in with Google to continue</p>
        {error && <div style={{ color: "#ffd1d1" }}>{error}</div>}
        <button onClick={signInWithGoogle} style={{ marginTop: 12, background: "white", color: "#7c3aed", padding: "8px 12px", borderRadius: 6, border: "none", fontWeight: 600 }}>Sign in with Google</button>
      </div>
    );
  }

  // Calculate upcoming events for today
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const currentTime = now.getHours() * 60 + now.getMinutes();
  
  const dayNameToIdx = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const todayWeekday = now.getDay();

  const upcomingRoutines = (data?.routines || [])
    .filter(r => {
      if (!r.days || !r.days.some(dd => dayNameToIdx[dd] === todayWeekday)) return false;
      const [hh, mm] = (r.startTime || "00:00").split(":").map(Number);
      const routineStartTime = hh * 60 + mm;
      return routineStartTime > currentTime;
    })
    .sort((a, b) => (a.startTime || "00:00") > (b.startTime || "00:00") ? 1 : -1)
    .slice(0, 3);

  // Build calendar events for current month
  const buildCalendarEvents = () => {
    const events = {};
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Get first and last day of current month
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    
    // Initialize all days in month
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      events[iso(d)] = [];
    }
    
    // Add routines to their scheduled days
    (data?.routines || []).forEach(r => {
      if (!r.days || !r.startTime) return;
      const createdAtIso = r.createdAt ? iso(new Date(r.createdAt)) : null;
      
      Object.keys(events).forEach(dayIso => {
        if (createdAtIso && dayIso < createdAtIso) return;
        const weekDay = weekdayNameFromIso(dayIso);
        if (r.days.includes(weekDay)) {
          events[dayIso].push({
            routineId: r.id,
            name: r.name || "Routine",
            color: r.color || "violet",
            startTime: r.startTime,
            endTime: r.endTime
          });
        }
      });
    });
    
    // Sort events by start time
    Object.keys(events).forEach(k => {
      events[k].sort((a, b) => (a.startTime || "") > (b.startTime || "") ? 1 : -1);
    });
    
    return events;
  };

  const calendarEvents = buildCalendarEvents();

  // Build calendar grid
  const buildCalendarGrid = () => {
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday
    
    const days = [];
    
    // Add empty cells for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days in month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(currentYear, currentMonth, d));
    }
    
    return days;
  };

  const calendarGrid = buildCalendarGrid();
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  const getColorClass = (color) => {
    const colors = {
      violet: { bg: "#8b5cf6", text: "white" },
      green: "#86efac",
      rose: "#fda4af",
      amber: "#fbbf24"
    };
    return colors[color] || colors.violet;
  };

  return (
    <div style={{ width: 320, height: 420, background: "linear-gradient(180deg,#8b5cf6,#7c3aed)", color: "white", fontFamily: "system-ui", borderRadius: 12, overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: 6, right: 6, cursor: "pointer" }} onClick={() => window.close()}>
        <X size={16} />
      </div>

      <div style={{ display: "flex", height: "100%" }}>
        <div style={{ width: 50, background: "rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-around", padding: "6px 0" }}>
          {[
            ["📅", "events", () => setView("events")],
            ["🗓️", "calendar", () => setView("calendar")],
            ["⚙️", "settings", () => setView("settings")],
            ["🌐", "web", () => chrome.tabs.create({ url: "https://aeryth01.web.app/" })]
          ].map(([icon, viewName, onClick]) => (
            <div key={viewName} onClick={onClick} title={viewName} style={{ cursor: "pointer", fontSize: 18, opacity: view === viewName ? 1 : 0.6 }}>
              {icon}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, padding: 10, overflowY: "auto" }}>
          {view === "events" && (
            <>
              <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Today's Upcoming Events</h3>
              {upcomingRoutines.length ? upcomingRoutines.map(r => (
                <div key={r.id} style={{ marginBottom: 8, padding: 8, background: "rgba(255,255,255,0.15)", borderRadius: 6, borderLeft: "3px solid rgba(255,255,255,0.4)" }}>
                  <div style={{ fontWeight: 600, marginBottom: 2, fontSize: 20 }}>{r.name}</div>
                  <div style={{ fontSize: 14, opacity: 0.9 }}>{r.startTime} - {r.endTime}</div>
                  {r.description && (
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{r.description}</div>
                  )}
                </div>
              )) : <div style={{ fontSize: 12, opacity: 0.7 }}>No more events today.</div>}
            </>
          )}

          {view === "calendar" && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: 14, textAlign: "center", flexShrink: 0 }}>{monthName}</h3>
              
              {/* Calendar grid - takes full available space */}
              <div style={{ background: "white", borderRadius: 6, padding: 4, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {/* Week day headers */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 3, flexShrink: 0 }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
                    <div key={i} style={{ textAlign: "center", fontSize: 9, fontWeight: 600, color: "#6b7280" }}>
                      {day}
                    </div>
                  ))}
                </div>
                
                {/* Calendar days - fills remaining space */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: `repeat(${Math.ceil(calendarGrid.length / 7)}, 1fr)`, gap: 2, flex: 1 }}>
                  {calendarGrid.map((date, i) => {
                    if (!date) {
                      return <div key={`empty-${i}`} style={{ minHeight: 0 }} />;
                    }
                    
                    const dayIso = iso(date);
                    const isToday = dayIso === todayIso;
                    const events = calendarEvents[dayIso] || [];
                    
                    return (
                      <div 
                        key={dayIso} 
                        style={{ 
                          minHeight: 0,
                          background: isToday ? "#e9d5ff" : "#f3f4f6",
                          borderRadius: 3,
                          padding: "2px",
                          border: isToday ? "1.5px solid #a855f7" : "1px solid #e5e7eb",
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden"
                        }}
                      >
                        {/* Date number - centered */}
                        <div style={{ fontSize: 8, fontWeight: isToday ? 700 : 500, color: "#374151", textAlign: "center", marginBottom: 2, flexShrink: 0 }}>
                          {date.getDate()}
                        </div>
                        
                        {/* Event strips - scrollable if needed */}
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minHeight: 0, overflow: "hidden" }}>
                          {events.slice(0, 2).map((evt, idx) => {
                            const colorStyle = getColorClass(evt.color);
                            return (
                              <div 
                                key={idx}
                                style={{
                                  background: typeof colorStyle === 'object' ? colorStyle.bg : colorStyle,
                                  color: typeof colorStyle === 'object' ? colorStyle.text : "#000",
                                  fontSize: 5.5,
                                  padding: "1px 2px",
                                  borderRadius: 2,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  lineHeight: 1.3,
                                  flexShrink: 0
                                }}
                                title={evt.name}
                              >
                                {evt.name}
                              </div>
                            );
                          })}
                          {events.length > 2 && (
                            <div style={{ fontSize: 5.5, color: "#6b7280", textAlign: "center", flexShrink: 0, marginTop: "auto" }}>
                              +{events.length - 2} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {view === "settings" && (
            <div>
              <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Settings</h3>
              <p style={{ fontSize: 13, marginBottom: 6 }}>Signed in as <b>{user.displayName || user.email}</b></p>
              <button onClick={handleSignOut} style={{ background: "white", color: "#7c3aed", fontWeight: 600, padding: "6px 12px", border: "none", borderRadius: 6, cursor: "pointer" }}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")).render(<Popup />);