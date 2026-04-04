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
      comfyUIServerUrl: '',
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

  it('opens ComfyUI when the service is already running', async () => {
    const launchGenerator = vi.fn();
    const openExternalUrl = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      ...(window.electronAPI ?? {}),
      launchGenerator,
      openExternalUrl,
    } as any;

    useSettingsStore.setState({
      generatorLaunchCommand: '@echo off\necho hello',
      comfyUIServerUrl: 'http://127.0.0.1:8188',
      comfyUILastConnectionStatus: 'connected',
    });

    render(
      <Header
        onOpenSettings={() => {}}
        onOpenAnalytics={() => {}}
        onOpenLicense={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /open comfyui/i }));

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith('http://127.0.0.1:8188');
    });

    expect(launchGenerator).not.toHaveBeenCalled();
  });
});
