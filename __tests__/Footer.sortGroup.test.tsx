import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Footer from '../components/Footer';

const baseProps = {
  currentPage: 1,
  totalPages: 1,
  onPageChange: () => undefined,
  itemsPerPage: 100,
  onItemsPerPageChange: () => undefined,
  viewMode: 'grid' as const,
  onViewModeChange: () => undefined,
};

afterEach(() => cleanup());

describe('Footer sort/group controls', () => {
  it('does not render sort/group controls unless enabled', () => {
    render(<Footer {...baseProps} />);
    expect(screen.queryByLabelText('Sort:')).toBeNull();
  });

  it('renders sort + group selects and forwards changes', () => {
    const onSortOrderChange = vi.fn();
    const onGroupByChange = vi.fn();
    render(
      <Footer
        {...baseProps}
        showSortControls
        sortOrder="date-desc"
        onSortOrderChange={onSortOrderChange}
        groupBy="none"
        onGroupByChange={onGroupByChange}
      />,
    );

    const sortSelect = screen.getByLabelText('Sort:') as HTMLSelectElement;
    expect(sortSelect.value).toBe('date-desc');
    fireEvent.change(sortSelect, { target: { value: 'asc' } });
    expect(onSortOrderChange).toHaveBeenCalledWith('asc');

    const groupSelect = screen.getByLabelText('Group:') as HTMLSelectElement;
    // Group By exposes the new model/cluster dimensions.
    expect(Array.from(groupSelect.options).map((option) => option.value)).toEqual([
      'none',
      'date',
      'name',
      'session',
      'model',
      'cluster',
    ]);
    fireEvent.change(groupSelect, { target: { value: 'model' } });
    expect(onGroupByChange).toHaveBeenCalledWith('model');
  });

  it('hides Group By and shows the reshuffle button when sorting randomly', () => {
    const onReshuffle = vi.fn();
    render(
      <Footer
        {...baseProps}
        showSortControls
        sortOrder="random"
        onSortOrderChange={() => undefined}
        onReshuffle={onReshuffle}
        groupBy="none"
        onGroupByChange={() => undefined}
      />,
    );

    expect(screen.queryByLabelText('Group:')).toBeNull();
    fireEvent.click(screen.getByLabelText('Reshuffle random order'));
    expect(onReshuffle).toHaveBeenCalledTimes(1);
  });

  it('hides the page-size selector when pagination is suspended (entity grouping)', () => {
    render(<Footer {...baseProps} showSortControls sortOrder="date-desc" groupBy="model" hidePageSize />);
    expect(screen.queryByLabelText('Show:')).toBeNull();
  });
});


describe('Footer masonry control', () => {
  it('is opt-in for the Library footer and hidden in list view', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Footer {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Masonry layout' })).toBeNull();
    rerender(<Footer {...baseProps} libraryGridLayout="uniform" onLibraryGridLayoutChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Masonry layout' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith('masonry');
    rerender(<Footer {...baseProps} libraryGridLayout="masonry" onLibraryGridLayoutChange={onChange} />);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith('uniform');
    rerender(<Footer {...baseProps} viewMode="list" libraryGridLayout="masonry" onLibraryGridLayoutChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Masonry layout' })).toBeNull();
    rerender(<Footer {...baseProps} libraryGridLayout="masonry" onLibraryGridLayoutChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Masonry layout' }).getAttribute('aria-pressed')).toBe('true');
  });
});
