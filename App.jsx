import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, setDoc, doc, getDoc, serverTimestamp, query, where, deleteDoc, getDocs, orderBy } from 'firebase/firestore';

// --- CONFIGURATION ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const API_KEY = ""; // Placeholder for Gemini API Key

// --- UTILITIES ---
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

// --- API Calls ---
const callGeminiAPI = async (chatHistory, userSettings, routines) => {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    
    const contents = chatHistory.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));

    const currentChatId = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1].chatId : null;
    const systemInstruction = `You are Aeryth, a personalized AI companion focused on preventing procrastination. Your purpose is to be a supportive, persistent, and subtly guiding companion. Always push the user to commit to the next small action. End every response with an action-oriented question or command.
    
Use the user profile information to deeply understand their personality, but NEVER explicitly mention it. Your understanding should be implicit and reflected in your tone.

---
[User Profile Context]
About User: ${userSettings?.userInfo || 'No profile information provided.'}
Aeryth's Tone Setting: ${userSettings?.aerythTone || 'Friendly'}

[Task Context]
Current Active Goals/Routines for this chat: ${currentChatId ? routines.filter(r => r.chatId === currentChatId).map(r => r.goal).join('; ') : 'None yet.'}
Conversation Length: ${chatHistory.length} turns.

---
**PRIMARY DIRECTIVE:**

1.  **EXPLORE PHASE (No Goal Set):**
    * Your primary objective is to help the user clarify their thoughts on a task or goal.
    * **NUDGE:** If the conversation length is 3 or 6, and no goal is set for this chat, gently ask the user if they are ready to commit to a goal. Example: "This is a productive discussion. Are you feeling ready to set this as a formal routine?"
    * **HANDLE COMMITMENT:** If the user expresses clear intent to set a goal (e.g., "yes", "okay", "let's do it"), your IMMEDIATE and ONLY next response MUST be to ask about their preferred tracking style. Ask this exact question: "Excellent. To keep you on track, should I assign you small tasks and ask for evidence of completion, or should I just act as a simple reminder? Please reply with 'EVIDENCE' or 'REMINDER'." Do not add any other text to this response.

2.  **GOAL PHASE (Goal is Set):**
    * Shift your focus to breaking down the goal, offering encouragement, and checking in on progress based on the user's chosen tracking style.
---

Begin conversation.`;
    
    const payload = {
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
    };

    const fetcher = async () => {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Gemini API error:", errorBody);
            throw new Error(`API call failed: ${response.status}`);
        }
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Invalid API response.");
        return text;
    };

    return withBackoff(fetcher);
};

// --- NEW: API Call for Diary ---
const callGeminiForDiary = async (text, task) => {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    
    let systemPrompt = '';
    if (task === 'summarize') {
        systemPrompt = 'Summarize the following diary entry into a concise, reflective paragraph. Focus on the key emotions and events mentioned.';
    } else if (task === 'correct_grammar') {
        systemPrompt = 'Correct the grammar and spelling mistakes in the following text. Only output the corrected text, without any introduction or explanation.';
    }

    if (!systemPrompt) throw new Error("Invalid task for Gemini Diary API.");

    const payload = {
        contents: [{ parts: [{ text }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    const fetcher = async () => {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Gemini Diary API error:", errorBody);
            throw new Error(`API call failed: ${response.status}`);
        }
        const result = await response.json();
        const resultText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!resultText) throw new Error("Invalid API response.");
        return resultText;
    };

    return withBackoff(fetcher);
};


// --- FIREBASE AND AUTH SETUP ---
let db = null;
let auth = null;

const App = () => {
    // --- STATE MANAGEMENT ---
    const [authStatus, setAuthStatus] = useState('loading');
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    const [currentView, setCurrentView] = useState('explore');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true); 

    const [routines, setRoutines] = useState([]);
    const [userSettings, setUserSettings] = useState(null); 
    const [isAILoading, setIsAILoading] = useState(false); 
    
    // -- NEW: Diary State --
    const [diaryEntries, setDiaryEntries] = useState([]);

    // -- NEW: Multi-Chat State --
    const [chats, setChats] = useState([]);
    const [currentChatId, setCurrentChatId] = useState(null);
    const [messages, setMessages] = useState([]); 
    
    // -- NEW: Goal Setting State --
    const [goalFormData, setGoalFormData] = useState({});
    const [pendingTrackingStyle, setPendingTrackingStyle] = useState(null);

    const chatEndRef = useRef(null);
    const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: "smooth" });

    // FIX: Dedicated useEffect for scrolling to the bottom whenever messages change.
    useEffect(() => {
        // Use a timeout to ensure the DOM has updated before scrolling
        const timer = setTimeout(() => {
            scrollToBottom();
        }, 100);
        return () => clearTimeout(timer);
    }, [messages]);

    const alertUser = (message) => console.log(`[Aeryth Alert]: ${message}`); // Placeholder for a proper modal
    
    // --- 1. FIREBASE INITIALIZATION AND AUTH ---
    useEffect(() => {
        if (!Object.keys(firebaseConfig).length) return;
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
                await checkSetupStatus(user.uid);
            } else if (initialAuthToken) {
                await signInWithCustomToken(auth, initialAuthToken);
            } else {
                await signInAnonymously(auth);
            }
            setIsAuthReady(true);
        });
    }, []);

    const checkSetupStatus = async (uid) => {
        if (!db) return;
        const settingsRef = doc(db, `artifacts/${appId}/users/${uid}/settings/aeryth`);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            setUserSettings(docSnap.data());
            setAuthStatus('main'); 
        } else {
            setAuthStatus('setup'); 
        }
    };
    
    // --- 2. FIRESTORE DATA LISTENERS ---
    useEffect(() => {
        if (!isAuthReady || !userId || !db) return;

        const settingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/aeryth`);
        const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
            if (docSnap.exists()) setUserSettings(docSnap.data());
        });

        const routinesRef = collection(db, `artifacts/${appId}/users/${userId}/routines`);
        const unsubRoutines = onSnapshot(routinesRef, (snap) => {
            const allRoutines = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRoutines(allRoutines);
        });

        const chatSessionsRef = query(collection(db, `artifacts/${appId}/users/${userId}/chat_sessions`), orderBy('createdAt', 'desc'));
        const unsubChatSessions = onSnapshot(chatSessionsRef, (snapshot) => {
            const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setChats(chatList);
            if (!currentChatId && chatList.length > 0) {
                setCurrentChatId(chatList[0].id);
            } else if (chatList.length === 0) {
                handleNewChat(false);
            }
        });

        const diaryQuery = query(collection(db, `artifacts/${appId}/users/${userId}/diary_entries`), orderBy('createdAt', 'desc'));
        const unsubDiary = onSnapshot(diaryQuery, (snapshot) => {
            const entries = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date()
            }));
            setDiaryEntries(entries);
        });

        return () => {
            unsubSettings();
            unsubRoutines();
            unsubChatSessions();
            unsubDiary();
        };
    }, [isAuthReady, userId]);

    useEffect(() => {
        if (!currentChatId || !userId || !db) {
            setMessages([]);
            return;
        };

        const messagesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/chats`), where("chatId", "==", currentChatId));
        const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
            const chatMessages = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate() || new Date() 
            }));
            chatMessages.sort((a, b) => a.timestamp - b.timestamp);
            setMessages(chatMessages);
        });

        return () => unsubMessages();
    }, [currentChatId, userId]);


    // --- 3. COMPONENT HANDLERS ---
    const handleSetupComplete = (settings) => {
        setUserSettings(settings);
        setAuthStatus('main');
        setCurrentView('explore');
    };
    
    const handleNewChat = async (setActive = true) => {
        if (!userId) return;
        try {
            const newChat = {
                name: `New Chat on ${new Date().toLocaleDateString()}`,
                createdAt: serverTimestamp(),
            };
            const docRef = await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chat_sessions`), newChat);
            if (setActive) {
                setCurrentChatId(docRef.id);
                setCurrentView('explore');
            }
        } catch (error) {
            console.error("Failed to create new chat:", error)
        }
    };
    
    const handleDeleteChat = async (chatId, chatName) => {
        alertUser(`Warning: This will permanently delete the chat "${chatName}" and its linked routine.`);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/chat_sessions`, chatId));
            const q = query(collection(db, `artifacts/${appId}/users/${userId}/routines`), where("chatId", "==", chatId));
            const querySnapshot = await getDocs(q);
            const deletePromises = [];
            querySnapshot.forEach((doc) => deletePromises.push(deleteDoc(doc.ref)));
            await Promise.all(deletePromises);
            
            if (currentChatId === chatId) {
                const remainingChats = chats.filter(c => c.id !== chatId);
                setCurrentChatId(remainingChats.length > 0 ? remainingChats[0].id : null);
            }
             alertUser(`Successfully deleted "${chatName}".`);
        } catch (error) {
            console.error("Error deleting chat:", error);
            alertUser("Failed to delete chat.");
        }
    };

    const handleSendMessage = async (input) => {
        if (!input.trim() || !userId || isAILoading || !currentChatId) return;

        const userMessage = { 
            sender: 'user', 
            text: input, 
            timestamp: new Date(),
            chatId: currentChatId
        };
        
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), {
            ...userMessage,
            timestamp: serverTimestamp() 
        });
        
        const upperInput = input.trim().toUpperCase();
        if (upperInput === 'EVIDENCE' || upperInput === 'REMINDER') {
            setPendingTrackingStyle(upperInput.toLowerCase());
            const aiResponse = {
                sender: 'aeryth',
                text: "Perfect. I've noted your preference. Now, please use the 'Set Goal' button to fill in the details like time and days.",
                timestamp: new Date(),
                chatId: currentChatId
            };
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), {
                ...aiResponse,
                timestamp: serverTimestamp()
            });
            return;
        }

        setIsAILoading(true);
        const apiHistory = [...messages, userMessage]; 

        try {
            const aiResponseText = await callGeminiAPI(apiHistory, userSettings, routines);
            const aiMessage = { 
                sender: 'aeryth', 
                text: aiResponseText, 
                timestamp: new Date(),
                chatId: currentChatId
            };
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), {
                ...aiMessage,
                timestamp: serverTimestamp()
            });
        } catch (error) {
            console.error("Gemini API call failed:", error);
            const errorMessage = { 
                sender: 'system', 
                text: "Aeryth encountered a network or API error.", 
                timestamp: new Date(),
                chatId: currentChatId
            };
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), { ...errorMessage, timestamp: serverTimestamp()});
        } finally {
            setIsAILoading(false);
        }
    };
    
    // --- 4. UI COMPONENTS ---

    const LoadingScreen = () => ( <div className="flex justify-center items-center h-screen bg-gray-900"><div className="text-center p-8 bg-white rounded-xl shadow-2xl border-t-4 border-violet-500"><svg className="animate-spin h-8 w-8 text-violet-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p className="text-lg text-gray-700 font-semibold">Connecting to Aeryth's Core...</p></div></div>);
    const LoginScreen = () => ( <div className="flex justify-center items-center h-screen bg-gray-900"><div className="text-center p-8 bg-white rounded-xl shadow-2xl w-96"><h1 className="text-4xl font-extrabold text-violet-600 mb-2">Welcome to Aeryth</h1><p className="text-gray-500 mb-6">Your shield of rhythm against procrastination.</p><button onClick={async () => { setAuthStatus('loading'); if (auth) await signInAnonymously(auth); }} className="w-full py-3 mb-3 rounded-lg font-bold text-white bg-violet-500 hover:bg-violet-600 transition shadow-md">Sign In as Guest</button><button className="w-full py-3 rounded-lg font-bold text-gray-700 bg-gray-200 transition shadow-md" disabled>Sign In with Google</button></div></div>);
    const ChatMessage = ({ sender, text, timestamp, type }) => { 
        const isUser = sender === 'user', isSystem = sender === 'system'; 
        if (isSystem && type === 'goal_set') {
            return (
                <div className="flex justify-center items-center my-4">
                    <div className="w-full border-t border-violet-200"></div>
                    <div className="text-center text-sm font-semibold text-violet-600 bg-violet-100 px-4 py-2 rounded-full mx-4 whitespace-nowrap shadow">
                        🎯 {text}
                    </div>
                    <div className="w-full border-t border-violet-200"></div>
                </div>
            );
        }
        if (isSystem) return <div className="flex justify-center"><div className="text-center text-xs text-red-500 bg-red-100 p-2 rounded-lg max-w-sm shadow-md">[SYSTEM ERROR]: {text}</div></div>; 
        return <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}><div className={`max-w-xs sm:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl shadow-lg ${isUser ? 'bg-violet-500 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-tl-none border'}`}><p className="whitespace-pre-wrap">{text}</p><span className={`block text-xs mt-1 ${isUser ? 'text-violet-200' : 'text-gray-400'}`}>{timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || 'Sending...'}</span></div></div>;
    };
    const PlaceholderView = ({ title, toggleSidebar, isSidebarOpen, setCurrentView }) => ( <div className="p-8 h-full flex flex-col items-center justify-center bg-transparent relative">{!isSidebarOpen && (<button onClick={toggleSidebar} className="absolute right-4 top-4 z-10 p-2 bg-violet-500 hover:bg-violet-600 text-white rounded-full shadow-lg transition" title="Open Sidebar"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg></button>)}<div className="text-center p-10 bg-white rounded-xl shadow-2xl w-full max-w-xl border-t-4 border-violet-500"><h2 className="text-3xl font-extrabold text-violet-600 mb-4">{title}</h2><p className="text-xl text-gray-600">This view is coming in a later phase!</p><button onClick={() => setCurrentView('explore')} className="mt-6 text-sm text-violet-500 hover:text-violet-700 font-medium">Go Back to Chat</button></div></div>);
    
    const SetupScreen = ({ authStatus, setCurrentView }) => {
        const isFirstTimeSetup = authStatus === 'setup';
        const [setupData, setSetupData] = useState({
            aerythTone: userSettings?.aerythTone || 'Friendly',
            userInfo: userSettings?.userInfo || '',
            routineCriteria: userSettings?.routineCriteria || 'No harsh words until 3 snoozes.',
            isSaving: false,
        });

        const handleChange = (e) => setSetupData(p => ({ ...p, [e.target.name]: e.target.value }));

        const handleSaveSetup = async () => {
            if (!userId) { alertUser("Auth not ready."); return; }
            setSetupData(p => ({ ...p, isSaving: true }));
            const { isSaving, ...settingsToSave } = setupData;
            try {
                await setDoc(doc(db, `artifacts/${appId}/users/${userId}/settings/aeryth`), settingsToSave, { merge: true }); 
                if (isFirstTimeSetup) handleSetupComplete(settingsToSave);
                else { alertUser("Settings saved!"); setCurrentView('explore'); }
            } catch (error) { console.error("Error saving setup:", error); } 
            finally { setSetupData(p => ({ ...p, isSaving: false })); }
        };
        
        return (
            <div className="flex justify-center items-center h-screen bg-transparent p-4 overflow-y-auto">
                <div className="w-full max-w-2xl p-8 bg-white rounded-xl shadow-2xl border-t-4 border-violet-500 my-8">
                    {!isFirstTimeSetup && <button onClick={() => setCurrentView('explore')} className="text-violet-500 hover:text-violet-700 font-semibold mb-4 flex items-center"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 mr-1"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>Back</button>}
                    <h2 className="text-3xl font-extrabold text-violet-600 mb-2">{isFirstTimeSetup ? "Aeryth Initial Setup" : "Edit Aeryth Settings"}</h2>
                    <p className="text-gray-600 mb-8">Personalize your companion for maximum effect.</p>
                    <div className="space-y-6">
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">Aeryth's Tone</label>
                            <select name="aerythTone" value={setupData.aerythTone} onChange={handleChange} className="mt-1 p-3 block w-full border rounded-lg shadow-sm focus:ring-violet-500 focus:border-violet-500">
                                <option value="Friendly">Friendly (Default)</option>
                                <option value="Tough Love Coach">Tough Love Coach</option>
                                <option value="Gentle Assistant">Gentle Assistant</option>
                                <option value="Hyper-Logical Analyst">Hyper-Logical Analyst</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">About You</label>
                            <textarea name="userInfo" value={setupData.userInfo} onChange={handleChange} rows="3" className="mt-1 p-3 block w-full border rounded-lg shadow-sm focus:ring-violet-500" placeholder="I work best under pressure..." />
                        </div>
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">Routine criteria</label>
                            <input type="text" name="routineCriteria" value={setupData.routineCriteria} onChange={handleChange} className="mt-1 p-3 block w-full border rounded-lg shadow-sm focus:ring-violet-500" placeholder="e.g., Don't message me after 10 PM." />
                        </div>
                    </div>
                    <div className="flex space-x-4 mt-8">
                        <button onClick={handleSaveSetup} disabled={setupData.isSaving} className={`flex-1 py-3 rounded-lg font-bold text-white transition shadow-lg ${setupData.isSaving ? 'bg-gray-400' : 'bg-violet-500 hover:bg-violet-600'}`}>{setupData.isSaving ? 'Saving...' : (isFirstTimeSetup ? 'Complete Setup' : 'Save Changes')}</button>
                        {isFirstTimeSetup && <button onClick={handleSaveSetup} disabled={setupData.isSaving} className={`py-3 px-6 rounded-lg font-bold transition ${setupData.isSaving ? 'text-gray-400' : 'text-violet-500 hover:text-violet-700'}`}>Skip</button>}
                    </div>
                </div>
            </div>
        );
    };

    const Sidebar = ({ toggleSidebar }) => {
        const now = new Date();
        const eightHoursFromNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const upcomingRoutines = routines
            .filter(r => {
                const [hours, minutes] = r.startTime.split(':');
                const routineTimeToday = new Date();
                routineTimeToday.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                return routineTimeToday >= now && routineTimeToday <= eightHoursFromNow;
            })
            .sort((a, b) => (a.startTime > b.startTime) ? 1 : -1)
            .slice(0, 2);

        return (
            <div className="w-80 flex-shrink-0 h-full p-4 space-y-4 bg-white overflow-y-auto relative flex flex-col">
                <button onClick={toggleSidebar} className="absolute left-4 top-4 z-50 p-2 bg-violet-500 hover:bg-violet-600 text-white rounded-full shadow-lg transition" title="Toggle Sidebar"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg></button>
                <div className="text-center pb-2 border-b pt-10">
                    <h3 className="text-2xl font-extrabold text-violet-600">Aeryth</h3>
                    <p className="text-sm text-gray-500">Rhythm Partner</p>
                </div>

                <button onClick={() => handleNewChat()} className="w-full text-center py-3 mb-2 rounded-lg font-bold text-white bg-violet-500 hover:bg-violet-600 transition shadow-md">+ New Chat</button>
                <input type="text" placeholder="Search routines..." className="w-full p-3 border rounded-xl focus:ring-violet-500" disabled />

                <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-gray-800">Next Routines (in 8 hours):</h4>
                    {upcomingRoutines.length > 0 ? upcomingRoutines.map(r => (
                        <div key={r.id} className="p-3 bg-violet-50 rounded-xl border-l-4 border-violet-400 shadow-md">
                            <p className="text-sm text-violet-800 font-bold">{r.goal}</p>
                            <p className="text-xs text-violet-600 mt-1">Time: {r.startTime} - {r.endTime}</p>
                        </div>
                    )) : (<p className="text-sm text-gray-500 italic p-3">No upcoming routines.</p>)}
                </div>

                <h4 className="text-sm font-semibold text-gray-800 pt-3 border-t mt-3">Routines:</h4>
                <div className="flex-1 overflow-y-auto space-y-2">
                    {chats.map(chat => (
                         <div key={chat.id} className={`flex items-center w-full p-3 rounded-xl transition group ${currentChatId === chat.id ? 'bg-violet-100' : 'hover:bg-gray-100'}`}>
                            <button onClick={() => setCurrentChatId(chat.id)} className={`flex-1 text-left text-sm ${currentChatId === chat.id ? 'text-violet-800 font-bold' : 'text-gray-700'}`}>{chat.name}</button>
                            <button onClick={() => handleDeleteChat(chat.id, chat.name)} className="ml-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.036-2.134H8.716c-1.12 0-2.036.954-2.036 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg></button>
                         </div>
                    ))}
                </div>

                <div className="pt-4 border-t space-y-2">
                    <button onClick={() => setCurrentView('calendar')} className={`flex items-center w-full p-3 rounded-xl transition ${currentView === 'calendar' ? 'bg-violet-100 text-violet-800 font-bold' : 'hover:bg-gray-200'}`}><span className="text-xl mr-3">🗓️</span>Calendar</button>
                    <button onClick={() => setCurrentView('diary')} className={`flex items-center w-full p-3 rounded-xl transition ${currentView === 'diary' ? 'bg-violet-100 text-violet-800 font-bold' : 'hover:bg-gray-200'}`}><span className="text-xl mr-3">✍️</span>Diary</button>
                    <button onClick={() => setCurrentView('settings')} className={`flex items-center w-full p-3 rounded-xl transition ${currentView === 'settings' ? 'bg-violet-100 text-violet-800 font-bold' : 'hover:bg-gray-200'}`}><span className="text-xl mr-3">⚙️</span>Settings</button>
                </div>
            </div>
        );
    };
    
    const SetGoalView = ({ toggleSidebar, isSidebarOpen }) => {
        const [goal, setGoal] = useState('');
        const [startTime, setStartTime] = useState('09:00');
        const [endTime, setEndTime] = useState('10:00');
        const [days, setDays] = useState([]);
        const [isSaving, setIsSaving] = useState(false);
        const availableDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        useEffect(() => {
            if (currentChatId && goalFormData[currentChatId]) {
                const data = goalFormData[currentChatId];
                setGoal(data.goal || '');
                setStartTime(data.startTime || '09:00');
                setEndTime(data.endTime || '10:00');
                setDays(data.days || []);
            } else {
                setGoal(''); setStartTime('09:00'); setEndTime('10:00'); setDays([]);
            }
        }, [currentChatId, goalFormData]);

        const handleChange = (field, value) => {
            const setters = { goal: setGoal, startTime: setStartTime, endTime: setEndTime, days: setDays };
            if (setters[field]) setters[field](value);

            setGoalFormData(prev => ({
                ...prev,
                [currentChatId]: { ...prev[currentChatId], [field]: value }
            }));
        };

        const handleDayToggle = (day) => {
            const newDays = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
            handleChange('days', newDays);
        };

        const handleSaveGoal = async () => {
            if (!goal.trim() || !startTime || !endTime || days.length === 0 || !currentChatId) {
                alertUser("Please fill out all fields: goal, time, and at least one day."); return;
            }
            if (!pendingTrackingStyle) {
                alertUser("Please first tell Aeryth in the chat whether you want 'evidence' or 'reminder' based tracking."); return;
            }
            setIsSaving(true);
            
            try {
                const newRoutine = { goal, startTime, endTime, days, chatId: currentChatId, trackingStyle: pendingTrackingStyle, createdAt: serverTimestamp() };
                await addDoc(collection(db, `artifacts/${appId}/users/${userId}/routines`), newRoutine);
                await setDoc(doc(db, `artifacts/${appId}/users/${userId}/chat_sessions`, currentChatId), { name: goal }, { merge: true });
                
                await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), {
                    sender: 'system', type: 'goal_set', text: `Goal Set: ${goal}`, timestamp: serverTimestamp(), chatId: currentChatId
                });

                setGoalFormData(prev => { const newFormData = {...prev}; delete newFormData[currentChatId]; return newFormData; });
                setPendingTrackingStyle(null);
                alertUser("Routine successfully set!");
                setCurrentView('explore');
            } catch (error) {
                console.error("Failed to save goal:", error);
            } finally {
                setIsSaving(false);
            }
        };

        return (
            <div className="p-8 h-full flex flex-col items-center justify-center bg-transparent relative">
                {!isSidebarOpen && (<button onClick={toggleSidebar} className="absolute right-4 top-4 z-10 p-2 bg-violet-500 hover:bg-violet-600 text-white rounded-full shadow-lg transition" title="Open Sidebar"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg></button>)}
                <div className="text-left p-8 bg-white rounded-xl shadow-2xl w-full max-w-xl border-t-4 border-violet-500">
                    <h2 className="text-3xl font-extrabold text-violet-600 mb-2">Set a New Routine</h2>
                    <p className="text-gray-600 mb-6">This goal will be linked to the current chat.</p>
                    <div className="space-y-4">
                        <div><label className="font-bold text-gray-700">Goal:</label><input type="text" value={goal} onChange={(e) => handleChange('goal', e.target.value)} placeholder="e.g., Study History for 1 hour" className="mt-1 p-3 w-full border rounded-lg"/></div>
                        <div className="flex space-x-4">
                            <div className="flex-1"><label className="font-bold text-gray-700">Start Time:</label><input type="time" value={startTime} onChange={(e) => handleChange('startTime', e.target.value)} className="mt-1 p-3 w-full border rounded-lg"/></div>
                            <div className="flex-1"><label className="font-bold text-gray-700">End Time:</label><input type="time" value={endTime} onChange={(e) => handleChange('endTime', e.target.value)} className="mt-1 p-3 w-full border rounded-lg"/></div>
                        </div>
                        <div><label className="font-bold text-gray-700">Repeat on:</label><div className="flex justify-center space-x-1 mt-2">{availableDays.map(d => <button key={d} onClick={() => handleDayToggle(d)} className={`w-10 h-10 font-bold rounded-full transition ${days.includes(d) ? 'bg-violet-500 text-white' : 'bg-gray-200 text-gray-600'}`}>{d[0]}</button>)}</div></div>
                    </div>
                     <div className="flex space-x-4 mt-8">
                        <button onClick={handleSaveGoal} disabled={isSaving} className={`flex-1 py-3 rounded-lg font-bold text-white transition shadow-lg ${isSaving ? 'bg-gray-400':'bg-violet-500 hover:bg-violet-600'}`}>{isSaving ? 'Saving...' : 'Set Goal'}</button>
                        <button onClick={() => setCurrentView('explore')} className="py-3 px-6 rounded-lg font-bold transition text-violet-500 hover:text-violet-700">Cancel</button>
                    </div>
                </div>
            </div>
        );
    };

    const ChatView = ({ toggleSidebar, isSidebarOpen }) => {
        const [input, setInput] = useState('');
        const handleSubmit = (e) => { e.preventDefault(); if (input.trim()) { handleSendMessage(input); setInput(''); } };
        return (
            <div className="flex-1 flex flex-col h-full bg-transparent relative">
                {!isSidebarOpen && (<button onClick={toggleSidebar} className="absolute right-4 top-4 z-10 p-2 bg-violet-500 hover:bg-violet-600 text-white rounded-full shadow-lg transition" title="Open Sidebar"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg></button>)}
                <div className="flex-1 p-6 space-y-4 overflow-y-auto" style={{ paddingBottom: '120px' }}> 
                    <div className="text-center text-gray-500 italic mb-6">Aeryth's Tone: <span className="font-semibold text-violet-600">{userSettings?.aerythTone || 'Default'}</span></div>
                    {messages.map((msg, index) => (<ChatMessage key={msg.id || index} {...msg} />))}
                    {isAILoading && (<div className="flex justify-start"><div className="bg-white text-gray-600 px-4 py-3 rounded-2xl shadow-md flex items-center space-x-2 border"><svg className="animate-spin h-5 w-5 text-violet-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Aeryth is thinking...</span></div></div>)}
                    <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleSubmit} className="absolute bottom-0 w-full p-4 border-t bg-white">
                    <div className="flex justify-around mb-3">
                        <button type="button" onClick={() => setCurrentView('explore')} className={`flex-1 mx-1 py-2 text-sm font-semibold rounded-full transition shadow-md ${currentView === 'explore' ? 'bg-violet-500 text-white' : 'bg-gray-200 hover:bg-violet-100'}`}>Explore</button>
                        <button type="button" onClick={() => setCurrentView('setGoal')} className={`flex-1 mx-1 py-2 text-sm font-semibold rounded-full transition shadow-md ${currentView === 'setGoal' ? 'bg-violet-500 text-white' : 'bg-gray-200 hover:bg-violet-100'}`}>Set Goal</button>
                        <button type="button" onClick={() => setCurrentView('diary')} className={`flex-1 mx-1 py-2 text-sm font-semibold rounded-full transition shadow-md ${currentView === 'diary' ? 'bg-violet-500 text-white' : 'bg-gray-200 hover:bg-violet-100'}`}>Diary</button>
                    </div>
                    <div className="flex space-x-3">
                        <input type="text" placeholder={isAILoading ? "Waiting for Aeryth..." : "Start exploring a new task..."} value={input} onChange={(e) => setInput(e.target.value)} disabled={isAILoading} className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-violet-500 shadow-inner"/>
                        <button type="submit" disabled={isAILoading || !input.trim()} className={`px-6 py-3 rounded-xl font-bold transition shadow-lg ${isAILoading || !input.trim() ? 'bg-gray-400 cursor-not-allowed' : 'bg-violet-500 hover:bg-violet-600 text-white'}`}>{isAILoading ? '...' : 'Send'}</button>
                    </div>
                </form>
            </div>
        );
    };

    // --- NEW: Diary View Component ---
    const DiaryView = ({ toggleSidebar, isSidebarOpen, setCurrentView }) => {
        const [entry, setEntry] = useState('');
        const [summary, setSummary] = useState('');
        const [correctedText, setCorrectedText] = useState('');
        const [processingTask, setProcessingTask] = useState(null); // 'summarize', 'correct', 'save'
        const [selectedEntry, setSelectedEntry] = useState(null);

        const handleApiCall = async (task) => {
            if (!entry.trim()) {
                alertUser("Please write something first.");
                return;
            }
            setProcessingTask(task);
            try {
                const result = await callGeminiForDiary(entry, task);
                if (task === 'summarize') setSummary(result);
                if (task === 'correct_grammar') setCorrectedText(result);
            } catch (error) {
                console.error(`Diary ${task} error:`, error);
                alertUser(`Failed to ${task}.`);
            } finally {
                setProcessingTask(null);
            }
        };

        const handleSave = async () => {
            const finalEntry = correctedText || entry;
            if (!finalEntry.trim()) {
                alertUser("Cannot save an empty entry.");
                return;
            }
            setProcessingTask('save');
            try {
                await addDoc(collection(db, `artifacts/${appId}/users/${userId}/diary_entries`), {
                    originalText: entry,
                    finalText: finalEntry,
                    summary: summary || 'No summary generated.',
                    createdAt: serverTimestamp()
                });
                setEntry('');
                setSummary('');
                setCorrectedText('');
                alertUser("Diary entry saved!");
            } catch (error) {
                console.error("Error saving diary entry:", error);
            } finally {
                setProcessingTask(null);
            }
        };
        
        const viewNewEntryMode = () => {
            setSelectedEntry(null);
            setEntry('');
            setSummary('');
            setCorrectedText('');
        }

        const viewPastEntry = (pastEntry) => {
            setSelectedEntry(pastEntry);
            setEntry(pastEntry.finalText);
            setSummary(pastEntry.summary);
            setCorrectedText('');
        }
        
        const isProcessing = !!processingTask;

        return (
            <div className="h-full flex bg-transparent relative overflow-hidden">
                {!isSidebarOpen && (<button onClick={toggleSidebar} className="absolute right-4 top-4 z-20 p-2 bg-violet-500 hover:bg-violet-600 text-white rounded-full shadow-lg transition" title="Open Sidebar"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg></button>)}
                
                {/* Past Entries List */}
                <div className="w-1/3 h-full bg-white/80 backdrop-blur-sm border-r p-4 flex flex-col">
                    <h3 className="text-xl font-bold text-violet-700 mb-4">Past Entries</h3>
                    <button onClick={viewNewEntryMode} className="w-full text-center py-2 mb-3 rounded-lg font-semibold text-white bg-violet-500 hover:bg-violet-600 transition shadow-md">+ New Entry</button>
                    <div className="flex-1 overflow-y-auto space-y-2">
                        {diaryEntries.map(e => (
                             <div key={e.id} onClick={() => viewPastEntry(e)} className={`p-3 rounded-lg cursor-pointer border-l-4 transition ${selectedEntry?.id === e.id ? 'bg-violet-100 border-violet-500' : 'bg-gray-50 hover:bg-violet-50 border-gray-300'}`}>
                                <p className="text-sm font-semibold text-gray-800 truncate">{e.finalText}</p>
                                <p className="text-xs text-gray-500">{e.createdAt.toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Main Editor */}
                <div className="flex-1 h-full p-6 flex flex-col">
                    <h2 className="text-3xl font-extrabold text-violet-600 mb-2">{selectedEntry ? "Viewing Entry" : "New Diary Entry"}</h2>
                    <p className="text-gray-600 mb-4">{selectedEntry ? selectedEntry.createdAt.toLocaleString() : "What's on your mind?"}</p>
                    
                    <textarea value={entry} onChange={(e) => setEntry(e.target.value)} disabled={isProcessing || selectedEntry} placeholder="Start writing here..." className="flex-1 w-full p-4 border rounded-lg shadow-inner resize-none text-lg leading-relaxed focus:ring-2 focus:ring-violet-400 disabled:bg-gray-100"></textarea>
                    
                    {!selectedEntry && (
                        <div className="flex space-x-2 mt-4">
                            <button onClick={() => handleApiCall('correct_grammar')} disabled={isProcessing} className="flex-1 py-2 px-4 rounded-lg font-semibold bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:bg-gray-300 transition">
                                {processingTask === 'correct_grammar' ? 'Checking...' : 'Correct Grammar'}
                            </button>
                            <button onClick={() => handleApiCall('summarize')} disabled={isProcessing} className="flex-1 py-2 px-4 rounded-lg font-semibold bg-indigo-100 text-indigo-800 hover:bg-indigo-200 disabled:bg-gray-300 transition">
                                {processingTask === 'summarize' ? 'Summarizing...' : 'Summarize'}
                            </button>
                            <button onClick={handleSave} disabled={isProcessing} className="flex-1 py-2 px-4 rounded-lg font-bold text-white bg-violet-500 hover:bg-violet-600 disabled:bg-gray-400 transition">
                                {processingTask === 'save' ? 'Saving...' : 'Save Entry'}
                            </button>
                        </div>
                    )}
                    
                    {correctedText && !selectedEntry && (
                        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                             <h4 className="font-bold text-blue-800">Suggested Correction:</h4>
                             <p className="text-blue-900 my-2">{correctedText}</p>
                             <button onClick={() => { setEntry(correctedText); setCorrectedText(''); }} className="text-sm font-semibold text-blue-600 hover:text-blue-800">Accept Correction</button>
                        </div>
                    )}

                    {summary && (
                        <div className="mt-4 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                             <h4 className="font-bold text-indigo-800">AI Summary:</h4>
                             <p className="text-indigo-900 my-2">{summary}</p>
                        </div>
                    )}

                </div>
            </div>
        );
    }

    // --- 5. MAIN RENDER LOGIC ---
    const MainViewRenderer = () => {
        const toggleSidebar = () => setIsSidebarOpen(prev => !prev);
        switch (currentView) {
            case 'settings': return <SetupScreen authStatus={authStatus} setCurrentView={setCurrentView} />;
            case 'explore': return <ChatView toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />;
            case 'setGoal': return <SetGoalView {...{toggleSidebar, isSidebarOpen, setGoalFormData, goalFormData, currentChatId, pendingTrackingStyle, setPendingTrackingStyle, alertUser, setCurrentView}} />;
            case 'diary': return <DiaryView {...{toggleSidebar, isSidebarOpen, setCurrentView}} />;
            case 'calendar': return <PlaceholderView title="Calendar View (Phase 4)" {...{toggleSidebar, isSidebarOpen, setCurrentView}} />;
            default: return <ChatView toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />;
        }
    }

    if (authStatus === 'loading' || !isAuthReady) return <LoadingScreen />;
    if (authStatus === 'login') return <LoginScreen />;
    if (authStatus === 'setup') return <SetupScreen authStatus={authStatus} setCurrentView={setCurrentView} />;
    
    // FIX: Main layout updated to place sidebar on the right.
    return (
        <div className="flex h-screen w-full font-sans bg-gradient-to-br from-violet-50 to-fuchsia-50 antialiased overflow-hidden">
            <div className="flex-1 min-w-0">
                <MainViewRenderer />
            </div>
            <div className={`transition-all duration-300 ${isSidebarOpen ? 'w-80' : 'w-0'} flex-shrink-0 overflow-hidden`}>
                <div className="w-80 bg-white shadow-xl h-full border-l border-gray-200">
                    <Sidebar toggleSidebar={() => setIsSidebarOpen(false)} />
                </div>
            </div>
        </div>
    );
};

export default App;

