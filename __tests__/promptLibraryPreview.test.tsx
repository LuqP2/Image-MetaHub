import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePromptLibraryPreview } from '../hooks/usePromptLibraryPreview';
import { linkSessionPreview, duplicateSessionPreview, removeSessionPreview } from '../services/promptLibrary/sessionPreviews';
import { emptyEditor } from '../services/promptLibrary/core.mjs';
import type { SavedPrompt } from '../types';
const item = (id: string): SavedPrompt => ({ id, createdAt: 1, sourceCreatedAt: null, source: null, positivePrompt: 'synthetic', negativePrompt: '', textBasis: 'authored', revision: 1, editor: emptyEditor() });
beforeEach(() => { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() }); });
afterEach(() => { cleanup(); delete window.electronAPI; vi.restoreAllMocks(); removeSessionPreview('browser'); removeSessionPreview('copy'); });
describe('linked prompt previews', () => {
  it('ignores a stale resolver response after switching items and revokes its object URL', async () => {
    let resolveFirst: (value: unknown) => void;
    const resolve = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolveFirst = done; })).mockResolvedValue({ success: true, data: { status: 'available', absolutePath: 'C:/synthetic/new.png', sourceChanged: false } });
    const thumbnail = vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([1]), mimeType: 'image/webp' });
    window.electronAPI = { promptLibraryResolvePreview: resolve, generateThumbnailFromPath: thumbnail } as unknown as typeof window.electronAPI;
    const { result, rerender, unmount } = renderHook(({ prompt }) => usePromptLibraryPreview(prompt), { initialProps: { prompt: item('old') } });
    rerender({ prompt: item('new') }); await waitFor(() => expect(result.current.url).toBe('blob:synthetic'));
    resolveFirst!({ success: true, data: { status: 'available', absolutePath: 'C:/synthetic/old.png', sourceChanged: false } });
    await Promise.resolve(); expect(thumbnail).toHaveBeenCalledTimes(1); expect(result.current.path).toBe('C:/synthetic/new.png');
    unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
  });
  it('copies browser-session file links on duplication without pretending they survive a new session', async () => {
    delete window.electronAPI;
    const file = new File(['synthetic'], 'preview.png', { type: 'image/png' });
    linkSessionPreview('browser', file); duplicateSessionPreview('browser', 'copy');
    const record = item('copy'); record.editor!.preview = { kind: 'session', name: file.name };
    const view = renderHook(() => usePromptLibraryPreview(record)); await waitFor(() => expect(view.result.current.url).toBe('blob:synthetic')); view.unmount();
    removeSessionPreview('copy'); const nextSession = renderHook(() => usePromptLibraryPreview(record));
    await waitFor(() => expect(nextSession.result.current.status).toBe('Relink image')); expect(nextSession.result.current.url).toBeNull();
  });
});
