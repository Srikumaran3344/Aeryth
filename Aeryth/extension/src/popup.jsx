// src/popup.jsx
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Loader2, X } from "lucide-react";
import { auth, signInWithGoogleToken, signOutUser, ensureFirebaseAuth } from "./utils/firebaseInit.js";
import { loadAsync } from "./utils/storage.js";

const Popup = () => {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState("settings");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // -------------------------------------------------
  // 1️⃣ Handle Firebase Auth state
  // -------------------------------------------------
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

  // -------------------------------------------------
  // 2️⃣ Load saved user data
  // -------------------------------------------------
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

  // -------------------------------------------------
  // 3️⃣ Chrome Identity + Firebase Sign-in
  // -------------------------------------------------
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

  // -------------------------------------------------
  // 4️⃣ Handle sign-out
  // -------------------------------------------------
  async function handleSignOut() {
    setLoading(true);
    await signOutUser();
    setUser(null);
    setData(null);
    setView("settings");
    setLoading(false);
  }

  // -------------------------------------------------
  // 5️⃣ Loading State
  // -------------------------------------------------
  if (loading) {
    return (
      <div style={{
        width: 320, height: 420, display: "flex", alignItems: "center",
        justifyContent: "center", background: "linear-gradient(180deg,#8b5cf6,#7c3aed)",
        color: "white", fontFamily: "system-ui"
      }}>
        <div style={{ textAlign: "center" }}>
          <Loader2 className="animate-spin" size={28} />
          <div style={{ marginTop: 8 }}>Connecting to Firebase...</div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------
  // 6️⃣ Not signed in
  // -------------------------------------------------
  if (!user) {
    return (
      <div style={{
        width: 320, height: 420, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "linear-gradient(180deg,#8b5cf6,#7c3aed)", color: "white",
        fontFamily: "system-ui", textAlign: "center", padding: 16
      }}>
        <h3>Welcome to Aeryth</h3>
        <p style={{ opacity: 0.85 }}>Sign in with Google to continue</p>
        {error && <div style={{ color: "#ffd1d1" }}>{error}</div>}
        <button
          onClick={signInWithGoogle}
          style={{
            marginTop: 12, background: "white", color: "#7c3aed",
            padding: "8px 12px", borderRadius: 6, border: "none", fontWeight: 600
          }}
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  // -------------------------------------------------
  // 7️⃣ Signed-in view
  // -------------------------------------------------
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = (data?.routines || []).filter(r => r.date === todayIso).slice(0, 3);

  return (
    <div style={{
      width: 320, height: 420, background: "linear-gradient(180deg,#8b5cf6,#7c3aed)",
      color: "white", fontFamily: "system-ui", borderRadius: 12, overflow: "hidden", position: "relative"
    }}>
      <div
        style={{ position: "absolute", top: 6, right: 6, cursor: "pointer" }}
        onClick={() => window.close()}
      >
        <X size={16} />
      </div>

      <div style={{ display: "flex", height: "100%" }}>
        <div style={{
          width: 50, background: "rgba(255,255,255,0.1)",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "space-around", padding: "6px 0"
        }}>
          {[
            ["📅", "Events", () => setView("events")],
            ["🗓️", "Calendar", () => setView("calendar")],
            ["⚙️", "Settings", () => setView("settings")],
            ["🌐", "Web", () => chrome.tabs.create({ url: "https://aeryth01.web.app/" })]
          ].map(([icon, title, onClick]) => (
            <div
              key={title}
              onClick={onClick}
              title={title}
              style={{ cursor: "pointer", fontSize: 18, opacity: view === title.toLowerCase() ? 1 : 0.8 }}
            >
              {icon}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, padding: 10, overflowY: "auto" }}>
          {view === "events" && (
            <>
              <h3>Today's Events</h3>
              {upcoming.length ? upcoming.map(r => (
                <div
                  key={r.id}
                  style={{ marginBottom: 8, padding: 6, background: "rgba(255,255,255,0.15)", borderRadius: 6 }}
                >
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12 }}>{r.startTime} - {r.endTime}</div>
                </div>
              )) : <div style={{ fontSize: 12, opacity: 0.7 }}>No events today.</div>}
            </>
          )}

          {view === "calendar" && (
            <div>
              <h3>Calendar</h3>
              <p style={{ opacity: 0.8, fontSize: 12 }}>Calendar view coming soon.</p>
            </div>
          )}

          {view === "settings" && (
            <div>
              <h3>Settings</h3>
              <p style={{ fontSize: 13, marginBottom: 6 }}>
                Signed in as <b>{user.displayName || user.email}</b>
              </p>
              <button
                onClick={handleSignOut}
                style={{
                  background: "white", color: "#7c3aed", fontWeight: 600,
                  padding: "6px 12px", border: "none", borderRadius: 6, cursor: "pointer"
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")).render(<Popup />);
