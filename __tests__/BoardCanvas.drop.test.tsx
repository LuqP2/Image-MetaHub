import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BoardCanvas from '../components/boards/BoardCanvas';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { clearInternalImageDragData, INTERNAL_IMAGE_DRAG_TYPE } from '../utils/internalImageDrag';
const flow = vi.hoisted(() => ({ screenToFlowPosition: vi.fn().mockReturnValue({ x: 75, y: -20 }), getViewport: vi.fn(), fitView: vi.fn() }));
vi.mock('@xyflow/react', async importOriginal => ({ ...await importOriginal<typeof import('@xyflow/react')>(), ReactFlow: ({ children }) => <div>{children}</div>, Background: () => null, useReactFlow: () => flow }));
afterEach(() => { cleanup(); clearInternalImageDragData(); });
describe('Canvas asset drop', () => {
  it('places all dragged references at converted board coordinates', () => {
    const document = createBoardDocument(); useBoardStore.getState().adoptBoard(document);
    const drop = vi.fn();
    const view = render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn(), dropAssets: drop }}><BoardCanvas boardId={document.id} /></BoardEditorContext.Provider>);
    const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 340 });
    Object.defineProperty(event, 'dataTransfer', { value: { types: [INTERNAL_IMAGE_DRAG_TYPE], getData: () => JSON.stringify({ imageIds: ['first', 'second'] }) } });
    fireEvent(view.container.querySelector('.board-stage')!, event);
    expect(flow.screenToFlowPosition).toHaveBeenCalledWith({ x: 500, y: 340 });
    expect(drop).toHaveBeenCalledWith(['first', 'second'], { x: 75, y: -20 });
  });
});
