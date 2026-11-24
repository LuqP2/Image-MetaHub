import type { IndexedImage } from '../../types';
import type { ExrAssetInfo, ExrReply, ExrPreviewRequest, ExrPreviewResult } from './contracts';

export function unwrapExr<T>(reply: ExrReply<T>): T {
  if (!reply.success) throw new Error('error' in reply ? reply.error : 'EXR operation failed');
  return reply.value;
}
const listeners = new Set<() => void>();
let listening = false;
let revision = 0;
export function subscribeExrChanged(listener: () => void) {
  listeners.add(listener);
  if (!listening && typeof window !== 'undefined' && window.electronAPI?.exr) {
    listening = true;
    window.electronAPI.exr.onChanged(status => {
      if (status?.phase === 'downloading' || status?.phase === 'verifying' || status?.phase === 'installing') return;
      revision++;
      for (const callback of listeners) callback();
    });
  }
  return () => { listeners.delete(listener); };
}
export const exrClientRevision = () => revision;
export async function resolveExrPath(image: IndexedImage, directoryPath?: string): Promise<string> {
  const direct = (image.handle as FileSystemFileHandle & { _filePath?: string })?._filePath;
  if (direct) return direct;
  if (!directoryPath || !window.electronAPI) throw new Error('EXR support is available in the desktop app.');
  const relativePath = image.id.split('::').slice(1).join('::') || image.name;
  const result = await window.electronAPI.joinPaths(directoryPath, relativePath);
  if (!result.success || !result.path) throw new Error(result.error || 'Cannot resolve EXR path');
  return result.path;
}
export async function inspectExrPath(filePath: string, boardId?: string | null): Promise<ExrAssetInfo> {
  if (boardId) {
    const boardInspect = window.electronAPI?.boardsExrInspect;
    if (!boardInspect) throw new Error('EXR support is available in the desktop app.');
    const reply = await boardInspect({ boardId, filePath });
    if (reply.success === false) throw new Error(reply.error || 'EXR operation failed');
    return reply.data;
  }
  const api = window.electronAPI?.exr;
  if (!api) throw new Error('EXR support is available in the desktop app.');
  return unwrapExr(await api.inspect(filePath));
}
export async function loadExrPreview(image: IndexedImage, directoryPath?: string, options: Partial<ExrPreviewRequest> = {}): Promise<ExrPreviewResult> {
  const boardId = (image.handle as FileSystemFileHandle & { _boardId?: string })?._boardId;
  const request: ExrPreviewRequest = { ...options, requestId: options.requestId ?? crypto.randomUUID(), filePath: await resolveExrPath(image, directoryPath) };
  if (boardId) {
    const boardPreview = window.electronAPI?.boardsExrPreview;
    if (!boardPreview) throw new Error('EXR support is available in the desktop app.');
    const reply = await boardPreview({ boardId, request });
    if (reply.success === false) throw new Error(reply.error || 'EXR operation failed');
    return reply.data;
  }
  const api = window.electronAPI?.exr;
  if (!api) throw new Error('EXR support is available in the desktop app.');
  return unwrapExr(await api.preview(request));
}
export function openExrSettings() {
  window.dispatchEvent(new CustomEvent('imh-open-exr-settings'));
}
