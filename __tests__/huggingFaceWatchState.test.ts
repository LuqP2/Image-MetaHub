import { describe, expect, it } from 'vitest';
import { packHuggingFaceWatches, unpackHuggingFaceWatches } from '../services/modelLibrary/huggingFaceWatchState.mjs';
import { emptyHuggingFaceWatch } from '../services/modelLibrary/huggingFaceTracking';
import type { HuggingFaceRemoteSnapshot } from '../services/modelLibrary/types';

const binding = { repoId: 'synthetic/repo', filePath: 'model.safetensors', linkedRevision: 'main', linkedRemoteFingerprint: 'git:oid:a', verification: 'manual' as const, resolvedCommit: 'a'.repeat(40), size: 100, fetchedAt: 1 };
const files = Array.from({ length: 1000 }, (_, index) => ({ path: `${index}.safetensors`, fingerprint: `git:oid:${index}`, size: 100 }));
const snapshot: HuggingFaceRemoteSnapshot = { repoId: binding.repoId, revision: 'main', watchedDirectory: '', recursive: false, resolvedCommit: binding.resolvedCommit, files, linkedFiles: { [binding.filePath]: null }, fetchedAt: 1 };

describe('normalized HF watch preferences', () => {
  it('serializes a shared 1000-file listing once for 1000 watches and restores shared references and decisions', () => {
    const watches = Object.fromEntries(files.map((file) => {
      const watch = { ...emptyHuggingFaceWatch({ ...binding, filePath: file.path }), snapshot, seenEventIds: ['seen'], ignoredEventIds: ['ignored'], notifiedEventIds: ['notified'] };
      return [watch.id, watch];
    }));
    const packed = packHuggingFaceWatches(watches);
    expect(Object.keys(packed.snapshots)).toHaveLength(1);
    const json = JSON.stringify(packed);
    expect(json.match(/"files":/g)).toHaveLength(1);
    expect(json.length).toBeLessThan(JSON.stringify(watches).length / 20);
    const restored = unpackHuggingFaceWatches(JSON.parse(json));
    expect(restored).toEqual(watches);
    const values = Object.values(restored);
    expect(values[0].snapshot).toBe(values[999].snapshot);
  });
  it('retains different historical baselines and watches that have not established a baseline', () => {
    const first = { ...emptyHuggingFaceWatch(binding), snapshot };
    const second = { ...emptyHuggingFaceWatch({ ...binding, filePath: 'second.safetensors' }), snapshot: { ...snapshot, fetchedAt: 2, files: [] } };
    const fresh = emptyHuggingFaceWatch({ ...binding, filePath: 'fresh.safetensors' });
    const watches = { [first.id]: first, [second.id]: second, [fresh.id]: fresh };
    const packed = packHuggingFaceWatches(watches);
    expect(Object.keys(packed.snapshots)).toHaveLength(2);
    expect(unpackHuggingFaceWatches(JSON.parse(JSON.stringify(packed)))).toEqual(watches);
  });
  it('rejects a missing baseline instead of silently treating the next check as the first check', () => {
    const watch = { ...emptyHuggingFaceWatch(binding), snapshot };
    const packed = packHuggingFaceWatches({ [watch.id]: watch });
    packed.snapshots = {};
    expect(() => unpackHuggingFaceWatches(packed)).toThrow('Missing');
  });
});
