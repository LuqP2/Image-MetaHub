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
});
