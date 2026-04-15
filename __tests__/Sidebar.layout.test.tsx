import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../components/Sidebar';
import { useImageStore } from '../store/useImageStore';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

describe('Sidebar layout', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    useImageStore.setState({
      images: [],
      filteredImages: [],
      availableTags: [],
      availableAutoTags: [],
      selectedTags: [],
      excludedTags: [],
      selectedAutoTags: [],
      excludedAutoTags: [],
      selectedRatings: [],
      favoriteFilterMode: 'neutral',
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the left sidebar with the main scrollable filter content', () => {
    const FolderPane = (_props: Record<string, unknown>) => <div>Folder content</div>;

    render(
      <Sidebar
        searchQuery=""
        onSearchChange={() => {}}
        availableModels={[]}
        availableLoras={[]}
        availableSamplers={[]}
        availableSchedulers={[]}
        availableDimensions={[]}
        selectedModels={[]}
        selectedLoras={[]}
        selectedSamplers={[]}
        selectedSchedulers={[]}
        onModelChange={() => {}}
        onLoraChange={() => {}}
        onSamplerChange={() => {}}
        onSchedulerChange={() => {}}
        onClearAllFilters={() => {}}
        advancedFilters={{}}
        onAdvancedFiltersChange={() => {}}
        onClearAdvancedFilters={() => {}}
        selectedRatings={[]}
        onSelectedRatingsChange={() => {}}
        isCollapsed={false}
        onToggleCollapse={() => {}}
        width={360}
        isResizing={false}
        onResizeStart={() => {}}
        isIndexing={false}
        scanSubfolders={true}
        excludedFolders={new Set<string>()}
        onExcludeFolder={() => {}}
        onIncludeFolder={() => {}}
        sortOrder="date-desc"
        onSortOrderChange={() => {}}
      >
        <FolderPane />
      </Sidebar>,
    );

    expect(screen.getByText('Folder content')).toBeTruthy();
    expect(screen.getByText('Sort Order')).toBeTruthy();
    expect(screen.getByRole('button', { name: /rules/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));
    expect(screen.getByRole('dialog', { name: /automation rules/i })).toBeTruthy();
  });
});
