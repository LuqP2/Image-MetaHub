import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelManagerSnapshot } from '../services/modelLibrary/types';

const fakes = vi.hoisted(() => ({ state: {} as ModelManagerSnapshot, refresh: vi.fn(), remove: vi.fn(), request: vi.fn(), verify: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => fakes.state, refreshModelStorage: () => fakes.refresh(), removeModelFiles: (ids: string[]) => fakes.remove(ids), requestModelRemoval: (ids: string[], selected: boolean) => fakes.request(ids, selected), verifyModelDuplicates: () => fakes.verify(), closeModelRemoval: vi.fn(), scanModelSources: vi.fn(), managerMessage: vi.fn() }));
vi.mock('../components/ModelManagerPanels', () => ({ modelButton: '', modelInput: '' }));
import ModelStoragePanel, { ModelRemovalDialog } from '../components/ModelStoragePanel';

beforeEach(() => {
  fakes.refresh.mockReset().mockResolvedValue(undefined); fakes.remove.mockReset().mockResolvedValue(undefined); fakes.request.mockReset(); fakes.verify.mockReset();
  fakes.state = { revision: 1, sources: [], catalog: { version: 1, updatedAt: 1, locations: [
    { id: 'ready', absolutePath: '/synthetic/ready.safetensors', fileName: 'ready.safetensors', sourceKind: 'checkpoint', size: 100 },
    { id: 'partial', absolutePath: '/synthetic/partial.safetensors', fileName: 'partial.safetensors', sourceKind: 'checkpoint', size: 100 },
    { id: 'unsupported', absolutePath: '/synthetic/unsupported.safetensors', fileName: 'unsupported.safetensors', sourceKind: 'vae', size: 100 },
  ] }, usage: { 'location:ready': { status: 'ready', totalCount: 0 }, 'location:partial': { status: 'partial', totalCount: 0 }, 'location:unsupported': { status: 'unsupported', totalCount: 0 } }, storage: { files: ['ready', 'partial', 'unsupported'].map((id) => ({ key: id, path: `/synthetic/${id}.safetensors`, locationIds: [id], size: 100, modifiedAt: 1, stale: false })), sources: [], checkedAt: 1 }, localMetadata: {}, watches: {}, loading: false, progress: null } as unknown as ModelManagerSnapshot;
});
afterEach(cleanup);
describe('Storage selection and removal choices', () => {
  it('opens without hashing and includes only ready supported zero matches in the no-match filter', async () => {
    await act(async () => { render(<ModelStoragePanel select={vi.fn()} active />); });
    expect(fakes.refresh).toHaveBeenCalledOnce(); expect(fakes.verify).not.toHaveBeenCalled(); expect(fakes.remove).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Storage filter'), { target: { value: 'unmatched' } });
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByRole('button', { name: 'ready' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'partial' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'unsupported' })).toBeNull();
  });
  it('keeps Storage selection across view switches and requests only selected paths', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<ModelStoragePanel select={vi.fn()} active />); });
    fireEvent.click(screen.getByLabelText('Select /synthetic/ready.safetensors'));
    await act(async () => { view!.rerender(<ModelStoragePanel select={vi.fn()} active={false} />); });
    await act(async () => { view!.rerender(<ModelStoragePanel select={vi.fn()} active />); });
    fireEvent.click(screen.getByRole('button', { name: /Remove selected/ }));
    expect(fakes.request).toHaveBeenCalledExactlyOnceWith(['ready'], true);
    expect(fakes.remove).not.toHaveBeenCalled();
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
