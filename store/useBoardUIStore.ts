import { create } from 'zustand';
interface BoardUIState {
  libraryOpen: boolean | null; inspectorOpen: boolean; minimapOpen: boolean;
  setLibraryOpen(open: boolean): void; setInspectorOpen(open: boolean): void; setMinimapOpen(open: boolean): void;
}
export const useBoardUIStore = create<BoardUIState>(set => ({
  libraryOpen: null, inspectorOpen: true, minimapOpen: true,
  setLibraryOpen: libraryOpen => set({ libraryOpen }), setInspectorOpen: inspectorOpen => set({ inspectorOpen }), setMinimapOpen: minimapOpen => set({ minimapOpen }),
}));
