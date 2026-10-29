import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BoardSmartFrameGroups from '../components/boards/BoardSmartFrameGroups';
import BoardSmartFrameMatrix from '../components/boards/BoardSmartFrameMatrix';
import BoardSmartFrameLayoutEditor from '../components/boards/BoardSmartFrameLayoutEditor';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { BoardQueryContext } from '../components/boards/BoardQueryContext';
import { buildBoardGroupedLayout, createGroupingContext } from '../services/boards/grouping';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame } from '../services/boards/smartFrameOperations';
import { useBoardStore } from '../store/useBoardStore';
import { boardImage, boardDirectory } from './helpers/boardIntegrationFixtures';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';

vi.mock('../hooks/useThumbnail', () => ({ useThumbnail: () => {} }));
vi.mock('../hooks/useResolvedThumbnail', () => ({ useResolvedThumbnail: () => ({ thumbnailUrl: 'blob:test' }) }));
vi.mock('../components/boards/BoardLocalSizer', () => ({ default: ({ children }) => children({ width: 600, height: 350 }) }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); });
function fixture(size = 2) {
  const images = Array.from({ length: size }, (_, i) => ({ ...boardImage(`${i}.png`), models: [i === 0 ? 'Flux' : `Model ${i}`], loras: [i === 0 ? 'A' : `LoRA ${i}`] }));
  const dataset = { images: images.map(toLibraryQueryImage), references: {}, collections: {}, context: { visibleDirectories: [boardDirectory], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] } } };
  const document = createSmartFrame(createBoardDocument(), { id: 'parent' });
  useBoardStore.getState().adoptBoard(document);
  const open = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => <BoardEditorContext.Provider value={{ editable: true, connecting: false, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() }}>
    <BoardQueryContext.Provider value={{ images: new Map(images.map(image => [image.id, image])), open, create: vi.fn(), retry: vi.fn(), snapshot: vi.fn(), useCurrentFilters: vi.fn(), collections: [] }}>{children}</BoardQueryContext.Provider>
  </BoardEditorContext.Provider>;
  return { open, images, dataset, document, wrapper, context: createGroupingContext(dataset) };
}

describe('metadata layouts', () => {
  it('branches a subgroup with both constraints and browses its complete image set', () => {
    const f = fixture();
    const layout = buildBoardGroupedLayout(f.dataset.images, { kind: 'groups', groupBy: 'model', subgroupBy: 'lora' }, f.context);
    if (layout?.kind !== 'groups') throw new Error('groups');
    render(<BoardSmartFrameGroups frameId="parent" groups={layout.groups} />, { wrapper: f.wrapper });
    const preview = screen.getByText('Flux / A').closest('.board-group-preview') as HTMLElement;
    fireEvent.click(within(preview).getByRole('button', { name: 'Branch group' }));
    const child = useBoardStore.getState().sessions[f.document.id].document.objects[1] as BoardSmartFrameObject;
    expect(child.groupConstraints).toEqual([{ kind: 'exact', dimension: 'model', value: 'Flux' }, { kind: 'exact', dimension: 'lora', value: 'A' }]);
    fireEvent.click(within(preview).getByRole('button', { name: 'Browse group' }));
    expect(screen.getByRole('button', { name: 'Back to groups' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1);
    fireEvent.doubleClick(screen.getAllByRole('button', { name: /^Open / })[0]);
    expect(f.open).toHaveBeenCalledWith(f.images[0].id, 'parent', [f.images[0].id]);
  });
  it('virtualizes high-cardinality axes and allows branching an empty matrix cell', () => {
    const f = fixture(1000);
    const matrix = buildBoardGroupedLayout(f.dataset.images, { kind: 'matrix', rows: 'lora', columns: 'model' }, f.context);
    if (matrix?.kind !== 'matrix') throw new Error('matrix');
    render(<BoardSmartFrameMatrix frameId="parent" matrix={matrix} />, { wrapper: f.wrapper });
    expect(screen.getAllByRole('button', { name: 'Branch group' }).length).toBeLessThan(50);
    const empty = screen.getAllByText('0 images')[0].closest('.board-group-preview') as HTMLElement;
    fireEvent.click(within(empty).getByRole('button', { name: 'Branch group' }));
    const child = useBoardStore.getState().sessions[f.document.id].document.objects[1] as BoardSmartFrameObject;
    expect(child.groupConstraints).toHaveLength(2);
  });
  it('offers distinct matrix axes through a controlled layout editor', () => {
    const change = vi.fn();
    render(<BoardSmartFrameLayoutEditor layout={{ kind: 'matrix', rows: 'lora', columns: 'model' }} disabled={false} change={change} />);
    expect(within(screen.getByLabelText('Rows')).queryByRole('option', { name: 'Checkpoint' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: 'rating' } });
    expect(change).toHaveBeenCalledWith({ kind: 'matrix', rows: 'rating', columns: 'model' });
  });
});
