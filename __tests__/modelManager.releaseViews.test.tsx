import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInspectorItem, ModelWatchRecord } from '../services/modelLibrary/types';

const fakes = vi.hoisted(() => ({ command: vi.fn(), watch: {} as ModelWatchRecord, observers: [] as Array<IntersectionObserverCallback> }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => ({ watches: { '1': fakes.watch } }), installedVersions: () => [{ versionId: 1, baseModel: 'SDXL' }], runModelCommand: (command: unknown) => fakes.command(command), closeModelPicker: vi.fn(), modelFolderWatchDefault: vi.fn() }));
vi.mock('../store/useImageStore', () => ({ useImageStore: vi.fn() }));
vi.mock('../services/thumbnailManager', () => ({ thumbnailManager: {} }));
import { ModelVersionLinks } from '../components/ModelManagerPanels';

const item = { location: { id: 'synthetic', civitai: { modelId: 1, versionId: 1 } } } as ModelInspectorItem;
beforeEach(() => {
  vi.useFakeTimers(); fakes.command.mockReset().mockResolvedValue(undefined); fakes.observers = [];
  fakes.watch = { id: '1', modelId: 1, modelName: 'Synthetic', versions: [2, 3].map((id) => ({ id, name: `Release ${id}`, baseModel: 'SDXL', description: '', url: `https://civitai.com/models/1?modelVersionId=${id}` })), novelVersionIds: [2, 3], knownVersionIds: [1, 2, 3], seenVersionIds: [], ignoredVersionIds: [], notifiedVersionIds: [] };
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { fakes.observers.push(callback); } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('release presentation', () => {
  it('does not mark releases viewed just because a model detail is selected', () => {
    render(<ModelVersionLinks item={item} />);
    expect(screen.queryByText('Release 2 ↗')).toBeNull();
    expect(fakes.observers).toHaveLength(0);
    expect(fakes.command).not.toHaveBeenCalled();
  });
  it('marks only visible releases and keeps their links after they become viewed', async () => {
    const view = render(<ModelVersionLinks item={item} reveal={1} />);
    expect(fakes.observers).toHaveLength(2);
    await act(async () => {
      fakes.observers[0]([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver);
      fakes.observers[1]([{ isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry], {} as IntersectionObserver);
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fakes.command).toHaveBeenCalledExactlyOnceWith({ type: 'seen', modelId: 1, versionIds: [2] });
    fakes.watch = { ...fakes.watch, seenVersionIds: [2] };
    view.rerender(<ModelVersionLinks item={item} reveal={1} />);
    expect(screen.getByText('Release 2 ↗')).toBeTruthy();
    expect(screen.getByText(/What's new · 1 unread/)).toBeTruthy();
  });
});
