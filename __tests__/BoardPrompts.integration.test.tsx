import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardPromptIntegration from '../components/boards/BoardPromptIntegration';
import BoardPromptInspector from '../components/boards/BoardPromptInspector';
import BoardImagePromptActions from '../components/boards/BoardImagePromptActions';
import { useBoardPrompts } from '../components/boards/BoardPromptContext';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addPromptObject, PROMPT_DRAG_TYPE, readPromptDrag } from '../services/boards/prompts';
import { addAssets, updateObjects } from '../services/boards/operations';
import { createBoardAssetReference } from '../services/boards/assetResolver';
import { createSmartFrame } from '../services/boards/smartFrameOperations';
import type { BoardAssetObject, BoardDocument, BoardPromptObject, BoardSmartFrameObject } from '../services/boards/types';
import type { IndexedImage } from '../types';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { useImageStore } from '../store/useImageStore';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { boardDirectory, boardImage } from './helpers/boardIntegrationFixtures';

const baseline = vi.hoisted(() => ({ read: vi.fn(async () => [] as string[]) }));
vi.mock('../services/boards/referenceSync', () => ({ getBoardReferenceBaseline: baseline.read }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseAdvancedPromptLibrary: true, canUseCanvas: true, showProModal: vi.fn() }) }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document: BoardDocument, revision: number) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
const text = 'Cat, (soft light:1.2)';
const cardInput = { title: 'Cat', positivePrompt: text, negativePrompt: 'blur' };
const image = (name: string, prompt = text) => boardImage(name, { metadata: { normalizedMetadata: { prompt, negativePrompt: name } } as IndexedImage['metadata'] });
function Probe() {
  const actions = useBoardPrompts();
  const id = useBoardStore(state => state.activeBoardId)!;
  const session = useBoardStore(state => state.sessions[id]);
  const card = session.document.objects.find(object => object.type === 'prompt') as BoardPromptObject;
  return <><output data-testid="matches">{[...actions.matchedIds].join(',')}</output><output data-testid="counts">{JSON.stringify(actions.counts(text))}</output><BoardPromptInspector boardId={id} card={card} editable /></>;
}
function setup(images: IndexedImage[], makeBoard: (document: BoardDocument) => BoardDocument = document => document, loading = false) {
  useImageStore.setState({ images, directories: [boardDirectory] });
  const document = makeBoard(addPromptObject(createBoardDocument(), cardInput, { x: 0, y: 0 }));
  useBoardStore.getState().adoptBoard(document);
  const card = document.objects.find(object => object.type === 'prompt')!;
  useBoardStore.getState().setSelection(document.id, [card.id]);
  const resolve = (object: BoardAssetObject) => { const match = images.find(item => item.id === object.reference.locator.imageId); return match ? { status: 'resolved', image: match } : { status: 'missing' }; };
  const view = render(<BoardPromptIntegration images={images} resolve={resolve} loading={loading} editable><Probe /></BoardPromptIntegration>);
  return { document, card, view, resolve };
}
beforeEach(() => {
  baseline.read.mockReset().mockResolvedValue([]);
  useBoardStore.setState({ sessions: {}, activeBoardId: null, closing: false });
  useBoardQueryStore.setState({ results: {} });
  useSettingsStore.setState({ enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: ['nsfw'] });
});
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); vi.restoreAllMocks(); });
describe('Canvas prompt integration', () => {
  it('highlights matches without selecting images; clears on deselection and updates edited positive in one undo', () => {
    const images = [image('a.png'), image('b.png', 'Different')];
    const { document, card } = setup(images);
    expect(screen.getByTestId('matches').textContent).toBe(images[0].id);
    expect(useBoardStore.getState().sessions[document.id].selectedObjectIds).toEqual([card.id]);
    const field = screen.getByLabelText('Card positive prompt');
    fireEvent.change(field, { target: { value: 'Differ' } });
    fireEvent.change(field, { target: { value: 'Different' } });
    fireEvent.blur(field);
    expect(screen.getByTestId('matches').textContent).toBe(images[1].id);
    expect(useBoardStore.getState().sessions[document.id].past).toHaveLength(1);
    act(() => useBoardStore.getState().undo(document.id));
    expect(screen.getByTestId('matches').textContent).toBe(images[0].id);
    act(() => useBoardStore.getState().setSelection(document.id, []));
    expect(screen.getByTestId('matches').textContent).toBe('');
  });
  it('brings only absent matches in a free grid and undoes the entire insertion', async () => {
    const images = [image('a.png'), image('b.png'), image('c.png')];
    const { document } = setup(images, document => addAssets(document, [{ name: images[0].name, mediaType: 'image', reference: createBoardAssetReference(images[0], [boardDirectory]) }], { x: 368, y: 0 }));
    expect(screen.getByTestId('counts').textContent).toBe('{"library":3,"canvas":1}');
    fireEvent.click(screen.getByText('Bring matching images…'));
    expect(screen.getByText('2 matching images are not yet on this Canvas.')).toBeTruthy();
    fireEvent.click(screen.getByText('Add 2 images'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const session = useBoardStore.getState().sessions[document.id];
    expect(session.document.objects.filter(object => object.type === 'asset')).toHaveLength(3);
    const fresh = session.document.objects.slice(document.objects.length);
    for (const added of fresh) for (const old of document.objects) expect(added.x < old.x + old.width && added.x + added.width > old.x && added.y < old.y + old.height && added.y + added.height > old.y).toBe(false);
    expect(session.past).toHaveLength(1);
    act(() => useBoardStore.getState().undo(document.id));
    expect(useBoardStore.getState().sessions[document.id].document.objects).toEqual(document.objects);
  });
  it('counts only current Smart Frame results and excludes them from bring', () => {
    const images = [image('a.png'), image('b.png')];
    const { document } = setup(images, document => createSmartFrame(document));
    const frame = document.objects.find(object => object.type === 'smart-frame') as BoardSmartFrameObject;
    const definitionKey = JSON.stringify({ source: frame.source, criteria: frame.criteria, groupConstraints: frame.groupConstraints });
    act(() => useBoardQueryStore.setState({ results: { [document.id]: { [frame.id]: { status: 'ready', definitionKey, imageIds: [images[0].id], totalCount: 1 } } } } as never));
    expect(screen.getByTestId('counts').textContent).toBe('{"library":2,"canvas":1}');
    fireEvent.click(screen.getByText('Bring matching images…'));
    expect(screen.getByText('1 matching images are not yet on this Canvas.')).toBeTruthy();
    act(() => useBoardQueryStore.setState({ results: { [document.id]: { [frame.id]: { status: 'ready', definitionKey: 'stale', imageIds: [images[0].id], totalCount: 1 } } } } as never));
    expect(screen.getByText('2 matching images are not yet on this Canvas.')).toBeTruthy();
  });
  it('respects Safe Mode and library loading', () => {
    const images = [image('a.png'), { ...image('b.png'), tags: ['nsfw'] }];
    useSettingsStore.setState({ enableSafeMode: true, blurSensitiveImages: false });
    const { view, resolve } = setup(images);
    expect(screen.getByTestId('matches').textContent).toBe(images[0].id);
    expect(screen.getByTestId('counts').textContent).toBe('{"library":1,"canvas":0}');
    view.rerender(<BoardPromptIntegration images={images} resolve={resolve} loading editable><Probe /></BoardPromptIntegration>);
    expect(screen.getByText('Loading matches…')).toBeTruthy();
    expect(screen.getByTestId('matches').textContent).toBe('');
    expect((screen.getByText('Bring matching images…') as HTMLButtonElement).disabled).toBe(true);
  });
  it('rejects an insertion if the library changes while awaiting references', async () => {
    let finish!: (value: string[]) => void;
    baseline.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const images = [image('a.png')];
    const { document } = setup(images);
    fireEvent.click(screen.getByText('Bring matching images…'));
    fireEvent.click(screen.getByText('Add 1 images'));
    act(() => useImageStore.setState({ images: [] }));
    await act(async () => finish([]));
    expect(screen.getByRole('alert').textContent).toContain('changed');
    expect(useBoardStore.getState().sessions[document.id].document.objects).toHaveLength(1);
  });
  it('does not rebuild the prompt index or recount the library when moving a card with 18k images', () => {
    let reads = 0;
    const images = Array.from({ length: 18000 }, (_, index) => { const entry = image(`${index}.png`); const metadata = entry.metadata; Object.defineProperty(entry, 'metadata', { get: () => { reads++; return metadata; } }); return entry; });
    const { document, card } = setup(images);
    expect(screen.getByTestId('counts').textContent).toBe('{"library":18000,"canvas":0}');
    const initialReads = reads;
    act(() => useBoardStore.getState().executeOperation(document.id, document => updateObjects(document, [{ id: card.id, x: 500 }])));
    expect(reads).toBe(initialReads);
    expect(screen.getByTestId('matches').textContent?.split(',')).toHaveLength(18000);
  });
  it('adds inspector content using the same versioned payload as drag and button', () => {
    const images = [image('a.png')];
    const { document, view, resolve } = setup(images, document => addAssets(document, [{ name: images[0].name, mediaType: 'image', reference: createBoardAssetReference(images[0], [boardDirectory]) }], { x: 400, y: 0 }));
    const object = document.objects.find(object => object.type === 'asset') as BoardAssetObject;
    view.rerender(<BoardPromptIntegration images={images} resolve={resolve} loading={false} editable><BoardImagePromptActions image={images[0]} object={object} editable /></BoardPromptIntegration>);
    const data = new Map<string, string>();
    const transfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key), types: [PROMPT_DRAG_TYPE] } as DataTransfer;
    fireEvent.dragStart(screen.getByLabelText('Drag prompt to Canvas'), { dataTransfer: transfer });
    const input = readPromptDrag(transfer);
    fireEvent.click(screen.getByText('Add prompt to Canvas'));
    expect(useBoardStore.getState().sessions[document.id].document.objects.at(-1)).toMatchObject(input);
    expect(input).toMatchObject({ positivePrompt: text, negativePrompt: 'a.png', origin: { kind: 'image', reference: object.reference } });
  });
  it('saves a card as an authored Library item and preserves the card', async () => {
    const { document } = setup([]);
    vi.spyOn(useSavedPromptStore.getState(), 'loadLibrary').mockResolvedValue();
    useSavedPromptStore.setState({ prompts: [], folders: [{ id: 'folder', name: 'Experiments' }] });
    const mutate = vi.spyOn(useSavedPromptStore.getState(), 'mutate').mockResolvedValue('saved');
    fireEvent.click(screen.getByText('Save to Prompt Library…'));
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'folder' } });
    fireEvent.click(screen.getByText('Save new prompt'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'prompt', item: expect.objectContaining({ textBasis: 'authored', positivePrompt: text, editor: expect.objectContaining({ folderId: 'folder' }) }) }));
    expect(useBoardStore.getState().sessions[document.id].document.objects).toEqual(document.objects);
  });
});
