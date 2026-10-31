import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeExportScene } from '../services/boards/pngExport';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
describe('PNG frozen scene', () => {
  it('preserves result thumbnails while removing interactive controls and event attributes', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    const scene = document.createElement('div');
    scene.innerHTML = '<button>Browse</button><div class="react-flow__handle"></div><button class="board-result-thumb" onclick="alert(1)"><img alt="local image" src="data:image/png;base64,fixture" /></button>';
    document.body.append(scene);
    Object.defineProperty(scene.querySelector('img'), 'naturalWidth', { value: 64 });
    Object.defineProperty(scene.querySelector('img'), 'complete', { value: true });
    const html = await serializeExportScene(scene);
    const result = document.createElement('div'); result.innerHTML = html;
    expect(result.querySelector('.board-result-thumb img')?.getAttribute('src')).toBe('data:image/png;base64,fixture');
    expect(result.querySelector('.board-result-thumb')?.getAttribute('onclick')).toBeNull();
    expect(result.querySelector('.react-flow__handle')).toBeNull();
    expect(result.querySelectorAll('button')).toHaveLength(1);
  });
});
