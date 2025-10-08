import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, onSnapshot, doc, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// --- CONFIGURATION ---
// These global variables are provided by the Canvas environment.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const API_KEY = ""; // Placeholder for Gemini API Key

// Utility function for exponential backoff during API calls
const withBackoff = async (fn, maxRetries = 5, delay = 1000) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay * 2 ** i));
        }
    }
};

// --- API Calls (Placeholders for Phase 2/3) ---
const callGeminiAPI = async (prompt, systemInstruction = "You are Aeryth, a personalized AI companion focused on preventing procrastination through friendly but persistent guidance.") => {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    
    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
    };

    const fetchRequest = async () => {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || "Aeryth couldn't form a response right now. Please try again.";
    };
    
    return withBackoff(fetchRequest);
};


// --- FIREBASE AND AUTH SETUP ---
let db = null;
let auth = null;

const App = () => {
    // State for Firebase and Auth
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [userId, setUserId] = useState(null);
    
    // State for UI and Navigation
    const [currentView, setCurrentView] = useState('explore'); // 'explore', 'setGoal', 'diary'
    const [chatHistory, setChatHistory] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    // State for Sidebar Data (Phase 3/4)
    const [routines, setRoutines] = useState([]);
    const [diaryEntries, setDiaryEntries] = useState([]);


    // 1. Firebase Initialization and Auth Listener
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase config is missing.");
            setIsAuthReady(true); // Allow UI to load even if DB is broken
            return;
        }

        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (error) {
                    console.error("Auth error:", error);
                }
            }
            setIsAuthReady(true);
        });
    }, []);

    // 2. Firestore Data Listeners (Diaries and Routines)
    useEffect(() => {
        if (!isAuthReady || !userId || !db) return;

        // Listener for private Diary Entries
        const diaryCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/diaries`);
        const unsubscribeDiary = onSnapshot(diaryCollectionRef, (snapshot) => {
            const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Sort by latest entry first
            setDiaryEntries(entries.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
        }, (error) => {
            console.error("Error fetching diary entries:", error);
        });

        // Listener for public Routines/Goals (for Phase 4)
        // For now, let's keep routines private until we implement comparison logic.
        const routineCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/routines`);
        const unsubscribeRoutines = onSnapshot(routineCollectionRef, (snapshot) => {
            const activeRoutines = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRoutines(activeRoutines);
        }, (error) => {
            console.error("Error fetching routines:", error);
        });


        // Clean up listeners on component unmount
        return () => {
            unsubscribeDiary();
            unsubscribeRoutines();
        };
    }, [isAuthReady, userId]);

    // --- HANDLERS FOR PHASE 2: CHAT (EXPLORE) ---
    const handleSendMessage = async (mode = 'explore') => {
        if (!input.trim() || loading) return;

        const userMessage = { sender: 'user', text: input.trim(), timestamp: new Date() };
        setChatHistory(prev => [...prev, userMessage]);
        setInput('');
        setLoading(true);

        const prompt = `User's query in ${mode} mode: ${userMessage.text}`;
        
        try {
            // Placeholder: Call Gemini API (This will be expanded in Phase 2)
            const aiResponse = await callGeminiAPI(prompt);

            const aiMessage = { sender: 'aeryth', text: aiResponse, timestamp: new Date() };
            setChatHistory(prev => [...prev, aiMessage]);

        } catch (error) {
            console.error("AI chat error:", error);
            const errorMessage = { sender: 'aeryth', text: "I hit a snag trying to process that. Please try again in a moment!", timestamp: new Date() };
            setChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };


    // --- HANDLERS FOR PHASE 3: DIARY ---
    const handleSaveDiaryEntry = async (entryText) => {
        if (!entryText.trim() || !userId || !db) return;
        
        // This is a simplified function. In Phase 3, we'll add summarization and grammar API calls here.
        const newEntry = {
            rawText: entryText.trim(),
            summary: "Awaiting AI summary...", // Placeholder
            timestamp: serverTimestamp(),
        };

        try {
            const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/diaries`);
            await addDoc(collectionRef, newEntry);
            alertUser('Diary entry saved! I’ll keep this safe for reflection.');
        } catch (error) {
            console.error("Error saving diary entry:", error);
            alertUser('Failed to save diary entry. Check the console for details.');
        }
    };

    // --- UI COMPONENTS ---
    
    // Custom Alert/Toast instead of window.alert
    const alertUser = (message) => {
        // Simple console log for now, replace with custom toast in full UI implementation
        console.log(`[Aeryth Alert]: ${message}`);
    }


    const Sidebar = () => (
        <div className="w-full h-full p-4 space-y-6 bg-gray-50 border-l border-gray-200 overflow-y-auto">
            <div className="text-center">
                <h3 className="text-2xl font-bold text-indigo-700">Aeryth Companion</h3>
                <p className="text-sm text-gray-500">User ID: {userId || 'Authenticating...'}</p>
            </div>
            
            {/* Active Routines (Phase 4) */}
            <div>
                <h4 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-3 flex justify-between items-center">
                    Active Routines
                    <span className="text-sm bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">{routines.length}</span>
                </h4>
                {routines.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No routines set. Use 'Set Goal' to start!</p>
                ) : (
                    <ul className="space-y-2">
                        {routines.slice(0, 3).map(r => (
                            <li key={r.id} className="p-3 bg-white rounded-lg shadow-sm text-sm text-gray-700 border border-indigo-200">
                                <strong>{r.goal}</strong> <br />
                                <span className="text-xs text-gray-500">Daily at {r.scheduleTime}</span>
                            </li>
                        ))}
                        {routines.length > 3 && <p className="text-xs text-center text-indigo-600 cursor-pointer hover:underline">View all {routines.length} routines...</p>}
                    </ul>
                )}
            </div>

            {/* Diary Log (Phase 3) */}
            <div>
                <h4 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-3 flex justify-between items-center">
                    Diary Log
                    <button onClick={() => setCurrentView('diary')} className="text-sm text-indigo-600 hover:text-indigo-800 transition">
                        + New Entry
                    </button>
                </h4>
                {diaryEntries.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">Start your reflection journal!</p>
                ) : (
                    <ul className="space-y-3">
                        {diaryEntries.slice(0, 3).map(d => (
                            <li key={d.id} className="p-3 bg-white rounded-lg shadow-md hover:shadow-lg transition cursor-pointer">
                                <p className="text-xs text-gray-400">
                                    {(d.timestamp?.toDate ? d.timestamp.toDate() : new Date()).toLocaleDateString()}
                                </p>
                                <p className="text-sm font-medium text-gray-700 truncate">{d.rawText}</p>
                                <p className="text-xs text-indigo-600 mt-1">Summary: {d.summary || 'Awaiting summary...'}</p>
                            </li>
                        ))}
                        {diaryEntries.length > 3 && <p className="text-xs text-center text-indigo-600 cursor-pointer hover:underline">View all {diaryEntries.length} entries...</p>}
                    </ul>
                )}
            </div>

            {/* Placeholder for Calendar View (Future Phase) */}
            <div className="bg-white p-4 rounded-xl shadow-lg border border-indigo-100">
                <h4 className="text-lg font-semibold text-gray-800">Schedule Collision Checker</h4>
                <p className="text-sm text-gray-500 mt-1">Future feature: Visualizing goal times to prevent overlaps.</p>
            </div>
        </div>
    );

    const ChatView = () => (
        <div className="flex-1 flex flex-col h-full bg-white">
            {/* Chat Messages Area */}
            <div className="flex-1 p-6 space-y-4 overflow-y-auto">
                <div className="text-center text-gray-500 italic mb-6">
                    Welcome to Aeryth. Let's work on your rhythm.
                </div>
                {chatHistory.map((msg, index) => (
                    <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xl p-4 rounded-xl shadow-md ${
                            msg.sender === 'user' 
                                ? 'bg-indigo-600 text-white rounded-br-none' 
                                : 'bg-gray-100 text-gray-800 rounded-tl-none border border-indigo-100'
                        }`}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                {loading && (
                     <div className="flex justify-start">
                        <div className="max-w-xl p-4 rounded-xl bg-gray-100 text-gray-800 rounded-tl-none">
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Aeryth is thinking...
                        </div>
                    </div>
                )}
            </div>

            {/* Input and Navigation Area */}
            <div className="p-4 border-t border-gray-200">
                <div className="flex justify-around mb-3">
                    <button 
                        onClick={() => setCurrentView('explore')} 
                        className={`px-4 py-2 text-sm font-semibold rounded-full transition duration-150 ${currentView === 'explore' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'}`}
                        title="Chat for ideas and general conversation"
                    >
                        Explore (Chat)
                    </button>
                    <button 
                        onClick={() => setCurrentView('setGoal')} 
                        className={`px-4 py-2 text-sm font-semibold rounded-full transition duration-150 ${currentView === 'setGoal' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'}`}
                        title="Set a structured routine goal"
                    >
                        Set Goal
                    </button>
                    <button 
                        onClick={() => setCurrentView('diary')} 
                        className={`px-4 py-2 text-sm font-semibold rounded-full transition duration-150 ${currentView === 'diary' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'}`}
                        title="Record today's progress and thoughts"
                    >
                        Diary
                    </button>
                </div>

                <div className="flex space-x-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSendMessage(currentView)}
                        placeholder={currentView === 'explore' ? "Ask Aeryth anything about your task..." : "Use the button above to navigate modes."}
                        className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-inner"
                        disabled={loading || currentView !== 'explore'}
                    />
                    <button 
                        onClick={() => handleSendMessage(currentView)} 
                        disabled={loading || currentView !== 'explore'}
                        className={`px-6 py-3 rounded-xl font-bold transition duration-300 shadow-md ${
                            loading || currentView !== 'explore' 
                                ? 'bg-gray-400 text-gray-600 cursor-not-allowed' 
                                : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg'
                        }`}
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );

    const GoalView = () => {
        const [goalData, setGoalData] = useState({ goal: '', duration: '', reason: '', dailyTime: '09:00' });
        const [isSaving, setIsSaving] = useState(false);

        const handleGoalChange = (e) => {
            const { name, value } = e.target;
            setGoalData(prev => ({ ...prev, [name]: value }));
        };

        const handleSaveGoal = async () => {
            if (!goalData.goal || !goalData.duration || !goalData.reason) {
                alertUser("Please fill out all goal fields.");
                return;
            }
            setIsSaving(true);
            try {
                const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/routines`);
                await addDoc(collectionRef, {
                    ...goalData,
                    status: 'active',
                    createdAt: serverTimestamp(),
                });
                alertUser(`Goal "${goalData.goal}" set successfully! Aeryth will nudge you at ${goalData.dailyTime}.`);
                setGoalData({ goal: '', duration: '', reason: '', dailyTime: '09:00' }); // Reset form
                setCurrentView('explore'); // Go back to chat
            } catch (error) {
                console.error("Error saving goal:", error);
                alertUser('Failed to save goal. Check the console for details.');
            } finally {
                setIsSaving(false);
            }
        };

        return (
            <div className="p-8 h-full overflow-y-auto bg-gray-50">
                <h2 className="text-3xl font-extrabold text-indigo-700 mb-6 border-b pb-2">Set Your Next Goal</h2>
                <p className="text-gray-600 mb-6">Define your goal, duration, and the time Aeryth should remind you daily.</p>
                <div className="space-y-4 max-w-lg mx-auto p-6 bg-white rounded-xl shadow-2xl">
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Goal (What are you building/studying?)</label>
                        <input
                            type="text"
                            name="goal"
                            value={goalData.goal}
                            onChange={handleGoalChange}
                            className="mt-1 p-3 block w-full border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g., Finish my project report"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Duration (How long will this take?)</label>
                        <input
                            type="text"
                            name="duration"
                            value={goalData.duration}
                            onChange={handleGoalChange}
                            className="mt-1 p-3 block w-full border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g., 2 weeks or 10 sessions"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Reason (Why is this important?)</label>
                        <textarea
                            name="reason"
                            value={goalData.reason}
                            onChange={handleGoalChange}
                            rows="3"
                            className="mt-1 p-3 block w-full border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g., I need a high grade or career advancement."
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Daily Scheduled Time (When should Aeryth nudge you?)</label>
                        <input
                            type="time"
                            name="dailyTime"
                            value={goalData.dailyTime}
                            onChange={handleGoalChange}
                            className="mt-1 p-3 block w-full border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    <button
                        onClick={handleSaveGoal}
                        disabled={isSaving || !userId}
                        className={`w-full py-3 rounded-lg font-bold text-white transition duration-300 shadow-lg ${
                            isSaving || !userId
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-green-600 hover:bg-green-700'
                        }`}
                    >
                        {isSaving ? 'Saving...' : 'Establish Routine with Aeryth'}
                    </button>
                    
                    <button 
                        onClick={() => setCurrentView('explore')} 
                        className="w-full text-sm text-indigo-600 mt-2 hover:text-indigo-800 transition"
                    >
                        Cancel and Go to Chat
                    </button>
                </div>
            </div>
        );
    };

    const DiaryView = () => {
        const [diaryInput, setDiaryInput] = useState('');
        const [isProcessing, setIsProcessing] = useState(false);
        
        const handleDiarySubmit = async () => {
            if (!diaryInput.trim()) {
                alertUser("Please write your thoughts before submitting.");
                return;
            }
            setIsProcessing(true);
            
            // Phase 3: In the next step, replace this placeholder with calls to the Grammar and Summarizer APIs
            await handleSaveDiaryEntry(diaryInput); 
            
            setDiaryInput('');
            setIsProcessing(false);
            setCurrentView('explore');
        }

        return (
            <div className="p-8 h-full overflow-y-auto bg-gray-50">
                <h2 className="text-3xl font-extrabold text-indigo-700 mb-6 border-b pb-2">Daily Reflection Diary</h2>
                <p className="text-gray-600 mb-6">Write down what you accomplished, what stopped you, or any thoughts for the day. Aeryth will process and summarize this later.</p>
                <div className="max-w-xl mx-auto p-6 bg-white rounded-xl shadow-2xl">
                    <textarea
                        value={diaryInput}
                        onChange={(e) => setDiaryInput(e.target.value)}
                        rows="10"
                        className="mt-1 p-4 block w-full border border-gray-300 rounded-lg shadow-inner focus:ring-indigo-500 focus:border-indigo-500 transition"
                        placeholder="Today, I worked on... but I got stuck when..."
                    />
                    <button
                        onClick={handleDiarySubmit}
                        disabled={isProcessing || !userId}
                        className={`w-full mt-4 py-3 rounded-lg font-bold text-white transition duration-300 shadow-lg ${
                            isProcessing || !userId
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                    >
                        {isProcessing ? 'Processing and Storing...' : 'Save Entry (Phase 3: AI Summarization)'}
                    </button>
                    <button 
                        onClick={() => setCurrentView('explore')} 
                        className="w-full text-sm text-indigo-600 mt-2 hover:text-indigo-800 transition"
                    >
                        Go Back to Chat
                    </button>
                </div>
            </div>
        );
    };


    const MainContent = () => {
        switch (currentView) {
            case 'setGoal':
                return <GoalView />;
            case 'diary':
                return <DiaryView />;
            case 'explore':
            default:
                return <ChatView />;
        }
    }
    
    // --- MAIN RENDER ---
    if (!isAuthReady) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-100">
                <div className="text-center p-6 bg-white rounded-xl shadow-xl">
                    <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-lg text-gray-700 font-semibold">Connecting to Aeryth's Core...</p>
                    <p className="text-sm text-gray-500 mt-1">Establishing Firebase connection and user authentication.</p>
                </div>
            </div>
        );
    }


    return (
        <div className="flex h-screen w-full font-sans bg-gray-100">
            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden">
                <MainContent />
            </div>
            {/* Right Sidebar */}
            <div className="w-80 flex-shrink-0 h-full">
                <Sidebar />
            </div>
        </div>
    );
};

export default App;
