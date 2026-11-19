import { formatMessage, languages } from '../i18n/messages.mjs';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem, ModelInspectorSnapshot } from '../services/modelLibrary/types';

const fakes = vi.hoisted(() => ({ language: 'en', snapshot: undefined as ((value: ModelInspectorSnapshot) => void) | undefined, progress: undefined as ((value: { requestId: string; bytesProcessed: number; totalBytes: number }) => void) | undefined, navigate: vi.fn(), follow: vi.fn(), select: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({ mirrorModelManager: () => () => {}, useModelManager: () => ({ progress: { kind: 'identify' } }) }));
vi.mock('../store/useSettingsStore', () => ({ useSettingsStore: Object.assign((selector: (settings: { theme: string; language: string }) => unknown) => selector({ theme: 'dark', language: fakes.language }), { persist: { rehydrate: vi.fn().mockResolvedValue(undefined) } }) }));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../components/ModelDetailsPanels', () => ({ default: ({ item, connectionExtras }: { item: ModelInspectorItem; connectionExtras?: React.ReactNode }) => <div><p>Shared detail panels: {item.location.id}</p><details><summary>Connections &amp; updates</summary>{connectionExtras}</details></div> }));
import ModelInspectorApp from '../components/ModelInspectorApp';
const snapshot = (selectedId = 'copy'): ModelInspectorSnapshot => ({ revision: 1, selectedId, followSelection: false, isAlwaysOnTop: false, items: ['primary', 'copy'].map((id) => ({
  location: { id, sourceKind: 'checkpoint', sourceName: 'Synthetic', fileName: `${id}.safetensors`, absolutePath: `/synthetic/${id}.safetensors`, relativePath: `${id}.safetensors`, size: 100, sha256: 'a'.repeat(64) } as ModelInspectorItem['location'],
})) });
beforeEach(() => {
  fakes.language = 'en'; fakes.snapshot = undefined; fakes.progress = undefined; fakes.navigate.mockReset(); fakes.follow.mockReset(); fakes.select.mockReset();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    getTheme: vi.fn().mockResolvedValue({ shouldUseDarkColors: true }), onThemeUpdated: () => () => {}, modelInspectorReady: vi.fn(), modelInspectorWindowAction: vi.fn(),
    onModelInspectorSnapshot: (callback: typeof fakes.snapshot) => { fakes.snapshot = callback; return () => {}; }, onModelLibraryHashProgress: (callback: typeof fakes.progress) => { fakes.progress = callback; return () => {}; },
    modelInspectorNavigate: fakes.navigate, modelInspectorSetFollowSelection: fakes.follow, modelInspectorSelect: fakes.select,
  } });
});
afterEach(cleanup);
describe('Inspector shared UX', () => {
  it.each(languages)('preserves physical-copy navigation and follow-selection controls in %s', async language => {
    fakes.language = language;
    const t = (key, values?) => formatMessage(language, key, values);
    await act(async () => { render(<ModelInspectorApp />); });
    act(() => fakes.snapshot!(snapshot()));
    expect(screen.getByText('Shared detail panels: copy')).toBeTruthy();
    expect(screen.getByText(t('modelLibrary.position', { current: 2, total: 2 }), { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('modelLibrary.previous') })); expect(fakes.navigate).toHaveBeenCalledWith('previous');
    expect(screen.getByRole('button', { name: t('modelLibrary.next') })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'primary' } }); expect(fakes.select).toHaveBeenCalledWith('primary');
    fireEvent.click(screen.getByRole('button', { name: t('modelLibrary.followOff') })); expect(fakes.follow).toHaveBeenCalledWith(true);
  });
  it.each(languages)('shows hash progress outside collapsed Connections in %s', async language => {
    fakes.language = language;
    await act(async () => { render(<ModelInspectorApp />); });
    act(() => { fakes.snapshot!(snapshot()); fakes.progress!({ requestId: 'synthetic', bytesProcessed: 50, totalBytes: 100 }); });
    expect(screen.getByText('Connections & updates').closest('details')!.open).toBe(false);
    const progress = screen.getByText(formatMessage(language, 'modelLibrary.hashing'));
    expect(progress.closest('details')).toBeNull(); expect(screen.getByText('50%')).toBeTruthy();
  });
});
