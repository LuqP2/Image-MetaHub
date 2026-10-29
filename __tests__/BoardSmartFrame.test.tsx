import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BoardSmartFrameNode from '../components/boards/BoardSmartFrameNode';
import BoardQueryFilterEditor from '../components/boards/BoardQueryFilterEditor';
import { BoardQueryContext } from '../components/boards/BoardQueryContext';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { useImageStore } from '../store/useImageStore';
import { createSmartFrame } from '../services/boards/smartFrameOperations';
import { createBoardDocument } from '../services/boards/document.mjs';
import { boardImage } from './helpers/boardIntegrationFixtures';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';

vi.mock('../components/boards/BoardNodeControls', () => ({ default: () => null }));
vi.mock('../hooks/useThumbnail', () => ({ useThumbnail: () => {} }));
vi.mock('../hooks/useResolvedThumbnail', () => ({ useResolvedThumbnail: () => ({ thumbnailUrl: 'blob:test' }) }));
vi.mock('../components/boards/BoardLocalSizer', () => ({ default: ({ children }) => children({ width: 600, height: 300 }) }));
afterEach(() => { cleanup(); useBoardQueryStore.setState({ results: {} }); });

describe('Smart Frame rendering', () => {
  it('limits previews and virtualizes expanded results without creating board objects', () => {
    const document = createSmartFrame(createBoardDocument());
    const frame = document.objects[0];
    useBoardStore.getState().adoptBoard(document);
    const images = Array.from({ length: 1000 }, (_, i) => boardImage(`${i}.png`));
    useBoardQueryStore.getState().publish(document.id, { [frame.id]: { frameId: frame.id, status: 'ready', imageIds: images.map(image => image.id), totalCount: 1000, unavailableReferences: 0, datasetRevision: 1, queryRevision: 1 } });
    const open = vi.fn();
    render(<BoardQueryContext.Provider value={{ images: new Map(images.map(image => [image.id, image])), open, create: vi.fn(), retry: vi.fn(), snapshot: vi.fn(), useCurrentFilters: vi.fn(), collections: [] }}>
      <BoardSmartFrameNode {...({ data: { object: frame }, selected: false } as any)} />
    </BoardQueryContext.Provider>);
    expect(screen.getByText(`${(1000).toLocaleString()} matches`)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(12);
    fireEvent.doubleClick(screen.getAllByRole('button', { name: /^Open / })[0]);
    expect(open).toHaveBeenCalledWith(images[0].id, frame.id);
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(screen.getAllByRole('button', { name: /^Open / }).length).toBeLessThan(40);
    expect(useBoardStore.getState().sessions[document.id].document.objects).toHaveLength(1);
    expect(useBoardStore.getState().sessions[document.id].changeSequence).toBe(0);
  });
  it('emits controlled local criteria without changing library filters', () => {
    const before = useImageStore.getState().searchQuery;
    const onChange = vi.fn();
    render(<BoardQueryFilterEditor value={normalizeLibraryQueryCriteria()} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Query search'), { target: { value: 'forest' } });
    expect(onChange.mock.lastCall![0].searchQuery).toBe('forest');
    fireEvent.change(screen.getByLabelText('LoRAs'), { target: { value: 'A, B' } });
    fireEvent.blur(screen.getByLabelText('LoRAs'));
    expect(onChange.mock.lastCall![0].selectedLoras).toEqual(['A', 'B']);
    expect(useImageStore.getState().searchQuery).toBe(before);
  });
});
