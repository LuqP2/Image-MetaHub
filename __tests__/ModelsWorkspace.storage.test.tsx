import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem, ModelManagerSnapshot } from '../services/modelLibrary/types';

const fakes = vi.hoisted(() => ({ state: {} as ModelManagerSnapshot, open: vi.fn(), collection: vi.fn(), selection: vi.fn(), refresh: vi.fn(), scan: vi.fn(), message: vi.fn(), identify: vi.fn(), check: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({
  useModelManager: () => fakes.state, getModelManagerState: () => fakes.state, refreshModelStorage: () => fakes.refresh(), scanModelSources: () => fakes.scan(), managerMessage: fakes.message,
  requestModelRemoval: vi.fn(), removeModelFiles: vi.fn(), closeModelRemoval: vi.fn(), verifyModelDuplicates: vi.fn(),
  addModelSource: vi.fn(), cancelModelJob: vi.fn(), checkModelUpdates: fakes.check, identifyModels: fakes.identify, removeModelSource: vi.fn(), setModelInterval: vi.fn(), updateModelSource: vi.fn(),
  showModelUpdates: (show: boolean) => { fakes.state.showUpdates = show; }, unreadModelCount: () => 0,
}));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: vi.fn(), modelButton: '', modelInput: '' }));
vi.mock('../components/ModelUsagePanel', () => ({ default: () => null }));
vi.mock('../components/ModelDetailsPanels', () => ({ default: ({ item }: { item: ModelInspectorItem }) => <p>Details for {item.location.id}</p> }));
vi.mock('../components/UnifiedModelUpdatesPanel', () => ({ ModelUpdatesPanel: ({ locationIds }: { locationIds: string[] }) => <p>Update locations: {locationIds.join(',')}</p> }));
import ModelsWorkspace from '../components/ModelsWorkspace';

beforeEach(() => {
  for (const fake of [fakes.open, fakes.collection, fakes.selection, fakes.refresh, fakes.scan, fakes.check, fakes.identify]) fake.mockReset().mockResolvedValue({ success: true });
  const hash = 'a'.repeat(64);
  const locations = [
    { id: 'primary', fileName: 'model2.safetensors', sourceId: 'one', sourceName: 'One', sourceKind: 'checkpoint', size: 100, sha256: hash },
    { id: 'copy', fileName: 'model10.safetensors', sourceId: 'two', sourceName: 'Two', sourceKind: 'checkpoint', size: 300, sha256: hash },
    { id: 'lora', fileName: 'lora.safetensors', sourceId: 'two', sourceName: 'Two', sourceKind: 'lora', size: 200 },
  ].map((location) => ({ ...location, absolutePath: `/synthetic/${location.id}.safetensors`, relativePath: `${location.id}.safetensors`, modifiedAt: 1, createdAt: 1, discoveredAt: 1, lastSeenAt: 1 })) as ModelManagerSnapshot['catalog']['locations'];
  fakes.state = {
    revision: 1, sources: ['one', 'two'].map((id) => ({ id, name: id === 'one' ? 'One' : 'Two', path: `/synthetic/${id}`, kind: 'auto', recursive: true, createdAt: 1, updatedAt: 1 })),
    catalog: { version: 1, updatedAt: 1, locations }, localMetadata: {}, watches: {}, hfWatches: {}, usage: {}, intervalHours: 24,
    storage: { files: locations.map((location) => ({ key: location.id, path: location.absolutePath, locationIds: [location.id], size: location.size, sha256: location.sha256, stale: false, modifiedAt: 1 })), sources: [], checkedAt: 1 },
    loading: false, progress: null, message: null,
  } as ModelManagerSnapshot;
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { modelInspectorOpen: fakes.open, modelInspectorSyncCollection: fakes.collection, modelInspectorSyncSelection: fakes.selection } });
});
afterEach(cleanup);
const enterStorage = async () => { fireEvent.click(screen.getByRole('button', { name: 'Storage' })); await waitFor(() => expect(fakes.refresh).toHaveBeenCalled()); await act(async () => {}); };
const storageRow = (name: string) => within(screen.getByRole('table')).getByText(name, { exact: true }).closest('tr')!;

describe('Storage workspace and Inspector integration', () => {
  it('opens non-primary copies and uses Storage order despite hidden Catalog filters', async () => {
    render(<ModelsWorkspace />);
    fireEvent.change(screen.getByPlaceholderText('Search models…'), { target: { value: 'not in catalog' } });
    await enterStorage();
    await waitFor(() => expect(fakes.collection.mock.calls.at(-1)?.[0].items.map((item: ModelInspectorItem) => item.location.id)).toEqual(['copy', 'lora', 'primary']));
    fireEvent.click(storageRow('model10'));
    expect(screen.getByText('Details for copy')).toBeTruthy();
    await waitFor(() => expect(fakes.selection).toHaveBeenLastCalledWith('copy'));
    fireEvent.doubleClick(storageRow('model10'));
    await waitFor(() => expect(fakes.open).toHaveBeenCalledOnce());
    expect(fakes.open.mock.calls[0][0].selectedId).toBe('copy');
    expect(fakes.open.mock.calls[0][0].items.map((item: ModelInspectorItem) => item.location.id)).toEqual(['copy', 'lora', 'primary']);
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Model' }));
    await waitFor(() => expect(fakes.collection.mock.calls.at(-1)?.[0].items.map((item: ModelInspectorItem) => item.location.id)).toEqual(['lora', 'primary', 'copy']));
    fireEvent.change(screen.getByLabelText('Search storage'), { target: { value: 'lora' } });
    expect(screen.getByText('This file is outside the current filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Inspector' }));
    await waitFor(() => expect(fakes.open).toHaveBeenCalledTimes(2));
    expect(fakes.open.mock.calls[1][0].items.map((item: ModelInspectorItem) => item.location.id)).toEqual(['lora', 'copy']);
  });
  it('shares folder/type filters with updates and preserves tab, selection and scroll', async () => {
    const view = render(<ModelsWorkspace />);
    await enterStorage();
    fireEvent.click(storageRow('model10'));
    fireEvent.change(screen.getByLabelText('Model folder'), { target: { value: 'two' } });
    expect(screen.queryByLabelText('Storage folder')).toBeNull();
    expect(screen.queryByLabelText('Storage type')).toBeNull();
    expect(within(screen.getByRole('table')).queryByText('model2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /LoRAs/ }));
    expect(screen.getByRole('button', { name: 'Storage' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 files · 1 selected · 1 outside current filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /What's new/ }));
    view.rerender(<ModelsWorkspace />);
    expect(screen.getByText('Update locations: lora')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /All types/ }));
    expect(screen.getByRole('button', { name: /What's new/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Update locations: primary,copy,lora')).toBeTruthy();
    await enterStorage();
    expect(screen.getByText('2 files · 1 selected')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Model' }));
    const scroll = screen.getByLabelText('Model storage table');
    scroll.scrollTop = 16; fireEvent.scroll(scroll);
    // A viewport shorter than the rows is covered by the dedicated geometry test.
    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }));
    await enterStorage();
    expect(screen.getByLabelText('Select /synthetic/copy.safetensors')).toHaveProperty('checked', true);
    expect(fakes.identify).not.toHaveBeenCalled(); expect(fakes.check).not.toHaveBeenCalled(); expect(fakes.scan).not.toHaveBeenCalled();
  });
  it('serializes collection before selection and keeps the latest rapidly clicked row', async () => {
    render(<ModelsWorkspace />); await enterStorage();
    await waitFor(() => expect(fakes.collection).toHaveBeenCalled());
    const log: string[] = [];
    let release!: () => void;
    fakes.collection.mockImplementationOnce(() => { log.push('collection'); return new Promise((resolve) => { release = () => resolve({ success: true }); }); });
    fakes.selection.mockImplementation((id: string) => { log.push(`selection:${id}`); return Promise.resolve({ success: true }); });
    fireEvent.click(storageRow('model10'));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.click(storageRow('lora'));
    await act(async () => { release(); });
    await waitFor(() => expect(fakes.selection).toHaveBeenLastCalledWith('lora'));
    expect(log).toEqual(['collection', 'selection:lora']);
  });
  it('keeps an overlapping path active after changing its source representative and opens it once', async () => {
    const original = fakes.state.catalog.locations[0];
    fakes.state.catalog.locations = [...fakes.state.catalog.locations, { ...original, id: 'overlap', sourceId: 'two', sourceName: 'Two' }];
    fakes.state.storage!.files[0].locationIds.push('overlap');
    render(<ModelsWorkspace />); await enterStorage();
    fireEvent.click(storageRow('model2'));
    fireEvent.change(screen.getByLabelText('Model folder'), { target: { value: 'two' } });
    await waitFor(() => expect(fakes.collection.mock.calls.at(-1)?.[0].items.some((item: ModelInspectorItem) => item.location.id === 'overlap')).toBe(true));
    expect(screen.queryByText('This file is outside the current filters.')).toBeNull();
    expect(storageRow('model2').getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Open Inspector' }));
    await waitFor(() => expect(fakes.open).toHaveBeenCalledOnce());
    expect(fakes.open.mock.calls[0][0].selectedId).toBe('overlap');
    expect(fakes.open.mock.calls[0][0].items.filter((item: ModelInspectorItem) => item.location.absolutePath === original.absolutePath)).toHaveLength(1);
  });
  it('resizes details by keyboard, preserves width while toggling and clamps its limits', () => {
    render(<ModelsWorkspace />);
    let separator = screen.getByRole('separator', { name: 'Resize model details' });
    expect(separator.getAttribute('aria-valuenow')).toBe('360');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' }); expect(separator.getAttribute('aria-valuenow')).toBe('376');
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    separator = screen.getByRole('separator', { name: 'Resize model details' }); expect(separator.getAttribute('aria-valuenow')).toBe('376');
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('480');
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('320');
  });
});
