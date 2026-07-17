import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ActiveFilters from '../components/ActiveFilters';
import { useImageStore } from '../store/useImageStore';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, layout, initial, animate, exit, transition, ...props }: any) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const resetFilters = () => {
  useImageStore.getState().resetState();
  useImageStore.setState({
    selectedModels: [],
    excludedModels: [],
    selectedLoras: [],
    excludedLoras: [],
    selectedSamplers: [],
    excludedSamplers: [],
    selectedSchedulers: [],
    excludedSchedulers: [],
    selectedGenerators: [],
    excludedGenerators: [],
    selectedGpuDevices: [],
    excludedGpuDevices: [],
    selectedTags: [],
    excludedTags: [],
    selectedAutoTags: [],
    excludedAutoTags: [],
    searchQuery: '',
    favoriteFilterMode: 'neutral',
    selectedRatings: [],
    advancedFilters: {},
    activeImageScope: null,
  });
};

afterEach(() => {
  cleanup();
});

describe('ActiveFilters scope chip', () => {
  it('renders a scope chip when a scope is active even with no other filters', () => {
    resetFilters();
    useImageStore.setState({
      activeImageScope: { type: 'collection', id: 'c1', label: 'Landscapes' },
    });

    render(<ActiveFilters />);

    expect(screen.getByText('Landscapes')).toBeTruthy();
    expect(screen.getByText('Collection')).toBeTruthy();
  });

  it('clears the scope when the chip × is clicked', () => {
    resetFilters();
    useImageStore.setState({
      activeImageScope: { type: 'model', id: 'sdxl', label: 'SDXL' },
    });

    render(<ActiveFilters />);
    fireEvent.click(screen.getByLabelText('Clear scope'));

    expect(useImageStore.getState().activeImageScope).toBeNull();
  });

  it('renders nothing when there is neither a scope nor any filter', () => {
    resetFilters();
    const { container } = render(<ActiveFilters />);
    expect(container.firstChild).toBeNull();
  });
});
