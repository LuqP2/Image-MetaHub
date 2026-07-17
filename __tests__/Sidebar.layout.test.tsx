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
        availableNodes={[]}
        nodeFacetCounts={new Map()}
        availableDimensions={[]}
        selectedModels={[]}
        selectedLoras={[]}
        selectedSamplers={[]}
        selectedSchedulers={[]}
        selectedNodes={[]}
        onModelChange={() => {}}
        onLoraChange={() => {}}
        onSamplerChange={() => {}}
        onSchedulerChange={() => {}}
        onNodeChange={() => {}}
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
      >
        <FolderPane />
      </Sidebar>,
    );

    expect(screen.getByText('Folder content')).toBeTruthy();
    // Sort Order / Group By moved to the grid Footer; they no longer live in the Sidebar.
    expect(screen.queryByText('Sort Order')).toBeNull();
    // Reorganized into Navigate / Filter categories.
    expect(screen.getByText('Navigate')).toBeTruthy();
    expect(screen.getByText('Filter')).toBeTruthy();
    // Collection/cluster actions moved to the Explore surface; the sidebar is folders + filters only.
    expect(screen.queryByText('Clusters')).toBeNull();
    expect(screen.queryByRole('button', { name: /rules/i })).toBeNull();
  });
});
