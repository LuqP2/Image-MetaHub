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

  it('places EXR under General optional components without a dedicated navigation tab', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} initialTab="general" />);

    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Optional components' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'EXR / OpenColorIO' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'EXR / OpenColorIO' })).toBeNull();
  });

  it('focuses the EXR component when opened from a preview shortcut', () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    render(<SettingsModal isOpen={true} onClose={() => {}} initialTab="general" focusSection="exr" />);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('EXR / OpenColorIO');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    delete (Element.prototype as Partial<Element>).scrollIntoView;
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

  it('stays above the sticky application header and footer', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: 'Settings' }).className).toContain('z-[100]');
  });
});
