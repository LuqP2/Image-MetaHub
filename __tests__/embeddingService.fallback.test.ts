import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveDevice,
  setOnDeviceChanged,
  startEmbeddingWorker,
  stopEmbeddingWorker,
} from '../services/embeddings/embeddingService';

class FakeWorker {
  static latest: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: unknown[] = [];
  terminate = vi.fn();

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(message: any) {
    this.messages.push(message);
    if (message.type === 'init') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', payload: { device: 'wasm' } } } as MessageEvent));
    }
  }
}

describe('embedding worker fallback state', () => {
  afterEach(() => {
    stopEmbeddingWorker();
    setOnDeviceChanged(null);
    vi.unstubAllGlobals();
    FakeWorker.latest = null;
  });

  it('reports WASM when a requested WebGPU worker falls back during initialization', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    await startEmbeddingWorker('webgpu');

    expect(FakeWorker.latest?.messages[0]).toMatchObject({
      type: 'init',
      payload: { device: 'webgpu', fallbackDevice: 'wasm' },
    });
    expect(getActiveDevice()).toBe('wasm');
  });

  it('observes a later WebGPU-to-WASM fallback after model loading fails', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const onChanged = vi.fn();
    setOnDeviceChanged(onChanged);
    await startEmbeddingWorker('webgpu');

    FakeWorker.latest?.onmessage?.({
      data: { type: 'deviceChanged', payload: { device: 'wasm', reason: 'fp16 load failed' } },
    } as MessageEvent);

    expect(getActiveDevice()).toBe('wasm');
    expect(onChanged).toHaveBeenCalledWith('wasm');
  });
});
