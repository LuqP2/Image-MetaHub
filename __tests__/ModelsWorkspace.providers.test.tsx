import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelManagerSnapshot, ModelWatchRecord } from '../services/modelLibrary/types';
import { emptyHuggingFaceWatch } from '../services/modelLibrary/huggingFaceTracking';

const fakes = vi.hoisted(() => ({ manager: {} as ModelManagerSnapshot, check: vi.fn(), identify: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => fakes.manager, getModelManagerState: () => fakes.manager, installedVersions: (modelId: number) => fakes.manager.catalog.locations.flatMap((location) => location.civitai && 'modelId' in location.civitai && location.civitai.modelId === modelId ? [location.civitai] : []), unreadModelCount: () => 1, checkModelUpdates: (...args: unknown[]) => fakes.check(...args), identifyModels: (...args: unknown[]) => fakes.identify(...args), addModelSource: vi.fn(), cancelModelJob: vi.fn(), managerMessage: vi.fn(), removeModelSource: vi.fn(), scanModelSources: vi.fn(), setModelInterval: vi.fn(), showModelUpdates: (showUpdates: boolean) => { fakes.manager.showUpdates = showUpdates; }, updateModelSource: vi.fn() }));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: vi.fn(), ModelActionsPanel: () => null, ModelLocalEditor: () => null, ModelMediaPanel: () => null, ReleaseGroup: ({ watch }: { watch: ModelWatchRecord }) => <p>Civitai release group: {watch.modelName}</p>, modelButton: '', modelInput: '' }));
vi.mock('../components/ModelStoragePanel', () => ({ default: () => null, ModelRemovalDialog: () => null }));
vi.mock('../components/ModelUsagePanel', () => ({ default: () => null }));
vi.mock('../components/HuggingFaceModelPanel', () => ({ HuggingFaceModelPanel: ({ revealUpdates }: { revealUpdates: number }) => <p>HF reveal {revealUpdates}</p> }));
vi.mock('../components/ModelDetailsPanels', () => ({ default: ({ revealUpdates }: { revealUpdates: number }) => <p>HF reveal {revealUpdates}</p> }));
import ModelsWorkspace from '../components/ModelsWorkspace';

beforeEach(() => {
  fakes.check.mockReset().mockResolvedValue(undefined); fakes.identify.mockReset().mockResolvedValue(true);
  const binding = { repoId: 'owner/repo', filePath: 'model.safetensors', linkedRevision: 'main', resolvedCommit: 'b'.repeat(40), linkedRemoteFingerprint: 'git:oid:' + 'a'.repeat(40), verification: 'manual' as const, size: 100, fetchedAt: 1 };
  const watch = emptyHuggingFaceWatch(binding);
  watch.events = [{ id: 'event', source: 'huggingFace', kind: 'newModelFile', path: 'new.safetensors', fingerprint: 'git:oid:' + 'c'.repeat(40), commit: 'b'.repeat(40), detectedAt: 1 }];
  fakes.manager = { revision: 1, sources: [{ id: 's', name: 'Models', path: '/synthetic', kind: 'lora', recursive: true, createdAt: 1, updatedAt: 1 }], watches: {}, hfWatches: { [watch.id]: watch }, localMetadata: {}, intervalHours: 24, loading: false, progress: null, message: null, notification: null, catalog: { version: 1, updatedAt: 1, locations: [{ id: 'one', sourceId: 's', sourceName: 'Models', sourceKind: 'lora', fileName: 'one.safetensors', relativePath: 'one.safetensors', absolutePath: '/synthetic/one.safetensors', size: 100, createdAt: 1, modifiedAt: 1, discoveredAt: 1, lastSeenAt: 1, huggingFace: binding }] } };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { modelInspectorSyncCollection: vi.fn().mockResolvedValue(undefined), modelInspectorSyncSelection: vi.fn() } });
});
afterEach(cleanup);

describe('HF catalog update entry points', () => {
  it('checks an HF-only model from the toolbar without presenting Civitai identification', async () => {
    render(<ModelsWorkspace />);
    fireEvent.click(screen.getByText('Check for updates · 1 model'));
    await waitFor(() => expect(fakes.check).toHaveBeenCalledExactlyOnceWith(['one']));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(fakes.identify).not.toHaveBeenCalled();
    expect((screen.getByText('Identify models on Civitai…') as HTMLButtonElement).disabled).toBe(false);
  });
  it('includes HF events in With updates and reveals their detail from the update indicator', () => {
    render(<ModelsWorkspace />);
    fireEvent.click(screen.getByText('With updates'));
    expect(screen.getByRole('button', { name: 'Select one' })).toBeTruthy();
    fireEvent.click(screen.getByText(/1 new update/));
    expect(screen.getByText('HF reveal 1')).toBeTruthy();
  });
  it.each(['huggingFace', 'civitai'] as const)('shows %s updates linked to another copy of a model in the selected folder', (provider) => {
    const linked = { ...fakes.manager.catalog.locations[0], sha256: 'a'.repeat(64) };
    const unrelated = { ...linked, id: 'unrelated', sha256: 'b'.repeat(64), fileName: 'unrelated.safetensors' };
    if (provider === 'huggingFace') {
      unrelated.huggingFace = { ...linked.huggingFace!, repoId: 'other/repo' };
      const watch = emptyHuggingFaceWatch(unrelated.huggingFace);
      watch.events = [{ ...Object.values(fakes.manager.hfWatches!)[0].events[0], id: 'unrelated-event' }];
      fakes.manager.hfWatches![watch.id] = watch;
    } else {
      linked.huggingFace = undefined;
      unrelated.huggingFace = undefined;
      linked.civitai = { modelId: 1, versionId: 1, modelName: 'Target', versionName: 'Installed', trainedWords: [], fetchedAt: 1, url: '' };
      unrelated.civitai = { ...linked.civitai, modelId: 2, modelName: 'Unrelated' };
      const watch: ModelWatchRecord = { id: '1', modelId: 1, modelName: 'Target', versions: [{ id: 3, name: 'New release', description: '', url: '' }], novelVersionIds: [3], knownVersionIds: [1, 3], seenVersionIds: [], ignoredVersionIds: [], notifiedVersionIds: [] };
      fakes.manager.watches = { '1': watch, '2': { ...watch, id: '2', modelId: 2, modelName: 'Unrelated' } };
    }
    const copy = { ...linked, id: 'copy', sourceId: 'selected', sourceName: 'Selected folder', fileName: 'copy.safetensors', relativePath: 'copy.safetensors', absolutePath: '/synthetic/selected/copy.safetensors', huggingFace: undefined, civitai: undefined };
    fakes.manager.sources.push({ ...fakes.manager.sources[0], id: 'selected', name: 'Selected folder', path: '/synthetic/selected' });
    fakes.manager.catalog.locations = [copy, linked, unrelated];
    const view = render(<ModelsWorkspace />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Model folder' }), { target: { value: 'selected' } });
    fireEvent.click(screen.getByText('With updates'));
    expect(screen.getByRole('button', { name: 'Select copy' })).toBeTruthy();
    expect(screen.getByText('1 new update')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /What's new/ }));
    view.rerender(<ModelsWorkspace />);
    expect(screen.queryByText(/You're caught up/)).toBeNull();
    expect(screen.getByText(provider === 'huggingFace' ? '1 model · 0 Civitai releases · 1 Hugging Face events' : '1 model · 1 Civitai releases · 0 Hugging Face events')).toBeTruthy();
    expect(screen.getByText(provider === 'huggingFace' ? /Hugging Face · owner\/repo/ : 'Civitai release group: Target')).toBeTruthy();
    expect(screen.queryByText(/other\/repo|Civitai release group: Unrelated/)).toBeNull();
  });
});
