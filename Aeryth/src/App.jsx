import React, { useState, useEffect, useRef } from 'react';

// --- GEMINI NANO & LOCAL STORAGE CONFIGURATION ---

// Helper functions for local storage
const getFromStorage = (key, defaultValue) => {
  try {
    const item = window.localStorage.getItem(key);
    if (item) {
      return JSON.parse(item, (key, value) => {
        if (
          typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        ) {
          return new Date(value);
        }
        return value;
      });
    }
  } catch (error) {
    console.error(`Error reading from localStorage key “${key}”:`, error);
  }
  return defaultValue;
};

const saveToStorage = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving to localStorage key “${key}”:`, error);
  }
};

// --- GEMINI NANO API WRAPPERS (UPDATED TO NEW SYNTAX) ---
let chatSessions = {};

const callGeminiNanoAPI = async (chatHistory, userSettings, routines, currentChatId) => {
  if (!currentChatId) throw new Error('No active chat session.');

  // Check for new API
  if (!window.languageModel || !window.languageModel.create) {
    throw new Error('Gemini Nano API unavailable in this browser.');
  }

  if (!chatSessions[currentChatId]) {
    const systemInstruction = `You are Aeryth, a personalized AI companion focused on preventing procrastination. Always end every response with an action-oriented question or command.

[User Profile Context]
About User: ${userSettings?.userInfo || 'No profile information provided.'}
Tone: ${userSettings?.aerythTone || 'Friendly'}

[Task Context]
Active Goals: ${
      currentChatId
        ? routines
            .filter((r) => r.chatId === currentChatId)
            .map((r) => r.goal)
            .join('; ')
        : 'None yet.'
    }
Conversation Length: ${chatHistory.length} turns.

Begin conversation.`;

    // ✅ UPDATED: use window.languageModel.create()
    chatSessions[currentChatId] = await window.languageModel.create({
      systemPrompt: systemInstruction,
    });
  }

  const session = chatSessions[currentChatId];
  const lastUserMessage = chatHistory.at(-1)?.text || '';
  if (!lastUserMessage) return 'How can I help you proceed?';

  try {
    const result = await session.prompt(lastUserMessage);
    return result.output || result;
  } catch (error) {
    console.error('Gemini Nano prompt failed:', error);
    session.destroy?.();
    delete chatSessions[currentChatId];
    throw error;
  }
};

const callGeminiNanoForDiary = async (text, task) => {
  let systemPrompt = '';
  if (task === 'summarize') {
    systemPrompt =
      'Summarize the following diary entry into a concise, reflective paragraph.';
  } else if (task === 'correct_grammar') {
    systemPrompt =
      'Correct grammar and spelling mistakes in the following text. Output only the corrected text.';
  } else {
    throw new Error('Invalid task for Gemini Diary API.');
  }

  if (!window.languageModel?.create)
    throw new Error('Gemini Nano API unavailable.');

  const session = await window.languageModel.create({ systemPrompt });

  try {
    const result = await session.prompt(text);
    return result.output || result;
  } finally {
    session.destroy?.();
  }
};

// --- MAIN APP COMPONENT ---
const App = () => {
  const [appStatus, setAppStatus] = useState('loading');
  const [userId, setUserId] = useState(null);
  const [currentView, setCurrentView] = useState('explore');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [routines, setRoutines] = useState([]);
  const [userSettings, setUserSettings] = useState(null);
  const [isAILoading, setIsAILoading] = useState(false);
  const [diaryEntries, setDiaryEntries] = useState([]);
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [goalFormData, setGoalFormData] = useState({});
  const [pendingTrackingStyle, setPendingTrackingStyle] = useState(null);

  const chatEndRef = useRef(null);
  const scrollToBottom = () =>
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages]);

  const alertUser = (message) => console.log(`[Aeryth Alert]: ${message}`);

  // --- APP INITIALIZATION ---
  useEffect(() => {
    const initializeApp = async () => {
      if (!window.languageModel?.create) {
        setAppStatus('nano_unavailable');
        return;
      }

      let loadedUserId = getFromStorage('aeryth_userId', null);
      if (!loadedUserId) {
        loadedUserId = crypto.randomUUID();
        saveToStorage('aeryth_userId', loadedUserId);
      }
      setUserId(loadedUserId);

      setUserSettings(getFromStorage('aeryth_userSettings', null));
      setRoutines(getFromStorage('aeryth_routines', []));
      setDiaryEntries(getFromStorage('aeryth_diaryEntries', []));
      const allMessages = getFromStorage('aeryth_messages', []);
      const loadedChats = getFromStorage('aeryth_chats', []);

      setChats(loadedChats);
      if (loadedChats.length > 0) {
        const lastChatId = loadedChats[0].id;
        setCurrentChatId(lastChatId);
        setMessages(allMessages.filter((m) => m.chatId === lastChatId));
      } else {
        const newChatId = crypto.randomUUID();
        const newChat = {
          id: newChatId,
          name: `New Chat on ${new Date().toLocaleDateString()}`,
          createdAt: new Date(),
        };
        setChats([newChat]);
        setCurrentChatId(newChatId);
      }

      setAppStatus(userSettings ? 'main' : 'setup');
    };

    initializeApp();
  }, []);

  // --- AUTO SAVE ---
  useEffect(() => {
    if (appStatus !== 'main') return;
    saveToStorage('aeryth_userSettings', userSettings);
    saveToStorage('aeryth_routines', routines);
    saveToStorage('aeryth_diaryEntries', diaryEntries);
    saveToStorage('aeryth_chats', chats);
  }, [userSettings, routines, diaryEntries, chats, appStatus]);

  useEffect(() => {
    if (appStatus !== 'main' || !currentChatId) return;
    const allMessages = getFromStorage('aeryth_messages', []);
    const otherChatMessages = allMessages.filter(
      (m) => m.chatId !== currentChatId
    );
    saveToStorage('aeryth_messages', [...otherChatMessages, ...messages]);
  }, [messages, currentChatId, appStatus]);

  // --- MESSAGE HANDLER ---
  const handleSendMessage = async (input) => {
    if (!input.trim() || isAILoading || !currentChatId) return;

    const userMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: input,
      timestamp: new Date(),
      chatId: currentChatId,
    };
    setMessages((prev) => [...prev, userMessage]);

    const upperInput = input.trim().toUpperCase();
    if (upperInput === 'EVIDENCE' || upperInput === 'REMINDER') {
      setPendingTrackingStyle(upperInput.toLowerCase());
      const aiResponse = {
        id: crypto.randomUUID(),
        sender: 'aeryth',
        text: "Perfect. I've noted your preference. Now, please use the 'Set Goal' button to fill in the details.",
        timestamp: new Date(),
        chatId: currentChatId,
      };
      setMessages((prev) => [...prev, aiResponse]);
      return;
    }

    setIsAILoading(true);
    try {
      const aiResponseText = await callGeminiNanoAPI(
        [...messages, userMessage],
        userSettings,
        routines,
        currentChatId
      );
      const aiMessage = {
        id: crypto.randomUUID(),
        sender: 'aeryth',
        text: aiResponseText,
        timestamp: new Date(),
        chatId: currentChatId,
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error('Gemini Nano API call failed:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender: 'system',
          text: 'Aeryth encountered a local AI model error.',
          timestamp: new Date(),
          chatId: currentChatId,
        },
      ]);
    } finally {
      setIsAILoading(false);
    }
  };

  return <div>Aeryth React App Updated for Gemini Nano API</div>;
};

export default App;
