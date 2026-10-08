import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { packHuggingFaceWatches, unpackHuggingFaceWatches } from '../services/modelLibrary/huggingFaceWatchState.mjs';
import { emptyHuggingFaceWatch } from '../services/modelLibrary/huggingFaceTracking';
import type { ModelManagerSnapshot } from '../services/modelLibrary/types';

// Execute only the production IPC handlers with synthetic I/O. Never start Electron or read user data.
const source = readFileSync(path.resolve('electron.mjs'), 'utf8');
const handlersSource = source.slice(source.indexOf("  ipcMain.handle('model-manager-load-preferences'"), source.indexOf("  ipcMain.handle('model-manager-state'"));
function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const binding = { repoId: 'synthetic/repo', filePath: 'one.safetensors', linkedRevision: 'main', linkedRemoteFingerprint: 'git:oid:a', verification: 'manual' as const, resolvedCommit: 'b'.repeat(40), size: 100, fetchedAt: 1 };
  const snapshot = { repoId: binding.repoId, revision: 'main', watchedDirectory: '', recursive: false, resolvedCommit: binding.resolvedCommit, files: [{ path: binding.filePath, size: 100, fingerprint: binding.linkedRemoteFingerprint }], linkedFiles: { [binding.filePath]: null }, fetchedAt: 2 };
  const first = { ...emptyHuggingFaceWatch(binding), snapshot, ignoredEventIds: ['keep'] };
  const second = { ...emptyHuggingFaceWatch({ ...binding, filePath: 'two.safetensors' }), snapshot, seenEventIds: ['seen'] };
  const watches = { [first.id]: first, [second.id]: second };
  const state: ModelManagerSnapshot = { revision: 1, sources: [], catalog: { version: 1, updatedAt: 0, locations: [] }, localMetadata: {}, watches: {}, hfWatches: watches, intervalHours: 24, loading: false, progress: null, message: null, notification: null };
  const disk = new Map<string, string>();
  const send = vi.fn();
  const context = {
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
    isPrimaryWindowSender: () => true, packHuggingFaceWatches, unpackHuggingFaceWatches,
    path, app: { getPath: () => '/synthetic/preferences' },
    fs: { mkdir: async () => {}, writeFile: async (file: string, data: string) => { disk.set(file, data); }, rename: async (from: string, to: string) => { disk.set(to, disk.get(from)!); disk.delete(from); }, readFile: async (file: string) => disk.get(file) },
    removedModelLocationIds: new Set(), modelManagerState: null as ModelManagerSnapshot | null,
    modelInspectorWindow: { isDestroyed: () => false, webContents: { send } }, modelInspectorSnapshot: null,
    modelManagerDurableJson: '', modelManagerVaultWrites: Promise.resolve(),
  };
  runInNewContext(handlersSource, context);
  return { handlers, state, watches, disk, context, send };
}

describe('HF preferences across the main-process boundary', () => {
  it('writes one shared snapshot, sends usable watches to Inspector and restores decisions after restart', async () => {
    const { handlers, state, watches, disk, context, send } = fixture();
    expect(await handlers.get('model-manager-publish')!({}, { ...state, hfWatches: undefined, hfWatchState: packHuggingFaceWatches(watches) })).toEqual({ success: true });
    expect(context.modelManagerState?.hfWatches).toEqual(watches);
    expect(send.mock.calls[0][1].hfWatches).toEqual(watches);
    expect(send.mock.calls[0][1].hfWatchState).toBeUndefined();
    const serialized = [...disk.values()][0];
    expect(JSON.parse(serialized).hfWatches).toBeUndefined();
    expect(serialized.match(/"files":/g)).toHaveLength(1);
    const restored = await handlers.get('model-manager-load-preferences')!({}) as ModelManagerSnapshot;
    expect(restored.hfWatches).toEqual(watches);
    const values = Object.values(restored.hfWatches!);
    expect(values[0].snapshot).toBe(values[1].snapshot);
  });
  it('continues reading preferences saved before normalization', async () => {
    const { handlers, state, watches, disk } = fixture();
    disk.set(path.join('/synthetic/preferences', 'model-manager-user-data', 'preferences.json'), JSON.stringify(state));
    const restored = await handlers.get('model-manager-load-preferences')!({}) as ModelManagerSnapshot;
    expect(restored.hfWatches).toEqual(watches);
  });
});
