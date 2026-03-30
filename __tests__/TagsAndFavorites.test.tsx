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
  const setSelectedAutoTags = vi.fn();
  const setExcludedAutoTags = vi.fn();
  const refreshAvailableAutoTags = vi.fn();

  useImageStore.getState().resetState();
  useImageStore.setState({
    availableTags: [{ name: 'ghost', count: 0 }],
    availableAutoTags: [],
    images: [],
    filteredImages: [],
    selectedTags: [],
    excludedTags: [],
    selectedAutoTags: [],
    excludedAutoTags: [],
    favoriteFilterMode: 'neutral',
    renameTag,
    clearTag,
    deleteTag,
    purgeTag,
    setSelectedTags,
    setExcludedTags,
    setSelectedAutoTags,
    setExcludedAutoTags,
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

  it('uses the context menu to set an include filter', () => {
    const { setSelectedTags, setExcludedTags } = seedSidebarState({
      availableTags: [{ name: 'ghost-tag', count: 0 }],
    });

    render(<TagsAndFavorites />);
    openContextMenuForTag('ghost-tag');
    fireEvent.click(screen.getByText('Include'));

    expect(setSelectedTags).toHaveBeenCalledWith(['ghost-tag']);
    expect(setExcludedTags).toHaveBeenCalledWith([]);
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

  it('offers purge when trying to delete a still-used tag', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { deleteTag, purgeTag } = seedSidebarState({
      availableTags: [{ name: 'used-tag', count: 3 }],
    });

    render(<TagsAndFavorites />);
    openContextMenuForTag('used-tag');
    fireEvent.click(screen.getByText('Delete Tag'));

    expect(deleteTag).not.toHaveBeenCalled();
    expect(purgeTag).toHaveBeenCalledWith('used-tag');
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});
