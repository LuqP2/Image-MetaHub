import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('opens A1111 when the detected service is already running', async () => {
    const launchGenerator = vi.fn();
    const openExternalUrl = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      ...(window.electronAPI ?? {}),
      launchGenerator,
      openExternalUrl,
    } as any;

    useSettingsStore.setState({
      generatorLaunchCommand: 'webui-user.bat --api',
      a1111ServerUrl: 'http://127.0.0.1:7860',
      a1111LastConnectionStatus: 'connected',
    });

    render(
      <Header
        onOpenSettings={() => {}}
        onOpenAnalytics={() => {}}
        onOpenLicense={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /open a1111/i }));

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith('http://127.0.0.1:7860');
    });

    expect(launchGenerator).not.toHaveBeenCalled();
  });
});
