import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Header from '../components/Header';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

vi.mock('../services/comfyUIApiClient', () => ({
  ComfyUIApiClient: class {
    async testConnection() {
      return { success: true };
    }
  },
}));

vi.mock('../services/a1111ApiClient', () => ({
  A1111ApiClient: class {
    async testConnection() {
      return { success: true };
    }
  },
}));

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseAnalytics: true,
    canUseComfyUI: true,
    canUseImageEditor: true,
    showProModal: vi.fn(),
    isTrialActive: false,
    trialDaysRemaining: 0,
    isPro: true,
    initialized: true,
    isExpired: false,
    isFree: false,
  }),
}));

const renderHeader = (overrides: Partial<React.ComponentProps<typeof Header>> = {}) =>
  render(
    <Header
      onOpenSettings={() => {}}
      onOpenAnalytics={() => {}}
      onOpenLicense={() => {}}
      libraryView="library"
      onLibraryViewChange={() => {}}
      {...overrides}
    />,
  );

describe('Header classic mode', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
    useImageStore.getState().resetState();
  });
  afterEach(() => cleanup());

  it('hides the legacy tabs by default', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /model view/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /smart library/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /node view/i })).toBeNull();
    // The unified Explore tab is always present.
    expect(screen.getByRole('button', { name: /explore/i })).toBeTruthy();
  });

  it('shows the legacy tabs as Explore deep-links when classic mode is on', () => {
    useSettingsStore.setState({ classicMode: true });
    const onNavigateExplore = vi.fn();
    const onLibraryViewChange = vi.fn();
    renderHeader({ onNavigateExplore, onLibraryViewChange });

    fireEvent.click(screen.getByRole('button', { name: /smart library/i }));
    expect(onNavigateExplore).toHaveBeenCalledWith('clusters');

    fireEvent.click(screen.getByRole('button', { name: /model view/i }));
    expect(onNavigateExplore).toHaveBeenCalledWith('models');

    fireEvent.click(screen.getByRole('button', { name: /^collections$/i }));
    expect(onNavigateExplore).toHaveBeenCalledWith('collections');

    // Node View opens the Library (its filter lives in the sidebar), not a separate surface.
    fireEvent.click(screen.getByRole('button', { name: /node view/i }));
    expect(onLibraryViewChange).toHaveBeenCalledWith('library');
  });
});
