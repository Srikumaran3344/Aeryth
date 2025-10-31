// src/popup.jsx
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Loader2, X } from "lucide-react";
import { auth, signInWithGoogleToken, signOutUser } from "./utils/firebaseInit.js";
import { loadAsync } from "./utils/storage.js";

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
      // Use Chrome Identity API to get OAuth token
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError || !token) {
            reject(chrome.runtime.lastError || new Error("No token"));
          } else {
            resolve(token);
          }
        });
      });

      // Sign in to Firebase using the token
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
  const currentTime = now.getHours() * 60 + now.getMinutes(); // minutes since midnight
  
  // Helper to convert routine days to numeric weekday index: Mon:1..Sun:0
  const dayNameToIdx = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const todayWeekday = now.getDay();

  // Filter today's routines that haven't started yet
  const upcomingRoutines = (data?.routines || [])
    .filter(r => {
      // Check if routine is scheduled for today
      if (!r.days || !r.days.some(dd => dayNameToIdx[dd] === todayWeekday)) return false;
      
      // Check if routine hasn't started yet
      const [hh, mm] = (r.startTime || "00:00").split(":").map(Number);
      const routineStartTime = hh * 60 + mm;
      return routineStartTime > currentTime;
    })
    .sort((a, b) => {
      // Sort by start time
      const aTime = (a.startTime || "00:00");
      const bTime = (b.startTime || "00:00");
      return aTime > bTime ? 1 : -1;
    })
    .slice(0, 3); // Take only next 3

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
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>{r.startTime} - {r.endTime}</div>
                  {r.description && (
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{r.description}</div>
                  )}
                </div>
              )) : <div style={{ fontSize: 12, opacity: 0.7 }}>No more events today.</div>}
            </>
          )}

          {view === "calendar" && (
            <div>
              <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Calendar</h3>
              <p style={{ opacity: 0.8, fontSize: 12 }}>Calendar view coming soon.</p>
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