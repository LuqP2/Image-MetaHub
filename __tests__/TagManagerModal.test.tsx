import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TagManagerModal from '../components/TagManagerModal';
import { useImageStore } from '../store/useImageStore';

describe('TagManagerModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0) as unknown as number;
    });

    const bulkAddTag = vi.fn().mockResolvedValue(undefined);
    const bulkRemoveTag = vi.fn().mockResolvedValue(undefined);

    useImageStore.getState().resetState();
    useImageStore.setState({
      availableTags: [{ name: 'portrait', count: 2 }],
      recentTags: ['portrait'],
      bulkAddTag,
      bulkRemoveTag,
      images: [
        { id: 'img-1', name: 'a.png', tags: ['portrait'] } as any,
        { id: 'img-2', name: 'b.png', tags: ['portrait'] } as any,
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the input focusable after removing a tag', async () => {
    render(
      <TagManagerModal
        isOpen={true}
        onClose={() => {}}
        selectedImageIds={['img-1', 'img-2']}
      />,
    );

    const input = screen.getByPlaceholderText('Type tags separated by commas...');

    fireEvent.click(screen.getByLabelText('Remove tag portrait'));
    expect(screen.getByText('Remove tag "portrait" from 2 images?')).toBeTruthy();
    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => {
      expect(useImageStore.getState().bulkRemoveTag).toHaveBeenCalledWith(['img-1', 'img-2'], 'portrait');
    });

    fireEvent.click(input);

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it('applies a displayed tag to the whole selection when its chip is clicked', async () => {
    useImageStore.setState({
      availableTags: [{ name: 'portrait', count: 2 }],
      recentTags: ['portrait'],
      images: [
        { id: 'img-1', name: 'a.png', tags: ['portrait'] } as any,
        { id: 'img-2', name: 'b.png', tags: [] } as any,
      ],
    });

    render(
      <TagManagerModal
        isOpen={true}
        onClose={() => {}}
        selectedImageIds={['img-1', 'img-2']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply tag portrait to all selected images' }));

    await waitFor(() => {
      expect(useImageStore.getState().bulkAddTag).toHaveBeenCalledWith(['img-1', 'img-2'], 'portrait');
    });
  });

  it('applies an existing chip tag with commas as a single tag value', async () => {
    useImageStore.setState({
      availableTags: [{ name: 'portrait, dramatic', count: 2 }],
      recentTags: ['portrait, dramatic'],
      images: [
        { id: 'img-1', name: 'a.png', tags: ['portrait, dramatic'] } as any,
        { id: 'img-2', name: 'b.png', tags: [] } as any,
      ],
    });

    render(
      <TagManagerModal
        isOpen={true}
        onClose={() => {}}
        selectedImageIds={['img-1', 'img-2']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply tag portrait, dramatic to all selected images' }));

    await waitFor(() => {
      expect(useImageStore.getState().bulkAddTag).toHaveBeenCalledTimes(1);
      expect(useImageStore.getState().bulkAddTag).toHaveBeenCalledWith(['img-1', 'img-2'], 'portrait, dramatic');
    });
  });

  it('suggests tags that are already present on part of the current selection', async () => {
    useImageStore.setState({
      availableTags: [{ name: 'portrait', count: 2 }],
      recentTags: ['portrait'],
      images: [
        { id: 'img-1', name: 'a.png', tags: ['portrait'] } as any,
        { id: 'img-2', name: 'b.png', tags: [] } as any,
      ],
    });

    render(
      <TagManagerModal
        isOpen={true}
        onClose={() => {}}
        selectedImageIds={['img-1', 'img-2']}
      />,
    );

    const input = screen.getByPlaceholderText('Type tags separated by commas...');
    fireEvent.change(input, { target: { value: 'por' } });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /portrait/i })).toBeTruthy();
    });
  });
});
