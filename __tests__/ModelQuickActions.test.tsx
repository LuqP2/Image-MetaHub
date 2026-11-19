import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem, ModelManagerSnapshot } from '../services/modelLibrary/types';
const fakes = vi.hoisted(() => ({ command: vi.fn(), state: {} as ModelManagerSnapshot }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => fakes.state, runModelCommand: fakes.command, closeModelPicker: vi.fn(), installedVersions: vi.fn(), modelFolderWatchDefault: vi.fn() }));
vi.mock('../store/useImageStore', () => ({ useImageStore: vi.fn() }));
vi.mock('../hooks/useResolvedThumbnail', () => ({ useResolvedThumbnail: vi.fn() }));
vi.mock('../services/thumbnailManager', () => ({ thumbnailManager: {} }));
import { ModelQuickActions } from '../components/ModelManagerPanels';
const item = { location: { id: 'primary', sha256: 'a'.repeat(64), absolutePath: '/synthetic/model.safetensors' } } as ModelInspectorItem;
beforeEach(() => { fakes.command.mockReset().mockResolvedValue(undefined); fakes.state = { catalog: { locations: [item.location] }, watches: {}, progress: null } as ModelManagerSnapshot; });
afterEach(() => { cleanup(); useSettingsStore.setState({ language: 'en' }); });
describe('quick model actions', () => {
  it.each(languages)('checks HF-only links on another physical copy and keeps completion feedback visible in %s', async language => {
  useSettingsStore.setState({ language });
  const t = (key, values?) => formatMessage(language, key, values);
    fakes.state.catalog.locations.push({ ...item.location, id: 'copy', huggingFace: {} as NonNullable<ModelInspectorItem['location']['huggingFace']> });
    fakes.state.checkResult = { locationIds: ['primary'], message: 'Synthetic check completed' } as ModelManagerSnapshot['checkResult'];
    render(<ModelQuickActions item={item} />);
    expect(screen.getByRole('status').textContent).toBe('Synthetic check completed');
    fireEvent.click(screen.getByRole('button', { name: t('modelLibrary.checkUpdates') }));
    await waitFor(() => expect(fakes.command).toHaveBeenCalledExactlyOnceWith({ type: 'check', locationId: 'primary' }));
    expect(screen.queryByRole('button', { name: t('modelLibrary.identifyCivitai') })).toBeNull();
  });
  it.each(languages)('identifies only by explicit action and reports failures returned by reveal IPC in %s', async language => {
  useSettingsStore.setState({ language });
  const t = (key, values?) => formatMessage(language, key, values);
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { modelLibraryRevealLocation: vi.fn().mockResolvedValue({ success: false, error: 'Synthetic missing file' }) } });
    render(<ModelQuickActions item={item} />);
    expect(fakes.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('modelLibrary.identifyCivitai') }));
    await waitFor(() => expect(fakes.command).toHaveBeenCalledExactlyOnceWith({ type: 'identify', locationId: 'primary' }));
    fireEvent.click(screen.getByRole('button', { name: t('modelLibrary.showFolder') }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Synthetic missing file'));
  });
});

it.each(languages)('hides and unhides through local metadata commands in %s', async language => {
  useSettingsStore.setState({ language });
  const t = (key, values?) => formatMessage(language, key, values);
  const view = render(<ModelQuickActions item={item} />);
  fireEvent.click(screen.getByRole('button', { name: t('modelLibrary.hide') }));
  await waitFor(() => expect(fakes.command).toHaveBeenCalledWith({ type: 'saveLocal', locationId: 'primary', patch: { hidden: true } }));
  view.rerender(<ModelQuickActions item={{ ...item, localMetadata: { id: 'sha256:' + 'a'.repeat(64), tags: [], updatedAt: 1, hidden: true } }} />);
  fireEvent.click(screen.getByRole('button', { name: t('modelLibrary.unhide') }));
  await waitFor(() => expect(fakes.command).toHaveBeenCalledWith({ type: 'saveLocal', locationId: 'primary', patch: { hidden: false } }));
});
