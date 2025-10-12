import React, { useState, useEffect, useRef } from 'react';

// --- LOCAL STORAGE UTILITY HOOK ---
const useLocalStorage = (key, initialValue) => {
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    const setValue = (value) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };

    return [storedValue, setValue];
};

// --- GEMINI NANO API SIMULATION ---
const callGeminiNanoAPI = async (prompt, taskType) => {
    console.log("--- Sending to Simulated Gemini Nano ---");
    console.log("TASK:", taskType);
    console.log("PROMPT:", prompt);
    await new Promise(resolve => setTimeout(resolve, 600)); // Simulate delay

    if (taskType === 'summarize_diary') {
        return "This is a mocked AI summary of the day's diary entries, highlighting key feelings and events.";
    }
    if (taskType === 'summarize_month') {
        return "This is a mocked AI summary of the entire month's reflections, identifying overarching themes and emotional trends.";
    }
    if (taskType === 'personalize_chat') {
        return "This is a personalized, supportive response based on your goals and personality profile. What is the very next small step you can take to move forward?";
    }
    return "This is a generic mocked response from Aeryth. How can I help you break down your task?";
};

// --- DATE UTILITIES ---
const getTodayDateString = () => new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};


const App = () => {
    // --- STATE MANAGEMENT ---
    const [settings, setSettings] = useLocalStorage('aeryth_settings', {
        aerythTone: 'Friendly',
        userName: '',
        personalityProfile: 'User is just getting started. Tone should be encouraging.'
    });
    const [routines, setRoutines] = useLocalStorage('aeryth_routines', []);
    const [diaryEntries, setDiaryEntries] = useLocalStorage('aeryth_diary_entries', []);
    const [diarySummaries, setDiarySummaries] = useLocalStorage('aeryth_diary_summaries', {});
    const [routineNotes, setRoutineNotes] = useLocalStorage('aeryth_routine_notes', {});
    
    const [currentView, setCurrentView] = useState('explore');
    const [selectedRoutine, setSelectedRoutine] = useState(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isLoading, setIsLoading] = useState(true);

    // Chat messages are ephemeral and not stored locally
    const [messages, setMessages] = useState([]);
    const [isAILoading, setIsAILoading] = useState(false);
    const chatEndRef = useRef(null);

    // --- EFFECTS ---
    useEffect(() => {
        // Daily and Monthly Summary Generation Logic
        const processSummaries = async () => {
            const todayStr = getTodayDateString();
            const lastSummaryDate = diarySummaries.lastProcessedDate;

            if (lastSummaryDate !== todayStr) {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];

                const yesterdayEntries = diaryEntries.filter(e => e.createdAt.startsWith(yesterdayStr));
                if (yesterdayEntries.length > 0 && !diarySummaries[yesterdayStr]) {
                    console.log(`Generating summary for ${yesterdayStr}...`);
                    const combinedEntries = yesterdayEntries.map(e => e.text).join('\n\n');
                    const summary = await callGeminiNanoAPI(combinedEntries, 'summarize_diary');
                    setDiarySummaries(prev => ({...prev, [yesterdayStr]: {day: summary}}));
                }
                
                if (yesterday.getDate() === 1 && !diarySummaries[yesterdayStr]?.month) {
                     console.log("Generating monthly summary...");
                     const monthSummary = await callGeminiNanoAPI("All entries from last month.", 'summarize_month');
                     setDiarySummaries(prev => ({...prev, [`${yesterday.getFullYear()}-${yesterday.getMonth()}`]: {month: monthSummary}}));
                }

                setDiarySummaries(prev => ({...prev, lastProcessedDate: todayStr}));
            }
        };
        
        processSummaries();
        setIsLoading(false);
    }, []);
    
    useEffect(() => {
       chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // --- HANDLERS ---
    const handleSendMessage = async (input) => {
        if (!input.trim() || isAILoading) return;
        const newUserMessage = { sender: 'user', text: input, timestamp: new Date() };
        setMessages(prev => [...prev, newUserMessage]);
        setIsAILoading(true);

        try {
            const prompt = `
                [User Personality Profile]: ${settings.personalityProfile}
                [User's Goal for this Tone]: ${settings.aerythTone}
                [User's Current Message]: ${input}
            `;
            const aiResponseText = await callGeminiNanoAPI(prompt, 'personalize_chat');
            setMessages(prev => [...prev, { sender: 'aeryth', text: aiResponseText, timestamp: new Date() }]);
        } catch (error) {
            console.error("Error calling Nano API:", error);
            setMessages(prev => [...prev, { sender: 'system', text: "Error connecting to local AI.", timestamp: new Date() }]);
        } finally {
            setIsAILoading(false);
        }
    };
    
    const viewRoutineDetail = (routine) => {
        if (!routineNotes[routine.id]) {
            const todayStr = getTodayDateString();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            
            setRoutineNotes(prev => ({
                ...prev,
                [routine.id]: {
                    previous: { date: null, content: 'Track your progress here.', color: 'bg-yellow-200' },
                    current: { date: todayStr, content: 'What\'s the goal for today?', color: 'bg-pink-200' },
                    next: { date: tomorrowStr, content: 'What\'s the goal for tomorrow?', color: 'bg-blue-200' },
                }
            }));
        }
        setSelectedRoutine(routine);
        setCurrentView('routineDetail');
    };

    // --- UI COMPONENTS ---
    const LoadingScreen = () => (<div className="flex justify-center items-center h-screen bg-gray-900 text-white">Loading Aeryth...</div>);
    const ChatMessage = ({ sender, text }) => {
        const isUser = sender === 'user';
        const isSystem = sender === 'system';
        if (isSystem) {
            return <div className="text-center text-xs text-red-500 my-2">System: {text}</div>;
        }
        return (
            <div className={`flex my-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-lg px-4 py-2 rounded-2xl shadow ${isUser ? 'bg-violet-500 text-white rounded-br-none' : 'bg-white rounded-bl-none'}`}>
                    {text}
                </div>
            </div>
        );
    };
    const Sidebar = () => (
        <div className={`transition-all duration-300 ${isSidebarOpen ? 'w-80' : 'w-0'} flex-shrink-0 overflow-hidden`}>
            <div className="w-80 bg-white shadow-xl h-full border-l border-gray-200 p-4 flex flex-col">
                <button onClick={() => setIsSidebarOpen(false)} className="self-start p-2 mb-4 bg-gray-200 rounded-full hover:bg-gray-300">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <div className="text-center pb-4 border-b">
                    <h3 className="text-2xl font-extrabold text-violet-600">Aeryth</h3>
                </div>
                <h4 className="text-sm font-semibold text-gray-800 mt-4">Routines:</h4>
                <div className="flex-1 overflow-y-auto space-y-2 mt-2">
                    {routines.map(r => (
                        <button key={r.id} onClick={() => viewRoutineDetail(r)} className="w-full text-left p-3 bg-violet-50 rounded-xl border-l-4 border-violet-400 shadow-sm hover:bg-violet-100 transition-colors">
                            <p className="text-sm text-violet-800 font-bold">{r.goal}</p>
                            <p className="text-xs text-violet-600 mt-1">{r.days.join(', ')} @ {r.startTime}</p>
                        </button>
                    ))}
                     {routines.length === 0 && <p className="text-sm text-gray-500 p-2 italic">No routines set yet.</p>}
                </div>
                <div className="pt-4 border-t space-y-2">
                    <button onClick={() => setCurrentView('diary')} className="w-full text-left p-3 rounded-lg font-semibold hover:bg-gray-100">✍️ Diary</button>
                    <button onClick={() => setCurrentView('settings')} className="w-full text-left p-3 rounded-lg font-semibold hover:bg-gray-100">⚙️ Settings</button>
                </div>
            </div>
        </div>
    );
    const ChatView = () => {
        const [input, setInput] = useState('');
        const handleSubmit = (e) => { e.preventDefault(); handleSendMessage(input); setInput(''); };
        return (
             <div className="flex-1 flex flex-col h-full bg-transparent relative">
                {!isSidebarOpen && <button onClick={() => setIsSidebarOpen(true)} className="absolute right-4 top-4 z-10 p-2 bg-violet-500 text-white rounded-full shadow-lg">O</button>}
                <div className="flex-1 p-6 space-y-4 overflow-y-auto" style={{ paddingBottom: '140px' }}>
                    {messages.length === 0 && <div className="text-center text-gray-500">Start a conversation with Aeryth.</div>}
                    {messages.map((msg, index) => <ChatMessage key={index} {...msg} />)}
                    {isAILoading && <div>Aeryth is thinking...</div>}
                    <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleSubmit} className="absolute bottom-0 w-full p-4 border-t bg-white">
                     <div className="flex justify-around mb-3">
                        <button type="button" onClick={() => setCurrentView('explore')} className={`flex-1 py-2 text-sm font-semibold rounded-full shadow-md transition-colors ${currentView === 'explore' ? 'bg-violet-500 text-white':'bg-gray-200'}`}>Explore</button>
                        <button type="button" onClick={() => setCurrentView('setGoal')} className={`flex-1 mx-2 py-2 text-sm font-semibold rounded-full shadow-md transition-colors ${currentView === 'setGoal' ? 'bg-violet-500 text-white':'bg-gray-200'}`}>Set Goal</button>
                     </div>
                     <div className="flex space-x-3">
                        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} disabled={isAILoading} className="flex-1 p-3 border rounded-xl shadow-inner focus:ring-2 focus:ring-violet-400" placeholder="Start exploring a task..."/>
                        <button type="submit" disabled={isAILoading || !input.trim()} className="px-6 py-3 rounded-xl font-bold bg-violet-500 text-white shadow-lg hover:bg-violet-600 disabled:bg-gray-400 transition-colors">Send</button>
                    </div>
                </form>
             </div>
        );
    };
    const SetGoalView = () => {
        const [goal, setGoal] = useState('');
        const [startTime, setStartTime] = useState('09:00');
        const [days, setDays] = useState([]);
        const availableDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        const handleDayToggle = (day) => {
            setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
        };
        
        const handleSaveGoal = () => {
            if (!goal.trim() || days.length === 0) return alert("Please provide a goal and select at least one day.");
            const newRoutine = { id: Date.now(), goal, startTime, days };
            setRoutines(prev => [...prev, newRoutine]);
            alert("Routine saved!");
            setCurrentView('explore');
        };
        
        return (
            <div className="p-8 h-full flex flex-col items-center justify-center">
                 <div className="text-left p-8 bg-white rounded-xl shadow-2xl w-full max-w-xl border-t-4 border-violet-500">
                    <h2 className="text-3xl font-extrabold text-violet-600 mb-2">Set a New Routine</h2>
                    <div className="space-y-4 mt-6">
                        <div><label className="font-bold text-gray-700">Goal:</label><input type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g., Study for 1 hour" className="mt-1 p-3 w-full border rounded-lg"/></div>
                        <div><label className="font-bold text-gray-700">Start Time:</label><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 p-3 w-full border rounded-lg"/></div>
                        <div><label className="font-bold text-gray-700">Repeat on:</label><div className="flex justify-center space-x-1 mt-2">{availableDays.map(d => <button key={d} onClick={() => handleDayToggle(d)} className={`w-10 h-10 font-bold rounded-full transition ${days.includes(d) ? 'bg-violet-500 text-white' : 'bg-gray-200 text-gray-600'}`}>{d[0]}</button>)}</div></div>
                    </div>
                     <div className="flex space-x-4 mt-8">
                        <button onClick={handleSaveGoal} className="flex-1 py-3 rounded-lg font-bold text-white bg-violet-500 hover:bg-violet-600">Set Goal</button>
                        <button onClick={() => setCurrentView('explore')} className="py-3 px-6 rounded-lg font-bold text-violet-500">Cancel</button>
                    </div>
                </div>
            </div>
        );
    };
    
    const RoutineDetailView = () => {
        if (!selectedRoutine || !routineNotes[selectedRoutine.id]) return <div>Select a routine.</div>;
        const notes = routineNotes[selectedRoutine.id];

        const handleNoteChange = (noteType, newContent) => {
            setRoutineNotes(prev => ({
                ...prev,
                [selectedRoutine.id]: {
                    ...prev[selectedRoutine.id],
                    [noteType]: { ...prev[selectedRoutine.id][noteType], content: newContent }
                }
            }));
        };

        const StickyNote = ({ type, noteData }) => (
            <div className={`p-4 rounded-lg shadow-lg flex flex-col ${noteData.color} w-full h-48`}>
                <h3 className="font-bold text-gray-800 border-b border-gray-400 pb-2 mb-2 capitalize">{type} Day</h3>
                <textarea
                    className="flex-grow bg-transparent resize-none focus:outline-none text-gray-700 text-lg"
                    value={noteData.content}
                    onChange={(e) => handleNoteChange(type, e.target.value)}
                />
            </div>
        );
        
        return (
            <div className="p-8 h-full flex flex-col items-center">
                <button onClick={() => setCurrentView('explore')} className="self-start mb-4 text-violet-600 font-semibold">{"<"} Back to Chat</button>
                <h2 className="text-3xl font-extrabold text-violet-600">{selectedRoutine.goal}</h2>
                <div className="w-full flex-grow flex flex-col items-center justify-start space-y-8 mt-8">
                    <div className="w-full max-w-2xl"><StickyNote type="current" noteData={notes.current}/></div>
                    <div className="w-full max-w-4xl flex gap-8">
                        <StickyNote type="previous" noteData={notes.previous}/>
                        <StickyNote type="next" noteData={notes.next}/>
                    </div>
                </div>
            </div>
        );
    };

    const DiaryView = () => {
        const [mode, setMode] = useState('today');
        const [detailKey, setDetailKey] = useState(null);
        const [search, setSearch] = useState('');
        const [newEntryText, setNewEntryText] = useState('');

        const handleSaveEntry = () => {
            if (!newEntryText.trim()) return;
            const newEntry = { id: Date.now(), text: newEntryText, createdAt: new Date().toISOString() };
            setDiaryEntries(prev => [newEntry, ...prev].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
            setNewEntryText('');
        };
        
        const handleDeleteEntry = (id) => {
             if(window.confirm("Are you sure you want to delete this entry?")) {
                setDiaryEntries(prev => prev.filter(e => e.id !== id));
             }
        };

        const todayStr = getTodayDateString();
        const todayEntries = diaryEntries.filter(e => e.createdAt.startsWith(todayStr));

        const pastEntriesGrouped = diaryEntries
            .filter(e => !e.createdAt.startsWith(todayStr))
            .reduce((acc, entry) => {
                const date = new Date(entry.createdAt);
                const month = date.toLocaleString('default', { month: 'long', year: 'numeric' });
                const dateStr = entry.createdAt.split('T')[0];
                if (!acc[month]) acc[month] = {};
                if (!acc[month][dateStr]) acc[month][dateStr] = [];
                acc[month][dateStr].push(entry);
                return acc;
            }, {});

        const renderToday = () => (
            <>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-2xl font-bold text-gray-800">{formatDate(todayStr)}</h3>
                </div>
                 <button onClick={() => setMode('past_list')} className="w-full mb-4 p-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold">View Past Entries</button>
                <input type="text" placeholder="Search entries..." value={search} onChange={e => setSearch(e.target.value)} className="w-full p-2 border rounded-lg mb-4" />
                <div className="space-y-2 flex-1 overflow-y-auto">
                    {todayEntries.map(e => (
                        <div key={e.id} className="p-3 bg-white rounded-lg shadow group relative">
                            <p className="text-sm text-gray-500">{new Date(e.createdAt).toLocaleTimeString()}</p>
                            <p>{e.text}</p>
                            <button onClick={() => handleDeleteEntry(e.id)} className="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">🗑️</button>
                        </div>
                    ))}
                </div>
                <div className="mt-4">
                    <textarea value={newEntryText} onChange={e => setNewEntryText(e.target.value)} className="w-full p-2 border rounded-lg h-24" placeholder="New entry..."/>
                    <button onClick={handleSaveEntry} className="mt-2 w-full p-2 bg-violet-500 text-white rounded-lg font-bold">Save</button>
                </div>
            </>
        );

        const renderPastList = () => (
            <>
                <button onClick={() => setMode('today')} className="font-semibold text-violet-600 mb-4">{"<"} Back to Today</button>
                <h3 className="text-2xl font-bold my-4">Past Entries</h3>
                {Object.entries(pastEntriesGrouped).map(([month, dates]) => (
                    <div key={month}>
                        <h4 className="text-xl font-semibold mt-4 bg-gray-200 p-2 rounded-t-lg">{month}</h4>
                        {diarySummaries[month]?.month && <div className="p-2 bg-indigo-50 rounded-b-lg text-sm italic border-x border-b">{diarySummaries[month].month}</div>}
                        {Object.keys(dates).map(dateStr => (
                            <button key={dateStr} onClick={() => { setDetailKey(dateStr); setMode('past_detail'); }} className="block w-full text-left p-2 mt-1 bg-gray-50 hover:bg-gray-100 rounded-lg">
                                {formatDate(dateStr)}
                            </button>
                        ))}
                    </div>
                ))}
            </>
        );

        const renderPastDetail = () => {
            const entriesForDate = diaryEntries.filter(e => e.createdAt.startsWith(detailKey));
            return (
                <>
                    <button onClick={() => setMode('past_list')} className="font-semibold text-violet-600 mb-4">{"<"} Back to List</button>
                    <h3 className="text-2xl font-bold my-4">{formatDate(detailKey)}</h3>
                    {diarySummaries[detailKey]?.day && <div className="p-3 bg-indigo-100 rounded-lg mb-4"><strong>AI Summary:</strong> {diarySummaries[detailKey].day}</div>}
                    <div className="space-y-2">
                        {entriesForDate.map(e => <div key={e.id} className="p-3 bg-white rounded-lg shadow">{e.text}</div>)}
                    </div>
                </>
            );
        };

        return (
            <div className="h-full flex flex-col bg-gray-50 p-4">
                {mode === 'today' && renderToday()}
                {mode === 'past_list' && renderPastList()}
                {mode === 'past_detail' && renderPastDetail()}
            </div>
        );
    };
    
    const SettingsView = () => {
        const [tempSettings, setTempSettings] = useState(settings);

        const handleSave = () => {
            setSettings(tempSettings);
            alert("Settings saved!");
            setCurrentView('explore');
        };

        return (
            <div className="flex justify-center items-center h-full p-4">
                <div className="w-full max-w-2xl p-8 bg-white rounded-xl shadow-2xl border-t-4 border-violet-500">
                     <h2 className="text-3xl font-extrabold text-violet-600 mb-6">Settings</h2>
                     <div className="space-y-6">
                         <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">Aeryth's Tone</label>
                            <select name="aerythTone" value={tempSettings.aerythTone} onChange={(e) => setTempSettings(p=>({...p, aerythTone: e.target.value}))} className="mt-1 p-3 block w-full border rounded-lg">
                                <option>Friendly</option>
                                <option>Tough Love Coach</option>
                                <option>Gentle Assistant</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">Your Name</label>
                            <input type="text" name="userName" value={tempSettings.userName} onChange={(e) => setTempSettings(p=>({...p, userName: e.target.value}))} className="mt-1 p-3 block w-full border rounded-lg" placeholder="How should Aeryth address you?"/>
                        </div>
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">Personality Profile (AI Generated)</label>
                             <textarea 
                                readOnly
                                value={tempSettings.personalityProfile}
                                className="mt-1 p-3 block w-full border rounded-lg bg-gray-100 h-32" 
                            />
                            <p className="text-sm text-gray-500 mt-1">This is updated automatically by Aeryth to better understand you.</p>
                        </div>
                    </div>
                    <button onClick={handleSave} className="w-full mt-8 py-3 rounded-lg font-bold text-white bg-violet-500 hover:bg-violet-600 transition shadow-md">Save Settings</button>
                </div>
            </div>
        );
    };

    const MainViewRenderer = () => {
        switch (currentView) {
            case 'explore': return <ChatView />;
            case 'setGoal': return <SetGoalView />;
            case 'routineDetail': return <RoutineDetailView />;
            case 'diary': return <DiaryView />;
            case 'settings': return <SettingsView />;
            default: return <ChatView />;
        }
    }

    if (isLoading) return <LoadingScreen />;
    
    return (
        <div className="flex h-screen w-full font-sans bg-violet-50 overflow-hidden">
            <div className="flex-1 min-w-0">
                <MainViewRenderer />
            </div>
            <Sidebar />
        </div>
    );
};

export default App;

