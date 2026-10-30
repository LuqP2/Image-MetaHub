import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromptFolders from '../components/promptLibrary/PromptFolders';
import { applyMutation } from '../services/promptLibrary/core.mjs';
import type { PromptLibraryMutation, PromptLibrarySnapshot } from '../types';

afterEach(cleanup);
function mountFolders() {
  let snapshot: PromptLibrarySnapshot = { prompts: [], blocks: [], folders: [{ id: 'a', name: 'Folder A' }, { id: 'b', name: 'Folder B' }] };
  const mutate = vi.fn(async (command: PromptLibraryMutation) => { snapshot = applyMutation(snapshot, command); return snapshot; });
  const props = { onChange: vi.fn(), onMutate: mutate, onRemove: vi.fn(), removing: false };
  const view = render(<PromptFolders {...props} folders={snapshot.folders!} value="a" />);
  return { mutate, get snapshot() { return snapshot; }, browse: (value: string) => view.rerender(<PromptFolders {...props} folders={snapshot.folders!} value={value} />), removeA: () => { snapshot = applyMutation(snapshot, { action: 'folder-remove', id: 'a' }); } };
}
describe('Prompt folder rename target', () => {
  it.each(['b', 'all', 'none'])('keeps renaming A after the browser switches to %s', async destination => {
    const state = mountFolders();
    fireEvent.click(screen.getByRole('button', { name: 'Rename folder' }));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Renamed A' } });
    state.browse(destination);
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    await waitFor(() => expect(screen.queryByLabelText('Folder name')).toBeNull());
    expect(state.mutate).toHaveBeenCalledWith({ action: 'folder-rename', id: 'a', name: 'Renamed A' });
    expect(state.snapshot.folders).toEqual([{ id: 'a', name: 'Renamed A' }, { id: 'b', name: 'Folder B' }]);
  });
  it('reports a deleted original target without renaming the newly browsed folder', async () => {
    const state = mountFolders(); fireEvent.click(screen.getByRole('button', { name: 'Rename folder' }));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Renamed A' } });
    state.removeA(); state.browse('b'); fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This folder no longer exists.');
    expect(state.snapshot.folders).toEqual([{ id: 'b', name: 'Folder B' }]);
  });
  it('changes the target only when Rename is explicitly opened for another folder', async () => {
    const state = mountFolders(); fireEvent.click(screen.getByRole('button', { name: 'Rename folder' }));
    state.browse('b'); fireEvent.click(screen.getByRole('button', { name: 'Rename folder' }));
    expect((screen.getByLabelText('Folder name') as HTMLInputElement).value).toBe('Folder B');
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Renamed B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    await waitFor(() => expect(screen.queryByLabelText('Folder name')).toBeNull());
    expect(state.mutate).toHaveBeenCalledWith({ action: 'folder-rename', id: 'b', name: 'Renamed B' });
    expect(state.snapshot.folders![0].name).toBe('Folder A');
  });
  it('keeps creating a new folder after navigating while its form is open', async () => {
    const state = mountFolders(); fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'New folder C' } }); state.browse('b');
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    await waitFor(() => expect(screen.queryByLabelText('Folder name')).toBeNull());
    expect(state.mutate).toHaveBeenCalledWith({ action: 'folder-create', name: 'New folder C' });
    expect(state.snapshot.folders!.map(folder => folder.name)).toEqual(['Folder A', 'Folder B', 'New folder C']);
  });
});
