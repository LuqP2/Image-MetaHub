import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem, ModelInspectorSnapshot } from '../services/modelLibrary/types';

const fakes = vi.hoisted(() => ({ snapshot: undefined as ((value: ModelInspectorSnapshot) => void) | undefined, progress: undefined as ((value: { requestId: string; bytesProcessed: number; totalBytes: number }) => void) | undefined, navigate: vi.fn(), follow: vi.fn(), select: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({ mirrorModelManager: () => () => {}, useModelManager: () => ({ progress: { kind: 'identify' } }) }));
vi.mock('../store/useSettingsStore', () => ({ useSettingsStore: Object.assign((selector: (settings: { theme: string }) => unknown) => selector({ theme: 'dark' }), { persist: { rehydrate: vi.fn().mockResolvedValue(undefined) } }) }));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../components/ModelDetailsPanels', () => ({ default: ({ item, connectionExtras }: { item: ModelInspectorItem; connectionExtras?: React.ReactNode }) => <div><p>Shared detail panels: {item.location.id}</p><details><summary>Connections &amp; updates</summary>{connectionExtras}</details></div> }));
import ModelInspectorApp from '../components/ModelInspectorApp';
const snapshot = (selectedId = 'copy'): ModelInspectorSnapshot => ({ revision: 1, selectedId, followSelection: false, isAlwaysOnTop: false, items: ['primary', 'copy'].map((id) => ({
  location: { id, sourceKind: 'checkpoint', sourceName: 'Synthetic', fileName: `${id}.safetensors`, absolutePath: `/synthetic/${id}.safetensors`, relativePath: `${id}.safetensors`, size: 100, sha256: 'a'.repeat(64) } as ModelInspectorItem['location'],
})) });
beforeEach(() => {
  fakes.snapshot = undefined; fakes.progress = undefined; fakes.navigate.mockReset(); fakes.follow.mockReset(); fakes.select.mockReset();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    getTheme: vi.fn().mockResolvedValue({ shouldUseDarkColors: true }), onThemeUpdated: () => () => {}, modelInspectorReady: vi.fn(), modelInspectorWindowAction: vi.fn(),
    onModelInspectorSnapshot: (callback: typeof fakes.snapshot) => { fakes.snapshot = callback; return () => {}; }, onModelLibraryHashProgress: (callback: typeof fakes.progress) => { fakes.progress = callback; return () => {}; },
    modelInspectorNavigate: fakes.navigate, modelInspectorSetFollowSelection: fakes.follow, modelInspectorSelect: fakes.select,
  } });
});
afterEach(cleanup);
describe('Inspector shared UX', () => {
  it('preserves physical-copy navigation, selector and follow-selection controls with the shared detail panels', async () => {
    await act(async () => { render(<ModelInspectorApp />); });
    act(() => fakes.snapshot!(snapshot()));
    expect(screen.getByText('Shared detail panels: copy')).toBeTruthy();
    expect(screen.getByText(/2 of 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' })); expect(fakes.navigate).toHaveBeenCalledWith('previous');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'primary' } }); expect(fakes.select).toHaveBeenCalledWith('primary');
    fireEvent.click(screen.getByRole('button', { name: /Follow selection: Off/ })); expect(fakes.follow).toHaveBeenCalledWith(true);
  });
  it('shows hash progress even when Connections is collapsed', async () => {
    await act(async () => { render(<ModelInspectorApp />); });
    act(() => { fakes.snapshot!(snapshot()); fakes.progress!({ requestId: 'synthetic', bytesProcessed: 50, totalBytes: 100 }); });
    expect(screen.getByText('Connections & updates').closest('details')!.open).toBe(false);
    const progress = screen.getByText('Identifying model locally (SHA256)');
    expect(progress.closest('details')).toBeNull(); expect(screen.getByText('50%')).toBeTruthy();
  });
});
