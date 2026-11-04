import BoardAssetBrowser from '../../../components/boards/BoardAssetBrowser';
import React, { useState } from 'react';
import GridToolbar from '../../../components/GridToolbar';
import { useLibraryCanvas } from '../../../hooks/useLibraryCanvas';
import { useImageStore } from '../../../store/useImageStore';
import { serializeExportScene } from '../../../services/boards/pngExport';
import { createRoot } from 'react-dom/client';
import BoardWorkspace from '../../../components/BoardWorkspace';
import { useBoardStore } from '../../../store/useBoardStore';
import { useBoardUIStore } from '../../../store/useBoardUIStore';
import { useBoardQueryStore } from '../../../store/useBoardQueryStore';
import { BoardQueryContext } from '../../../components/boards/BoardQueryContext';
import { drawBoardObject, createFrame, addConnection, updateObjects } from '../../../services/boards/operations';
import { copyBoardSelection, pasteBoardSelection } from '../../../services/boards/commands';
import { createSmartFrame, branchSmartFrame } from '../../../services/boards/smartFrameOperations';
import type { BoardSmartFrameObject } from '../../../services/boards/queryTypes';
import '../../../src/index.css';
import { boardImage } from '../../helpers/boardIntegrationFixtures';

document.documentElement.style.cssText = '--gray-950:9 12 20;--gray-900:17 24 39;--gray-800:31 41 55;--gray-700:55 65 81;--gray-600:75 85 99;--gray-400:156 163 175;--gray-300:209 213 219;--gray-100:243 244 246;--accent:99 102 241;';
document.body.style.cssText = 'margin:0;width:100vw;height:100vh;font-family:Arial,sans-serif';
document.getElementById('root')!.style.cssText = 'width:100%;height:100%';
useBoardUIStore.setState({ libraryOpen: true, inspectorOpen: true });
const sampleImage = boardImage('Synthetic gradient', { thumbnailStatus: 'ready', thumbnailUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="180"><defs><linearGradient id="g"><stop stop-color="#0ea5e9"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect width="256" height="180" fill="url(#g)"/><circle cx="125" cy="90" r="50" fill="#fff" opacity=".7"/></svg>') });
const queryActions = { images: new Map([[sampleImage.id, sampleImage]]), open() {}, create() {}, retry() {}, snapshot() {}, useCurrentFilters() {}, collections: [] };
createRoot(document.getElementById('root')!).render(<BoardQueryContext.Provider value={queryActions}><BoardWorkspace editable assetPanel={<BoardAssetBrowser images={[sampleImage, ...Array.from({ length: 7 }, (_, index) => ({ ...sampleImage, id: `sample-${index}`, name: `Reference ${index + 1}` }))]} directories={[]} editable onAdd={() => {}} />} resolveAsset={object => object.name === 'Synthetic gradient' ? { status: 'resolved', image: sampleImage } : { status: 'missing' }} /></BoardQueryContext.Provider>);
const wait = async (test: () => boolean, message = 'UI timeout') => { const start = Date.now(); while (!test()) { if (Date.now() - start > 15000) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 30)); } };
const button = (name: string) => { const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name); if (!element) throw new Error(`Button missing: ${name}`); return element; };
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

function LibraryFlowSmoke({ boardId }: { boardId: string }) {
  const [view, navigate] = useState('canvas');
  const flow = useLibraryCanvas({ view, navigate, blocked: false, canEdit: true, upgrade() { throw new Error('Unexpected edit gate'); } });
  return <div data-flow-view={view} style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: '#111827' }}>
    {view === 'canvas' ? <button onClick={() => flow.explore(boardId)}>Smoke explore Library</button> :
      <GridToolbar canvasAction={flow.action} selectedImages={new Set()} images={[]} directories={[]}
        onDeleteSelected={() => {}} onGenerateA1111={() => {}} onGenerateComfyUI={() => {}} onCompare={() => {}}
        onBatchExport={() => {}} onStartSlideshow={() => {}} slideshowImageCount={0}/>}
    {flow.dialog}
  </div>;
}

Object.assign(window, { canvasSmoke: {
  async verifyLibraryFlowAndGrid() {
    const state = useBoardStore.getState();
    const boardId = await state.createBoard('Library flow smoke');
    const images = Array.from({ length: 1000 }, (_, i) => ({ ...sampleImage, id: `grid-${i}`, name: `Grid ${i}.png` }));
    images.forEach(image => queryActions.images.set(image.id, image));
    useImageStore.setState({ images: images.slice(0, 15), filteredImages: images.slice(0, 15), isLoading: false,
      selectedModels: ['Model A', 'Model B'], selectedLoras: ['Lora X'], advancedFilters: { dimension: '1024x1024' } });
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host); root.render(<LibraryFlowSmoke boardId={boardId}/>);
    try {
      await wait(() => !!host.querySelector('button'));
      (host.querySelector('button') as HTMLButtonElement).click();
      await wait(() => host.querySelector('[data-flow-view]')?.getAttribute('data-flow-view') === 'library');
      const add = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('Add to “Library flow smoke”'))!;
      check(add && add.getBoundingClientRect().right <= window.innerWidth, 'Library action is missing or overflows');
      add.click();
      await wait(() => host.querySelector('[data-flow-view]')?.getAttribute('data-flow-view') === 'canvas');
      const frame = useBoardStore.getState().sessions[boardId].document.objects.find(item => item.type === 'smart-frame') as BoardSmartFrameObject;
      check(frame?.criteria.selectedModels.join(',') === 'Model A,Model B' && frame.criteria.selectedLoras[0] === 'Lora X' && frame.criteria.advancedFilters.dimension === '1024x1024', 'Library filters were lost');
      const publish = (count: number) => useBoardQueryStore.getState().publish(boardId, { [frame.id]: { frameId: frame.id, status: 'ready', imageIds: images.slice(0, count).map(image => image.id), totalCount: count } });
      publish(15);
      await wait(() => !!document.querySelector('.board-stage .board-smart-results .scrollbar-thin'));
      check(![...document.querySelectorAll('.board-stage button')].some(item => item.textContent === 'Browse'), 'Preview toggle remains');
      const grid = () => document.querySelector<HTMLElement>('.board-stage .board-smart-results .scrollbar-thin')!;
      check(getComputedStyle(grid()).scrollbarColor.includes('96, 165, 250'), 'Grid scrollbar is not using the app style');
      grid().scrollTop = grid().scrollHeight; grid().dispatchEvent(new Event('scroll'));
      await wait(() => !!document.querySelector('.board-stage [aria-label="Open Grid 14.png"]'), 'The fifteenth image is inaccessible');
      const scene = await serializeExportScene(document.querySelector<HTMLElement>('.board-stage .react-flow__viewport')!);
      check(scene.includes('Grid 14.png') && (/translate\(0px,\s*-/.test(scene)), 'PNG scene lost the visible scrolled grid');
      state.executeOperation(boardId, doc => updateObjects(doc, [{ id: frame.id, height: 850 }]));
      await wait(() => grid().clientHeight > 600, 'Grid did not resize with the frame');
      check(document.querySelectorAll('.board-stage .board-result-thumb').length === 15, 'Expanded frame does not show all 15 images');
      state.executeOperation(boardId, doc => updateObjects(doc, [{ id: frame.id, height: 420 }]));
      publish(1000);
      await wait(() => document.querySelectorAll('.board-stage .board-result-thumb').length < 60);
      check(document.querySelectorAll('.board-stage .board-result-thumb').length > 0, 'Virtualized grid is empty');
      grid().scrollTop = grid().scrollHeight; grid().dispatchEvent(new Event('scroll'));
      await wait(() => !!document.querySelector('.board-stage [aria-label="Open Grid 999.png"]'), 'Last result is inaccessible');
      for (const selector of ['.board-tabs-scroll', '.board-toolbar-group']) check(document.querySelector(selector)?.classList.contains('scrollbar-thin'), 'Native toolbar scrollbar remains');
      return { libraryToCanvas: true, capturedFilters: true, fifteenResults: true, resize: true, virtualizedThousand: true, scrolledPngScene: true, appScrollbars: true };
    } finally { root.unmount(); host.remove(); }
  },
  async showTextStyle() {
    const state = useBoardStore.getState(), id = state.activeBoardId!;
    state.setSelection(id, [state.sessions[id].document.objects.find(object => object.type === 'text')!.id]);
    await wait(() => !!document.querySelector('[aria-label="Font size"]'));
    check(document.querySelectorAll('[aria-label="Font size"]').length === 1 && !document.querySelector('[aria-label="Text size"]'), 'Duplicate font controls');
    check(document.querySelectorAll('[aria-label="Custom color"]').length === 1, 'Duplicate color controls');
    check(!document.querySelector('button[aria-label="Link"]'), 'Link tool still present');
    const edge = document.querySelector('.board-stage .react-flow__node.selected .react-flow__resize-control.line.right')!;
    check(edge.getBoundingClientRect().width >= 11, 'Resize hit target shrank with zoom');
    const selected = document.querySelector('.board-stage .board-text-content a');
    check(selected?.getAttribute('href') === 'https://example.com/', 'Inline URL is not clickable');
    return true;
  },
  async prepareConnection() {
    button('Connect').click();
    await wait(() => button('Connect').getAttribute('aria-pressed') === 'true' && !document.querySelector('.board-stage textarea'));
    const source = document.querySelector<HTMLElement>('.board-stage .board-creative--sticky')!.getBoundingClientRect();
    const target = document.querySelector<HTMLElement>('.board-stage .board-creative--shape')!.getBoundingClientRect();
    const id = useBoardStore.getState().activeBoardId!;
    return { from: { x: Math.round(source.x + source.width / 2), y: Math.round(source.y + 30) }, to: { x: Math.round(target.x + target.width / 2), y: Math.round(target.y + target.height / 2) }, count: useBoardStore.getState().sessions[id].document.connections.length };
  },
  async verifyConnection(count: number) {
    const state = useBoardStore.getState(), id = state.activeBoardId!;
    await wait(() => useBoardStore.getState().sessions[id].document.connections.length === count + 1, 'Body drag failed to create a connector');
    const edge = useBoardStore.getState().sessions[id].document.connections.at(-1)!;
    state.setSelection(id, [], [edge.id]);
    await wait(() => !!document.querySelector('[aria-label="Connection thickness"]'));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Connection thickness"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '6');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); input.blur();
    await wait(() => useBoardStore.getState().sessions[id].document.connections.at(-1)!.width === 6);
    await state.flushAll();
    button('Select').click();
    return true;
  },
  async panelPoints(side: string) {
    if (side === 'library') useBoardUIStore.getState().setLibraryOpen(true);
    const handle = document.querySelector<HTMLElement>(`[aria-label="Resize ${side} sidebar"]`)!;
    const rect = handle.getBoundingClientRect();
    return { from: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + 200) }, to: { x: Math.round(rect.x + rect.width / 2 + (side === 'library' ? 60 : -60)), y: Math.round(rect.y + 200) } };
  },
  verifyPanel(side: 'library' | 'inspector') {
    check(useBoardUIStore.getState()[side === 'library' ? 'libraryWidth' : 'inspectorWidth'] >= (side === 'library' ? 324 : 380), 'Sidebar did not resize'); return true;
  },
  async marqueePoints() {
    const bounds = document.querySelector<HTMLElement>('.board-browser-results')!.getBoundingClientRect();
    return { from: { x: Math.round(bounds.x + 2), y: Math.round(bounds.y + 2) }, to: { x: Math.round(bounds.right - 4), y: Math.round(bounds.y + 275) } };
  },
  async verifyMarquee() { await wait(() => !!document.querySelector('.board-browser button[aria-pressed="true"]')); check(document.querySelectorAll('.board-browser button[aria-pressed="true"]').length >= 4, 'Marquee did not select library tiles'); return true; },
  async verifyRestored(id: string) {
    await wait(() => useBoardStore.getState().activeBoardId === id, 'Tabs did not restore after renderer restart');
    const session = useBoardStore.getState().sessions[id];
    check(session.past.length === 0 && session.selectedObjectIds.length === 0, 'Restored session retained transient history');
    check(session.document.objects.some(object => object.type === 'sticky' && object.text.includes('Idea 12')), 'Saved note was lost on restart');
    return true;
  },
  async run() {
    const state = useBoardStore.getState();
    const a = await state.createBoard('Creative references');
    state.executeOperation(a, doc => {
      let next = drawBoardObject(doc, 'sticky', { x: 60, y: 80, width: 240, height: 180 });
      next = updateObjects(next, [{ id: next.objects[0].id, text: 'Choose a direction\nExplore → compare → decide' }]);
      next = drawBoardObject(next, 'diamond', { x: 400, y: 100, width: 220, height: 180 });
      next = updateObjects(next, [{ id: next.objects[1].id, text: 'Keep?' }]);
      next = drawBoardObject(next, 'ellipse', { x: 730, y: 100, width: 220, height: 180 });
      next = drawBoardObject(next, 'text', { x: 400, y: 360, width: 260, height: 150 });
      next = updateObjects(next, [{ id: next.objects.at(-1)!.id, text: 'Reference: https://example.com/' }]);
      next = { ...next, objects: [...next.objects, { id: crypto.randomUUID(), type: 'asset', x: 740, y: 350, width: 220, height: 180, zIndex: 4, frameId: null, name: 'Synthetic gradient', mediaType: 'image', visibleFields: [], reference: { kind: 'path', locator: { imageId: sampleImage.id, directoryPath: 'C:/synthetic', relativePath: 'gradient.png' } } }] };
      next = createFrame(next, next.objects.map(object => object.id));
      const members = next.objects.filter(object => object.type !== 'frame');
      next = addConnection(next, { sourceObjectId: members[0].id, targetObjectId: members[1].id, sourceSide: 'right', targetSide: 'left', label: 'Review', color: '#a5b4fc' });
      next = createSmartFrame(next, { x: 1100, y: 80, width: 360, height: 300, title: 'Live library' });
      next = branchSmartFrame(next, next.objects.at(-1)!.id, [], 'Live branch');
      return next;
    });
    const doc = useBoardStore.getState().sessions[a].document;
    for (const board of [a]) useBoardQueryStore.getState().publish(board, Object.fromEntries(doc.objects.filter((object): object is BoardSmartFrameObject => object.type === 'smart-frame').map(frame => [frame.id, { status: 'ready', imageIds: [sampleImage.id], totalCount: 1, definitionKey: JSON.stringify({ source: frame.source, criteria: frame.criteria, groupConstraints: frame.groupConstraints }) }])));
    state.setSelection(a, doc.objects.map(object => object.id));
    await copyBoardSelection(a);
    const b = await state.createBoard('Clipboard destination');
    await pasteBoardSelection(b, { x: 40, y: 80 });
    const pasted = useBoardStore.getState().sessions[b];
    check(pasted.document.objects.length === doc.objects.length && pasted.document.connections.length === 1, 'Clipboard relations were lost');
    check(pasted.past.length === 1, 'Paste must be one undo step');
    state.undo(b); check(useBoardStore.getState().sessions[b].document.objects.length === 0, 'Undo paste failed'); state.redo(b);
    await state.openBoard(a);
    await wait(() => !!document.querySelector('.board-stage .react-flow__node-sticky'));
    // Exercise native inline editing and auto height in the real layout engine.
    const note = document.querySelector<HTMLElement>('.board-stage .board-creative--sticky')!;
    note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await wait(() => !!note.querySelector('textarea'));
    check(!document.querySelector('[aria-label="Canvas actions"]'), 'Object double click opened the blank-canvas menu');
    const textarea = note.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, Array.from({ length: 12 }, (_, index) => `Idea ${index + 1}`).join('\n'));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => useBoardStore.getState().sessions[a].document.objects.some(object => object.type === 'sticky' && object.height > 180), 'Sticky did not auto-resize');
    textarea.blur();
    button('Viewport options').click(); await wait(() => [...document.querySelectorAll('button')].some(item => item.textContent === 'Fit all')); button('Fit all').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    await state.flushAll();
    const exportImage = async (scope: 'board' | 'selection', scale: number, transparent: boolean) => {
      button('Export').click(); await wait(() => !![...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === 'PNG image')); button('PNG image').click();
      await wait(() => !!document.querySelector('[aria-label="Export PNG"]'));
      const dialog = document.querySelector<HTMLElement>('[aria-label="Export PNG"]')!;
      await wait(() => !!document.activeElement?.closest('[role="dialog"]'), 'PNG dialog did not take keyboard focus');
      const count = useBoardStore.getState().sessions[a].document.objects.length;
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      check(useBoardStore.getState().sessions[a].document.objects.length === count, 'Dialog forwarded Delete to the canvas');
      const selects = dialog.querySelectorAll('select');
      selects[0].value = scope; selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 50));
      selects[1].value = String(scale); selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      if (checkbox.checked !== transparent) checkbox.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      button('Save PNG').click();
      await wait(() => !document.querySelector('[aria-label="Export PNG"]'), 'PNG UI export did not finish');
    };
    state.setSelection(a, [doc.objects.find(object => object.type === 'shape')!.id]);
    await exportImage('selection', 2, false);
    await exportImage('selection', 4, true);
    state.setSelection(a, []);
    await exportImage('board', 1, true);
    const savedTabs = localStorage.getItem('imh-board-tabs-v1');
    check(savedTabs?.includes(a) && savedTabs.includes(b), 'Tabs were not persisted');
    await state.closeBoard(b); check(useBoardStore.getState().activeBoardId === a, 'Closing an inactive tab changed the active board');
    return { a, b, objectCount: doc.objects.length, clipboardUndoRedo: true, inlineAutoResize: true, pngFromUi: true, pngScales: [1, 2, 4], dialogKeyboardIsolation: true, tabsPersisted: true };
  },
} });
