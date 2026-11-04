import React, { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBezierPath, Position } from '@xyflow/react';
import { useBoardConnections } from '../hooks/useBoardConnections';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addConnection, drawBoardObject } from '../services/boards/operations';
import type { BoardTool } from '../services/boards/types';
const flow = vi.hoisted(() => ({ screenToFlowPosition: (point: { x: number; y: number }) => point }));
vi.mock('@xyflow/react', async original => ({ ...await original<typeof import('@xyflow/react')>(), useReactFlow: () => flow }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
let hit: Element | null;
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent); hit = null;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
  useBoardStore.setState({ sessions: {}, activeBoardId: null, closing: false });
});
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); vi.restoreAllMocks(); Reflect.deleteProperty(document, 'elementFromPoint'); vi.unstubAllGlobals(); });
function Surface({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const connection = useBoardConnections(id, ref);
  const objects = useBoardStore.getState().sessions[id].document.objects;
  return <div ref={ref} data-testid="stage" onPointerDownCapture={connection.pointerDown} onPointerMove={connection.pointerMove} onPointerUpCapture={connection.pointerUp} onPointerCancel={connection.cancel} onClickCapture={connection.click}>
    {objects.map((object, index) => <div key={object.id} className="react-flow__node" data-id={object.id} data-testid={`node-${index}`}><span className="react-flow__handle" data-handleid="right" data-testid={`handle-${index}`}/></div>)}
    <div className="react-flow__pane" data-testid="pane"/>
    {connection.preview && <svg aria-label="Connection preview"><path d={connection.preview.path}/>{connection.preview.target && <rect data-testid="destination"/>}</svg>}
  </div>;
}
function Harness({ id, initialTool, editable }: { id: string; initialTool: BoardTool; editable: boolean }) {
  const [tool, setTool] = useState(initialTool);
  return <BoardEditorContext.Provider value={{ editable, tool, setTool, connecting: tool === 'connect', begin() {}, change() {}, commit() {}, cancel() {} }}>
    <section className="board-workspace" tabIndex={0}><Surface id={id}/></section><output data-testid="tool">{tool}</output><button>Outside canvas</button>
  </BoardEditorContext.Provider>;
}
function setup(initialTool: BoardTool = 'connect', editable = true) {
  let document = drawBoardObject(createBoardDocument(), 'rectangle', { x: 0, y: 0, width: 100, height: 100 });
  document = drawBoardObject(document, 'ellipse', { x: 400, y: 200, width: 100, height: 100 });
  useBoardStore.getState().adoptBoard(document);
  render(<Harness id={document.id} initialTool={initialTool} editable={editable}/>);
  Object.defineProperty(screen.getByTestId('stage'), 'setPointerCapture', { value: vi.fn() });
  const click = (index: number, handle = false) => {
    hit = screen.getByTestId(`node-${index}`);
    const element = screen.getByTestId(`${handle ? 'handle' : 'node'}-${index}`);
    const point = { button: 0, clientX: index ? 420 : 20, clientY: index ? 220 : 20 };
    fireEvent.pointerDown(element, point); fireEvent.pointerUp(element, point); fireEvent.click(element);
  };
  return { id: document.id, click, current: () => useBoardStore.getState().sessions[document.id] };
}
describe('curved connections and two-click creation', () => {
  it('previews the exact final Bezier curve, accepts the entire destination, and commits one undo operation', () => {
    const { click, current, id } = setup(); click(0);
    expect(current().document.connections).toHaveLength(0);
    hit = screen.getByTestId('node-1');
    fireEvent.pointerMove(screen.getByTestId('stage'), { clientX: 420, clientY: 220 });
    const [expected] = getBezierPath({ sourceX: 100, sourceY: 50, sourcePosition: Position.Right, targetX: 400, targetY: 250, targetPosition: Position.Left });
    expect(screen.getByLabelText('Connection preview').querySelector('path')?.getAttribute('d')).toBe(expected);
    expect(screen.getByTestId('destination')).toBeTruthy();
    click(1);
    expect(current().document.connections).toHaveLength(1);
    expect(current().document.connections[0]).toMatchObject({ sourceSide: 'right', targetSide: 'left' });
    expect(current().past).toHaveLength(1);
    expect(screen.getByTestId('tool').textContent).toBe('select');
    expect(screen.queryByLabelText('Connection preview')).toBeNull();
    act(() => useBoardStore.getState().undo(id)); expect(current().document.connections).toHaveLength(0);
  });
  it('starts from a connection dot in Select and does not turn ordinary card movement into a connection', () => {
    const { click, current } = setup('select');
    fireEvent.pointerDown(screen.getByTestId('node-0'), { button: 0, clientX: 20, clientY: 20 });
    expect(screen.queryByLabelText('Connection preview')).toBeNull();
    click(0, true); expect(screen.getByLabelText('Connection preview')).toBeTruthy();
    click(1); expect(current().document.connections).toHaveLength(1);
  });
  it('still supports a single drag from origin to destination without moving objects', () => {
    const { current } = setup(); const original = current().document.objects;
    hit = screen.getByTestId('node-0'); fireEvent.pointerDown(hit, { button: 0, clientX: 20, clientY: 20 });
    hit = screen.getByTestId('node-1'); fireEvent.pointerMove(screen.getByTestId('stage'), { clientX: 420, clientY: 220 });
    fireEvent.pointerUp(screen.getByTestId('stage'), { clientX: 420, clientY: 220 });
    expect(current().document.connections).toHaveLength(1); expect(current().document.objects).toEqual(original);
    expect(screen.getByTestId('tool').textContent).toBe('select');
  });
  it.each(['escape', 'outside', 'blank', 'blur', 'pointercancel'])('cancels a pending click connection on %s', reason => {
    const { click, current } = setup(); click(0);
    if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (reason === 'outside') fireEvent.pointerDown(screen.getByText('Outside canvas'), { button: 0 });
    else if (reason === 'blur') fireEvent(window, new Event('blur'));
    else if (reason === 'pointercancel') fireEvent.pointerCancel(screen.getByTestId('stage'));
    else { hit = null; fireEvent.pointerDown(screen.getByTestId('pane'), { button: 0 }); fireEvent.pointerUp(screen.getByTestId('stage')); }
    expect(current().document.connections).toHaveLength(0); expect(current().past).toHaveLength(0);
    expect(screen.queryByLabelText('Connection preview')).toBeNull(); expect(screen.getByTestId('tool').textContent).toBe('select');
  });
  it('selects an existing directed connection instead of creating a duplicate', () => {
    const { click, current, id } = setup();
    act(() => useBoardStore.getState().executeOperation(id, document => addConnection(document, { sourceObjectId: document.objects[0].id, targetObjectId: document.objects[1].id, sourceSide: 'right', targetSide: 'left', color: '#94a3b8', label: '' })));
    click(0); click(1);
    expect(current().document.connections).toHaveLength(1); expect(current().past).toHaveLength(1);
    expect(current().selectedConnectionIds).toEqual([current().document.connections[0].id]);
  });
  it('keeps read-only cards unchanged', () => {
    const { click, current } = setup('connect', false); click(0); click(1);
    expect(current().document.connections).toHaveLength(0); expect(screen.queryByLabelText('Connection preview')).toBeNull();
  });
});
