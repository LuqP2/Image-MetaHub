import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelManagerSnapshot } from '../services/modelLibrary/types';
import { emptyHuggingFaceWatch, huggingFaceWatchId } from '../services/modelLibrary/huggingFaceTracking';

const fakes = vi.hoisted(() => ({ command: vi.fn(), manager: {} as ModelManagerSnapshot, observers: [] as IntersectionObserverCallback[] }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => fakes.manager, installedVersions: () => [{ versionId: 2 }] }));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: (command: unknown) => fakes.command(command), modelButton: '', ReleaseGroup: ({ watch }: { watch: { modelName: string } }) => <p>Civitai · {watch.modelName}</p> }));
import { ModelUpdatesPanel, HuggingFaceReleaseGroup } from '../components/UnifiedModelUpdatesPanel';

const binding = { repoId: 'owner/repo', filePath: 'model.safetensors', linkedRevision: 'tag', linkedRemoteFingerprint: 'git:oid:' + 'a'.repeat(40), resolvedCommit: 'b'.repeat(40), verification: 'manual' as const, size: 100, fetchedAt: 1 };
beforeEach(() => {
  vi.useFakeTimers(); fakes.command.mockReset().mockResolvedValue(undefined); fakes.observers = [];
  const hf = emptyHuggingFaceWatch(binding);
  hf.events = ['one', 'two'].map((id) => ({ id, source: 'huggingFace', kind: 'newModelFile', path: `${id}.safetensors`, fingerprint: `git:oid:${'c'.repeat(40)}`, commit: 'b'.repeat(40), detectedAt: 1 }));
  fakes.manager = { revision: 1, sources: [], localMetadata: {}, watches: { '1': { id: '1', modelId: 1, modelName: 'Synthetic', versions: [{ id: 3, name: 'New', description: '', url: '' }], knownVersionIds: [3], novelVersionIds: [3], seenVersionIds: [], ignoredVersionIds: [], notifiedVersionIds: [] } }, hfWatches: { [hf.id]: hf }, intervalHours: 24, loading: false, progress: null, message: null, notification: null, catalog: { version: 1, updatedAt: 1, locations: [{ id: 'one', sha256: 'a'.repeat(64), sourceId: 's', sourceName: 'Models', sourceKind: 'lora', fileName: 'one.safetensors', relativePath: 'one.safetensors', absolutePath: '/synthetic/one.safetensors', size: 100, modifiedAt: 1, createdAt: 1, discoveredAt: 1, lastSeenAt: 1, huggingFace: binding, civitai: { modelId: 1, versionId: 2, modelName: 'Synthetic', versionName: 'Installed', trainedWords: [], fetchedAt: 1, url: '' } }] } };
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { fakes.observers.push(callback); } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('provider-aware model updates', () => {
  it('counts one logical model across providers and keeps provider event counts distinct', () => {
    render(<ModelUpdatesPanel />);
    expect(screen.getByText('1 model · 1 Civitai releases · 2 Hugging Face events')).toBeTruthy();
    expect(screen.getByText('Civitai · Synthetic')).toBeTruthy();
    expect(screen.getByText(/Hugging Face · owner\/repo/)).toBeTruthy();
    expect(fakes.command).not.toHaveBeenCalled(); expect(fakes.observers).toHaveLength(0);
    fireEvent.click(screen.getByText('Mark all as viewed'));
    expect(fakes.command).toHaveBeenCalledWith({ type: 'seen', modelId: 1, versionIds: [3] });
    expect(fakes.command).toHaveBeenCalledWith({ type: 'hfEventAction', watchId: huggingFaceWatchId(binding), action: 'seen', eventIds: ['one', 'two'] });
  });
  it('marks only visible HF events, cancels the dwell timer when a row leaves the viewport and retains history', async () => {
    const watch = fakes.manager.hfWatches![huggingFaceWatchId(binding)];
    render(<HuggingFaceReleaseGroup watch={watch} />);
    const detail = screen.getByText(/Hugging Face · owner\/repo/).closest('details')!;
    await act(async () => { detail.open = true; fireEvent(detail, new Event('toggle')); });
    expect(fakes.observers).toHaveLength(2);
    await act(async () => {
      fakes.observers[0]([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver);
      fakes.observers[1]([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver);
      await vi.advanceTimersByTimeAsync(100);
      fakes.observers[1]([{ isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry], {} as IntersectionObserver);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fakes.command).toHaveBeenCalledExactlyOnceWith({ type: 'hfEventAction', watchId: watch.id, eventIds: ['one'], action: 'seen' });
    expect(screen.getByText('one.safetensors')).toBeTruthy(); expect(screen.getByText('two.safetensors')).toBeTruthy();
  });
  it('keeps ignored events out of unread counts and exposes restore independently from Civitai', async () => {
    const watch = fakes.manager.hfWatches![huggingFaceWatchId(binding)]; watch.ignoredEventIds = ['one'];
    render(<HuggingFaceReleaseGroup watch={watch} history />);
    const detail = screen.getByText(/Hugging Face · owner\/repo/).closest('details')!;
    await act(async () => { detail.open = true; fireEvent(detail, new Event('toggle')); });
    fireEvent.click(screen.getByText('Restore event'));
    expect(fakes.command).toHaveBeenCalledWith({ type: 'hfEventAction', watchId: watch.id, eventIds: ['one'], action: 'restore' });
  });
  it('opens the HF events when the catalog update indicator requests their presentation', () => {
    const watch = fakes.manager.hfWatches![huggingFaceWatchId(binding)];
    render(<HuggingFaceReleaseGroup watch={watch} reveal={1} />);
    expect(screen.getByText('one.safetensors')).toBeTruthy();
    expect(fakes.command).not.toHaveBeenCalled();
  });
});
