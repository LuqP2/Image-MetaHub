import { afterEach, describe, expect, it, vi } from 'vitest';
import { pngExportLabelBounds, pngExportSize, serializeExportScene } from '../services/boards/pngExport';

import { createBoardDocument } from '../services/boards/document.mjs';
import { drawBoardObject } from '../services/boards/operations';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
describe('PNG frozen scene', () => {
  it('omits prompt correspondence outlines and collapsed-stack match badges', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    const scene = document.createElement('div');
    scene.innerHTML = '<article class="board-prompt"><p>cat</p></article><button class="board-result-thumb" data-prompt-match="true" style="outline:2px solid purple">Image</button><span class="board-prompt-stack-count">2 matches</span>';
    document.body.append(scene);
    const result = document.createElement('div'); result.innerHTML = await serializeExportScene(scene);
    expect(result.querySelector('[data-prompt-match]')).toBeNull();
    expect(result.querySelector('.board-prompt-stack-count')).toBeNull();
    expect(result.querySelector<HTMLElement>('.board-result-thumb')?.style.outline).toBe('none');
    expect(result.querySelector('.board-prompt')?.textContent).toBe('cat');
  });
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


describe('PNG connection label bounds', () => {
  it.each([1, 2, 4])('includes labels beyond every card boundary at %sx resolution', scale => {
    const board = drawBoardObject(createBoardDocument(), 'sticky', { x: 100, y: 200, width: 240, height: 180 });
    const scene = document.createElement('div');
    scene.innerHTML = '<div class="react-flow__viewport"></div><div class="board-edge-label">Above left</div><div class="board-edge-label">Below right</div>';
    const viewport = scene.querySelector<HTMLElement>('.react-flow__viewport')!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: -100068, top: -168 } as DOMRect);
    const labels = scene.querySelectorAll<HTMLElement>('.board-edge-label');
    vi.spyOn(labels[0], 'getBoundingClientRect').mockReturnValue({ left: -100118, top: -68, width: 140, height: 48 } as DOMRect);
    vi.spyOn(labels[1], 'getBoundingClientRect').mockReturnValue({ left: -99668, top: 332, width: 180, height: 64 } as DOMRect);
    const measured = pngExportLabelBounds(scene);
    expect(measured).toEqual([{ x: -50, y: 100, width: 140, height: 48 }, { x: 400, y: 500, width: 180, height: 64 }]);
    expect(pngExportSize(board, scale, measured)).toEqual({ bounds: { x: -50, y: 100, width: 630, height: 464 }, width: 694 * scale, height: 528 * scale, valid: true });
    // Moving the export viewport must preserve the same document-space bounds.
    vi.mocked(labels[0].getBoundingClientRect).mockReturnValue({ left: -99968, top: 32, width: 140, height: 48 } as DOMRect);
    vi.mocked(labels[1].getBoundingClientRect).mockReturnValue({ left: -99518, top: 432, width: 180, height: 64 } as DOMRect);
    vi.mocked(viewport.getBoundingClientRect).mockReturnValue({ left: -99918, top: -68 } as DOMRect);
    expect(pngExportLabelBounds(scene)).toEqual(measured);
  });
  it('applies PNG size limits to displaced labels as well as cards', () => {
    const board = drawBoardObject(createBoardDocument(), 'sticky', { x: 0, y: 0, width: 240, height: 180 });
    expect(pngExportSize(board, 1).valid).toBe(true);
    expect(pngExportSize(board, 1, [{ x: 16400, y: 0, width: 100, height: 20 }]).valid).toBe(false);
  });
});
