import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FacetFilterSection from '../components/FacetFilterSection';
import React from 'react';

describe('FacetFilterSection Bubbling', () => {
  const defaultProps = {
    title: 'Test Facet',
    items: ['Item 1'],
    selectedValues: [],
    excludedValues: [],
    onIncludeToggle: vi.fn(),
    onExcludeToggle: vi.fn(),
    onClear: vi.fn(),
  };

  it('does not trigger handleRowClick when pressing Enter on the Include button', () => {
    render(<FacetFilterSection {...defaultProps} />);

    const includeButton = screen.getByLabelText('Include Item 1');

    // Press Enter on the include button.
    // It should NOT call handleRowClick (which calls onIncludeToggle for unselected items)
    // because of the e.target !== e.currentTarget guard.
    fireEvent.keyDown(includeButton, { key: 'Enter', bubbles: true });

    expect(defaultProps.onIncludeToggle).not.toHaveBeenCalled();
  });

  it('triggers handleRowClick when pressing Enter on the row itself', () => {
    const { container } = render(<FacetFilterSection {...defaultProps} />);

    // Find the row. It's the div with role="button"
    const row = container.querySelector('div[role="button"]');
    if (!row) throw new Error('Row not found');

    fireEvent.keyDown(row, { key: 'Enter' });

    expect(defaultProps.onIncludeToggle).toHaveBeenCalledWith('Item 1');
  });
});
