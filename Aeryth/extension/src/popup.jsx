import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const Popup = () => {
  const [data, setData] = useState(null);
  const [view, setView] = useState("events");

  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "READ_DATA_ONCE" });
        if (res?.ok && res.data) {
          setData(res.data);
        } else {
          console.warn("Failed to load data:", res);
        }
      } catch (e) {
        console.error("Error reading data from background:", e);
      }
    })();
  }, []);

  if (!data) {
    return (
      <div
        style={{
          width: "270px",
          height: "380px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
          color: "white",
          fontFamily: "system-ui",
        }}
      >
        Loading...
      </div>
    );
  }

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
