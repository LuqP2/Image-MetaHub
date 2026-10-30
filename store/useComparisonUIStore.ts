import { useCallback } from 'react';
import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import type { ComparisonAdvancedSettings, ComparisonLayoutMode, ComparisonViewMode, ZoomState } from '../types';
export interface ComparisonUIState {
  syncEnabled: boolean;
  sharedZoom: ZoomState;
  paneZooms: Record<string, ZoomState>;
  isMetadataExpanded: boolean;
  viewMode: ComparisonViewMode;
  layoutMode: ComparisonLayoutMode;
  metadataViewMode: 'standard' | 'diff';
  activeMetadataIndex: number | null;
  advancedSettings: ComparisonAdvancedSettings;
}
export const defaultComparisonUI = (): ComparisonUIState => ({ syncEnabled: true, sharedZoom: { zoom: 1, x: 0, y: 0 }, paneZooms: {}, isMetadataExpanded: false, viewMode: 'side-by-side', layoutMode: 'strip', metadataViewMode: 'diff', activeMetadataIndex: null, advancedSettings: { threshold: 18, opacity: 65, baseMode: 'left', flickerSpeedMs: 700, loupeSize: 220, loupeZoom: 2, showLabels: true } });
export const useComparisonUIStore = create<{ ui: ComparisonUIState }>(() => ({ ui: defaultComparisonUI() }));
export function useComparisonField<K extends keyof ComparisonUIState>(key: K): [ComparisonUIState[K], Dispatch<SetStateAction<ComparisonUIState[K]>>] {
  const value = useComparisonUIStore(state => state.ui[key]);
  const set = useCallback((next: SetStateAction<ComparisonUIState[K]>) => useComparisonUIStore.setState(state => { const value = typeof next === 'function' ? (next as (current: ComparisonUIState[K]) => ComparisonUIState[K])(state.ui[key]) : next; return Object.is(value, state.ui[key]) ? state : { ui: { ...state.ui, [key]: value } }; }), [key]);
  return [value, set];
}
