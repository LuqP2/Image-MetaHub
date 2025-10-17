import { create } from 'zustand';

type View = 'gallery' | 'favorites';

interface AppState {
  view: View;
  setView: (view: View) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: 'gallery',
  setView: (view) => set({ view }),
}));
