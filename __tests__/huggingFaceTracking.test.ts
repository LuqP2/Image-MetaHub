import { describe, expect, it } from 'vitest';
import { huggingFaceConfig, huggingFaceWatchId, modelUpdateCounts, reconcileHuggingFaceWatch, unreadHuggingFaceEvents, linkedModelLocationIds } from '../services/modelLibrary/huggingFaceTracking';
import { reconcileWatch } from '../services/modelLibrary/updateTracking';
import type { HuggingFaceBinding, HuggingFaceRemoteSnapshot, ModelLocation } from '../services/modelLibrary/types';

const binding: HuggingFaceBinding = { repoId: 'owner/repo', filePath: 'folder/model.safetensors', linkedRevision: 'release-tag', linkedRemoteFingerprint: 'lfs:sha256:' + 'a'.repeat(64), resolvedCommit: 'b'.repeat(40), verification: 'manual', size: 100, fetchedAt: 1 };
const file = (path = binding.filePath, fingerprint = binding.linkedRemoteFingerprint) => ({ path, size: 100, fingerprint });
const snapshot = (files = [file()], linkedFile = files.find((entry) => entry.path === binding.filePath) ?? null, fetchedAt = 10): HuggingFaceRemoteSnapshot => ({ repoId: binding.repoId, revision: 'main', resolvedCommit: 'c'.repeat(40), watchedDirectory: 'folder', recursive: false, files, linkedFiles: { [binding.filePath]: linkedFile }, fetchedAt });

describe('HF baselines and event identities', () => {
  it('defaults legacy links to opt-out main and the parent folder without changing the linked revision', () => {
    expect(huggingFaceConfig(binding)).toEqual({ trackedRevision: 'main', watchedDirectory: 'folder', recursive: false, monitoringEnabled: false });
    expect(binding.linkedRevision).toBe('release-tag');
  });
  it('establishes a quiet baseline and ignores repository/README-only changes', () => {
    const first = reconcileHuggingFaceWatch(undefined, binding, snapshot([file(), file('folder/old.safetensors')]));
    expect(first.events).toEqual([]);
    expect(reconcileHuggingFaceWatch(first, binding, { ...first.snapshot!, resolvedCommit: 'd'.repeat(40), fetchedAt: 20 }).events).toEqual([]);
  });
  it('tracks linked changes, new model files and disappearance, but ignores edits to old unrelated files', () => {
    const first = reconcileHuggingFaceWatch(undefined, binding, snapshot([file(), file('folder/old.safetensors')]));
    const changed = reconcileHuggingFaceWatch(first, binding, snapshot([file(binding.filePath, 'lfs:sha256:' + 'e'.repeat(64)), file('folder/old.safetensors', 'git:oid:' + 'f'.repeat(40)), file('folder/new.safetensors')]));
    expect(changed.events.map((event) => event.kind)).toEqual(['fileChanged', 'newModelFile']);
    const missing = reconcileHuggingFaceWatch(changed, binding, snapshot([file('folder/old.safetensors'), file('folder/new.safetensors')], null));
    expect(missing.events.at(-1)?.kind).toBe('fileUnavailable');
    expect(reconcileHuggingFaceWatch(missing, binding, missing.snapshot!).events).toEqual(missing.events);
  });
  it('does not duplicate events across repeated polls or content transitions back to a known fingerprint', () => {
    let watch = reconcileHuggingFaceWatch(undefined, binding, snapshot());
    const different = snapshot([file(binding.filePath, 'git:oid:' + 'e'.repeat(40))]);
    watch = reconcileHuggingFaceWatch(watch, binding, different);
    watch = reconcileHuggingFaceWatch(watch, binding, snapshot());
    watch = reconcileHuggingFaceWatch(watch, binding, different);
    expect(watch.events).toHaveLength(2);
    expect(new Set(watch.events.map((event) => event.id)).size).toBe(2);
  });
  it('a new revision/folder/recursion scope starts quietly and preserves independent decisions', () => {
    let previous = reconcileHuggingFaceWatch(undefined, binding, snapshot());
    previous = reconcileHuggingFaceWatch(previous, binding, snapshot([file(), file('folder/new.safetensors')]));
    previous.seenEventIds = [previous.events[0].id];
    const otherBinding = { ...binding, trackedRevision: 'release/v2', watchedDirectory: '', recursive: true };
    const next = reconcileHuggingFaceWatch(previous, otherBinding, { ...snapshot([file(), file('folder/new.safetensors')]), revision: 'release/v2', watchedDirectory: '', recursive: true });
    expect(next.events).toEqual([]); expect(next.seenEventIds).toEqual([]);
    expect(next.id).not.toBe(previous.id);
  });
  it('rejects a response from the wrong scope or missing a requested linked-file result', () => {
    const before = reconcileHuggingFaceWatch(undefined, binding, snapshot());
    expect(() => reconcileHuggingFaceWatch(before, binding, { ...snapshot(), recursive: true })).toThrow('scope');
    expect(() => reconcileHuggingFaceWatch(before, binding, { ...snapshot(), linkedFiles: {} })).toThrow('scope');
    expect(before.events).toEqual([]);
  });
  it('preserves seen/ignored/notified decisions during a successful refresh', () => {
    const first = reconcileHuggingFaceWatch(undefined, binding, snapshot());
    const changed = reconcileHuggingFaceWatch(first, binding, snapshot([file(), file('folder/new.safetensors')]));
    changed.ignoredEventIds = [changed.events[0].id]; changed.notifiedEventIds = [changed.events[0].id];
    const repeated = reconcileHuggingFaceWatch(changed, binding, changed.snapshot!);
    expect(unreadHuggingFaceEvents(repeated)).toEqual([]);
    expect(repeated.ignoredEventIds).toEqual(changed.ignoredEventIds);
    expect(repeated.notifiedEventIds).toEqual(changed.notifiedEventIds);
  });
});

it('counts local models once across providers/copies and recognizes HF-only bindings on a secondary copy', () => {
  const makeLocation = (id: string, sha256: string): ModelLocation => ({ id, sha256, sourceId: 's', sourceName: 'Models', sourceKind: 'lora', relativePath: `${id}.safetensors`, absolutePath: `/synthetic/${id}.safetensors`, fileName: `${id}.safetensors`, size: 100, createdAt: 1, modifiedAt: 1, discoveredAt: 1, lastSeenAt: 1 });
  const one = makeLocation('one', 'a'.repeat(64)), copy = { ...makeLocation('copy', 'a'.repeat(64)), huggingFace: binding };
  one.civitai = { modelId: 1, versionId: 2, modelName: 'Model', versionName: 'Installed', trainedWords: [], fetchedAt: 1, url: '', publishedAt: '2025-01-01' };
  const watch = reconcileWatch(undefined, 1, 'Model', [{ id: 3, name: 'New', description: '', url: '', publishedAt: '2025-02-01' }], [one.civitai], 1);
  const initial = reconcileHuggingFaceWatch(undefined, binding, snapshot());
  const hf = reconcileHuggingFaceWatch(initial, binding, snapshot([file(), file('folder/new.safetensors')]));
  const catalog = { version: 1 as const, updatedAt: 1, locations: [one, copy] };
  expect(modelUpdateCounts(catalog, { '1': watch }, { [hf.id]: hf })).toEqual({ ['sha256:' + one.sha256]: 2 });
  delete one.civitai;
  expect(linkedModelLocationIds(catalog)).toEqual(new Set(['one', 'copy']));
  expect(linkedModelLocationIds(catalog, true).size).toBe(0);
  expect(huggingFaceWatchId(binding)).toBe(hf.id);
});
