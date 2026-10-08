import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem, ModelLocation } from '../services/modelLibrary/types';

const fakes = vi.hoisted(() => ({ command: vi.fn(), manager: { catalog: { locations: [] as ModelLocation[] }, loading: false, progress: null } }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => fakes.manager }));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: (command: unknown) => fakes.command(command), modelButton: '', modelInput: '' }));
import { HuggingFaceModelPanel } from '../components/HuggingFaceModelPanel';

const makeItem = (id = 'synthetic', sha256?: string): ModelInspectorItem => ({ location: { id, sourceId: 's', sourceName: 'Models', sourceKind: 'lora', absolutePath: `/synthetic/${id}.safetensors`, relativePath: `${id}.safetensors`, fileName: `${id}.safetensors`, size: 100, createdAt: 1, modifiedAt: 1, discoveredAt: 1, lastSeenAt: 1, sha256 } });
const lookup = { repoId: 'owner/repo', revision: 'main', resolvedCommit: 'b'.repeat(40), fetchedAt: 1, files: [{ path: 'one.safetensors', size: 100, fingerprint: `lfs:sha256:${'a'.repeat(64)}`, lfsSha256: 'a'.repeat(64) }, { path: 'folder/two.safetensors', size: 200, fingerprint: `git:oid:${'c'.repeat(40)}` }] };
beforeEach(() => { fakes.command.mockReset().mockResolvedValue(lookup); fakes.manager = { catalog: { locations: [] }, loading: false, progress: null }; });
afterEach(cleanup);

describe('Hugging Face binding interactions', () => {
  it('looks up public files, allows selection and saves only after explicit confirmation', async () => {
    render(<HuggingFaceModelPanel item={makeItem()} />);
    expect(fakes.command).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Repository or file URL'), { target: { value: 'https://huggingface.co/owner/repo' } });
    fireEvent.click(screen.getByText('Look up public files'));
    await waitFor(() => expect(screen.getByText('Confirm manual link')).toBeTruthy());
    expect(fakes.command).toHaveBeenCalledExactlyOnceWith({ type: 'lookupHF', locationId: 'synthetic', repoId: 'owner/repo', revision: 'main', filePath: '' });
    fireEvent.change(screen.getByLabelText('Choose a .safetensors file'), { target: { value: 'folder/two.safetensors' } });
    expect(screen.getByText(/No LFS SHA-256 available/)).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm manual link'));
    await waitFor(() => expect(fakes.command).toHaveBeenLastCalledWith({ type: 'bindHF', locationId: 'synthetic', repoId: 'owner/repo', revision: 'main', filePath: 'folder/two.safetensors', fingerprint: `git:oid:${'c'.repeat(40)}` }));
  });
  it('accepts corrected slash revisions and invalidates the preview when the target changes', async () => {
    render(<HuggingFaceModelPanel item={makeItem()} />);
    fireEvent.change(screen.getByLabelText('Repository or file URL'), { target: { value: 'https://huggingface.co/owner/repo/resolve/release/v1/one.safetensors' } });
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'release/v1' } });
    fireEvent.change(screen.getByLabelText('File path (leave empty to browse)'), { target: { value: 'one.safetensors' } });
    fireEvent.click(screen.getByText('Look up public files'));
    await waitFor(() => expect(fakes.command).toHaveBeenLastCalledWith({ type: 'lookupHF', locationId: 'synthetic', repoId: 'owner/repo', revision: 'release/v1', filePath: 'one.safetensors' }));
    await waitFor(() => expect(screen.getByText('Confirm manual link')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'main' } });
    expect(screen.queryByText('Confirm manual link')).toBeNull();
  });
  it('routes verification and unlink to the selected copy without exposing HF monitoring', async () => {
    const first = makeItem('one', 'a'.repeat(64)), second = makeItem('two', 'a'.repeat(64));
    second.location.huggingFace = { repoId: 'other/repo', filePath: 'model.safetensors', linkedRevision: 'main', resolvedCommit: 'b'.repeat(40), linkedRemoteFingerprint: 'git:oid:' + 'c'.repeat(40), size: 100, verification: 'manual', fetchedAt: 1 };
    fakes.manager.catalog.locations = [first.location, second.location];
    render(<HuggingFaceModelPanel item={first} />);
    fireEvent.change(screen.getByLabelText('File location'), { target: { value: 'two' } });
    expect(screen.getByText('other/repo')).toBeTruthy();
    expect(screen.queryByText(/monitoring/i)).toBeNull();
    fireEvent.click(screen.getByText('Verify file match'));
    await waitFor(() => expect(fakes.command).toHaveBeenLastCalledWith({ type: 'verifyHF', locationId: 'two' }));
    fireEvent.click(screen.getByText('Remove Hugging Face link'));
    await waitFor(() => expect(fakes.command).toHaveBeenLastCalledWith({ type: 'unbindHF', locationId: 'two' }));
  });
  it('discards a lookup response after switching to another copy', async () => {
    const first = makeItem('one', 'a'.repeat(64)), second = makeItem('two', 'a'.repeat(64));
    fakes.manager.catalog.locations = [first.location, second.location];
    let finish!: (value: typeof lookup) => void;
    fakes.command.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<HuggingFaceModelPanel item={first} />);
    fireEvent.change(screen.getByLabelText('Repository or file URL'), { target: { value: 'https://huggingface.co/owner/repo' } });
    fireEvent.click(screen.getByText('Look up public files'));
    fireEvent.change(screen.getByLabelText('File location'), { target: { value: 'two' } });
    await act(async () => { finish(lookup); });
    expect(screen.queryByText('Confirm manual link')).toBeNull();
    expect((screen.getByLabelText('Repository') as HTMLInputElement).value).toBe('');
  });
  it('shows failures without dropping the current binding', async () => {
    const item = makeItem();
    item.location.huggingFace = { repoId: 'owner/repo', filePath: 'one.safetensors', linkedRevision: 'main', resolvedCommit: 'b'.repeat(40), linkedRemoteFingerprint: lookup.files[0].fingerprint, verification: 'manual', size: 100, fetchedAt: 1 };
    fakes.command.mockRejectedValue(new Error('Public file unavailable'));
    render(<HuggingFaceModelPanel item={item} />);
    fireEvent.click(screen.getByText('Verify file match'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Public file unavailable'));
    expect(screen.getByText('owner/repo')).toBeTruthy();
    expect(screen.getByText('Manual link · file match not verified')).toBeTruthy();
  });
});
