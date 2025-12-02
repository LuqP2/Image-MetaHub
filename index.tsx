
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './src/index.css';
import './src/styles/themes.css';
import { A1111ProgressProvider } from './contexts/A1111ProgressContext.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <A1111ProgressProvider>
      <App />
    </A1111ProgressProvider>
  </React.StrictMode>
);
