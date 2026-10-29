import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardCreateSmartFrameDialog from '../components/boards/BoardCreateSmartFrameDialog';
import BoardListPreview from '../components/boards/BoardListPreview';
import { boardSourceLabel, boardSourceMode, boardValueLabel, boardGroupLabel } from '../services/boards/presentation';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { branchSmartFrame, createSmartFrame } from '../services/boards/smartFrameOperations';
import { buildBoardGroupedLayout, createGroupingContext } from '../services/boards/grouping';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import type { BoardAssetObject, BoardSummary } from '../services/boards/types';
import { boardImage, boardDirectory } from './helpers/boardIntegrationFixtures';
import { useBoardStore } from '../store/useBoardStore';
import { useSettingsStore } from '../store/useSettingsStore';
const { load, thumbnail } = vi.hoisted(() => ({ load: vi.fn(), thumbnail: vi.fn(() => ({ thumbnailUrl: 'blob:existing' })) }));
vi.mock('../services/boards/boardService', () => ({ boardService: { load } }));
vi.mock('../hooks/useResolvedThumbnail', () => ({ useResolvedThumbnail: thumbnail }));
vi.mock('../hooks/useThumbnail', () => ({ useThumbnail: () => { throw new Error('Preview must not generate thumbnails'); } }));
let intersect: IntersectionObserverCallback;
const observers: IntersectionObserver[] = [];
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; observers.push(this as unknown as IntersectionObserver); }
    observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
  });
  load.mockReset(); thumbnail.mockClear();
  useBoardStore.setState({ sessions: {}, activeBoardId: null });
  useSettingsStore.setState({ enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const visible = (isIntersecting = true) => act(() => intersect([{ isIntersecting } as IntersectionObserverEntry], observers[observers.length - 1]));

describe('Canvas identification and first use', () => {
  it('explains sources, counts selection, contains keyboard focus and restores it', () => {
    const before = document.createElement('button'); document.body.appendChild(before); before.focus();
    const create = vi.fn(), close = vi.fn();
    const view = render(<BoardCreateSmartFrameDialog collections={[{ id: 'c', name: 'Favorites' }]} selectionCount={0} currentViewSnapshot create={create} close={close} />);
    const source = screen.getByLabelText('Source');
    expect(document.activeElement).toBe(source);
    expect((screen.getByRole('option', { name: /Selected library images/ }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(source, { target: { value: 'current' } });
    expect(screen.getByText(/Capture the current scoped/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    screen.getByRole('button', { name: 'Cancel' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(source);
    view.rerender(<BoardCreateSmartFrameDialog collections={[]} selectionCount={2} create={create} close={close} />);
    fireEvent.change(source, { target: { value: 'selection' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(create).toHaveBeenCalledWith('selection');
    view.unmount(); expect(document.activeElement).toBe(before); before.remove();
  });
  it('formats technical values without merging group identity or changing export criteria', () => {
    const raw = ['<comfy.model.Model object at 0xABC>', '<comfy.model.Model object at 0xDEF>'];
    expect(raw.map(boardValueLabel)).toEqual(['Unidentified model', 'Unidentified model']);
    const images = raw.map((model, index) => toLibraryQueryImage(boardImage(`${index}.png`, { models: [model] })));
    const dataset = { images, references: {}, collections: {}, context: { visibleDirectories: [boardDirectory], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] } } };
    const layout = buildBoardGroupedLayout(images, { kind: 'groups', groupBy: 'model', subgroupBy: null }, createGroupingContext(dataset));
    if (layout?.kind !== 'groups') throw new Error('groups');
    expect(layout.groups).toHaveLength(2); expect(new Set(layout.groups.map(group => group.key)).size).toBe(2);
    expect(layout.groups.map(boardGroupLabel)).toEqual(['Unidentified model', 'Unidentified model']);
    const doc = createSmartFrame(createBoardDocument(), { id: 'parent', title: 'My saved title' });
    const branched = branchSmartFrame(doc, 'parent', [layout.groups[0].constraint], 'Unidentified model');
    expect(branched.objects[0]).toEqual(doc.objects[0]);
    const restored = normalizeBoardDocument(JSON.parse(JSON.stringify(branched)));
    const child = restored.objects[1];
    expect(child.type).toBe('smart-frame');
    if (child.type !== 'smart-frame') throw new Error('frame');
    expect(child.title).toBe('Unidentified model');
    expect(child.groupConstraints).toEqual([layout.groups[0].constraint]);
    expect(boardSourceLabel(child.source, restored.objects)).toBe('Refines “My saved title”');
    expect(boardSourceMode(child.source)).toBe('Linked');
    expect(restored.schemaVersion).toBe(2);
  });
  it('loads only visible saved boards, resolves manual references and releases thumbnails offscreen', async () => {
    const image = boardImage('manual.png');
    const asset: BoardAssetObject = { id: 'a', type: 'asset', name: image.name, mediaType: 'image', x: 0, y: 0, width: 200, height: 200, zIndex: 1, frameId: null, visibleFields: [], reference: { kind: 'path', locator: { imageId: image.id, directoryPath: null, relativePath: image.name } } };
    const doc = createSmartFrame({ ...createBoardDocument(), objects: [asset] });
    const summary: BoardSummary = { ...doc, objectCount: 2 };
    load.mockResolvedValue(doc);
    const resolve = vi.fn(() => ({ status: 'resolved' as const, image }));
    const view = render(<BoardListPreview summary={summary} resolveAsset={resolve} />);
    expect(load).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    visible();
    await waitFor(() => expect(view.container.querySelector('img')).toBeTruthy());
    expect(load).toHaveBeenCalledTimes(1); expect(resolve).toHaveBeenCalledTimes(1);
    expect(thumbnail).toHaveBeenCalledWith(image);
    visible(false);
    expect(view.container.querySelector('img')).toBeNull();
  });
  it('keeps hidden sensitive references out of previews and uses object types instead', async () => {
    const image = boardImage('sensitive.png', { tags: ['private'] });
    const doc = createBoardDocument();
    doc.objects = [{ id: 'a', type: 'asset', name: image.name, mediaType: 'image', x: 0, y: 0, width: 100, height: 100, zIndex: 1, frameId: null, visibleFields: [], reference: { kind: 'path', locator: { imageId: image.id, directoryPath: null, relativePath: image.name } } }];
    useSettingsStore.setState({ enableSafeMode: true, blurSensitiveImages: false, sensitiveTags: ['private'] });
    load.mockResolvedValue(doc);
    const view = render(<BoardListPreview summary={{ ...doc, objectCount: 1 }} resolveAsset={() => ({ status: 'resolved', image })} />);
    visible();
    await screen.findByText('1 Reference');
    expect(view.container.querySelector('img')).toBeNull(); expect(thumbnail).not.toHaveBeenCalled();
  });
});
