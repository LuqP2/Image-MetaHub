import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TagsAndFavorites from '../components/TagsAndFavorites';
import { useImageStore } from '../store/useImageStore';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

const seedSidebarState = (overrides: Record<string, unknown> = {}) => {
  const renameTag = vi.fn().mockResolvedValue(undefined);
  const clearTag = vi.fn().mockResolvedValue(undefined);
  const deleteTag = vi.fn().mockResolvedValue(undefined);
  const purgeTag = vi.fn().mockResolvedValue(undefined);
  const setSelectedTags = vi.fn();
  const setExcludedTags = vi.fn();
  const setSelectedTagsMatchMode = vi.fn();
  const setSelectedAutoTags = vi.fn();
  const setExcludedAutoTags = vi.fn();
  const setSelectedRatings = vi.fn();
  const refreshAvailableAutoTags = vi.fn();

  useImageStore.getState().resetState();
  useImageStore.setState({
    availableTags: [{ name: 'ghost', count: 0 }],
    availableAutoTags: [],
    images: [],
    filteredImages: [],
    selectedTags: [],
    excludedTags: [],
    selectedTagsMatchMode: 'any',
    selectedAutoTags: [],
    excludedAutoTags: [],
    favoriteFilterMode: 'neutral',
    selectedRatings: [],
    renameTag,
    clearTag,
    deleteTag,
    purgeTag,
    setSelectedTags,
    setExcludedTags,
    setSelectedTagsMatchMode,
    setSelectedAutoTags,
    setExcludedAutoTags,
    setSelectedRatings,
    refreshAvailableAutoTags,
    ...overrides,
  });

  return {
    renameTag,
    clearTag,
    deleteTag,
    purgeTag,
    setSelectedTags,
    setExcludedTags,
    setSelectedTagsMatchMode,
    setSelectedRatings,
    refreshAvailableAutoTags,
  };
};

const openContextMenuForTag = (tagName: string) => {
  const tagLabel = screen.getByText(tagName);
  const row = tagLabel.closest('div');
  if (!row) {
    throw new Error(`Could not find row for tag ${tagName}`);
  }
  fireEvent.contextMenu(row);
};

describe('TagsAndFavorites manual tag browser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders zero-use manual tags from the global catalog', () => {
    seedSidebarState({
      availableTags: [{ name: 'ghost-tag', count: 0 }],
    });

    render(<TagsAndFavorites />);

    expect(screen.getByText('ghost-tag')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('hides filter and image-removal actions for empty tags', () => {
    seedSidebarState({
      availableTags: [{ name: 'ghost-tag', count: 0 }],
    });

    render(<TagsAndFavorites />);
    openContextMenuForTag('ghost-tag');

    expect(screen.queryByText('Include')).toBeNull();
    expect(screen.queryByText('Exclude')).toBeNull();
    expect(screen.queryByText('Clear Filter')).toBeNull();
    expect(screen.queryByText('Clear From Images')).toBeNull();
    expect(screen.queryByText('Clear and Delete')).toBeNull();
  });

  it('uses the context menu to set an include filter', () => {
    const { setSelectedTags, setExcludedTags } = seedSidebarState({
      availableTags: [{ name: 'ghost-tag', count: 2 }],
    });

    render(<TagsAndFavorites />);
    openContextMenuForTag('ghost-tag');
    fireEvent.click(screen.getByText('Include'));

    expect(setSelectedTags).toHaveBeenCalledWith(['ghost-tag']);
    expect(setExcludedTags).toHaveBeenCalledWith([]);
  });

  it('toggles tag match mode from any to all', () => {
    const { setSelectedTagsMatchMode } = seedSidebarState({
      availableTags: [{ name: 'ghost-tag', count: 2 }],
      selectedTagsMatchMode: 'any',
    });

    render(<TagsAndFavorites />);
    fireEvent.click(screen.getByLabelText('Tag match mode: any'));

    expect(setSelectedTagsMatchMode).toHaveBeenCalledWith('all');
  });

  it('toggles rating chips with multi-select OR behavior', () => {
    const { setSelectedRatings } = seedSidebarState({
      images: [{ id: 'img-1', rating: 4 } as any],
      filteredImages: [{ id: 'img-1', rating: 4 } as any],
      selectedRatings: [1],
    });

    render(<TagsAndFavorites />);
    fireEvent.click(screen.getByLabelText('Toggle 3 stars filter'));

    expect(setSelectedRatings).toHaveBeenCalledWith([1, 3]);
  });

  it('clears selected rating filters from the rating section', () => {
    const { setSelectedRatings } = seedSidebarState({
      images: [{ id: 'img-1', rating: 4 } as any],
      filteredImages: [{ id: 'img-1', rating: 4 } as any],
      selectedRatings: [4],
    });

    render(<TagsAndFavorites />);
    fireEvent.click(screen.getByTitle('Clear rating filters'));

    expect(setSelectedRatings).toHaveBeenCalledWith([]);
  });

  it('opens the rename dialog and submits the new tag name', async () => {
    const { renameTag } = seedSidebarState({
      availableTags: [{ name: 'ghost-tag', count: 0 }],
    });

    render(<TagsAndFavorites />);
    openContextMenuForTag('ghost-tag');
    fireEvent.click(screen.getByText('Rename Tag'));

    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Tag name'), {
      target: { value: 'fixed-tag' },
    });
    fireEvent.click(screen.getByText('Rename'));

    expect(renameTag).toHaveBeenCalledWith('ghost-tag', 'fixed-tag');
  });

  it('hides delete-empty for used tags and keeps purge available', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { deleteTag, purgeTag } = seedSidebarState({
      availableTags: [{ name: 'used-tag', count: 3 }],
    });

    render(<TagsAndFavorites />);
    openContextMenuForTag('used-tag');
    expect(screen.queryByText('Remove Empty Tag')).toBeNull();
    fireEvent.click(screen.getByText('Clear and Delete'));

    expect(deleteTag).not.toHaveBeenCalled();
    expect(purgeTag).toHaveBeenCalledWith('used-tag');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
