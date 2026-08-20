import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fetchCivitaiInfoWithIdentity } from '../services/modelLibrary/civitaiEnrichment';
import {
  applyFollowedModelSelection,
  createModelInspectorSnapshot,
  navigateModelInspector,
  replaceModelInspectorCollection,
  setModelInspectorFollowSelection,
} from '../services/modelLibrary/inspectorState';
import {
  createModelLocalMetadata,
  promoteModelLocalMetadata,
} from '../services/modelLibrary/localMetadataStorage';
import {
  getDefaultLoraSyntax,
  getEffectiveModelPresentation,
  getModelLocalMetadataId,
} from '../services/modelLibrary/presentation';
import type { ModelInspectorItem, ModelLocation } from '../services/modelLibrary/types';
import {
  resolveModelInspectorWindowState,
  toggleModelInspectorAlwaysOnTop,
} from '../electron/modelInspectorWindowState.mjs';
import { isModelLibraryPathWithinRoots } from '../electron/modelLibrarySecurity.mjs';

const location = (id: string, overrides: Partial<ModelLocation> = {}): ModelLocation => ({
  id,
  sourceId: 'source-1',
  sourceKind: 'lora',
  sourceName: 'LoRAs',
  relativePath: `${id}.safetensors`,
  absolutePath: `D:\\models\\loras\\${id}.safetensors`,
  fileName: `${id}.safetensors`,
  size: 100,
  createdAt: 1,
  modifiedAt: 2,
  discoveredAt: 3,
  lastSeenAt: 4,
  ...overrides,
});

const item = (id: string, overrides: Partial<ModelLocation> = {}): ModelInspectorItem => ({
  location: location(id, overrides),
});

describe('Model Inspector collection behavior', () => {
  it('navigates the exact supplied ordering and stops at its boundaries', () => {
    const snapshot = createModelInspectorSnapshot([item('movie-z'), item('movie-a'), item('movie-m')], 'movie-a');
    expect(navigateModelInspector(snapshot, 'next').selectedId).toBe('movie-m');
    expect(navigateModelInspector(navigateModelInspector(snapshot, 'previous'), 'previous').selectedId).toBe('movie-z');
  });

  it('follows main selection only while Follow selection is enabled', () => {
    const initial = createModelInspectorSnapshot([item('a'), item('b')], 'a');
    expect(applyFollowedModelSelection(initial, 'b').selectedId).toBe('b');
    const locked = setModelInspectorFollowSelection(initial, false);
    expect(applyFollowedModelSelection(locked, 'b')).toBe(locked);
  });

  it('selects a safe remaining item when a deleted location leaves the visible collection', () => {
    const initial = createModelInspectorSnapshot([item('a'), item('b')], 'b');
    expect(replaceModelInspectorCollection(initial, [item('a')]).selectedId).toBe('a');
    expect(replaceModelInspectorCollection(initial, []).selectedId).toBeNull();
  });
});

describe('Model Inspector metadata behavior', () => {
  it('uses local, Civitai, safetensors, then filename display precedence', () => {
    const model = location('file-name', {
      fileMetadata: {
        modelName: 'Embedded name',
        baseModel: 'SDXL embedded',
        triggerWords: ['embedded trigger'],
        embeddedPreview: 'data:image/png;base64,ZW1iZWRkZWQ=',
        raw: {},
      },
      civitai: {
        modelId: 1,
        versionId: 2,
        modelName: 'Civitai model',
        versionName: 'Civitai version',
        baseModel: 'ZImageTurbo',
        trainedWords: ['civitai trigger'],
        coverImage: 'data:image/png;base64,Y2l2aXRhaQ==',
        url: 'https://civitai.com/models/1',
        fetchedAt: 1,
      },
    });
    const local = createModelLocalMetadata(model, {
      displayName: 'My name',
      notes: 'note',
      tags: [],
      triggerWords: ['my trigger'],
      defaultStrength: 0.75,
    });
    const presentation = getEffectiveModelPresentation(model, local);
    expect(presentation).toMatchObject({
      name: 'My name',
      nameSource: 'local',
      baseModel: 'ZImageTurbo',
      baseModelSource: 'civitai',
      triggerWords: ['my trigger'],
      triggerWordsSource: 'local',
      previewSource: 'safetensors',
    });
    expect(getDefaultLoraSyntax(model, local)).toBe('<lora:file-name:0.75>');
  });

  it('saves local metadata against location identity without hashing, then promotes it to SHA256', () => {
    const model = location('unhashed');
    const local = createModelLocalMetadata(model, { displayName: 'Local', notes: 'Fast save', tags: [], triggerWords: [], defaultStrength: 1 });
    expect(local.id).toBe('location:unhashed');
    expect(local.sha256).toBeUndefined();
    const hash = 'a'.repeat(64);
    const promoted = promoteModelLocalMetadata(local, hash);
    expect(promoted).toMatchObject({ id: `sha256:${hash}`, sha256: hash, displayName: 'Local' });
    expect(getModelLocalMetadataId({ id: model.id, sha256: hash })).toBe(`sha256:${hash}`);
  });

  it('automatically resolves SHA256 before the single explicit Civitai lookup', async () => {
    const calls: string[] = [];
    const identified = item('model', { sha256: 'b'.repeat(64) });
    const ensureSha256 = vi.fn(async () => { calls.push('hash'); return identified; });
    const fetchByHash = vi.fn(async (hash: string) => {
      calls.push(`fetch:${hash}`);
      return { status: 'notFound' as const };
    });
    const result = await fetchCivitaiInfoWithIdentity({ item: item('model'), ensureSha256, fetchByHash, now: () => 42 });
    expect(calls).toEqual(['hash', `fetch:${'b'.repeat(64)}`]);
    expect(result?.location.civitai).toEqual({ status: 'notFound', fetchedAt: 42, url: '' });
  });

  it('does not hash again when identity is already available', async () => {
    const identified = item('model', { sha256: 'c'.repeat(64) });
    const ensureSha256 = vi.fn();
    await fetchCivitaiInfoWithIdentity({
      item: identified,
      ensureSha256,
      fetchByHash: async () => ({ status: 'notFound' }),
    });
    expect(ensureSha256).not.toHaveBeenCalled();
  });
});

describe('Model Inspector Electron behavior', () => {
  it('restores an off-screen saved window onto an available display', () => {
    const state = resolveModelInspectorWindowState({
      saved: { bounds: { x: 5000, y: 5000, width: 700, height: 800 }, displayId: 99 },
      displays: [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      mainBounds: { x: 100, y: 100, width: 1200, height: 800 },
    });
    expect(state.bounds.x).toBeGreaterThanOrEqual(0);
    expect(state.bounds.y).toBeGreaterThanOrEqual(0);
    expect(state.bounds.x + state.bounds.width).toBeLessThanOrEqual(1920);
    expect(state.bounds.y + state.bounds.height).toBeLessThanOrEqual(1040);
  });

  it('applies and reports Always on Top state through the native window', () => {
    let alwaysOnTop = false;
    const nativeWindow = {
      isAlwaysOnTop: () => alwaysOnTop,
      setAlwaysOnTop: (value: boolean) => { alwaysOnTop = value; },
    };
    expect(toggleModelInspectorAlwaysOnTop(nativeWindow)).toBe(true);
    expect(toggleModelInspectorAlwaysOnTop(nativeWindow)).toBe(false);
  });

  it('authorizes only model paths inside configured roots', () => {
    const roots = ['D:\\models\\loras'];
    expect(isModelLibraryPathWithinRoots('D:\\models\\loras\\people\\movie.safetensors', roots, 'win32')).toBe(true);
    expect(isModelLibraryPathWithinRoots('D:\\models\\loras-escape\\movie.safetensors', roots, 'win32')).toBe(false);
    expect(isModelLibraryPathWithinRoots('D:\\other\\movie.safetensors', roots, 'win32')).toBe(false);
  });

  it('wires the dedicated BrowserWindow, preload handshake, controls, and renderer entrypoint', () => {
    const electronSource = readFileSync(path.join(process.cwd(), 'electron.mjs'), 'utf8');
    const preloadSource = readFileSync(path.join(process.cwd(), 'preload.js'), 'utf8');
    const indexSource = readFileSync(path.join(process.cwd(), 'index.tsx'), 'utf8');
    expect(electronSource).toContain("inspectorUrl.searchParams.set('window', 'model-inspector')");
    expect(electronSource).toContain("ipcMain.handle('model-inspector-open'");
    expect(electronSource).toContain("ipcMain.handle('model-inspector-window-action'");
    expect(electronSource).toContain('toggleModelInspectorAlwaysOnTop(modelInspectorWindow)');
    expect(preloadSource).toContain("ipcRenderer.invoke('model-inspector-ready')");
    expect(preloadSource).toContain("ipcRenderer.invoke('model-inspector-set-follow-selection'");
    expect(indexSource).toContain("windowKind === 'model-inspector'");
  });
});
