// @vitest-environment node
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererRecoveryState } from '../electron/rendererRecoveryState.mjs';
import { attachMainWindowRecovery } from '../electron/mainWindowRecovery.mjs';
import { registerRendererRecoveryTest } from '../electron/rendererRecoveryTest.mjs';
import { resumeRecoveredEnrichment } from '../services/resumeRecoveredEnrichment';
import type { Directory } from '../types';

afterEach(() => vi.useRealTimers());
const directory = (id: string, transient = false) => ({ id, path: `/synthetic/${id}`, name: id, transient } as Directory);
const images = [
  { directoryId: 'pending', enrichmentState: 'catalog' as const },
  { directoryId: 'finished', enrichmentState: 'enriched' as const },
];

async function fixture() {
  const mainFrame = {};
  const contents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false, reload: vi.fn() });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  const event = { sender: contents, senderFrame: mainFrame };
  const handlers = new Map<string, (event: unknown) => unknown>();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const state = createRendererRecoveryState({ ipcMain, getWindow: () => window });
  registerRendererRecoveryTest({ ipcMain, isDevelopment: true, getWindow: () => window, log: vi.fn() });
  attachMainWindowRecovery(window, {
    isCurrent: () => true, isQuitting: () => false, showDialog: vi.fn(), quit: vi.fn(), log: vi.fn(),
    onBeforeReload: () => state.mark(contents),
  });
  let api: { consumeRendererRecovery: () => Promise<boolean>; testRendererRecovery: () => Promise<unknown> };
  vm.runInNewContext(await readFile(new URL('../preload.js', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { on: vi.fn(), invoke: async channel => handlers.get(channel)!(event) }, webUtils: {},
    }),
    process: { env: {} },
  });
  return { api: api!, contents, event, state, handlers };
}

describe('resume enrichment after main window recovery', () => {
  it('carries recovery through main, preload and hydrated catalog selection without manual refresh', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    expect(await f.api.consumeRendererRecovery()).toBe(false);
    await f.api.testRendererRecovery();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.contents.reload).toHaveBeenCalledTimes(1);
    const resume = vi.fn().mockResolvedValue(undefined);
    const result = await resumeRecoveredEnrichment({
      consumeRecovery: f.api.consumeRendererRecovery,
      directories: [directory('pending'), directory('finished')], getImages: () => images, resume,
    });
    await result.completion;
    expect([...result.resumed]).toEqual(['pending']);
    expect(resume.mock.calls.map(([dir]) => dir.id)).toEqual(['pending']);
    expect(await f.api.consumeRendererRecovery()).toBe(false);
  });

  it('does not resume on ordinary startup/reload or when the bridge is unavailable', async () => {
    const f = await fixture();
    const resume = vi.fn();
    const getImages = vi.fn(() => images);
    for (const consumeRecovery of [f.api.consumeRendererRecovery, undefined]) {
      const result = await resumeRecoveredEnrichment({
        consumeRecovery, directories: [directory('pending')], getImages, resume,
      });
      await result.completion;
      expect(result.resumed.size).toBe(0);
    }
    expect(resume).not.toHaveBeenCalled();
    expect(getImages).not.toHaveBeenCalled();
  });

  it('cannot consume another window/main-frame recovery marker', async () => {
    const f = await fixture();
    f.state.mark(f.contents);
    const consume = f.handlers.get('consume-renderer-recovery')!;
    expect(consume({ sender: {}, senderFrame: {} })).toBe(false);
    expect(consume({ sender: f.contents, senderFrame: {} })).toBe(false);
    expect(await f.api.consumeRendererRecovery()).toBe(true);
    expect(await f.api.consumeRendererRecovery()).toBe(false);
    f.state.mark(f.contents);
    expect(await f.api.consumeRendererRecovery()).toBe(true);
  });

  it('does not block hydration and runs pending directories sequentially', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const resume = vi.fn().mockImplementationOnce(() => gate).mockResolvedValue(undefined);
    const result = await resumeRecoveredEnrichment({
      consumeRecovery: async () => true,
      directories: [directory('pending'), directory('second'), directory('temporary', true)],
      getImages: () => [...images,
        { directoryId: 'second', enrichmentState: 'catalog' },
        { directoryId: 'temporary', enrichmentState: 'catalog' },
      ], resume,
    });
    expect([...result.resumed]).toEqual(['pending', 'second']);
    expect(resume.mock.calls.map(([dir]) => dir.id)).toEqual(['pending']);
    release();
    await result.completion;
    expect(resume.mock.calls.map(([dir]) => dir.id)).toEqual(['pending', 'second']);
  });

  it('does not rescan completed libraries even after recovery', async () => {
    const resume = vi.fn();
    const result = await resumeRecoveredEnrichment({
      consumeRecovery: async () => true, directories: [directory('finished')], getImages: () => images, resume,
    });
    await result.completion;
    expect(resume).not.toHaveBeenCalled();
  });
});
