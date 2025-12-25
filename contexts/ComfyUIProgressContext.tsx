/**
 * ComfyUI Progress Context
 * Provides WebSocket-based progress tracking state across the application
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useComfyUIProgress, ComfyUIProgressState } from '../hooks/useComfyUIProgress';

interface ComfyUIProgressContextType {
  progressState: ComfyUIProgressState | null;
  startTracking: (serverUrl: string, promptId: string) => void;
  stopTracking: () => void;
}

const ComfyUIProgressContext = createContext<ComfyUIProgressContextType | null>(null);

export function ComfyUIProgressProvider({ children }: { children: ReactNode }) {
  const { progressState, startTracking, stopTracking } = useComfyUIProgress();

  return (
    <ComfyUIProgressContext.Provider value={{ progressState, startTracking, stopTracking }}>
      {children}
    </ComfyUIProgressContext.Provider>
  );
}

export function useComfyUIProgressContext() {
  const context = useContext(ComfyUIProgressContext);
  if (!context) {
    throw new Error('useComfyUIProgressContext must be used within ComfyUIProgressProvider');
  }
  return context;
}
