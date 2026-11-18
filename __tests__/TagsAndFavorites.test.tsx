import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';
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
  const createCollection = vi.fn().mockResolvedValue(undefined);

  useImageStore.getState().resetState();
  useImageStore.setState({
    availableTags: [{ name: 'ghost', count: 0 }],
    availableAutoTags: [],
    images: [],
    filteredImages: [],
    collections: [],
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
    createCollection,
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
    createCollection,
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
  it.each(languages)('localizes confirmations in %s and preserves the original tag', async (language) => {
    const tag = 'fixture {tag} 海';
    const { clearTag } = seedSidebarState({
      availableTags: [{ name: tag, count: 1 }],
      images: [{ id: 'fixture', tags: [tag] }],
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TagsAndFavorites />);
    openContextMenuForTag(tag);
    act(() => useSettingsStore.setState({ language }));
    expect(screen.getByText(tag)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(formatMessage(language, 'libraryTags.clearFromImages')) }));
    });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(formatMessage(language, 'libraryTags.clearConfirm', { tag }));
    expect(clearTag).toHaveBeenCalledExactlyOnceWith(tag);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().resetState();
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

  it('updates usage counts and hides a tag when its last image is removed', () => {
    seedSidebarState({
      availableTags: [{ name: 'rejected', count: 20 }, { name: 'unused', count: 0 }],
      images: [{ id: 'remaining-image', tags: ['rejected'] }],
    });

    render(<TagsAndFavorites />);
    expect(screen.getByText('rejected').parentElement?.textContent).toBe('rejected1');
    act(() => useImageStore.setState({ images: [] }));
    expect(screen.queryByText('rejected')).toBeNull();
    expect(screen.getByText('unused')).toBeTruthy();
  });

  it('opens the auto-tag menu below the cursor and deletes only the chosen auto-tag', () => {
    const removeAutoTags = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    seedSidebarState({
      availableAutoTags: [{ name: 'generated', count: 2 }],
      removeAutoTags,
    });

    render(<TagsAndFavorites />);
    fireEvent.contextMenu(screen.getByText('generated'), { clientX: 100, clientY: 120 });
    const remove = screen.getByRole('button', { name: 'Delete from All Images' });
    expect(remove.closest('div.fixed')?.getAttribute('style')).toContain('top: 128px');
    expect(screen.getByRole('button', { name: 'Rename Tag' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Include' })).toBeTruthy();
    fireEvent.click(remove);
    expect(removeAutoTags).toHaveBeenCalledWith('generated');
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
      images: [{ id: 'img-1', tags: ['ghost-tag'] }],
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
      images: [{ id: 'img-1', tags: ['ghost-tag'] }],
      selectedTagsMatchMode: 'any',
    });

    render(<TagsAndFavorites />);
    fireEvent.click(screen.getByLabelText('Tag match mode: Any'));

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

  it('creates a tag-rule collection from the tag context menu', async () => {
    const { createCollection } = seedSidebarState({
      availableTags: [{ name: 'carros', count: 2 }],
      images: [
        { id: 'img-1', tags: ['carros'] } as any,
        { id: 'img-2', tags: ['carros', 'motos'] } as any,
      ],
    });

    render(<TagsAndFavorites />);
    openContextMenuForTag('carros');
    fireEvent.click(screen.getByText('Create Collection'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }));

    expect(createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tag_rule',
        name: 'carros',
        sourceTag: 'carros',
        autoUpdate: true,
      }),
    );
  });

  it('hides delete-empty for used tags and keeps purge available', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { deleteTag, purgeTag } = seedSidebarState({
      availableTags: [{ name: 'used-tag', count: 3 }],
      images: [{ id: 'img-1', tags: ['used-tag'] }],
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
