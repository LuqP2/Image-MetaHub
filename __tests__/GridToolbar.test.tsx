import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import GridToolbar from '../components/GridToolbar';
import { useImageStore } from '../store/useImageStore';

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseComparison: true,
    canUseA1111: true,
    canUseComfyUI: true,
    canUseBulkTagging: true,
    showProModal: vi.fn(),
  }),
}));

vi.mock('../hooks/useReparseMetadata', () => ({
  useReparseMetadata: () => ({
    isReparsing: false,
    reparseImages: vi.fn(),
  }),
}));

vi.mock('../components/ActiveFilters', () => ({
  default: () => <div>Active Filters</div>,
}));

vi.mock('../components/TagManagerModal', () => ({
  default: () => null,
}));

describe('GridToolbar', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
  });

  it('renders the save-as-collection action in the toolbar', () => {
    const onSaveCurrentFilteredAsCollection = vi.fn();

    render(
      <GridToolbar
        selectedImages={new Set()}
        images={[]}
        directories={[]}
        onSaveCurrentFilteredAsCollection={onSaveCurrentFilteredAsCollection}
        saveCurrentFilteredCount={18}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /save as collection/i }));

    expect(onSaveCurrentFilteredAsCollection).toHaveBeenCalled();
    expect(screen.getByText('18')).toBeTruthy();
  });
});
