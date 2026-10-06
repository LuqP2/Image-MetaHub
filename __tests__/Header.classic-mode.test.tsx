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

const modelAccess = vi.hoisted(() => ({ allowed: true, showProModal: vi.fn() }));

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseAnalytics: true,
    canUseComfyUI: true,
    canUseImageEditor: true,
    canUseModelManager: modelAccess.allowed,
    showProModal: modelAccess.showProModal,
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
    modelAccess.allowed = true;
    modelAccess.showProModal.mockClear();
    useSettingsStore.getState().resetState();
    useImageStore.getState().resetState();
  });
  afterEach(() => cleanup());

  it('opens the Model Manager paywall without navigating on Free', () => {
    modelAccess.allowed = false;
    const onLibraryViewChange = vi.fn();
    renderHeader({ onLibraryViewChange });
    fireEvent.click(screen.getByRole('button', { name: /^models/i }));
    expect(modelAccess.showProModal).toHaveBeenCalledWith('model_manager');
    expect(onLibraryViewChange).not.toHaveBeenCalled();
  });

  it('opens Model Manager with an eligible entitlement', () => {
    const onLibraryViewChange = vi.fn();
    renderHeader({ onLibraryViewChange });
    fireEvent.click(screen.getByRole('button', { name: /^models/i }));
    expect(onLibraryViewChange).toHaveBeenCalledWith('models');
    expect(modelAccess.showProModal).not.toHaveBeenCalled();
  });

  it('hides the legacy tabs by default', () => {
    const { container } = renderHeader();
    expect(container.querySelector('header > div')?.className).not.toContain('container');
    expect(container.querySelector('header > div')?.className).not.toContain('mx-auto');
    expect(screen.queryByRole('button', { name: /model view/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /smart library/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /node view/i })).toBeNull();
    // The unified Explore tab is always present.
    expect(screen.getByRole('button', { name: /explore/i })).toBeTruthy();
  });

  it('keeps Library as a text destination and opens prompts from a compact bookmark button', () => {
    const onLibraryViewChange = vi.fn();
    renderHeader({ onLibraryViewChange });

    expect(screen.queryByRole('button', { name: /^prompts$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Prompt Library' }));
    expect(onLibraryViewChange).toHaveBeenCalledWith('prompts');

    fireEvent.click(screen.getByRole('button', { name: /^library$/i }));
    expect(onLibraryViewChange).toHaveBeenCalledWith('library');
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

    // Collections still has a real workspace, so its Classic tab opens that view directly.
    fireEvent.click(screen.getByRole('button', { name: /^collections$/i }));
    expect(onLibraryViewChange).toHaveBeenCalledWith('collections');

    // Node View opens the Library (its filter lives in the sidebar), not a separate surface.
    fireEvent.click(screen.getByRole('button', { name: /node view/i }));
    expect(onLibraryViewChange).toHaveBeenCalledWith('library');
  });
});
