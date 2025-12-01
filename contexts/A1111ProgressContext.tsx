import React, { createContext, useContext, ReactNode } from 'react';
import { useA1111Progress, A1111ProgressState } from '../hooks/useA1111Progress';

interface A1111ProgressContextType {
  progressState: A1111ProgressState | null;
  startPolling: (serverUrl: string, numberOfImages?: number) => void;
  stopPolling: () => void;
}

const A1111ProgressContext = createContext<A1111ProgressContextType | undefined>(undefined);

export function A1111ProgressProvider({ children }: { children: ReactNode }) {
  const { progressState, startPolling, stopPolling } = useA1111Progress();

  return (
    <A1111ProgressContext.Provider value={{ progressState, startPolling, stopPolling }}>
      {children}
    </A1111ProgressContext.Provider>
  );
}

export function useA1111ProgressContext() {
  const context = useContext(A1111ProgressContext);
  if (context === undefined) {
    throw new Error('useA1111ProgressContext must be used within A1111ProgressProvider');
  }
  return context;
}
