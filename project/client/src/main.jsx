import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

if ((localStorage.getItem('ss_theme') || 'light') === 'dark') document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<App />);
