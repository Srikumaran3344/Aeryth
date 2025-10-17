// src/App.jsx
import React, { useEffect, useRef, useState } from "react";

/* -----------------------
   LocalStorage helpers
   ----------------------- */
const reviverDate = (k, v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
    ? new Date(v)
    : v;
const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw, reviverDate) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

/* -----------------------
   Gemini Nano wrappers (window.LanguageModel)
   ----------------------- */
let sessions = {};
const ensureModelAvailable = () =>
  !!(typeof window !== "undefined" && window.LanguageModel && window.LanguageModel.create);

async function ensureSession(chatId, systemPrompt) {
  if (!ensureModelAvailable()) throw new Error("Gemini Nano not available.");
  if (!sessions[chatId]) {
    sessions[chatId] = await window.LanguageModel.create({
      initialPrompts: [{ role: "system", content: systemPrompt }],
    });
  }
  return sessions[chatId];
}

async function callGemini(chatId, chatHistory, userSettings, routines) {
  const lastMsg = chatHistory.at(-1)?.text || "";
  const system = `You are Aeryth, a personalized AI companion focused on preventing procrastination. Use user context implicitly. End every response with an action-oriented question or command.

User info: ${userSettings?.userInfo || "None"}
Tone: ${userSettings?.aerythTone || "Friendly"}
Active goals: ${routines.filter((r) => r.chatId === chatId).map((r) => r.goal).join("; ") || "None"}
Conversation length: ${chatHistory.length} turns.`;
  const session = await ensureSession(chatId, system);
  const result = await session.prompt(lastMsg);
  return (result && (result.output ?? result)) || "";
}

async function callGeminiDiary(text, task) {
  if (!ensureModelAvailable()) throw new Error("Gemini Nano not available.");
  const systemPrompt =
    task === "summarize"
      ? "Summarize the diary entry into a concise reflective paragraph focusing on emotions and events."
      : task === "correct_grammar"
      ? "Correct grammar and spelling. Output only corrected text."
      : null;
  if (!systemPrompt) throw new Error("invalid diary task");
  const temp = await window.LanguageModel.create({
    initialPrompts: [{ role: "system", content: systemPrompt }],
  });
  try {
    const r = await temp.prompt(text);
    return (r && (r.output ?? r)) || "";
  } finally {
    temp.destroy?.();
  }
}

/* -----------------------
   App component
   ----------------------- */
export default function App() {
  /* persisted state */
  const [userId] = useState(() => load("aeryth_userId", crypto.randomUUID()));
  useEffect(() => save("aeryth_userId", userId), [userId]);

  const [settings, setSettings] = useState(() =>
    load("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" })
  );
  useEffect(() => save("aeryth_settings", settings), [settings]);

  const [chats, setChats] = useState(() =>
    load("aeryth_chats", [{ id: crypto.randomUUID(), name: "Welcome", createdAt: new Date() }])
  );
  useEffect(() => save("aeryth_chats", chats), [chats]);

  const [messagesStore, setMessagesStore] = useState(() => load("aeryth_messages", []));
  useEffect(() => save("aeryth_messages", messagesStore), [messagesStore]);

  const [routines, setRoutines] = useState(() => load("aeryth_routines", []));
  useEffect(() => save("aeryth_routines", routines), [routines]);

  const [diaryEntries, setDiaryEntries] = useState(() => load("aeryth_diary_entries", []));
  useEffect(() => save("aeryth_diary_entries", diaryEntries), [diaryEntries]);

  /* UI state */
  const [currentChatId, setCurrentChatId] = useState(() => chats[0]?.id ?? null);
  const [messages, setMessages] = useState(() => messagesStore.filter((m) => m.chatId === (chats[0]?.id)));
  const [currentView, setCurrentView] = useState("explore"); // explore, setGoal, diary, calendar, settings
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAILoading, setIsAILoading] = useState(false);
  const [pendingTrackingStyle, setPendingTrackingStyle] = useState(null);

  const [showSetupModal, setShowSetupModal] = useState(() => {
    const s = load("aeryth_settings", null);
    return !s || (!s.userInfo && !s.aerythTone && !s.routineCriteria);
  });

  /* dropdown & inline-rename UI */
  const [openMenuId, setOpenMenuId] = useState(null); // chat id whose menu is open
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingChatName, setEditingChatName] = useState("");

  useEffect(() => {
    setMessages(messagesStore.filter((m) => m.chatId === currentChatId));
  }, [currentChatId, messagesStore]);

  const chatEndRef = useRef(null);
  useEffect(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, [messages, isAILoading]);

  /* helpers */
  const pushMessage = (msg) => {
    const withId = { id: crypto.randomUUID(), ...msg };
    setMessagesStore((prev) => [...prev, withId]);
  };

  const updateChats = (cb) => setChats((prev) => cb(prev));

  /* chat actions */
  const handleNewChat = () => {
    const id = crypto.randomUUID();
    const n = { id, name: `New Chat ${new Date().toLocaleDateString()}`, createdAt: new Date() };
    updateChats((prev) => [n, ...prev]);
    setCurrentChatId(id);
    setCurrentView("explore");
  };

  const handleDeleteChat = (id) => {
    // immediate delete (no dialog per user request)
    setChats((prev) => prev.filter((c) => c.id !== id));
    setMessagesStore((prev) => prev.filter((m) => m.chatId !== id));
    setRoutines((prev) => prev.filter((r) => r.chatId !== id));
    sessions[id]?.destroy?.();
    delete sessions[id];
    if (currentChatId === id) setCurrentChatId(chats[0]?.id ?? null);
  };

  const openRename = (id) => {
    const c = chats.find((x) => x.id === id);
    setEditingChatId(id);
    setEditingChatName(c?.name || "");
    setOpenMenuId(null);
  };
  const applyRename = (id) => {
    const name = editingChatName.trim();
    if (name) setChats((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    setEditingChatId(null);
    setEditingChatName("");
  };

  /* AI send */
  const handleSendMessage = async (text) => {
    if (!text?.trim() || isAILoading || !currentChatId) return;
    const userMsg = { sender: "user", text: text.trim(), timestamp: new Date(), chatId: currentChatId };
    pushMessage(userMsg);

    const upper = text.trim().toUpperCase();
    if (upper === "EVIDENCE" || upper === "REMINDER") { //later change the wording
      setPendingTrackingStyle(upper.toLowerCase());
      pushMessage({
        sender: "aeryth",
        text: "Preference noted. Use Set Goal to formalize details.",
        timestamp: new Date(),
        chatId: currentChatId,
      });
      return;
    }

    if (!ensureModelAvailable()) {
      pushMessage({
        sender: "aeryth",
        text: "Gemini Nano unavailable. Use a supported Chrome runtime for AI features.",
        timestamp: new Date(),
        chatId: currentChatId,
      });
      return;
    }

    setIsAILoading(true);
    try {
      const chatHistory = [...messagesStore.filter((m) => m.chatId === currentChatId), userMsg];
      const aiText = await callGemini(currentChatId, chatHistory, settings, routines);
      pushMessage({ sender: "aeryth", text: aiText || "No response.", timestamp: new Date(), chatId: currentChatId });
    } catch {
      pushMessage({ sender: "system", text: "Aeryth encountered an AI error.", timestamp: new Date(), chatId: currentChatId });
    } finally {
      setIsAILoading(false);
    }
  };

  /* diary */
  const handleDiaryApi = async (task, entryText) => {
    if (!entryText?.trim()) return null;
    if (!ensureModelAvailable()) return null;
    try {
      return await callGeminiDiary(entryText, task);
    } catch {
      return null;
    }
  };
  const saveDiary = (originalText, finalText, summary) => {
    const doc = { id: crypto.randomUUID(), originalText, finalText, summary, createdAt: new Date() };
    setDiaryEntries((prev) => [doc, ...prev].sort((a, b) => b.createdAt - a.createdAt));
  };

  /* goal */
  const handleSaveGoal = ({ goal, startTime, endTime, days }) => {
    if (!goal || !currentChatId) return;
    if (!pendingTrackingStyle) return;
    const r = { id: crypto.randomUUID(), goal, startTime, endTime, days, chatId: currentChatId, trackingStyle: pendingTrackingStyle, createdAt: new Date() };
    setRoutines((prev) => [r, ...prev]);
    pushMessage({ sender: "system", type: "goal_set", text: `Goal Set: ${goal}`, timestamp: new Date(), chatId: currentChatId });
    setPendingTrackingStyle(null);
    setCurrentView("explore");
  };

  /* small UI components */
  const TopPills = ({ view, setView }) => (
    <div className=" flex justify-around mb-3 gap-3">     
      <button
        onClick={() => setView("explore")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "explore" ? "bg-violet-500 text-white" : "bg-gray-200 hover:bg-violet-100"}`}
        // Explore must show black text when active per request
      >
        Explore
      </button>

      <button
        onClick={() => setView("setGoal")}
        className={`flex-1 px-4 py-2 rounded-full text-sm font-semibold transition shadow-md ${view === "setGoal" ? "bg-violet-500 text-white" : "bg-gray-200 hover:bg-violet-100"}`}
      >
        Set Goal
      </button>

      <button
        onClick={() => setView("diary")}
        className={`flex-1 px-4 py-2 rounded-full font-semibold transition shadow-md ${view === "diary" ? "bg-violet-500 text-white" : "bg-gray-200 hover:bg-violet-100"}`}
      >
        Diary
      </button>
    </div>
  );

  const ChatBubble = ({ m }) => {
    const isUser = m.sender === "user";
    const isSystem = m.sender === "system";
    if (isSystem) {
      if (m.type === "goal_set") {
        return (
          <div className="flex justify-center my-4">
            <div className="w-full border-t border-[#EDE9FE]" />
            <div className="mx-4 px-4 py-2 rounded-full text-sm font-semibold text-[#6D28D9] bg-[#F3E8FF] shadow">🎯 {m.text}</div>
            <div className="w-full border-t border-[#EDE9FE]" />
          </div>
        );
      }
      return (
        <div className="flex justify-center">
          <div className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600 border">[SYSTEM] {m.text}</div>
        </div>
      );
    }
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-xs sm:max-w-md px-4 py-3 rounded-2xl shadow ${isUser ? "bg-[#8B5CF6] text-white rounded-br-none" : "bg-white text-gray-800 rounded-tl-none border"}`}>
          <div className="whitespace-pre-wrap">{m.text}</div>
          <div className={`text-[10px] mt-2 ${isUser ? "text-[#EDE9FE]" : "text-gray-400"}`}>{m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "..."}</div>
        </div>
      </div>
    );
  };

  /* Panels */
  function SetupModal({ visible, onClose }) {
    const [tone, setTone] = useState(settings?.aerythTone || "Friendly");
    const [about, setAbout] = useState(settings?.userInfo || "");
    const [criteria, setCriteria] = useState(settings?.routineCriteria || "");

    useEffect(() => {
      if (!visible) {
        setTone(settings?.aerythTone || "Friendly");
        setAbout(settings?.userInfo || "");
        setCriteria(settings?.routineCriteria || "");
      }
    }, [visible]);

    if (!visible) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="relative w-full max-w-lg mx-4">
          <div className="bg-white rounded-2xl shadow-2xl border-t-8 border-[#8B5CF6] p-6">
            <h3 className="text-2xl font-extrabold text-[#6D28D9] mb-3 text-center">Aeryth Initial Setup</h3>
            <p className="text-sm text-gray-600 text-center mb-4">Personalize Aeryth for better nudges.</p>

            <label className="block mb-3">
              <div className="text-sm font-medium text-[#6D28D9]">Aeryth's Tone</div>
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-2 w-full p-3 border rounded-lg bg-[#FAF5FF] focus:ring-2 focus:ring-[#C4B5FD]">
                <option>Friendly</option>
                <option>Tough Love Coach</option>
                <option>Gentle Assistant</option>
                <option>Hyper-Logical Analyst</option>
              </select>
            </label>

            <label className="block mb-3">
              <div className="text-sm font-medium text-[#6D28D9]">About You</div>
              <textarea rows={3} value={about} onChange={(e) => setAbout(e.target.value)} className="mt-2 w-full p-3 border rounded-lg bg-[#FAF5FF]" placeholder="I work best under pressure..." />
            </label>

            <label className="block mb-4">
              <div className="text-sm font-medium text-[#6D28D9]">Routine criteria</div>
              <input value={criteria} onChange={(e) => setCriteria(e.target.value)} className="mt-2 w-full p-3 border rounded-lg bg-[#FAF5FF]" placeholder="e.g., Don't message after 10 PM." />
            </label>

            <div className="flex gap-3 mt-4">
              <button onClick={onClose} className="flex-1 py-3 rounded-lg border text-gray-700 bg-white">Skip</button>
              <button
                onClick={() => {
                  const newSettings = { aerythTone: tone, userInfo: about, routineCriteria: criteria };
                  setSettings(newSettings);
                  save("aeryth_settings", newSettings);
                  onClose();
                }}
                className="flex-1 py-3 rounded-lg bg-[#8B5CF6] text-white font-bold hover:bg-[#7C3AED]"
              >
                Complete Setup
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function SetGoalPanel({ onSave, onClose }) {
    const [goal, setGoal] = useState("");
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("10:00");
    const [days, setDays] = useState([]);
    const availableDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const toggleDay = (d) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20" onClick={onClose} />
        <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-lg p-6 border-t-4 border-[#8B5CF6]">
          <h3 className="text-xl font-bold text-[#6D28D9] mb-3">Set a New Routine</h3>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Goal</label>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" placeholder="e.g., Study History for 1 hour" />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-sm font-medium">Start</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium">End</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Repeat on</label>
              <div className="flex gap-2 mt-2">
                {availableDays.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`w-10 h-10 rounded-full font-bold transition ${days.includes(d) ? "bg-[#8B5CF6] text-white" : "bg-gray-200 text-gray-700"}`}
                    title={d}
                  >
                    {d[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="flex-1 py-3 rounded-lg border">Cancel</button>
            <button onClick={() => { onSave({ goal: goal.trim(), startTime, endTime, days }); }} className="flex-1 py-3 rounded-lg bg-[#8B5CF6] text-white font-bold">Set Goal</button>
          </div>
        </div>
      </div>
    );
  }

  function DiaryPanel() {
    const [entry, setEntry] = useState("");
    const [summary, setSummary] = useState("");
    const [corrected, setCorrected] = useState("");
    const [processing, setProcessing] = useState(false);
    const [selected, setSelected] = useState(null);

    useEffect(() => {
      if (selected) {
        setEntry(selected.finalText);
        setSummary(selected.summary);
        setCorrected("");
      }
    }, [selected]);

    const callTask = async (task) => {
      if (!entry.trim()) return;
      setProcessing(true);
      try {
        const out = await handleDiaryApi(task, entry);
        if (task === "summarize") setSummary(out || "");
        if (task === "correct_grammar") setCorrected(out || "");
      } finally {
        setProcessing(false);
      }
    };

    const saveEntryLocal = () => {
      const final = corrected || entry;
      if (!final.trim()) return;
      saveDiary(entry, final, summary || "No summary.");
      setEntry(""); setSummary(""); setCorrected("");
    };

    return (
      <div className="h-full flex">
        <div className="w-1/3 bg-white/80 p-4 border-r overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-[#6D28D9]">Past Entries</h3>
            <button onClick={() => { setSelected(null); setEntry(""); setSummary(""); setCorrected(""); }} className="text-sm text-[#6D28D9]">+ New</button>
          </div>
          <div className="space-y-2">
            {diaryEntries.map((d) => (
              <div key={d.id} onClick={() => setSelected(d)} className={`p-3 rounded-md cursor-pointer ${selected?.id === d.id ? "bg-[#F3E8FF]" : "bg-gray-50"}`}>
                <p className="truncate text-sm font-medium">{d.finalText}</p>
                <p className="text-xs text-gray-500">{new Date(d.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 p-6 overflow-auto">
          <h2 className="text-2xl font-bold text-[#6D28D9] mb-1">{selected ? "Viewing Entry" : "New Diary Entry"}</h2>
          <p className="text-sm text-gray-500 mb-4">{selected ? new Date(selected.createdAt).toLocaleString() : "What's on your mind?"}</p>

          <textarea value={entry} onChange={(e) => setEntry(e.target.value)} className="w-full h-64 p-4 border rounded-lg resize-none" disabled={processing || !!selected} />

          {!selected && (
            <div className="flex gap-3 mt-4">
              <button onClick={() => callTask("correct_grammar")} disabled={processing} className="flex-1 py-2 rounded-lg bg-blue-100 text-blue-800 font-semibold">{processing ? "..." : "Correct Grammar"}</button>
              <button onClick={() => callTask("summarize")} disabled={processing} className="flex-1 py-2 rounded-lg bg-indigo-100 text-indigo-800 font-semibold">{processing ? "..." : "Summarize"}</button>
              <button onClick={saveEntryLocal} disabled={processing} className="flex-1 py-2 rounded-lg bg-[#8B5CF6] text-white font-bold">Save Entry</button>
            </div>
          )}

          {corrected && !selected && (
            <div className="mt-4 p-4 bg-blue-50 rounded border">
              <h4 className="font-bold text-blue-800">Suggested Correction</h4>
              <p className="text-blue-900 my-2">{corrected}</p>
              <button onClick={() => { setEntry(corrected); setCorrected(""); }} className="text-sm text-blue-700">Accept Correction</button>
            </div>
          )}

          {summary && (
            <div className="mt-4 p-4 bg-indigo-50 rounded border">
              <h4 className="font-bold text-indigo-800">AI Summary</h4>
              <p className="text-indigo-900 my-2">{summary}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  function SettingsPanel({ initial, onSave }) {
    const [form, setForm] = useState(initial);
    const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));
    useEffect(() => setForm(initial), [initial]);
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-2xl bg-white p-6 rounded-2xl shadow border-t-4 border-[#8B5CF6]">
          <h3 className="text-xl font-bold text-[#6D28D9] mb-3">Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="font-semibold">Aeryth's Tone</label>
              <select value={form.aerythTone} onChange={(e) => setField("aerythTone", e.target.value)} className="w-full mt-1 p-3 border rounded-lg bg-[#FAF5FF]">
                <option>Friendly</option>
                <option>Tough Love Coach</option>
                <option>Gentle Assistant</option>
                <option>Hyper-Logical Analyst</option>
              </select>
            </div>

            <div>
              <label className="font-semibold">About You</label>
              <textarea value={form.userInfo} onChange={(e) => setField("userInfo", e.target.value)} className="w-full mt-1 p-3 border rounded-lg" rows={3} />
            </div>

            <div>
              <label className="font-semibold">Routine criteria</label>
              <input value={form.routineCriteria} onChange={(e) => setField("routineCriteria", e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={() => { onSave(form); save("aeryth_settings", form); }} className="bg-[#8B5CF6] text-white py-2 px-4 rounded font-bold">Save</button>
            <button onClick={() => setForm(initial)} className="py-2 px-4 rounded border">Reset</button>
          </div>
        </div>
      </div>
    );
  }

  /* Sidebar (right) */
  function Sidebar() {
    const now = new Date();
    const eight = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const upcoming = routines
      .filter((r) => {
        if (!r.startTime) return false;
        const [hh, mm] = r.startTime.split(":").map(Number);
        const t = new Date();
        t.setHours(hh, mm, 0, 0);
        return t >= now && t <= eight;
      })
      .slice(0, 3);

    return (
      <div className="w-80 h-full p-4 flex flex-col bg-white border-l shadow-inner">
        <div className="flex items-center justify-between pt-4 mb-4">
          <div>
            <h3 className="text-2xl font-extrabold text-[#6D28D9]">Aeryth</h3>
            <p className="text-sm text-gray-500">Rhythm Partner</p>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 rounded-full bg-[#8B5CF6] text-white hover:bg-[#7C3AED]">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <button onClick={handleNewChat} className="w-full mb-3 py-3 rounded-lg bg-[#8B5CF6] text-white font-bold">+ New Chat</button>
        <input placeholder="Search..." className="w-full p-3 border rounded-xl mb-3" disabled />

        <div className="flex-1 overflow-auto space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-800">Next Routines</h4>
            {upcoming.length ? upcoming.map((r) => (
              <div key={r.id} className="p-3 bg-[#F3E8FF] rounded-xl border-l-4 border-[#E9D5FF] mt-2">
                <div className="font-bold text-[#5B21B6] truncate">{r.goal}</div>
                <div className="text-xs text-[#6D28D9] mt-1">{r.startTime} - {r.endTime}</div>
              </div>
            )) : <p className="text-sm text-gray-500 italic mt-2">No upcoming routines</p>}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-800 mt-4">Chats</h4>
            <div className="space-y-2 mt-2">
              {chats.map((c) => (
                <div key={c.id} className={`relative flex items-center p-3 rounded-xl ${c.id === currentChatId ? "bg-[#F3E8FF]" : "hover:bg-gray-100"}`}>
                  <div className="flex-1">
                    {editingChatId === c.id ? (
                      <input
                        value={editingChatName}
                        onChange={(e) => setEditingChatName(e.target.value)}
                        onBlur={() => applyRename(c.id)}
                        onKeyDown={(e) => e.key === "Enter" && applyRename(c.id)}
                        autoFocus
                        className="w-full p-1 border-b"
                      />
                    ) : (
                      <button onClick={() => setCurrentChatId(c.id)} className="text-left font-medium truncate">{c.name}</button>
                    )}
                  </div>

                  <div className="ml-2">
                    <button onClick={() => setOpenMenuId((p) => (p === c.id ? null : c.id))} className="p-1 text-gray-500 hover:text-gray-800">⋯</button>

                    {openMenuId === c.id && (
                      <div className="absolute right-3 top-10 z-20 bg-white border rounded shadow px-2 py-1 w-28">
                        <button onClick={() => openRename(c.id)} className="w-full text-left py-1 px-2 text-sm hover:bg-gray-100">Rename</button>
                        <button onClick={() => { handleDeleteChat(c.id); setOpenMenuId(null); }} className="w-full text-left py-1 px-2 text-sm text-red-600 hover:bg-gray-100">Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t mt-4 space-y-2">
          <button onClick={() => setCurrentView("calendar")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "calendar" ? "bg-[#F3E8FF] text-[#6D28D9] font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">🗓️</span>Calendar</button>
          <button onClick={() => setCurrentView("diary")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "diary" ? "bg-[#F3E8FF] text-[#6D28D9] font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">✍️</span>Diary</button>
          <button onClick={() => setCurrentView("settings")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "settings" ? "bg-[#F3E8FF] text-[#6D28D9] font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">⚙️</span>Settings</button>
        </div>
      </div>
    );
  }

  /* MainPanel (resizes based on sidebar) */
  function MainPanel() {
    const [input, setInput] = useState("");
    const [goalPanelOpen, setGoalPanelOpen] = useState(false);

    const submit = (e) => {
      e.preventDefault();
      if (!input.trim()) return;
      handleSendMessage(input);
      setInput("");
    };

    // width calc: sidebar 320px (w-80). main = calc(100% - 320px) when sidebar open, else 100%
    const mainStyle = { width: isSidebarOpen ? "calc(100% - 320px)" : "100%" };

    return (
      <div style={mainStyle} className="transition-all duration-300 flex-1 min-h-screen">
        <div className="p-6 h-full flex flex-col">
          <div className="flex-1 flex flex-col mb-4">
            <div className="flex-1 overflow-auto bg-transparent pb-4">
              {currentView === "explore" && (
                <>
                  <div className="flex-1 overflow-y-auto space-y-4">
                    <div className="text-center text-gray-500 italic mb-4">Aeryth's Tone: <span className="font-semibold text-[#6D28D9]">{settings?.aerythTone || "Friendly"}</span></div>
                    {messages.map((m) => <ChatBubble key={m.id} m={m} />)}
                    {isAILoading && <div className="flex"><div className="bg-white p-3 rounded-xl shadow inline-flex items-center gap-2"><svg className="animate-spin h-5 w-5 text-[#8B5CF6]" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" /></svg><span>Aeryth is thinking...</span></div></div>}
                    <div ref={chatEndRef} />
                  </div>
                </>
              )}

              {currentView === "setGoal" && (
                <div className="flex items-center justify-center h-full">
                  <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-2xl border-t-4 border-[#8B5CF6]">
                    <h3 className="text-xl font-bold text-[#6D28D9] mb-2">Set a New Routine</h3>
                    <p className="text-sm text-gray-600 mb-4">Link a goal to the current chat conversation.</p>
                    <div className="flex justify-end">
                      <button onClick={() => setGoalPanelOpen(true)} className="py-2 px-4 bg-[#8B5CF6] text-white rounded-lg">Open</button>
                    </div>
                  </div>
                </div>
              )}

              {currentView === "diary" && <DiaryPanel />}

              {currentView === "calendar" && <div className="flex-1 flex items-center justify-center text-gray-500">Calendar placeholder — coming later.</div>}

              {currentView === "settings" && <SettingsPanel initial={settings} onSave={(s) => { setSettings(s); save("aeryth_settings", s); }} />}
            </div>

            {/* buttons right above chat input */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <TopPills view={currentView} setView={setCurrentView} />
                </div>
                <div className="text-sm italic text-gray-500 hidden"> /* space for extras */ </div>
              </div>

              <form onSubmit={submit} className="bg-white p-4 rounded-xl border-t flex gap-3 items-center">
                <input value={input} onChange={(e) => setInput(e.target.value)} disabled={isAILoading} placeholder={isAILoading ? "Aeryth is thinking..." : "Start exploring a new task..."} className="flex-1 p-3 rounded-xl border focus:ring-2 focus:ring-[#C4B5FD]" />
                <button type="submit" disabled={isAILoading || !input.trim()} className={`px-6 py-3 rounded-xl font-bold ${isAILoading || !input.trim() ? "bg-gray-300 text-white" : "bg-[#8B5CF6] text-white hover:bg-[#7C3AED]"}`}>{isAILoading ? "..." : "Send"}</button>
              </form>
            </div>
          </div>
        </div>

        {goalPanelOpen && <SetGoalPanel onSave={(g) => { handleSaveGoal(g); setGoalPanelOpen(false); }} onClose={() => setGoalPanelOpen(false)} />}
      </div>
    );
  }

  /* root layout */
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-[#EDE9FE] to-[#FAE8FF] font-sans text-gray-800">
      <MainPanel />
      <div className={`transition-all duration-300 ${isSidebarOpen ? "w-80" : "w-0"} flex-shrink-0 overflow-hidden`}>
        <Sidebar />
      </div>

      {/* persistent floating toggle button (always visible) */}
      <div className="fixed right-4 top-1/2 transform -translate-y-1/2 z-50">
        <button onClick={() => setIsSidebarOpen((p) => !p)} className="p-3 rounded-full bg-[#8B5CF6] text-white shadow-lg">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>

      <SetupModal visible={showSetupModal} onClose={() => setShowSetupModal(false)} />
    </div>
  );
}
