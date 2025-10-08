import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, setDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';

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

// --- API Calls (Phase 2 Implementation) ---
const callGeminiAPI = async (chatHistory, systemInstruction) => {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    
    // Prepare contents array for the API, mapping local messages to API format
    const contents = chatHistory.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));
    
    const payload = {
        contents: contents,
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
    };

    const fetcher = async () => {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API call failed with status: ${response.status}`);
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error("Invalid response structure from API.");
        }
        return text;
    };

    return withBackoff(fetcher);
};

// --- FIREBASE AND AUTH SETUP ---
let db = null;
let auth = null;

const App = () => {
    // State for Firebase and Auth
    const [authStatus, setAuthStatus] = useState('loading'); // 'loading', 'login', 'setup', 'main'
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    // State for UI and Navigation
    const [currentView, setCurrentView] = useState('explore'); // 'explore', 'setGoal', 'diary', 'calendar', 'report', 'settings'
    const [isSidebarOpen, setIsSidebarOpen] = useState(true); 

    // State for Chat and Data 
    const [routines, setRoutines] = useState([]);
    const [diaryEntries, setDiaryEntries] = useState([]);
    const [userSettings, setUserSettings] = useState(null); 
    const [messages, setMessages] = useState([]); // NEW: Chat history state
    const [isAILoading, setIsAILoading] = useState(false); // NEW: Loading state
    
    // Ref for chat scrolling
    const chatEndRef = useRef(null);
    const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: "smooth" });

    // --- UTILITIES ---
    const alertUser = (message) => console.log(`[Aeryth Alert]: ${message}`);
    
    // --- 1. FIREBASE INITIALIZATION AND AUTH ---
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase config is missing.");
            setIsAuthReady(true);
            setAuthStatus('login');
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            
            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    await checkSetupStatus(user.uid);
                } else {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                }
                setIsAuthReady(true);
            });
        } catch (error) {
            console.error("Firebase initialization failed:", error);
            setIsAuthReady(true);
            setAuthStatus('login');
        }
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

        // Listener for User Settings
        const settingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/aeryth`);
        const unsubscribeSettings = onSnapshot(settingsRef, (docSnap) => {
            if (docSnap.exists()) {
                setUserSettings(docSnap.data());
            }
        }, (error) => console.error("Error fetching settings:", error));

        // Listener for private Diary Entries (Phase 3)
        const diaryCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/diaries`);
        const unsubscribeDiary = onSnapshot(diaryCollectionRef, (snapshot) => {
            const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setDiaryEntries(entries.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
        }, (error) => console.error("Error fetching diary entries:", error));

        // Listener for Routines/Goals (Phase 3)
        const routineCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/routines`);
        const unsubscribeRoutines = onSnapshot(routineCollectionRef, (snapshot) => {
            const activeRoutines = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRoutines(activeRoutines.sort((a, b) => (a.dailyTime > b.dailyTime) ? 1 : -1));
        }, (error) => console.error("Error fetching routines:", error));
        
        // Listener for Chat Messages (Phase 2)
        const chatCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/chats`);
        const unsubscribeChat = onSnapshot(chatCollectionRef, (snapshot) => {
            const chatMessages = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate() || new Date() 
            }));
            setMessages(chatMessages.sort((a, b) => a.timestamp - b.timestamp));
            scrollToBottom();
        }, (error) => console.error("Error fetching chat messages:", error));


        return () => {
            unsubscribeSettings();
            unsubscribeDiary();
            unsubscribeRoutines();
            unsubscribeChat();
        };
    }, [isAuthReady, userId]);

    // --- 3. COMPONENT HANDLERS ---

    // Handler to transition from Setup to Main App
    const handleSetupComplete = (settings) => {
        setUserSettings(settings);
        setAuthStatus('main');
        setCurrentView('explore');
    };
    
    const handleSendMessage = async (input) => {
        if (!input.trim() || !userId || isAILoading) return;

        // 1. Prepare new user message object and optimistically update local state
        const userMessage = { 
            sender: 'user', 
            text: input, 
            timestamp: new Date() 
        };
        
        // Update local state temporarily (Firestore listener will correct this when data syncs)
        setMessages(prev => [...prev, userMessage]); 
        
        // 2. Save user message to Firestore
        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), {
                ...userMessage,
                timestamp: serverTimestamp() 
            });
        } catch (error) {
            console.error("Failed to save user message:", error);
        }
        
        setIsAILoading(true);
        scrollToBottom();

        // 3. Prepare AI Prompt & System Instruction
        const systemInstruction = `You are Aeryth, a personalized AI companion focused on preventing procrastination. Your purpose is to be a supportive, persistent, and mildly manipulative guide. Always push the user to commit to the next small action. End every response with an action-oriented question or command.
        
        ---
        User Profile: ${userSettings?.userInfo || 'No profile information provided.'}
        Aeryth's Tone: ${userSettings?.aerythTone || 'Friendly Manipulator'}
        Nagging Criteria: ${userSettings?.naggingCriteria || 'No harsh words until 3 snoozes.'}
        Current Goals: ${routines.map(r => r.goal).join('; ') || 'No active goals.'}
        ---`;
        
        // Use the current messages state (synced by listener) as chat history for the API call
        const apiHistory = [...messages, userMessage]; 

        try {
            const aiResponseText = await callGeminiAPI(apiHistory, systemInstruction);
            
            const aiMessage = { 
                sender: 'aeryth', 
                text: aiResponseText, 
                timestamp: new Date() 
            };
            
            // 4. Save AI response to Firestore
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), {
                ...aiMessage,
                timestamp: serverTimestamp()
            });

        } catch (error) {
            console.error("Gemini API call failed:", error);
            // Add system error message to chat
            const errorMessage = { 
                sender: 'system', 
                text: "Aeryth encountered an error. Please check your network connection or the console for details.", 
                timestamp: new Date() 
            };
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/chats`), {
                ...errorMessage,
                timestamp: serverTimestamp()
            });
        } finally {
            setIsAILoading(false);
        }
    };
    
    // Placeholder for Phase 3 Diary
    const handleSaveDiaryEntry = async (entryText) => {
        // Implementation for Phase 3
    };

    // --- UI COMPONENTS: SCREENS (Login, Setup, Loading) ---

    const LoadingScreen = () => (
        <div className="flex justify-center items-center h-screen bg-gray-900">
            <div className="text-center p-8 bg-white rounded-xl shadow-2xl border-t-4 border-indigo-600">
                <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-lg text-gray-700 font-semibold">Connecting to Aeryth's Core...</p>
                <p className="text-sm text-gray-500 mt-1">Establishing identity and rhythm.</p>
            </div>
        </div>
    );

    const LoginScreen = () => {
        const handleGuestLogin = async () => {
             setAuthStatus('loading');
             if (auth) {
                 await signInAnonymously(auth);
             } else {
                 // Fallback if auth didn't initialize
                 setAuthStatus('setup'); 
             }
        }

        return (
            <div className="flex justify-center items-center h-screen bg-gray-900">
                <div className="text-center p-8 bg-white rounded-xl shadow-2xl w-96">
                    <h1 className="text-4xl font-extrabold text-indigo-700 mb-2">Welcome to Aeryth</h1>
                    <p className="text-gray-500 mb-6">Your shield of rhythm against procrastination.</p>
                    
                    <button
                        onClick={handleGuestLogin}
                        className="w-full py-3 mb-3 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-md"
                    >
                        Sign In as Guest (Recommended)
                    </button>
                    
                    <button
                        className="w-full py-3 rounded-lg font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 transition shadow-md"
                        disabled
                    >
                        Sign In with Google (Future Feature)
                    </button>
                    <p className="text-xs text-gray-400 mt-4">We use anonymous login to secure your data in Firestore.</p>
                </div>
            </div>
        );
    };

    const SetupScreen = () => {
        const [setupData, setSetupData] = useState({
            aerythTone: userSettings?.aerythTone || 'Friendly Manipulator',
            userInfo: userSettings?.userInfo || '',
            naggingCriteria: userSettings?.naggingCriteria || 'No harsh words until 3 snoozes.',
            isSaving: false,
        });

        const handleChange = (e) => {
            const { name, value } = e.target;
            setSetupData(prev => ({ ...prev, [name]: value }));
        };

        const handleSaveSetup = async () => {
            if (!userId) {
                alertUser("Authentication not ready. Please try again.");
                return;
            }

            setSetupData(prev => ({ ...prev, isSaving: true }));
            const settingsToSave = {
                aerythTone: setupData.aerythTone,
                userInfo: setupData.userInfo,
                naggingCriteria: setupData.naggingCriteria,
            };

            try {
                const settingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/aeryth`);
                await setDoc(settingsRef, settingsToSave);
                alertUser("Aeryth is configured! Starting the rhythm...");
                handleSetupComplete(settingsToSave);
            } catch (error) {
                console.error("Error saving setup:", error);
                alertUser("Failed to save settings. Check console.");
            } finally {
                setSetupData(prev => ({ ...prev, isSaving: false }));
            }
        };
        
        const skipSetup = () => {
            // Save defaults and skip
            handleSaveSetup(); 
        }

        return (
            <div className="flex justify-center items-center h-screen bg-gray-100 p-4 overflow-y-auto">
                <div className="w-full max-w-2xl p-8 bg-white rounded-xl shadow-2xl border-t-4 border-indigo-600 my-8">
                    <h2 className="text-3xl font-extrabold text-indigo-700 mb-2">Aeryth Initial Setup</h2>
                    <p className="text-gray-600 mb-8">Personalize your protective companion for maximum effect.</p>

                    <div className="space-y-6">
                        {/* 1. Tone */}
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">1. Aeryth's Tone</label>
                            <select
                                name="aerythTone"
                                value={setupData.aerythTone}
                                onChange={handleChange}
                                className="mt-1 p-3 block w-full border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="Friendly Manipulator">Friendly Manipulator (Default)</option>
                                <option value="Tough Love Coach">Tough Love Coach</option>
                                <option value="Gentle Assistant">Gentle Assistant</option>
                                <option value="Hyper-Logical Analyst">Hyper-Logical Analyst</option>
                            </select>
                        </div>
                        
                        {/* 2. User Info */}
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">2. About You</label>
                            <textarea
                                name="userInfo"
                                value={setupData.userInfo}
                                onChange={handleChange}
                                rows="3"
                                className="mt-1 p-3 block w-full border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder="I work best when I have a tight deadline. I am interested in history."
                            />
                            <p className="text-sm text-gray-500 mt-1">This helps Aeryth personalize its conversation.</p>
                        </div>

                        {/* 3. Nagging Criteria */}
                        <div>
                            <label className="block text-lg font-bold text-gray-700 mb-2">3. Nagging Criteria (The 'Stop' Switch)</label>
                            <input
                                type="text"
                                name="naggingCriteria"
                                value={setupData.naggingCriteria}
                                onChange={handleChange}
                                className="mt-1 p-3 block w-full border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder="e.g., Don't message me after 10 PM. Stop after 5 failed attempts."
                            />
                            <p className="text-sm text-gray-500 mt-1">Aeryth will stop or ease up based on this rule.</p>
                        </div>
                    </div>
                    
                    <div className="flex space-x-4 mt-8">
                        <button
                            onClick={handleSaveSetup}
                            disabled={setupData.isSaving}
                            className={`flex-1 py-3 rounded-lg font-bold text-white transition duration-300 shadow-lg ${
                                setupData.isSaving
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-700'
                            }`}
                        >
                            {setupData.isSaving ? 'Saving...' : 'Complete Setup'}
                        </button>
                        <button 
                            onClick={skipSetup}
                            disabled={setupData.isSaving}
                            className={`py-3 px-6 rounded-lg font-bold transition duration-300 ${
                                setupData.isSaving
                                    ? 'text-gray-400 cursor-not-allowed'
                                    : 'text-indigo-600 hover:text-indigo-800'
                            }`}
                        >
                            Skip for Now
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // --- UI COMPONENTS: LAYOUT & SIDEBAR ---

    const Sidebar = ({ userId, routines, currentView, setCurrentView, toggleSidebar }) => {
        // Find the next upcoming routine
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        const nextRoutine = routines.find(r => r.dailyTime > currentTime) || routines[0];
        
        const SidebarButton = ({ view, icon, label }) => (
            <button
                onClick={() => setCurrentView(view)}
                className={`flex items-center w-full p-3 rounded-xl transition duration-150 ${
                    currentView === view 
                        ? 'bg-indigo-100 text-indigo-800 font-bold shadow-inner'
                        : 'text-gray-700 hover:bg-gray-200'
                }`}
            >
                <span className="text-xl mr-3">{icon}</span>
                {label}
            </button>
        );

        return (
            <div className="w-80 flex-shrink-0 h-full p-4 space-y-4 bg-white overflow-y-auto relative">
                
                {/* Close Button (Now a universal toggle icon) */}
                <button
                    onClick={toggleSidebar}
                    // Changed styling from red to indigo and title to reflect universal toggle
                    className="absolute right-4 top-4 z-50 p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg transition"
                    title="Toggle Sidebar"
                >
                    {/* Hamburger Icon (used for universal toggle) */}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                </button>
                
                <div className="text-center pb-2 border-b pt-10"> {/* Added pt-10 to account for button */}
                    <h3 className="text-2xl font-extrabold text-indigo-700">Aeryth</h3>
                    <p className="text-sm text-gray-500">Rhythm Partner</p>
                    <p className="text-xs text-gray-400 truncate" title={userId}>ID: {userId ? userId.slice(0, 8) + '...' : '...'}</p>
                </div>
                
                {/* Search Bar (Future Feature) */}
                <div className="mb-4">
                    <input 
                        type="text" 
                        placeholder="Search routines or diary..." 
                        className="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                        disabled 
                    />
                </div>

                {/* Next Routine (Main List) */}
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-gray-800">Next Routine:</h4>
                    {nextRoutine ? (
                        <div className="p-3 bg-indigo-50 rounded-xl border-l-4 border-indigo-500 shadow-md">
                            <p className="text-sm text-indigo-800 font-bold">{nextRoutine.goal}</p>
                            <p className="text-xs text-indigo-600 mt-1">Starts at: {nextRoutine.dailyTime}</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 italic p-3">No active goals. Set one!</p>
                    )}
                    
                    <h4 className="text-sm font-semibold text-gray-800 pt-3 border-t mt-3">All Routines:</h4>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                        {routines.map(r => (
                            <div key={r.id} className="p-2 bg-gray-50 rounded-lg text-xs text-gray-700 border border-gray-200">
                                <span className="font-medium">{r.goal}</span> ({r.dailyTime})
                            </div>
                        ))}
                    </div>
                </div>

                {/* Navigation Buttons (Lower Quarter) */}
                <div className="pt-4 border-t border-gray-200 space-y-2">
                    <h4 className="text-sm font-semibold text-gray-800">Navigation:</h4>
                    <SidebarButton view="calendar" icon="🗓️" label="Calendar (Phase 4)" />
                    <SidebarButton view="diary" icon="✍️" label="Diary" />
                    <SidebarButton view="report" icon="📈" label="Progress Report (Phase 4)" />
                    <SidebarButton view="explore" icon="💬" label="Chat with Aeryth" />
                </div>
                
                {/* Settings Button */}
                <div className="pt-4 border-t border-gray-200">
                    <SidebarButton view="settings" icon="⚙️" label="Settings & Setup" />
                </div>
            </div>
        );
    };
    
    // Component to display a single message
    const ChatMessage = ({ sender, text, timestamp }) => {
        const isUser = sender === 'user';
        const isSystem = sender === 'system';
        
        if (isSystem) {
             return (
                 <div className="flex justify-center">
                     <div className="text-center text-xs text-red-500 bg-red-100 p-2 rounded-lg max-w-sm shadow-md">
                         [SYSTEM ERROR]: {text}
                     </div>
                 </div>
             )
        }

        return (
            <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div 
                    className={`max-w-xs sm:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl shadow-lg ${
                        isUser 
                            ? 'bg-indigo-600 text-white rounded-br-none' 
                            : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'
                    }`}
                >
                    <p className="whitespace-pre-wrap">{text}</p>
                    <span className={`block text-xs mt-1 ${isUser ? 'text-indigo-200' : 'text-gray-400'}`}>
                        {timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || 'Sending...'}
                    </span>
                </div>
            </div>
        );
    };


    const ChatView = ({ toggleSidebar, isSidebarOpen, messages, handleSendMessage, isAILoading, chatEndRef, userSettings, setCurrentView }) => {
        const [input, setInput] = useState('');
        
        const handleSubmit = (e) => {
            e.preventDefault();
            if (input.trim()) {
                handleSendMessage(input);
                setInput('');
            }
        };

        return (
            <div className="flex-1 flex flex-col h-full bg-gray-100 relative">
                {/* Sidebar Toggle Button (Open) - Only visible when sidebar is CLOSED */}
                {/* Now placed outside the sidebar to initiate the toggle */}
                {!isSidebarOpen && (
                    <button
                        onClick={toggleSidebar}
                        className="absolute right-4 top-4 z-10 p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg transition"
                        title="Open Sidebar"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>
                )}

                {/* Chat Messages Area - Scrollable area with padding for the fixed footer/input */}
                <div className="flex-1 p-6 space-y-4 overflow-y-auto" style={{ paddingBottom: '120px' }}> 
                    <div className="text-center text-gray-500 italic mb-6">
                        Aeryth's Tone: <span className="font-semibold text-indigo-600">{userSettings?.aerythTone}</span> | Current Mode: Chat
                    </div>
                    
                    {messages.map((msg, index) => (
                        <ChatMessage key={index} sender={msg.sender} text={msg.text} timestamp={msg.timestamp} />
                    ))}

                    {isAILoading && (
                        <div className="flex justify-start">
                            <div className="bg-white text-gray-600 px-4 py-3 rounded-2xl rounded-tl-none shadow-md flex items-center space-x-2 border border-gray-200">
                                 <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Aeryth is calculating the optimal push...</span>
                            </div>
                        </div>
                    )}
                    
                    <div ref={chatEndRef} />
                </div>

                {/* Input and Navigation Area - Fixed at the bottom */}
                <form onSubmit={handleSubmit} className="absolute bottom-0 w-full p-4 border-t border-gray-200 bg-white">
                    <div className="flex justify-around mb-3">
                        <button 
                            type="button"
                            onClick={() => setCurrentView('explore')} 
                            className={`flex-1 mx-1 py-2 text-sm font-semibold rounded-full transition duration-150 shadow-md ${currentView === 'explore' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'}`}
                            title="Chat for ideas and general conversation"
                        >
                            Explore (Chat)
                        </button>
                        <button 
                            type="button"
                            onClick={() => setCurrentView('setGoal')} 
                            className={`flex-1 mx-1 py-2 text-sm font-semibold rounded-full transition duration-150 shadow-md ${currentView === 'setGoal' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'}`}
                            title="Set a structured routine goal"
                        >
                            Set Goal (Phase 3)
                        </button>
                        <button 
                            type="button"
                            onClick={() => setCurrentView('diary')} 
                            className={`flex-1 mx-1 py-2 text-sm font-semibold rounded-full transition duration-150 shadow-md ${currentView === 'diary' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'}`}
                            title="Record today's progress and thoughts"
                        >
                            Diary (Phase 3)
                        </button>
                    </div>

                    <div className="flex space-x-3">
                        <input
                            type="text"
                            placeholder={isAILoading ? "Waiting for Aeryth..." : "Ask Aeryth anything about your task..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={isAILoading}
                            className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-inner"
                        />
                        <button 
                            type="submit"
                            disabled={isAILoading || !input.trim()}
                            className={`px-6 py-3 rounded-xl font-bold transition duration-300 shadow-lg ${
                                isAILoading || !input.trim()
                                    ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                        >
                            {isAILoading ? 'Thinking' : 'Send'}
                        </button>
                    </div>
                </form>
            </div>
        );
    };
    
    // Placeholder Views for other main screens
    const PlaceholderView = ({ title, toggleSidebar, isSidebarOpen }) => (
        <div className="p-8 h-full flex flex-col items-center justify-center bg-gray-100 relative">
            {/* Sidebar Toggle Button (Open) - Only visible when sidebar is CLOSED */}
            {!isSidebarOpen && (
                <button
                    onClick={toggleSidebar}
                    className="absolute right-4 top-4 z-10 p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg transition"
                    title="Open Sidebar"
                >
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                </button>
            )}
            <div className="text-center p-10 bg-white rounded-xl shadow-2xl w-full max-w-xl border-t-4 border-indigo-600">
                <h2 className="text-3xl font-extrabold text-indigo-700 mb-4">{title}</h2>
                <p className="text-xl text-gray-600">This view is coming in a later phase!</p>
                <p className="text-gray-500 mt-2">Current View: **{title}** is ready for implementation.</p>
                <button onClick={() => setCurrentView('explore')} className="mt-6 text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                    Go Back to Chat
                </button>
            </div>
        </div>
    );
    
    const MainViewRenderer = () => {
        // Function to toggle the sidebar
        const toggleSidebar = () => setIsSidebarOpen(prev => !prev);

        // Map 'settings' view back to the SetupScreen component
        if (currentView === 'settings') {
            // Setup screen is static and doesn't need the toggle button
            return <SetupScreen />;
        }
        
        // Map other views to components, passing props
        switch (currentView) {
            case 'explore':
                return <ChatView 
                    toggleSidebar={toggleSidebar} 
                    isSidebarOpen={isSidebarOpen} 
                    messages={messages}
                    handleSendMessage={handleSendMessage}
                    isAILoading={isAILoading}
                    chatEndRef={chatEndRef}
                    userSettings={userSettings}
                    setCurrentView={setCurrentView}
                />;
            case 'setGoal':
                return <PlaceholderView title="Set Goal (Phase 3)" toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />;
            case 'diary':
                return <PlaceholderView title="Diary Entry (Phase 3)" toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />;
            case 'calendar':
                return <PlaceholderView title="Calendar View (Phase 4)" toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />;
            case 'report':
                return <PlaceholderView title="Progress Report (Phase 4)" toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />;
            default:
                return <PlaceholderView title="Unknown View" toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />;
        }
    }


    // --- MAIN RENDER LOGIC ---

    if (authStatus === 'loading' || !isAuthReady) {
        return <LoadingScreen />;
    }

    if (authStatus === 'login') {
        return <LoginScreen />;
    }

    if (authStatus === 'setup') {
        return <SetupScreen />;
    }
    
    // Main App Layout using Flexbox for dynamic resizing
    return (
        <div className="flex h-screen w-full font-sans bg-gray-100 antialiased overflow-hidden">
            
            {/* 1. Main Content Area (Dynamically shrinks when sidebar is open) */}
            <div className="flex-1 min-w-0 overflow-hidden">
                <MainViewRenderer />
            </div>
            
            {/* 2. Right Sidebar Area (Dynamic width and content control) */}
            <div className={`h-full transition-all duration-300 ${isSidebarOpen ? 'w-80' : 'w-0'} flex-shrink-0 overflow-hidden`}>
                {/* Inner div with fixed width (w-80) to ensure content looks correct during transition */}
                <div className={`w-80 bg-white shadow-xl h-full border-l border-gray-200 ${isSidebarOpen ? '' : 'opacity-0 pointer-events-none'}`}>
                    <Sidebar 
                        userId={userId} 
                        routines={routines} 
                        currentView={currentView} 
                        setCurrentView={setCurrentView}
                        toggleSidebar={() => setIsSidebarOpen(false)} 
                    />
                </div>
            </div>
        </div>
    );
};

export default App;
