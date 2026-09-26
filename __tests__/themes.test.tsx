import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppearanceSettingsPanel } from '../components/settings/AppearanceSettingsPanel';
import { themeOptions, resolveTheme } from '../src/theme/themeRegistry';
import { useSettingsStore } from '../store/useSettingsStore';

const newThemeIds = ['ayu', 'catppuccin', 'github', 'matrix', 'monokai', 'oscurange', 'raycast', 'solarized', 'temple', 'tokyo-night'];

describe('theme selection', () => {
  beforeEach(() => useSettingsStore.getState().resetState());
  afterEach(() => cleanup());

  it('keeps all 16 choices and resolves every new theme as dark', () => {
    expect(themeOptions).toHaveLength(16);
    expect(themeOptions.slice(6).map((option) => option.id)).toEqual(newThemeIds);
    for (const id of newThemeIds) {
      expect(resolveTheme(id as (typeof themeOptions)[number]['id'], false)).toEqual({ id, dark: true });
    }
    expect(resolveTheme('system', false)).toEqual({ id: 'light', dark: false });
    expect(resolveTheme('system', true)).toEqual({ id: 'dark', dark: true });
  });

  it('selects a theme by keyboard and retains the saved choice', async () => {
    render(<AppearanceSettingsPanel />);
    const trigger = screen.getByRole('button', { name: 'Theme' });
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox', { name: 'Available themes' });
    expect(screen.getAllByRole('option')).toHaveLength(16);
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(useSettingsStore.getState().theme).toBe('tokyo-night');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('image-metahub-settings') ?? '{}');
      expect(saved.state?.theme).toBe('tokyo-night');
    });
  });

  it('applies a mouse selection immediately and restores it from persisted settings', async () => {
    render(<AppearanceSettingsPanel />);
    const trigger = screen.getByRole('button', { name: 'Theme' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Matrix' }));
    expect(useSettingsStore.getState().theme).toBe('matrix');
    expect(trigger.textContent).toContain('Matrix');
    const saved = localStorage.getItem('image-metahub-settings');
    expect(saved).not.toBeNull();
    await act(async () => {
      useSettingsStore.getState().resetState();
      localStorage.setItem('image-metahub-settings', saved!);
      await useSettingsStore.persist.rehydrate();
    });
    expect(useSettingsStore.getState().theme).toBe('matrix');
  });

  it('closes on Escape without changing the theme', () => {
    render(<AppearanceSettingsPanel />);
    const trigger = screen.getByRole('button', { name: 'Theme' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when clicking outside the dropdown', () => {
    render(<AppearanceSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

const css = readFileSync(resolve(process.cwd(), 'src/styles/themes.css'), 'utf8');
const channelsFromHex = (hex: string) => (hex.slice(1).match(/../g) ?? []).map((part) => parseInt(part, 16));
const channels = (id: string, token: string) => {
  const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]+)\\}`))?.[1];
  const value = block?.match(new RegExp(`--${token}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!value) throw new Error(`Missing ${token} for ${id}`);
  return value.slice(1).map(Number);
};
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (first: number[], second: number[]) => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

describe('new theme palette contrast', () => {
  it.each(newThemeIds)('%s meets the principal text and control targets', (id) => {
    const color = (token: string) => channels(id, token);
    expect(contrast(color('gray-500'), color('gray-800'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('gray-400'), color('gray-800'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('gray-700'), color('gray-900'))).toBeGreaterThanOrEqual(3);
    expect(contrast(color('blue-500'), color('gray-950'))).toBeGreaterThanOrEqual(3);
    expect(contrast(color('gray-950'), color('blue-500'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast([255, 255, 255], color('blue-600'))).toBeGreaterThanOrEqual(4.5);
    const option = themeOptions.find((theme) => theme.id === id)!;
    expect(color('gray-950')).toEqual(channelsFromHex(option.colors[0]));
    expect(color('blue-500')).toEqual(channelsFromHex(option.colors[1]));
  });
});
