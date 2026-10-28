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
  const clusters = useImageStore(state => state.clusters);
  const enableSafeMode = useSettingsStore(state => state.enableSafeMode);
  const blurSensitiveImages = useSettingsStore(state => state.blurSensitiveImages);
  const sensitiveTags = useSettingsStore(state => state.sensitiveTags);
  const runtime = useRef<ReturnType<typeof createBoardQueryRuntime> | null>(null);
  const signature = JSON.stringify(objects?.filter((object): object is BoardSmartFrameObject => object.type === 'smart-frame')
    .map(({ id, type, source, criteria, groupConstraints, layout }) => ({ id, type, source, criteria, groupConstraints, layout })) ?? []);
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
    const records = images.map(toLibraryQueryImage);
    const directoryPaths = new Map(directories.map(directory => [directory.id, directory.path.replace(/\\/g, '/').replace(/\/+$/, '')]));
    const grouping = Object.fromEntries(images.map((image, index) => {
      const relative = records[index].relativePath.replace(/\\/g, '/');
      const slash = relative.lastIndexOf('/');
      const root = directoryPaths.get(image.directoryId ?? '');
      return [image.id, { seed: image.seed == null ? null : String(image.seed).trim(), folder: root === undefined ? null : `${root}${slash < 0 ? '' : `/${relative.slice(0, slash)}`}` || '/' }];
    }));
    return { images: records, references, grouping,
      collectionLabels: Object.fromEntries(collections.map(collection => [collection.id, collection.name])),
      clusters: Object.fromEntries((clusters ?? []).map(cluster => [cluster.id, { label: cluster.basePrompt || cluster.id, imageIds: cluster.imageIds }])) ,
      collections: Object.fromEntries(collections.map(collection => [collection.id, [...resolveSmartCollectionImageIds(collection, images)]])),
      context: { visibleDirectories: directories.filter(directory => directory.visible ?? true).map(({ id, path }) => ({ id, path })),
        safeMode: { enableSafeMode, blurSensitiveImages, sensitiveTags: (sensitiveTags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean) } } };
  // Frame criteria do not change the dataset; only Snapshot references can do so.
  }, [images, directories, collections, clusters, enableSafeMode, blurSensitiveImages, sensitiveTags, referenceSignature, loading, frames.length > 0]);
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
