
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './src/index.css';
import './src/styles/themes.css';
import { A1111ProgressProvider } from './contexts/A1111ProgressContext.tsx';
import { ComfyUIProgressProvider } from './contexts/ComfyUIProgressContext.tsx';
import { useLicenseStore } from './store/useLicenseStore';
import { useImageStore } from './store/useImageStore';
import { useSettingsStore } from './store/useSettingsStore';
import { initializePerformanceDiagnostics } from './utils/performanceDiagnostics';
import DetachedImageModalApp from './components/DetachedImageModalApp';
import { AppErrorBoundary } from './components/AppErrorBoundary';

// Expose stores globally for debugging
if (process.env.NODE_ENV === 'development') {
  Object.assign(window, {
    useLicenseStore,
    useImageStore,
    useSettingsStore,
  });
  console.log('🔧 [DEV] Stores exposed globally: useLicenseStore, useImageStore, useSettingsStore');
}

initializePerformanceDiagnostics();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const isDetachedImageViewer = new URLSearchParams(window.location.search).get('window') === 'image-modal';
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <A1111ProgressProvider>
        <ComfyUIProgressProvider>
          {isDetachedImageViewer ? <DetachedImageModalApp /> : <App />}
        </ComfyUIProgressProvider>
      </A1111ProgressProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
