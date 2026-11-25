import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BatchExportModal from '../components/BatchExportModal';
import type { IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTeamWorkspaceStore } from '../store/useTeamWorkspaceStore';
import { reduceTeamOps } from '../services/team/teamOpsReducer';
import type { TeamWorkspaceSummary } from '../services/team/teamWorkspaceTypes';

vi.mock('../services/userDataPersistenceAdapter', () => ({ getPersistedShadowMetadata: async () => null }));

const images = ['first.png', 'second.png'].map((name, index) => ({ id: String(index), name, directoryId: 'fixture' }) as IndexedImage);
const completed = { success: true, exportedCount: 1, failedCount: 0 };
const api = {
  team: { writeAuditReports: vi.fn() },
  showSaveDialog: vi.fn(), showDirectoryDialog: vi.fn(),
  exportBatchToFolder: vi.fn(), exportBatchToZip: vi.fn(), showItemInFolder: vi.fn(),
};

function setup(count = 1, options: { name?: string } = {}) {
  const selected = images.slice(0, count).map(image => ({ ...image, name: options.name ?? image.name }));
  const closed = vi.fn();
  function Parent() {
    const [open, setOpen] = useState(true);
    return <BatchExportModal isOpen={open} onClose={() => { closed(); setOpen(false); }}
      selectedImageIds={new Set(selected.map(image => image.id))} filteredImages={selected}
      directories={[{ id: 'fixture', path: 'D:/synthetic-input' }]} />;
  }
  render(<Parent />);
  return closed;
}

beforeEach(() => {
  useSettingsStore.setState({ language: 'en' });
  useTeamWorkspaceStore.setState({ workspacesById: {}, assetStatesByWorkspace: {} });
  vi.clearAllMocks();
  api.showSaveDialog.mockResolvedValue({ success: true, path: 'D:/exports/result.png' });
  api.showDirectoryDialog.mockResolvedValue({ success: true, path: 'D:/exports' });
  api.exportBatchToFolder.mockResolvedValue(completed);
  api.exportBatchToZip.mockResolvedValue(completed);
  vi.stubGlobal('electronAPI', api);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('export destination and completion', () => {
  it('exports the approved subset as a single file and writes its audit reports beside it', async () => {
    const workspace = {
      rootPath: 'D:/synthetic-input', manifest: { workspaceId: 'ws', name: 'Synthetic workspace' },
    } as TeamWorkspaceSummary;
    const states = reduceTeamOps([{
      type: 'set_review_status', workspaceId: 'ws', assetKey: 'p:first.png', relativePath: 'first.png',
      contentHash: null, opId: 'approved', deviceId: 'synthetic', lamportClock: 1,
      createdAt: '2026-11-25T00:00:00Z', status: 'approved', baseOpId: null,
    }]);
    useTeamWorkspaceStore.setState({ workspacesById: { ws: workspace }, assetStatesByWorkspace: { ws: Object.fromEntries(states) } });
    const closed = setup(2);
    fireEvent.click(screen.getByRole('checkbox', { name: /Client Delivery Pack/ }));
    fireEvent.change(screen.getByLabelText('File path'), { target: { value: 'D:/exports/approved.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(api.exportBatchToFolder).toHaveBeenCalledWith(expect.objectContaining({
      destFilePath: 'D:/exports/approved.png', metadataPolicy: 'strip',
      files: [expect.objectContaining({ imageId: '0' })],
    }));
    expect(api.team.writeAuditReports).toHaveBeenCalledWith(expect.objectContaining({
      destDir: 'D:/exports/', csvContent: expect.stringContaining('first.png'),
    }));
  });

  it('selects a file for one image, closes, and keeps a working reveal action after closing', async () => {
    const closed = setup();
    expect(screen.getByRole('button', { name: 'File', exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Destination folder' }));
    await waitFor(() => expect((screen.getByLabelText('File path') as HTMLInputElement).value).toBe('D:/exports/result.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(api.exportBatchToFolder).toHaveBeenCalledWith(expect.objectContaining({ destFilePath: 'D:/exports/result.png', scope: 'single' }));
    expect(api.showDirectoryDialog).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Exported 1 image.');
    fireEvent.click(screen.getByRole('button', { name: 'Go to folder' }));
    expect(api.showItemInFolder).toHaveBeenCalledWith('D:/exports/result.png');
    act(() => useSettingsStore.setState({ language: 'pt-BR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar notificação' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismisses the completion notification after seven seconds', async () => {
    vi.useFakeTimers();
    setup();
    fireEvent.change(screen.getByLabelText('File path'), { target: { value: 'D:/exports/result.png' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true })); });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(6999));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('accepts a typed single-file path without another dialog', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('File path'), { target: { value: 'D:/exports/custom.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(api.exportBatchToFolder).toHaveBeenCalledWith(expect.objectContaining({ destFilePath: 'D:/exports/custom.png' })));
    expect(api.showSaveDialog).not.toHaveBeenCalled();
  });

  it('uses the save dialog for a ZIP containing multiple images', async () => {
    setup(2);
    api.showSaveDialog.mockResolvedValue({ success: true, path: 'D:/exports/archive.zip' });
    fireEvent.click(screen.getByRole('button', { name: 'ZIP', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(api.exportBatchToZip).toHaveBeenCalledWith(expect.objectContaining({ destZipPath: 'D:/exports/archive.zip' })));
    expect(api.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'ImageMetaHub-Export.zip', filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] }));
    expect(api.showDirectoryDialog).not.toHaveBeenCalled();
  });

  it('keeps the folder picker for multiple unpacked images and accepts typed folders', async () => {
    setup(2);
    fireEvent.click(screen.getByRole('button', { name: 'Destination folder' }));
    await waitFor(() => expect((screen.getByLabelText('Folder path') as HTMLInputElement).value).toBe('D:/exports'));
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: 'D:/exports/batch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(api.exportBatchToFolder).toHaveBeenCalledWith(expect.objectContaining({ destDir: 'D:/exports/batch', scope: 'selected' })));
    expect(api.showDirectoryDialog).toHaveBeenCalledOnce();
    expect(api.showSaveDialog).not.toHaveBeenCalled();
  });

  it('returns to the modal when the native picker is canceled', async () => {
    const closed = setup();
    api.showSaveDialog.mockResolvedValue({ canceled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(api.showSaveDialog).toHaveBeenCalledOnce());
    expect(api.exportBatchToFolder).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps partial failures visible and does not auto-close', async () => {
    const closed = setup(2);
    api.exportBatchToFolder.mockResolvedValue({ ...completed, failedCount: 1 });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: 'D:/exports' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    expect(await screen.findByText(/1 failure/)).toBeTruthy();
    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('suggests the converted extension and clears the stale path after changing format', async () => {
    setup(1, { name: 'photo.jpg' });
    fireEvent.change(screen.getByLabelText('File path'), { target: { value: 'D:/exports/photo.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as MetaHub + A1111' }));
    expect((screen.getByLabelText('File path') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Destination folder' }));
    await waitFor(() => expect(api.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'photo.png', filters: [{ name: 'PNG', extensions: ['png'] }] })));
  });

  it('retains the AVIF extension for MetaHub metadata export', async () => {
    setup(1, { name: 'photo.avif' });
    fireEvent.click(screen.getByRole('button', { name: 'Save as MetaHub + A1111' }));
    fireEvent.click(screen.getByRole('button', { name: 'Destination folder' }));
    await waitFor(() => expect(api.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'photo.avif', filters: [{ name: 'AVIF', extensions: ['avif'] }] })));
  });
});
