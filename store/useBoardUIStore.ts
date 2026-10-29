import { create } from 'zustand';
interface BoardUIState {
  sections: Record<string, boolean>;
  setSection(key: string, open: boolean): void;
  libraryOpen: boolean | null; inspectorOpen: boolean; minimapOpen: boolean;
  setLibraryOpen(open: boolean): void; setInspectorOpen(open: boolean): void; setMinimapOpen(open: boolean): void;
}
export const useBoardUIStore = create<BoardUIState>(set => ({
  sections: {}, setSection: (key, open) => set(state => ({ sections: { ...state.sections, [key]: open } })),
  libraryOpen: null, inspectorOpen: true, minimapOpen: true,
  setLibraryOpen: libraryOpen => set({ libraryOpen }), setInspectorOpen: inspectorOpen => set({ inspectorOpen }), setMinimapOpen: minimapOpen => set({ minimapOpen }),
}));
