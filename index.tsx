
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './src/index.css';
import './src/styles/themes.css';
import { A1111ProgressProvider } from './contexts/A1111ProgressContext.tsx';
import { useLicenseStore } from './store/useLicenseStore';
import { useImageStore } from './store/useImageStore';
import { useSettingsStore } from './store/useSettingsStore';

// Expose stores globally for debugging
if (process.env.NODE_ENV === 'development') {
  (window as any).useLicenseStore = useLicenseStore;
  (window as any).useImageStore = useImageStore;
  (window as any).useSettingsStore = useSettingsStore;
  console.log('🔧 [DEV] Stores exposed globally: useLicenseStore, useImageStore, useSettingsStore');
}

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
