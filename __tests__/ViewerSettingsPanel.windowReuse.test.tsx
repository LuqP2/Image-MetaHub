import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ViewerSettingsPanel } from '../components/settings/ViewerSettingsPanel';
import { useSettingsStore } from '../store/useSettingsStore';

describe('viewer window reuse setting', () => {
  beforeEach(() => useSettingsStore.getState().resetState());
  afterEach(() => { cleanup(); delete window.electronAPI; });

  it('lets desktop users opt in and preserves the choice while using the inline viewer', () => {
    window.electronAPI = {} as Window['electronAPI'];
    render(<ViewerSettingsPanel />);
    const toggle = screen.getByRole('switch', { name: 'Reuse a single viewer window' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().reuseImageViewerWindow).toBe(true);
    act(() => useSettingsStore.getState().setImageViewerMode('inline'));
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    act(() => useSettingsStore.getState().setImageViewerMode('detached'));
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables window reuse in browser builds', () => {
    render(<ViewerSettingsPanel />);
    const toggle = screen.getByRole('switch', { name: 'Reuse a single viewer window' });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().reuseImageViewerWindow).toBe(false);
  });
});
