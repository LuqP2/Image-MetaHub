import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BoardMiniMap from '../components/boards/BoardMiniMap';
import { boardWithTexts } from './helpers/boardFixtures';

const state = vi.hoisted(() => ({ width: 1000, height: 600, viewport: { x: -100, y: -50, zoom: 1 } }));
vi.mock('@xyflow/react', () => ({ useViewport: () => state.viewport, useStore: selector => selector(state), useReactFlow: () => ({}) }));
afterEach(cleanup);

it('changes the visible-area rectangle during zoom and pan while retaining the map scale', () => {
  const objects = boardWithTexts().objects;
  const view = render(<BoardMiniMap objects={objects} />);
  const mapBounds = view.getByRole('img').getAttribute('viewBox');
  const area = () => view.container.querySelector('.board-minimap-viewport')!;
  expect(area().getAttribute('width')).toBe('1000');
  expect(area().getAttribute('x')).toBe('100');
  state.viewport = { x: -400, y: -200, zoom: 2 };
  view.rerender(<BoardMiniMap objects={objects} />);
  expect(area().getAttribute('width')).toBe('500');
  expect(area().getAttribute('height')).toBe('300');
  expect(area().getAttribute('x')).toBe('200');
  expect(area().getAttribute('y')).toBe('100');
  expect(view.getByRole('img').getAttribute('viewBox')).toBe(mapBounds);
});
