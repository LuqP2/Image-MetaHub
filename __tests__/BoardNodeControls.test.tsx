import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BoardNodeControls from '../components/boards/BoardNodeControls';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';

const flow = vi.hoisted(() => ({ state: {} as any }));
vi.mock('@xyflow/react', () => ({
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  NodeResizer: () => null,
  Handle: ({ id, style, isConnectableStart, isConnectableEnd }) => <div data-testid={id} style={style} data-start={String(isConnectableStart)} data-end={String(isConnectableEnd)} />,
  useNodeId: () => 'destination',
  useStore: selector => selector(flow.state),
}));
afterEach(cleanup);

it('reveals selected origins and nearby destinations while retaining invisible connection targets', () => {
  const node = { width: 100, height: 100, measured: {}, internals: { positionAbsolute: { x: 100, y: 100 } } };
  flow.state = { connection: { inProgress: false }, transform: [0, 0, 2], nodeLookup: new Map([['destination', node]]) };
  const context = { editable: true, connecting: false, begin: vi.fn(), change: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
  const controls = (selected: boolean) => <BoardEditorContext.Provider value={context}><BoardNodeControls selected={selected} /></BoardEditorContext.Provider>;
  const view = render(controls(false));
  // Hidden resting handles use board.css; the component leaves inline style unset.
  expect(view.getByTestId('left').style.opacity).toBe('');
  expect(view.getByTestId('left').getAttribute('data-start')).toBe('true');
  view.rerender(controls(true));
  expect(view.getByTestId('left').style.opacity).toBe('1');
  expect(view.getByTestId('left').getAttribute('data-start')).toBe('true');

  // At zoom 2, a pointer 30 screen pixels from the destination reveals its handles.
  flow.state.connection = { inProgress: true, fromNode: { id: 'origin' }, pointer: { x: 170, y: 300 }, isValid: false };
  view.rerender(controls(false));
  expect(view.getByTestId('left').style.opacity).toBe('1');
  expect(view.getByTestId('left').getAttribute('data-start')).toBe('true');
  expect(view.getByTestId('left').getAttribute('data-end')).toBe('true');
  flow.state.connection = { ...flow.state.connection, pointer: { x: 200, y: 300 }, isValid: true, toNode: { id: 'destination' }, toHandle: { id: 'left' } };
  view.rerender(controls(false));
  expect(view.getByTestId('left').style.width).toBe('14px');
  expect(view.getByTestId('right').style.width).toBe('');
  flow.state.connection.pointer = { x: 120, y: 300 };
  view.rerender(controls(false));
  expect(view.getByTestId('left').style.opacity).toBe('');
  expect(view.getByTestId('left').style.pointerEvents).toBe('auto');
  flow.state.connection = { inProgress: false };
  view.rerender(controls(false));
  expect(view.getByTestId('left').style.opacity).toBe('');
  expect(view.getByTestId('left').style.pointerEvents).toBe('');
});
