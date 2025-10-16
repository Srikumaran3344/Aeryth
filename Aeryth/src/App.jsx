// src/App.jsx
import React, { useEffect, useRef, useState } from "react";

/* -----------------------
   LocalStorage utilities
   ----------------------- */
const reviverDate = (key, value) => {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return new Date(value);
  }
  return value;
};
const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw, reviverDate) : fallback;
  } catch (e) {
    console.error("localStorage load error", e);
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("localStorage save error", e);
  }
};

/* -----------------------
   Gemini Nano wrappers
   ----------------------- */
let sessions = {}; // in-memory sessions per chat

const ensureModelAvailable = () =>
  !!(window && window.LanguageModel && window.LanguageModel.create);

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
Active goals: ${
    routines.filter((r) => r.chatId === chatId).map((r) => r.goal).join("; ") ||
    "None"
  }
Conversation length: ${chatHistory.length} turns.`;
  const session = await ensureSession(chatId, system);
  const result = await session.prompt(lastMsg);
  return result?.output ?? result;
}

async function callGeminiDiary(text, task) {
  if (!ensureModelAvailable()) throw new Error("Gemini Nano not available.");
  const systemPrompt =
    task === "summarize"
      ? "Summarize the following diary entry into a concise reflective paragraph focusing on emotions and events."
      : task === "correct_grammar"
      ? "Correct grammar and spelling. Output only corrected text."
      : null;
  if (!systemPrompt) throw new Error("invalid diary task");
  // Use a transient session
  const temp = await window.LanguageModel.create({
    initialPrompts: [{ role: "system", content: systemPrompt }],
  });
  try {
    const res = await temp.prompt(text);
    return res?.output ?? res;
  } finally {
    temp.destroy?.();
  }
}

/* -----------------------
   App component
   ----------------------- */
export default function App() {
  /* Persisted state */
  const [userId] = useState(() => load("aeryth_userId", crypto.randomUUID()));
  useEffect(() => save("aeryth_userId", userId), [userId]);

  const [settings, setSettings] = useState(() =>
    load("aeryth_settings", { aerythTone: "Friendly", userInfo: "", routineCriteria: "" })
  );
  useEffect(() => save("aeryth_settings", settings), [settings]);

  const [chats, setChats] = useState(() =>
    load("aeryth_chats", [{ id: crypto.randomUUID(), name: `Welcome`, createdAt: new Date() }])
  );
  useEffect(() => save("aeryth_chats", chats), [chats]);

  const [messagesStore, setMessagesStore] = useState(() =>
    load("aeryth_messages", [])
  );
  useEffect(() => save("aeryth_messages", messagesStore), [messagesStore]);

  const [routines, setRoutines] = useState(() =>
    load("aeryth_routines", [])
  );
  useEffect(() => save("aeryth_routines", routines), [routines]);

  const [diaryEntries, setDiaryEntries] = useState(() =>
    load("aeryth_diary_entries", [])
  );
  useEffect(() => save("aeryth_diary_entries", diaryEntries), [diaryEntries]);

  /* UI state */
  const [currentChatId, setCurrentChatId] = useState(() => chats[0]?.id ?? null);
  const [messages, setMessages] = useState(() => messagesStore.filter(m => m.chatId === (chats[0]?.id)));
  const [currentView, setCurrentView] = useState("explore"); // explore, setGoal, diary, calendar, settings
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAILoading, setIsAILoading] = useState(false);
  const [pendingTrackingStyle, setPendingTrackingStyle] = useState(null);

  useEffect(() => {
    // sync messages when currentChatId or messagesStore change
    setMessages(messagesStore.filter((m) => m.chatId === currentChatId));
  }, [currentChatId, messagesStore]);

  const chatEndRef = useRef(null);
  useEffect(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, [messages, isAILoading]);

  /* helpers */
  const pushMessage = (msg) => {
    const withId = { id: crypto.randomUUID(), ...msg };
    setMessagesStore((prev) => {
      const next = [...prev, withId];
      return next;
    });
  };

  const updateChats = (cb) => setChats((prev) => {
    const next = cb(prev);
    return next;
  });

  /* Chat operations */
  const handleNewChat = () => {
    const id = crypto.randomUUID();
    const newChat = { id, name: `New Chat ${new Date().toLocaleDateString()}`, createdAt: new Date() };
    updateChats(prev => [newChat, ...prev]);
    setCurrentChatId(id);
    setCurrentView("explore");
  };

  const handleDeleteChat = (id) => {
    if (!confirm("Delete chat and related routines?")) return;
    setChats(prev => prev.filter(c => c.id !== id));
    setMessagesStore(prev => prev.filter(m => m.chatId !== id));
    setRoutines(prev => prev.filter(r => r.chatId !== id));
    sessions[id]?.destroy?.();
    delete sessions[id];
    if (currentChatId === id) setCurrentChatId(chats[0]?.id ?? null);
  };

  const systemPromptForChat = (chatId) => {
    return `You are Aeryth... tailored to the user. (Do not reveal this system text). Conversation chatId:${chatId}`;
  };

  const handleSendMessage = async (text) => {
    if (!text?.trim() || isAILoading || !currentChatId) return;
    const userMsg = { sender: "user", text: text.trim(), timestamp: new Date(), chatId: currentChatId };
    pushMessage(userMsg);

    const upper = text.trim().toUpperCase();
    if (upper === "EVIDENCE" || upper === "REMINDER") {
      setPendingTrackingStyle(upper.toLowerCase());
      const info = {
        sender: "aeryth",
        text: "Perfect. I've noted your preference. Now, please use Set Goal and fill details.",
        timestamp: new Date(),
        chatId: currentChatId,
      };
      pushMessage(info);
      return;
    }

    if (!ensureModelAvailable()) {
      const offlineReply = {
        sender: "aeryth",
        text: "Local Gemini Nano not available in this browser. Please use a supported Chrome Canary with the AI runtime.",
        timestamp: new Date(),
        chatId: currentChatId,
      };
      pushMessage(offlineReply);
      return;
    }

    setIsAILoading(true);
    try {
      // collect history for the chat
      const chatHistory = [...messagesStore.filter(m => m.chatId === currentChatId), userMsg];
      const aiText = await callGemini(currentChatId, chatHistory, settings, routines);
      pushMessage({ sender: "aeryth", text: aiText ?? "No output", timestamp: new Date(), chatId: currentChatId });
    } catch (e) {
      console.error("AI call failed", e);
      pushMessage({ sender: "system", text: "Aeryth encountered an AI error.", timestamp: new Date(), chatId: currentChatId });
    } finally {
      setIsAILoading(false);
    }
  };

  /* DIARY functions */
  const handleDiaryApi = async (task, entryText) => {
    if (!entryText?.trim()) return null;
    if (!ensureModelAvailable()) {
      alert("Gemini Nano not available.");
      return null;
    }
    try {
      return await callGeminiDiary(entryText, task);
    } catch (e) {
      console.error("Diary AI error", e);
      return null;
    }
  };

  const saveDiary = async (originalText, finalText, summary) => {
    const doc = { id: crypto.randomUUID(), originalText, finalText, summary, createdAt: new Date() };
    setDiaryEntries(prev => [doc, ...prev].sort((a, b) => b.createdAt - a.createdAt));
  };

  /* GOAL / ROUTINE functions */
  const handleSaveGoal = async ({ goal, startTime, endTime, days }) => {
    if (!goal || !currentChatId) { alert("Fill fields."); return; }
    if (!pendingTrackingStyle) { alert("Tell Aeryth EVIDENCE or REMINDER in chat first."); return; }
    const r = { id: crypto.randomUUID(), goal, startTime, endTime, days, chatId: currentChatId, trackingStyle: pendingTrackingStyle, createdAt: new Date() };
    setRoutines(prev => [r, ...prev]);
    // add system message to chat
    pushMessage({ sender: "system", type: "goal_set", text: `Goal Set: ${goal}`, timestamp: new Date(), chatId: currentChatId });
    setPendingTrackingStyle(null);
    setCurrentView("explore");
  };

  /* SETTINGS */
  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
    setCurrentView("explore");
  };

  /* Basic analytics derived */
  const analytics = {
    totalChats: chats.length,
    totalRoutines: routines.length,
    totalDiary: diaryEntries.length,
    totalMessages: messagesStore.length,
  };

  /* Small UI components */
  const IconMenu = ({ onClick }) => (
    <button onClick={onClick} className="p-2 rounded-full bg-violet-500 text-white hover:bg-violet-600">
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
  );

  /* Sub-views */
  const ChatMessage = ({ m }) => {
    const isUser = m.sender === "user";
    const isSystem = m.sender === "system";
    return isSystem ? (
      m.type === "goal_set" ? (
        <div className="flex justify-center my-4">
          <div className="w-full border-t border-violet-200"></div>
          <div className="text-center text-sm font-semibold text-violet-600 bg-violet-100 px-4 py-2 rounded-full mx-4 whitespace-nowrap shadow">🎯 {m.text}</div>
          <div className="w-full border-t border-violet-200"></div>
        </div>
      ) : (
        <div className="flex justify-center"><div className="text-center text-xs text-red-500 bg-red-100 p-2 rounded-lg max-w-sm shadow-md">[SYSTEM]: {m.text}</div></div>
      )
    ) : (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-xs sm:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl shadow-lg ${isUser ? "bg-violet-500 text-white rounded-br-none" : "bg-white text-gray-800 rounded-tl-none border"}`}>
          <p className="whitespace-pre-wrap">{m.text}</p>
          <span className={`block text-xs mt-1 ${isUser ? "text-violet-200" : "text-gray-400"}`}>{m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "..."}</span>
        </div>
      </div>
    );
  };

  function MainPanel() {
    const [input, setInput] = useState("");
    return (
      <div className="flex-1 h-full p-6 overflow-hidden flex flex-col">
        <div className="flex items-center space-x-3 mb-4">
          <button onClick={() => setCurrentView("explore")} className={`px-4 py-2 rounded-full font-semibold ${currentView === "explore" ? "bg-violet-500 text-white" : "bg-gray-100 text-gray-700"}`}>Explore</button>
          <button onClick={() => setCurrentView("setGoal")} className={`px-4 py-2 rounded-full font-semibold ${currentView === "setGoal" ? "bg-violet-500 text-white" : "bg-gray-100 text-gray-700"}`}>Set Goal</button>
          <button onClick={() => setCurrentView("diary")} className={`px-4 py-2 rounded-full font-semibold ${currentView === "diary" ? "bg-violet-500 text-white" : "bg-gray-100 text-gray-700"}`}>Diary</button>
        </div>

        {currentView === "explore" && (
          <>
            <div className="flex-1 overflow-y-auto space-y-4 pb-6">
              <div className="text-center text-gray-500 italic mb-4">Aeryth's Tone: <span className="font-semibold text-violet-600">{settings?.aerythTone || "Friendly"}</span></div>
              {messages.map((m) => <ChatMessage key={m.id} m={m} />)}
              {isAILoading && <div className="flex justify-start"><div className="bg-white text-gray-600 px-4 py-3 rounded-2xl shadow-md flex items-center space-x-2 border"><svg className="animate-spin h-5 w-5 text-violet-500" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg><span>Aeryth is thinking...</span></div></div>}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); setInput(""); }} className="pt-4 border-t bg-white p-4">
              <div className="flex space-x-3">
                <input value={input} onChange={(e) => setInput(e.target.value)} disabled={isAILoading} placeholder={isAILoading ? "Aeryth is thinking..." : "Start exploring a new task..."} className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-violet-400" />
                <button type="submit" disabled={isAILoading || !input.trim()} className={`px-6 py-3 rounded-xl font-bold ${isAILoading || !input.trim() ? "bg-gray-400 text-white" : "bg-violet-500 text-white hover:bg-violet-600"}`}>{isAILoading ? "..." : "Send"}</button>
              </div>
            </form>
          </>
        )}

        {currentView === "setGoal" && (
          <SetGoalPanel onSave={handleSaveGoal} onCancel={() => setCurrentView("explore")} />
        )}

        {currentView === "diary" && (
          <DiaryPanel />
        )}

        {currentView === "calendar" && (
          <div className="flex-1 flex items-center justify-center text-gray-500">Calendar view coming later.</div>
        )}

        {currentView === "settings" && (
          <SettingsPanel onSave={handleSaveSettings} initial={settings} />
        )}
      </div>
    );
  }

  function SetGoalPanel({ onSave, onCancel }) {
    const [goal, setGoal] = useState("");
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("10:00");
    const [days, setDays] = useState([]);
    const availableDays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const toggleDay = (d) => setDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev,d]);
    return (
      <div className="max-w-2xl w-full mx-auto">
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-2xl font-bold text-violet-600 mb-3">Set a New Routine</h2>
          <div className="space-y-4">
            <div><label className="font-semibold">Goal</label><input value={goal} onChange={e=>setGoal(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" placeholder="e.g., Study for 1 hour" /></div>
            <div className="flex space-x-3">
              <div className="flex-1"><label className="font-semibold">Start</label><input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" /></div>
              <div className="flex-1"><label className="font-semibold">End</label><input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} className="w-full mt-1 p-3 border rounded-lg" /></div>
            </div>
            <div>
              <label className="font-semibold">Repeat on</label>
              <div className="flex gap-2 mt-2">
                {availableDays.map(d => <button key={d} onClick={()=>toggleDay(d)} type="button" className={`w-10 h-10 rounded-full font-bold ${days.includes(d) ? "bg-violet-500 text-white" : "bg-gray-200 text-gray-700"}`}>{d[0]}</button>)}
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={()=>onSave({goal,startTime,endTime,days})} className="flex-1 py-3 rounded-lg bg-violet-500 text-white font-bold">Set Goal</button>
            <button onClick={onCancel} className="py-3 px-6 rounded-lg border">Cancel</button>
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

    useEffect(()=> {
      if (selected) {
        setEntry(selected.finalText);
        setSummary(selected.summary);
        setCorrected("");
      }
    },[selected]);

    const callTask = async (task) => {
      if (!entry.trim()) { alert("Write something first"); return; }
      setProcessing(true);
      try {
        const out = await handleDiaryApi(task, entry);
        if (task === "summarize") setSummary(out ?? "");
        if (task === "correct_grammar") setCorrected(out ?? "");
      } finally {
        setProcessing(false);
      }
    };

    const saveEntry = async () => {
      const final = corrected || entry;
      if (!final.trim()) { alert("Empty"); return; }
      await saveDiary(entry, final, summary || "No summary.");
      setEntry(""); setSummary(""); setCorrected(""); alert("Saved");
    };

    return (
      <div className="h-full flex">
        <div className="w-1/3 bg-white/80 p-4 border-r overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-violet-700">Past Entries</h3>
            <button onClick={()=>{setSelected(null); setEntry(""); setSummary(""); setCorrected("")}} className="text-sm text-violet-600">New</button>
          </div>
          <div className="space-y-2">
            {diaryEntries.map(d => (
              <div key={d.id} onClick={()=>setSelected(d)} className={`p-3 rounded-md cursor-pointer ${selected?.id===d.id ? "bg-violet-100 border-violet-300" : "bg-gray-50"}`}>
                <p className="truncate text-sm font-medium">{d.finalText}</p>
                <p className="text-xs text-gray-500">{new Date(d.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 p-6 overflow-auto">
          <h2 className="text-2xl font-bold text-violet-600 mb-1">{selected ? "Viewing Entry" : "New Diary Entry"}</h2>
          <p className="text-sm text-gray-500 mb-4">{selected ? new Date(selected.createdAt).toLocaleString() : "What's on your mind?"}</p>
          <textarea value={entry} onChange={e=>setEntry(e.target.value)} className="w-full h-64 p-4 border rounded-lg resize-none" disabled={processing || !!selected} />
          {!selected && (
            <div className="flex gap-3 mt-4">
              <button onClick={()=>callTask("correct_grammar")} disabled={processing} className="flex-1 py-2 rounded-lg bg-blue-100 text-blue-800 font-semibold">{processing ? "..." : "Correct Grammar"}</button>
              <button onClick={()=>callTask("summarize")} disabled={processing} className="flex-1 py-2 rounded-lg bg-indigo-100 text-indigo-800 font-semibold">{processing ? "..." : "Summarize"}</button>
              <button onClick={saveEntry} disabled={processing} className="flex-1 py-2 rounded-lg bg-violet-500 text-white font-bold">Save Entry</button>
            </div>
          )}

          {corrected && !selected && (
            <div className="mt-4 p-4 bg-blue-50 rounded border">
              <h4 className="font-bold text-blue-800">Suggested Correction</h4>
              <p className="text-blue-900 my-2">{corrected}</p>
              <button onClick={()=>{ setEntry(corrected); setCorrected(""); }} className="text-sm text-blue-700">Accept Correction</button>
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

  function SettingsPanel({ onSave, initial }) {
    const [form, setForm] = useState(initial);
    const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-2xl font-bold text-violet-600 mb-3">Aeryth Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="font-semibold">Aeryth's Tone</label>
              <select value={form.aerythTone} onChange={e=>setField("aerythTone", e.target.value)} className="w-full mt-1 p-3 border rounded-lg">
                <option>Friendly</option>
                <option>Tough Love Coach</option>
                <option>Gentle Assistant</option>
                <option>Hyper-Logical Analyst</option>
              </select>
            </div>
            <div>
              <label className="font-semibold">About You</label>
              <textarea value={form.userInfo} onChange={e=>setField("userInfo", e.target.value)} className="w-full mt-1 p-3 border rounded-lg" rows={3} />
            </div>
            <div>
              <label className="font-semibold">Routine criteria</label>
              <input value={form.routineCriteria} onChange={e=>setField("routineCriteria", e.target.value)} className="w-full mt-1 p-3 border rounded-lg" />
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={()=>{ onSave(form); save("aeryth_settings", form); }} className="bg-violet-500 text-white py-2 px-4 rounded font-bold">Save</button>
            <button onClick={()=>{ setForm(initial); }} className="py-2 px-4 rounded border">Reset</button>
          </div>
        </div>
      </div>
    );
  }

  /* Sidebar (right) */
  function Sidebar() {
    const now = new Date();
    const eightHours = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const upcomingRoutines = routines
      .filter(r => {
        if (!r.startTime) return false;
        const [hh, mm] = r.startTime.split(":").map(Number);
        const t = new Date();
        t.setHours(hh, mm, 0, 0);
        return t >= now && t <= eightHours;
      })
      .slice(0, 3);

    return (
      <div className="w-80 h-full p-4 flex flex-col bg-white">
        <div className="flex items-center justify-between mb-4 pt-6">
          <div>
            <h3 className="text-2xl font-extrabold text-violet-600">Aeryth</h3>
            <p className="text-sm text-gray-500">Rhythm Partner</p>
          </div>
          <button onClick={()=>setIsSidebarOpen(false)} className="p-2 rounded-full bg-violet-500 text-white hover:bg-violet-600">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <button onClick={handleNewChat} className="w-full mb-3 py-3 rounded-lg bg-violet-500 text-white font-bold">+ New Chat</button>
        <input placeholder="Search routines..." className="w-full p-3 border rounded-xl mb-3" disabled />

        <div className="flex-1 overflow-auto space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-800">Next Routines</h4>
            {upcomingRoutines.length ? upcomingRoutines.map(r => (
              <div key={r.id} className="p-3 bg-violet-50 rounded-xl border-l-4 border-violet-400 mt-2">
                <div className="font-bold text-violet-800 truncate">{r.goal}</div>
                <div className="text-xs text-violet-600 mt-1">{r.startTime} - {r.endTime}</div>
              </div>
            )) : <p className="text-sm text-gray-500 italic mt-2">No upcoming routines</p>}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-800 mt-4">Chats</h4>
            <div className="space-y-2 mt-2">
              {chats.map(c => (
                <div key={c.id} className={`flex items-center p-3 rounded-xl ${c.id === currentChatId ? "bg-violet-100" : "hover:bg-gray-100"}`}>
                  <button onClick={()=>setCurrentChatId(c.id)} className="flex-1 text-left font-medium">{c.name}</button>
                  <button onClick={()=>handleDeleteChat(c.id)} className="p-1 text-gray-400 hover:text-red-500"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M9 13l2 2 4-4M7 4h10l-1 14a2 2 0 01-2 2H10a2 2 0 01-2-2L7 4z"/></svg></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t mt-4 space-y-2">
          <button onClick={()=>setCurrentView("calendar")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "calendar" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">🗓️</span>Calendar</button>
          <button onClick={()=>setCurrentView("diary")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "diary" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">✍️</span>Diary</button>
          <button onClick={()=>setCurrentView("settings")} className={`flex items-center w-full p-3 rounded-xl ${currentView === "settings" ? "bg-violet-100 text-violet-800 font-bold" : "hover:bg-gray-100"}`}><span className="mr-3 text-xl">⚙️</span>Settings</button>
        </div>
      </div>
    );
  }

  /* top-level render */
  return (
    <div className="flex h-screen w-full font-sans bg-violet-50">
      <div className="flex-1 min-w-0">
        <MainPanel />
      </div>

      <div className={`transition-all duration-300 ${isSidebarOpen ? "w-80" : "w-0"} flex-shrink-0 overflow-hidden border-l`}>
        <div className="w-80 h-full">
          <Sidebar />
        </div>
      </div>

      {!isSidebarOpen && (
        <div className="fixed right-4 top-6 z-50">
          <button onClick={()=>setIsSidebarOpen(true)} className="p-3 rounded-full bg-violet-500 text-white shadow-lg">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
