import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelManagerSnapshot } from '../services/modelLibrary/types';

const fakes = vi.hoisted(() => ({ state: {} as ModelManagerSnapshot, refresh: vi.fn(), remove: vi.fn(), request: vi.fn(), verify: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => fakes.state, refreshModelStorage: () => fakes.refresh(), removeModelFiles: (ids: string[]) => fakes.remove(ids), requestModelRemoval: (ids: string[], selected: boolean) => fakes.request(ids, selected), verifyModelDuplicates: () => fakes.verify(), closeModelRemoval: vi.fn(), scanModelSources: vi.fn(), managerMessage: vi.fn() }));
vi.mock('../components/ModelManagerPanels', () => ({ modelButton: '', modelInput: '' }));
import ModelStoragePanel, { ModelRemovalDialog } from '../components/ModelStoragePanel';
const storageProps = { select: vi.fn(), openInspector: vi.fn(), folder: 'all', kind: 'all', selectedId: null, clearSharedFilters: vi.fn(), onCollection: vi.fn(), addFolder: vi.fn() };

beforeEach(() => {
  fakes.refresh.mockReset().mockResolvedValue(undefined); fakes.remove.mockReset().mockResolvedValue(undefined); fakes.request.mockReset(); fakes.verify.mockReset();
  fakes.state = { revision: 1, sources: [], catalog: { version: 1, updatedAt: 1, locations: [
    { id: 'ready', absolutePath: '/synthetic/ready.safetensors', fileName: 'ready.safetensors', sourceKind: 'checkpoint', size: 100 },
    { id: 'partial', absolutePath: '/synthetic/partial.safetensors', fileName: 'partial.safetensors', sourceKind: 'checkpoint', size: 100 },
    { id: 'unsupported', absolutePath: '/synthetic/unsupported.safetensors', fileName: 'unsupported.safetensors', sourceKind: 'vae', size: 100 },
  ] }, usage: { 'location:ready': { status: 'ready', totalCount: 0 }, 'location:partial': { status: 'partial', totalCount: 0 }, 'location:unsupported': { status: 'unsupported', totalCount: 0 } }, storage: { files: ['ready', 'partial', 'unsupported'].map((id) => ({ key: id, path: `/synthetic/${id}.safetensors`, locationIds: [id], size: 100, modifiedAt: 1, stale: false })), sources: [], checkedAt: 1 }, localMetadata: {}, watches: {}, loading: false, progress: null } as unknown as ModelManagerSnapshot;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Storage selection and removal choices', () => {
  it('opens without hashing and includes only ready supported zero matches in the no-match filter', async () => {
    await act(async () => { render(<ModelStoragePanel {...storageProps} active />); });
    expect(fakes.refresh).toHaveBeenCalledOnce(); expect(fakes.verify).not.toHaveBeenCalled(); expect(fakes.remove).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Storage filter'), { target: { value: 'unmatched' } });
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('ready')).toBeTruthy();
    expect(screen.queryByText('partial')).toBeNull();
    expect(screen.queryByText('unsupported')).toBeNull();
  });
  it('keeps Storage selection across view switches and requests only selected paths', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ModelStoragePanel {...storageProps} active />); });
    fireEvent.click(screen.getByLabelText('Select /synthetic/ready.safetensors'));
    await act(async () => { view!.rerender(<ModelStoragePanel {...storageProps} active={false} />); });
    await act(async () => { view!.rerender(<ModelStoragePanel {...storageProps} active />); });
    fireEvent.click(screen.getByRole('button', { name: /Remove selected/ }));
    expect(fakes.request).toHaveBeenCalledExactlyOnceWith(['ready'], true);
    expect(fakes.remove).not.toHaveBeenCalled();
  });
  it('selects whole rows, toggles with modifiers and checkboxes, and opens Inspector once on double click', async () => {
    const select = vi.fn(), openInspector = vi.fn();
    await act(async () => { render(<ModelStoragePanel {...storageProps} select={select} openInspector={openInspector} active />); });
    const row = (name: string) => screen.getByText(name, { exact: true }).closest('tr')!;
    fireEvent.click(row('ready'));
    expect(screen.getByLabelText('Select /synthetic/ready.safetensors')).toHaveProperty('checked', true);
    expect(select).toHaveBeenLastCalledWith('ready');
    fireEvent.click(row('partial'), { ctrlKey: true });
    expect(screen.getByLabelText('Select /synthetic/ready.safetensors')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Select /synthetic/partial.safetensors')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByLabelText('Select /synthetic/unsupported.safetensors'));
    expect(screen.getByText('3 files · 3 selected')).toBeTruthy();
    fireEvent.click(row('partial'), { metaKey: true });
    expect(screen.getByLabelText('Select /synthetic/partial.safetensors')).toHaveProperty('checked', false);
    fireEvent.doubleClick(screen.getByLabelText('Select /synthetic/ready.safetensors'));
    expect(openInspector).not.toHaveBeenCalled();
    fireEvent.doubleClick(row('ready'));
    expect(openInspector).toHaveBeenCalledExactlyOnceWith('ready');
  });
  it('keeps hidden selections, supports intervals and clears only filtered selections from the header', async () => {
    await act(async () => { render(<ModelStoragePanel {...storageProps} active />); });
    fireEvent.click(screen.getByText('partial', { exact: true }).closest('tr')!);
    fireEvent.click(screen.getByText('unsupported', { exact: true }).closest('tr')!, { shiftKey: true });
    expect(screen.getByText('3 files · 3 selected')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search storage'), { target: { value: 'ready' } });
    expect(screen.getByText('1 files · 3 selected · 2 outside current filters')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select filtered files'));
    expect(screen.getByText('1 files · 2 selected · 2 outside current filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('1 files · 0 selected')).toBeTruthy();
  });
  it('selects non-rendered filtered files and prunes stale or removed files after refresh', async () => {
    const location = fakes.state.catalog.locations[0];
    fakes.state.catalog.locations = Array.from({ length: 100 }, (_, index) => ({ ...location, id: `item${index}`, fileName: `item${index}.safetensors`, absolutePath: `/synthetic/item${index}.safetensors` }));
    fakes.state.storage!.files = fakes.state.catalog.locations.map((entry) => ({ key: entry.id, path: entry.absolutePath, locationIds: [entry.id], size: 100, modifiedAt: 1, stale: false }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ModelStoragePanel {...storageProps} active />); });
    expect(screen.queryByText('item99', { exact: true })).toBeNull();
    fireEvent.click(screen.getByLabelText('Select filtered files'));
    expect(screen.getByText('100 files · 100 selected')).toBeTruthy();
    fakes.state.storage = { ...fakes.state.storage!, files: [{ ...fakes.state.storage!.files[0], stale: true }, ...fakes.state.storage!.files.slice(1, -1)] };
    await act(async () => { view!.rerender(<ModelStoragePanel {...storageProps} active />); });
    expect(screen.getByText('99 files · 98 selected')).toBeTruthy();
  });
  it('measures its viewport, navigates virtualized rows, restores scroll and uses density height', async () => {
    const location = fakes.state.catalog.locations[0];
    fakes.state.catalog.locations = Array.from({ length: 100 }, (_, index) => ({ ...location, id: `item${index}`, fileName: `item${index}.safetensors`, absolutePath: `/synthetic/item${index}.safetensors` }));
    fakes.state.storage!.files = fakes.state.catalog.locations.map((entry) => ({ key: entry.id, path: entry.absolutePath, locationIds: [entry.id], size: 100, modifiedAt: 1, stale: false }));
    let resize!: () => void;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const openInspector = vi.fn();
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ModelStoragePanel {...storageProps} openInspector={openInspector} active />); });
    const scroll = screen.getByLabelText('Model storage table');
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 152 });
    act(() => resize());
    expect(screen.queryByText('item20', { exact: true })).toBeNull();
    fireEvent.keyDown(scroll, { key: 'ArrowDown' });
    for (let index = 0; index < 20; index += 1) fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', ctrlKey: true });
    const focused = document.activeElement!;
    expect(focused.tagName).toBe('TR'); expect(within(focused as HTMLElement).getByText('item20')).toBeTruthy();
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(screen.getByText('100 files · 1 selected')).toBeTruthy();
    fireEvent.keyDown(focused, { key: ' ' }); expect(screen.getByText('100 files · 2 selected')).toBeTruthy();
    fireEvent.keyDown(focused, { key: 'Enter' }); expect(openInspector).toHaveBeenLastCalledWith('item20');
    const savedScroll = scroll.scrollTop;
    await act(async () => { view!.rerender(<ModelStoragePanel {...storageProps} openInspector={openInspector} active={false} />); });
    scroll.scrollTop = 0; fireEvent.scroll(scroll);
    await act(async () => { view!.rerender(<ModelStoragePanel {...storageProps} openInspector={openInspector} active />); });
    expect(scroll.scrollTop).toBe(savedScroll);
    fireEvent.change(screen.getByLabelText('Storage density'), { target: { value: 'comfortable' } });
    expect(screen.getByText('item0', { exact: true }).closest('tr')!.style.height).toBe('80px');
    expect(scroll.scrollTop).toBe(0);
    fireEvent.change(screen.getByLabelText('Search storage'), { target: { value: 'item20' } });
    fireEvent.keyDown(screen.getByLabelText('Search storage'), { key: 'a', ctrlKey: true });
    expect(screen.getByText('1 files · 2 selected · 1 outside current filters')).toBeTruthy();
    expect(fakes.verify).not.toHaveBeenCalled();
  });
  it('shows unavailable errors, permits inspection while busy, and isolates context menu actions', async () => {
    fakes.state.storage!.files[0].stale = true;
    let view: ReturnType<typeof render>;
    const openInspector = vi.fn(), select = vi.fn(), reveal = vi.fn().mockResolvedValue({ success: true }), copy = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { modelLibraryRevealLocation: reveal, copyTextToClipboard: copy } });
    await act(async () => { view = render(<ModelStoragePanel {...storageProps} select={select} openInspector={openInspector} active />); });
    expect(screen.getByText('Unavailable', { exact: true })).toBeTruthy();
    expect(screen.getByLabelText('Select /synthetic/ready.safetensors')).toHaveProperty('disabled', true);
    const row = screen.getByText('ready', { exact: true }).closest('tr')!;
    fireEvent.click(row); expect(select).toHaveBeenLastCalledWith('ready');
    fireEvent.doubleClick(row); expect(openInspector).toHaveBeenLastCalledWith('ready');
    fireEvent.click(screen.getByText('partial', { exact: true }).closest('tr')!);
    fireEvent.contextMenu(row, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    await act(async () => {});
    expect(copy).toHaveBeenCalledExactlyOnceWith('/synthetic/ready.safetensors');
    expect(screen.getByText('3 files · 1 selected')).toBeTruthy();
    fakes.state.progress = { kind: 'scan', current: 0, total: 1, name: '' };
    await act(async () => { view!.rerender(<ModelStoragePanel {...storageProps} select={select} openInspector={openInspector} active />); });
    fireEvent.click(screen.getByText('unsupported', { exact: true }).closest('tr')!);
    expect(select).toHaveBeenLastCalledWith('unsupported');
    expect(screen.getByText('3 files · 1 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remove selected/ })).toHaveProperty('disabled', true);
  });
  it('requires explicit copy selection in the model removal dialog', async () => {
    fakes.state.removal = { locationIds: ['ready', 'partial'], selected: false };
    render(<ModelRemovalDialog />);
    const review = screen.getByRole('button', { name: 'Review in system dialog…' }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    await act(async () => { fireEvent.click(review); });
    expect(fakes.remove).toHaveBeenCalledExactlyOnceWith(['ready']);
  });
  it('makes all-copy selection deliberate and does not remove files before review', async () => {
    fakes.state.removal = { locationIds: ['ready', 'partial'], selected: false };
    render(<ModelRemovalDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove all copies' }));
    expect(fakes.remove).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review in system dialog…' })); });
    expect(fakes.remove).toHaveBeenCalledExactlyOnceWith(['ready', 'partial']);
  });
});
