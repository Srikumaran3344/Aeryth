<<<<<<< HEAD
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
=======
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
>>>>>>> 834cc03bbe56521f448652d55f83d2f3968509e3

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
