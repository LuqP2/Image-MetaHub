import { formatMessage, languages } from '../i18n/messages.mjs';
import { useSettingsStore } from '../store/useSettingsStore';
import { summarizeBoardCriteria } from '../components/boards/BoardInheritedQuerySummary';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
beforeEach(() => useSettingsStore.setState({ language: 'en' }));
afterEach(() => { cleanup(); useBoardQueryStore.setState({ results: {} }); });

describe('Smart Frame rendering', () => {
  it.each(languages)('preserves local query values and sort enums in %s', (language) => {
    const value = normalizeLibraryQueryCriteria({
      searchQuery: 'original {query} 海', selectedModels: ['FixtureModel_{model}.safetensors'],
      selectedLoras: ['FixtureLoRA_{lora}'], selectedTags: ['user tag 海'],
      sortOrder: 'date-desc', selectedNodes: ['KSamplerAdvanced'],
    });
    const original = JSON.stringify(value);
    const change = vi.fn();
    const globalQuery = useImageStore.getState().searchQuery;
    render(<BoardQueryFilterEditor value={value} disabled={false} onChange={change} />);
    act(() => useSettingsStore.setState({ language }));
    expect((screen.getByLabelText(formatMessage(language, 'canvas.querySearch')) as HTMLInputElement).value).toBe(value.searchQuery);
    const sort = screen.getByRole('combobox', { name: formatMessage(language, 'canvas.sort'), exact: true });
    expect((sort as HTMLSelectElement).value).toBe('date-desc');
    expect(change).not.toHaveBeenCalled();
    const summary = summarizeBoardCriteria(value, (key, values) => formatMessage(language, key, values)).join(' · ');
    for (const raw of [value.searchQuery, ...value.selectedModels, ...value.selectedLoras, ...value.selectedTags, ...value.selectedNodes!]) expect(summary).toContain(raw);
    fireEvent.change(sort, { target: { value: 'random' } });
    expect(change.mock.lastCall![0]).toMatchObject({ sortOrder: 'random', selectedModels: value.selectedModels, selectedTags: value.selectedTags, searchQuery: value.searchQuery });
    expect(JSON.stringify(value)).toBe(original);
    expect(useImageStore.getState().searchQuery).toBe(globalQuery);
  });

  it.each([15, 1000])('makes all %i results available immediately without creating board objects', count => {
    const document = createSmartFrame(createBoardDocument());
    const frame = document.objects[0];
    useBoardStore.getState().adoptBoard(document);
    const images = Array.from({ length: count }, (_, i) => boardImage(`${i}.png`));
    useBoardQueryStore.getState().publish(document.id, { [frame.id]: { frameId: frame.id, status: 'ready', imageIds: images.map(image => image.id), totalCount: count, unavailableReferences: 0, datasetRevision: 1, queryRevision: 1 } });
    const open = vi.fn();
    render(<BoardQueryContext.Provider value={{ images: new Map(images.map(image => [image.id, image])), open, create: vi.fn(), retry: vi.fn(), snapshot: vi.fn(), useCurrentFilters: vi.fn(), collections: [] }}>
      <BoardEditorContext.Provider value={{ editable: true, connecting: false, begin() {}, change() {}, commit() {}, cancel() {} }}><BoardSmartFrameNode {...({ data: { object: frame }, selected: false } as any)} /></BoardEditorContext.Provider>
    </BoardQueryContext.Provider>);
    expect(screen.getByText(formatMessage('en', 'canvas.imagesInFrame', { count }))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Browse' })).toBeNull();
    fireEvent.doubleClick(screen.getAllByRole('button', { name: /^Open / })[0]);
    expect(open).toHaveBeenCalledWith(images[0].id, frame.id, images.map(image => image.id));
    const buttons = screen.getAllByRole('button', { name: /^Open / });
    if (count === 15) expect(buttons).toHaveLength(15);
    else expect(buttons.length).toBeLessThan(40);
    expect(useBoardStore.getState().sessions[document.id].document.objects).toHaveLength(1);
    expect(useBoardStore.getState().sessions[document.id].changeSequence).toBe(0);
  });
  it('emits controlled local criteria without changing library filters', async () => {
    const before = useImageStore.getState().searchQuery;
    const onChange = vi.fn();
    render(<BoardQueryFilterEditor value={normalizeLibraryQueryCriteria()} disabled={false} facets={{ availableLoras: ['A, B'] } as any} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Query search'), { target: { value: 'forest' } });
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(onChange.mock.lastCall![0].searchQuery).toBe('forest');
    fireEvent.click(screen.getByRole('button', { name: 'Include A, B' }));
    expect(onChange.mock.lastCall![0].selectedLoras).toEqual(['A, B']);
    expect(useImageStore.getState().searchQuery).toBe(before);
  });
});
