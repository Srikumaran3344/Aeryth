
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import React, { useEffect, useState } from "react";
import { initFirebase } from "./utils/firebaseInit.js";


const Root = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await initFirebase(); // waits for auth and firestore ready
      setReady(true);
    })();
  }, []);

  if (!ready) return <div>Loading Firebase...</div>;
  return (<App />);
};
createRoot(document.getElementById('root')).render(
  <Root />
)
