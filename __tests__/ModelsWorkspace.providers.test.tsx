import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelManagerSnapshot } from '../services/modelLibrary/types';
import { emptyHuggingFaceWatch } from '../services/modelLibrary/huggingFaceTracking';

const fakes = vi.hoisted(() => ({ manager: {} as ModelManagerSnapshot, check: vi.fn(), identify: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => fakes.manager, getModelManagerState: () => fakes.manager, unreadModelCount: () => 1, checkModelUpdates: (...args: unknown[]) => fakes.check(...args), identifyModels: (...args: unknown[]) => fakes.identify(...args), addModelSource: vi.fn(), cancelModelJob: vi.fn(), managerMessage: vi.fn(), removeModelSource: vi.fn(), scanModelSources: vi.fn(), setModelInterval: vi.fn(), showModelUpdates: vi.fn(), updateModelSource: vi.fn() }));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: vi.fn(), ModelActionsPanel: () => null, ModelLocalEditor: () => null, ModelMediaPanel: () => null, modelButton: '', modelInput: '' }));
vi.mock('../components/ModelStoragePanel', () => ({ default: () => null, ModelRemovalDialog: () => null }));
vi.mock('../components/ModelUsagePanel', () => ({ default: () => null }));
vi.mock('../components/UnifiedModelUpdatesPanel', () => ({ ModelUpdatesPanel: () => null }));
vi.mock('../components/HuggingFaceModelPanel', () => ({ HuggingFaceModelPanel: ({ revealUpdates }: { revealUpdates: number }) => <p>HF reveal {revealUpdates}</p> }));
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
});
