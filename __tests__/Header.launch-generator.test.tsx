import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Header from '../components/Header';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseAnalytics: true,
    showProModal: vi.fn(),
    isTrialActive: false,
    trialDaysRemaining: 0,
    isPro: true,
    initialized: true,
    isExpired: false,
    isFree: false,
  }),
}));

describe('Header launch generator', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
    useImageStore.getState().resetState();
  });

  it('launches the configured command from the header button', async () => {
    const launchGenerator = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      ...(window.electronAPI ?? {}),
      launchGenerator,
    } as any;

    useSettingsStore.setState({
      generatorLaunchCommand: '@echo off\necho hello',
    });

    render(
      <Header
        onOpenSettings={() => {}}
        onOpenAnalytics={() => {}}
        onOpenLicense={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /launch generator/i }));

    await waitFor(() => {
      expect(launchGenerator).toHaveBeenCalledWith('@echo off\necho hello');
    });
  });
});
