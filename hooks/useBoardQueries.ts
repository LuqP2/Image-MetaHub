import { useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useBoardStore } from '../store/useBoardStore';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import { createBoardQueryRuntime } from '../services/boards/queryRuntime';
import { buildBoardAssetLookup, resolveBoardAsset } from '../services/boards/assetResolver';
import { mapSetExpression } from '../services/boards/queryDocument.mjs';
import { resolveSmartCollectionImageIds } from '../services/imageAnnotationsStorage';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';
import type { BoardQueryFrame } from '../services/boards/queryProtocol';

export function useBoardQueries(boardId: string | null, loading: boolean) {
  const objects = useBoardStore(state => boardId ? state.sessions[boardId]?.document.objects : undefined);
  const images = useImageStore(state => state.images);
  const directories = useImageStore(state => state.directories);
  const collections = useImageStore(state => state.collections);
  const enableSafeMode = useSettingsStore(state => state.enableSafeMode);
  const blurSensitiveImages = useSettingsStore(state => state.blurSensitiveImages);
  const sensitiveTags = useSettingsStore(state => state.sensitiveTags);
  const runtime = useRef<ReturnType<typeof createBoardQueryRuntime> | null>(null);
  const signature = JSON.stringify(objects?.filter((object): object is BoardSmartFrameObject => object.type === 'smart-frame')
    .map(({ id, type, source, criteria, groupConstraints }) => ({ id, type, source, criteria, groupConstraints })) ?? []);
  // Geometry, selection, title and color never invalidate queries.
  const frames = useMemo(() => JSON.parse(signature) as BoardQueryFrame[], [signature]);
  const referenceSignature = JSON.stringify(frames.map(frame => {
    const references: unknown[] = [];
    mapSetExpression(frame.source, source => { if (source.kind === 'snapshot') references.push(...source.references); return source; });
    return references;
  }));
  const dataset = useMemo(() => {
    if (loading || !frames.length) return null;
    const lookup = buildBoardAssetLookup(images, directories);
    const references: Record<string, string> = {};
    for (const list of JSON.parse(referenceSignature)) for (const reference of list) {
      const resolved = resolveBoardAsset(reference, lookup);
      if (resolved.status === 'resolved') references[JSON.stringify(reference)] = resolved.image.id;
    }
    return { images: images.map(toLibraryQueryImage), references,
      collections: Object.fromEntries(collections.map(collection => [collection.id, [...resolveSmartCollectionImageIds(collection, images)]])),
      context: { visibleDirectories: directories.filter(directory => directory.visible ?? true).map(({ id, path }) => ({ id, path })),
        safeMode: { enableSafeMode, blurSensitiveImages, sensitiveTags: (sensitiveTags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean) } } };
  // Frame criteria do not change the dataset; only Snapshot references can do so.
  }, [images, directories, collections, enableSafeMode, blurSensitiveImages, sensitiveTags, referenceSignature, loading, frames.length > 0]);
  useLayoutEffect(() => {
    if (!boardId) return;
    const instance = createBoardQueryRuntime(boardId,
      () => new Worker(new URL('../services/workers/boardQueryWorker.ts', import.meta.url), { type: 'module' }),
      results => useBoardQueryStore.getState().publish(boardId, results));
    runtime.current = instance;
    return () => { instance.dispose(); runtime.current = null; useBoardQueryStore.getState().clear(boardId); };
  }, [boardId]);
  useLayoutEffect(() => {
    if (dataset) runtime.current?.syncDataset(dataset);
    else { runtime.current?.pause(); if (boardId) useBoardQueryStore.getState().clear(boardId); }
  }, [dataset, boardId]);
  useEffect(() => { runtime.current?.evaluate(frames); }, [frames, boardId]);
  return useCallback(() => runtime.current?.retry(), []);
}
