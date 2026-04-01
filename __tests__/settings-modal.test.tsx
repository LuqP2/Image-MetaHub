import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import SettingsModal from '../components/SettingsModal';
import { useSettingsStore } from '../store/useSettingsStore';

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().resetState();
  });

  afterEach(() => {
    cleanup();
  });

  it('maps the legacy general tab to the Library panel', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} initialTab="general" />);

    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
  });

  it('maps the legacy hotkeys tab to the Shortcuts panel', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} initialTab="hotkeys" />);

    expect(screen.getByRole('heading', { name: 'Shortcuts' })).toBeTruthy();
  });

  it('opens the license panel when focusSection is license', async () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={() => {}}
        initialTab="general"
        focusSection="license"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Support / License' })).toBeTruthy();
    });
  });
});
