import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import VerticalSplitPanels from '../components/VerticalSplitPanels';

describe('VerticalSplitPanels', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the configured panes and persists resized pane sizes', async () => {
    const { getByTestId, rerender } = render(
      <VerticalSplitPanels
        storageKey="test-pane-sizes"
        defaultSizes={[36, 34, 30]}
        panes={[
          { id: 'one', ariaLabel: 'Pane one', content: <div>One</div> },
          { id: 'two', ariaLabel: 'Pane two', content: <div>Two</div> },
          { id: 'three', ariaLabel: 'Pane three', content: <div>Three</div> },
        ]}
      />,
    );

    const layout = getByTestId('vertical-split-panels');
    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600 }),
    });

    expect(screen.getByRole('region', { name: 'Pane one' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Pane two' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Pane three' })).toBeTruthy();

    const firstHandle = screen.getByRole('separator', { name: 'Resize Pane one' });
    fireEvent.pointerDown(firstHandle, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: -300 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      const firstPane = screen.getByRole('region', { name: 'Pane one' }) as HTMLElement;
      expect(parseFloat(firstPane.style.flexBasis)).toBe(20);
    });

    const stored = JSON.parse(window.localStorage.getItem('test-pane-sizes') ?? '[]') as number[];
    expect(stored).toHaveLength(3);
    expect(Math.round(stored[0])).toBe(20);

    rerender(
      <VerticalSplitPanels
        storageKey="test-pane-sizes"
        defaultSizes={[36, 34, 30]}
        panes={[
          { id: 'one', ariaLabel: 'Pane one', content: <div>One</div> },
          { id: 'two', ariaLabel: 'Pane two', content: <div>Two</div> },
          { id: 'three', ariaLabel: 'Pane three', content: <div>Three</div> },
        ]}
      />,
    );

    const reloadedFirstPane = screen.getByRole('region', { name: 'Pane one' }) as HTMLElement;
    expect(Math.round(parseFloat(reloadedFirstPane.style.flexBasis))).toBe(20);
  });
});
