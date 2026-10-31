import { create } from 'zustand';
interface BoardUIState {
  libraryWidth: number; inspectorWidth: number;
  setPanelWidth(side: 'library' | 'inspector', width: number): void;
  groupOrders: Record<string, 'count' | 'name'>;
  setGroupOrder(key: string, order: 'count' | 'name'): void;
  sections: Record<string, boolean>;
  setSection(key: string, open: boolean): void;
  libraryOpen: boolean | null; inspectorOpen: boolean; minimapOpen: boolean;
  setLibraryOpen(open: boolean): void; setInspectorOpen(open: boolean): void; setMinimapOpen(open: boolean): void;
}
export const useBoardUIStore = create<BoardUIState>(set => ({
  ...(() => { try { const saved = JSON.parse(localStorage.getItem('imh-board-panel-widths') ?? '{}'); return { libraryWidth: Math.max(220, Math.min(560, Number(saved.libraryWidth) || 264)), inspectorWidth: Math.max(260, Math.min(560, Number(saved.inspectorWidth) || 320)) }; } catch { return { libraryWidth: 264, inspectorWidth: 320 }; } })(),
  setPanelWidth(side, width) { if (!Number.isFinite(width)) return; set({ [side === 'library' ? 'libraryWidth' : 'inspectorWidth']: Math.round(Math.max(side === 'library' ? 220 : 260, Math.min(560, width))) }); },
  groupOrders: {}, setGroupOrder: (key, order) => set(state => ({ groupOrders: { ...state.groupOrders, [key]: order } })),
  sections: {}, setSection: (key, open) => set(state => ({ sections: { ...state.sections, [key]: open } })),
  libraryOpen: null, inspectorOpen: true, minimapOpen: true,
  setLibraryOpen: libraryOpen => set({ libraryOpen }), setInspectorOpen: inspectorOpen => set({ inspectorOpen }), setMinimapOpen: minimapOpen => set({ minimapOpen }),
}));
useBoardUIStore.subscribe((state, previous) => { if (state.libraryWidth === previous.libraryWidth && state.inspectorWidth === previous.inspectorWidth) return; try { localStorage.setItem('imh-board-panel-widths', JSON.stringify({ libraryWidth: state.libraryWidth, inspectorWidth: state.inspectorWidth })); } catch { /* Widths are optional preferences. */ } });
