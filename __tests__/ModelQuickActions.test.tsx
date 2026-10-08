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
afterEach(cleanup);
describe('quick model actions', () => {
  it('checks HF-only links on another physical copy and keeps completion feedback visible', async () => {
    fakes.state.catalog.locations.push({ ...item.location, id: 'copy', huggingFace: {} as NonNullable<ModelInspectorItem['location']['huggingFace']> });
    fakes.state.checkResult = { locationIds: ['primary'], message: 'Synthetic check completed' } as ModelManagerSnapshot['checkResult'];
    render(<ModelQuickActions item={item} />);
    expect(screen.getByRole('status').textContent).toBe('Synthetic check completed');
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(fakes.command).toHaveBeenCalledExactlyOnceWith({ type: 'check', locationId: 'primary' }));
    expect(screen.queryByRole('button', { name: 'Identify on Civitai' })).toBeNull();
  });
  it('identifies only by explicit action and reports failures returned by reveal IPC', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { modelLibraryRevealLocation: vi.fn().mockResolvedValue({ success: false, error: 'Synthetic missing file' }) } });
    render(<ModelQuickActions item={item} />);
    expect(fakes.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Identify on Civitai' }));
    await waitFor(() => expect(fakes.command).toHaveBeenCalledExactlyOnceWith({ type: 'identify', locationId: 'primary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Synthetic missing file'));
  });
});
