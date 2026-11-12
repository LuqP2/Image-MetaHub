import React from 'react';
import { createRoot } from 'react-dom/client';
import CanvasWorkspace from '../../../components/CanvasWorkspace';
import { useBoardStore } from '../../../store/useBoardStore';
import { useBoardUIStore } from '../../../store/useBoardUIStore';
import { useImageStore } from '../../../store/useImageStore';
import { useSavedPromptStore } from '../../../store/useSavedPromptStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useLicenseStore } from '../../../store/useLicenseStore';
import { addImagesToBoard } from '../../../services/boards/commands';
import { imagePromptText } from '../../../services/boards/promptMatching';
import { boardDirectory, boardImage } from '../../helpers/boardIntegrationFixtures';
import type { BoardPromptObject } from '../../../services/boards/types';
import { emptyEditor } from '../../../services/promptLibrary/core.mjs';
import '../../../src/index.css';

document.body.style.cssText = 'margin:0;width:100vw;height:100vh;background:#111827;color:#e5e7eb;font-family:Arial';
document.getElementById('root')!.style.cssText = 'width:100%;height:100%';
useSettingsStore.setState({ enableSafeMode: false, blurSensitiveImages: false });
const thumbnail = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#5b4a8c"/><circle cx="120" cy="90" r="45" fill="#d4bfff"/></svg>');
const images = ['a.png', 'b.png'].map(name => boardImage(name, { thumbnailStatus: 'ready', thumbnailUrl: thumbnail, dimensions: '240 x 180', metadata: { normalizedMetadata: { prompt: 'cat, soft light', negativePrompt: 'blur' } } as never }));
useImageStore.setState({ images, directories: [boardDirectory] });
useSavedPromptStore.setState({ prompts: [], blocks: [], folders: [], loadLibrary: async () => {} });
useBoardUIStore.setState({ libraryOpen: false, inspectorOpen: true });
createRoot(document.getElementById('root')!).render(<CanvasWorkspace loading={false} onOpenImage={() => {}} onCompareImages={() => {}} />);
const wait = async (test: () => boolean, message: string) => { const start = Date.now(); while (!test()) { if (Date.now() - start > 12000) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 30)); } };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const button = (name: string) => { const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === name); if (!result) throw new Error('Missing button: ' + name); return result; };
Object.assign(window, { canvasPromptSmoke: {
  async verifySidebars() {
    const state = useBoardStore.getState();
    state.setSelection(state.activeBoardId!, []);
    useBoardUIStore.setState({ libraryOpen: true, inspectorOpen: false });
    const visibleImages = () => [...document.querySelectorAll<HTMLImageElement>('.board-browser-tile img')].filter(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().height > 0);
    await wait(() => visibleImages().length === 2, 'Image sidebar thumbnails are missing');
    const imageHeight = document.querySelector('.board-browser-results')!.getBoundingClientRect().height;
    check(imageHeight > 100, 'Image sidebar lost its available height');
    useSavedPromptStore.setState({ prompts: [{ id: 'linked-preview', createdAt: 1, revision: 1, sourceCreatedAt: null, source: null, textBasis: 'authored', positivePrompt: 'cat, soft light', negativePrompt: '', editor: { ...emptyEditor(), title: 'Linked prompt' } }] });
    button('Prompts').click();
    await wait(() => { const image = document.querySelector<HTMLImageElement>('.board-prompt-library-preview img'); return !!image && image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().height > 0; }, 'Linked prompt thumbnail is missing from Canvas sidebar');
    const promptHeight = document.querySelector('.board-prompt-library')!.getBoundingClientRect().height;
    check(promptHeight > 100, 'Prompt sidebar lost its available height');
    return { imageThumbnails: 2, imageHeight, linkedPromptThumbnail: true, promptHeight };
  },
  async showImageSidebar() {
    button('Images').click();
    await wait(() => !!document.querySelector('.board-browser-tile img'), 'Image thumbnails disappeared after switching tabs');
  },
  async run() {
    await new Promise(resolve => setTimeout(resolve, 100));
    useLicenseStore.setState({ initialized: true, licenseStatus: 'pro' });
    const store = useBoardStore.getState();
    const boardId = await store.createBoard('Prompt cards packaged smoke');
    await wait(() => !!document.querySelector('.board-stage'), 'Canvas did not mount');
    const ids = await addImagesToBoard(boardId, images, [boardDirectory], { x: 500, y: 50 });
    useBoardStore.getState().setSelection(boardId, [ids[0]]);
    await wait(() => !!document.querySelector('[aria-label="Drag prompt to Canvas"]'), 'Prompt drag handle missing from image inspector');
    const handle = button('Drag prompt to Canvas');
    const stage = document.querySelector<HTMLElement>('.board-stage')!;
    const rect = stage.getBoundingClientRect();
    const viewport = useBoardStore.getState().sessions[boardId].document.viewport;
    const clientX = rect.left + 180, clientY = rect.top + 150;
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }));
    stage.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true, clientX, clientY }));
    stage.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true, clientX, clientY }));
    await wait(() => !!document.querySelector('.board-prompt'), 'Dropping inspector prompt did not create a card');
    const card = useBoardStore.getState().sessions[boardId].document.objects.find(object => object.type === 'prompt') as BoardPromptObject;
    check(card.positivePrompt === imagePromptText(images[0]).positivePrompt && card.negativePrompt === 'blur', 'Dropped text changed');
    check(Math.abs(card.x - (clientX - rect.left - viewport.x) / viewport.zoom) < 2, 'Drop X was not converted to Canvas coordinates');
    check(useBoardStore.getState().sessions[boardId].selectedObjectIds.join() === card.id, 'Prompt matching selected image objects');
    await wait(() => document.querySelectorAll('[data-prompt-match="true"]').length === 2, 'Exact prompt images did not highlight');
    check(document.querySelector('[aria-label="Card positive prompt"]'), 'Prompt inspector did not open');
    useBoardStore.getState().setSelection(boardId, []);
    await wait(() => !document.querySelector('[data-prompt-match="true"]'), 'Highlight persisted after deselection');
    useBoardStore.getState().setSelection(boardId, [card.id]);
    await useBoardStore.getState().flushBoard(boardId);
    const loaded = await window.electronAPI!.boardsLoad(boardId);
    check(loaded.success && loaded.data.schemaVersion === 5 && loaded.data.objects.some(object => object.id === card.id && object.type === 'prompt' && object.positivePrompt === card.positivePrompt), 'Prompt card did not survive native storage reload');
    await wait(() => !!document.querySelector('.board-prompt'), 'Card disappeared after save');
    return { boardId, promptId: card.id, promptDragDrop: true, exactHighlights: true, independentSelection: true, nativePromptPersistence: true };
  }
} });
