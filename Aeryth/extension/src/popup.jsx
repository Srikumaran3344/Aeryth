import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// ✅ Try restoring saved file handle from chrome storage
async function getSavedHandle() {
  const { fileHandle } = await chrome.storage.local.get("fileHandle");
  if (!fileHandle) return null;

  try {
    // Check permission first (if expired, return null)
    const perm = await fileHandle.queryPermission({ mode: "read" });
    if (perm === "granted") return fileHandle;
    const req = await fileHandle.requestPermission({ mode: "readwrite" });
    return req === "granted" ? fileHandle : null;
  } catch {
    return null;
  }
}

// ✅ Ask user to choose the data.json file
async function requestFile() {
  const [handle] = await window.showOpenFilePicker({
    types: [
      {
        description: "Aeryth Data",
        accept: { "application/json": [".json"] },
      },
    ],
  });
  await chrome.storage.local.set({ fileHandle: handle });
  return handle;
}

// ✅ Read JSON content
async function readData(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  return text ? JSON.parse(text) : {};
}

const Popup = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("events");

  // ---------- Initial setup ----------
  useEffect(() => {
    (async () => {
      try {
        // Ask notification permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError("Notifications blocked. Enable them for reminders.");
        }

        // Try to restore saved handle
        let handle = await getSavedHandle();
        if (!handle) {
          setError("Please choose your Aeryth data file.");
          return;
        }

        const json = await readData(handle);
        setData(json);
      } catch (err) {
        console.error(err);
        setError("Error reading saved file.");
      }
    })();
  }, []);

  // ---------- File picker ----------
  const chooseFile = async () => {
    try {
      const handle = await requestFile();
      const json = await readData(handle);
      setData(json);
      setError(null);
    } catch (err) {
      setError("File selection cancelled or failed.");
    }
  };

  // ---------- Loading or error ----------
  if (!data) {
    return (
      <div
        style={{
          width: "270px",
          height: "380px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
          color: "white",
          fontFamily: "system-ui",
          textAlign: "center",
          padding: "16px",
        }}
      >
        <p>{error || "Loading..."}</p>
        {error && (
          <button
            onClick={chooseFile}
            style={{
              background: "white",
              color: "#7c3aed",
              padding: "6px 12px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              marginTop: "8px",
            }}
          >
            Choose File
          </button>
        )}
      </div>
    );
  }

  // ---------- Main UI ----------
  const upcoming = (data.routines || []).slice(0, 3);

  return (
    <div
      style={{
        width: "270px",
        height: "380px",
        background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
        color: "white",
        display: "flex",
        borderRadius: "12px",
        overflow: "hidden",
        fontFamily: "system-ui",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: "50px",
          background: "rgba(255,255,255,0.1)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-around",
        }}
      >
        {[
          ["📅", "Events", () => setView("events")],
          ["🗒️", "Sticky", () => setView("sticky")],
          ["🗓️", "Calendar", () => setView("calendar")],
          ["⚙️", "Settings", () => setView("settings")],
          ["🌐", "Web", () => chrome.tabs.create({ url: "https://aeryth01.web.app/" })],
        ].map(([icon, title, onClick]) => (
          <div
            key={title}
            onClick={onClick}
            title={title}
            style={{ cursor: "pointer", fontSize: "18px" }}
          >
            {icon}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: "10px", overflowY: "auto" }}>
        {view === "events" && (
          <>
            <h3 style={{ marginBottom: "8px" }}>Upcoming Events</h3>
            {upcoming.length > 0 ? (
              upcoming.map((r) => (
                <div
                  key={r.id}
                  style={{
                    marginBottom: "8px",
                    padding: "6px",
                    background: "rgba(255,255,255,0.15)",
                    borderRadius: "6px",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: "12px" }}>
                    {r.startTime} - {r.endTime}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: "12px", opacity: 0.7 }}>No upcoming events.</div>
            )}
          </>
        )}

        {view === "settings" && (
          <div>
            <h3>Storage</h3>
            <p style={{ fontSize: "12px", opacity: 0.8 }}>
              {data.settings?.storagePath || "Default internal storage"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")).render(<Popup />);
