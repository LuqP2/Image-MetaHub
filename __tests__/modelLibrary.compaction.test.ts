import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import { compactCacheMetadataEntry, type CacheImageMetadata } from '../services/cacheManager';
import { compactRawMetadataForRuntime } from '../services/fileIndexer';
import { buildModelDescriptors, resolveManagedModelImages } from '../services/modelLibrary/imageAssociations';
import { deriveModelUsage } from '../services/modelLibrary/usage';
import type { ModelCatalog } from '../services/modelLibrary/types';

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
const catalog: ModelCatalog = { version: 1, updatedAt: 1, locations: [
  { id: 'one', sourceKind: 'checkpoint', fileName: 'installed.safetensors', sha256: a },
  { id: 'two', sourceKind: 'checkpoint', fileName: 'installed.safetensors', sha256: b },
  { id: 'lora', sourceKind: 'lora', fileName: 'installed-brush.safetensors', sha256: c },
] as ModelCatalog['locations'] };
const file = (metadata: IndexedImage['metadata']): IndexedImage => ({ id: 'synthetic', name: 'synthetic.png', models: ['renamed'], loras: ['renamed-brush'], lastModified: 100, metadata, metadataString: JSON.stringify(metadata), scheduler: '', handle: {} as FileSystemFileHandle });
const runtime = (image: IndexedImage) => ({ ...image, ...compactRawMetadataForRuntime(image.metadata, image.metadata?.normalizedMetadata) });
// Round-trip JSON too: cache reloads must retain the same evidence.
const cache = (image: IndexedImage) => JSON.parse(JSON.stringify(compactCacheMetadataEntry(image as CacheImageMetadata))) as IndexedImage;

describe('model hash evidence through metadata compaction', () => {
  it.each([
    ['MetaHub', () => ({ imagemetahub_data: { model: 'renamed', model_hash: a.toUpperCase(), workflow: 'x'.repeat(40_000) } })],
    ['A1111', () => ({ parameters: `${'synthetic prompt '.repeat(3_000)}\nSteps: 20, Model: renamed, Model hash: ${a}, Lora hashes: "renamed-brush: ${c}"` })],
    ['A1111 Hashes', () => ({ parameters: `${'synthetic prompt '.repeat(3_000)}\nSteps: 20, Hashes: {"model":"${a}","lora:renamed-brush":"${c}"}` })],
  ] as const)('preserves %s identity in runtime, cache and repeated compaction', async (kind, payload) => {
    const original = file(payload());
    const expectedUsage = await deriveModelUsage([original], catalog, false);
    for (const compacted of [runtime(original), cache(original), cache(runtime(original)), runtime(cache(original))]) {
      expect(compacted.metadata).toMatchObject({ _rawMetadataCompacted: true });
      expect(compacted.metadataString.length).toBeLessThan(original.metadataString.length);
      expect(await deriveModelUsage([compacted], catalog, false)).toEqual(expectedUsage);
      const descriptors = buildModelDescriptors(catalog);
      expect(resolveManagedModelImages([compacted], descriptors[0])).toEqual(new Set(['synthetic']));
      expect(resolveManagedModelImages([compacted], descriptors[1])).toEqual(new Set());
      if (kind !== 'MetaHub') expect(resolveManagedModelImages([compacted], descriptors[2])).toEqual(new Set(['synthetic']));
    }
  });
  it('preserves conflicting hashes instead of falling back to same-name association', async () => {
    const original = file({ imagemetahub_data: { model_hash: 'd'.repeat(64), workflow: 'x'.repeat(40_000) } });
    original.models = ['installed'];
    for (const compacted of [runtime(original), cache(original), cache(runtime(original))]) {
      const usage = (await deriveModelUsage([compacted], catalog, false))!;
      expect(usage[`sha256:${a}`]).toMatchObject({ totalCount: 0, ambiguousCount: 0 });
      expect(usage[`sha256:${b}`]).toMatchObject({ totalCount: 0, ambiguousCount: 0 });
    }
  });
  it('compacts cache-only payloads between 4 KB and 32 KB without losing identity', async () => {
    const original = file({ imagemetahub_data: { model_hash: a, workflow: 'x'.repeat(5_000) } });
    expect(runtime(original).metadata).not.toHaveProperty('_rawMetadataCompacted');
    expect(cache(original).metadata).toHaveProperty('_rawMetadataCompacted', true);
    expect((await deriveModelUsage([cache(original)], catalog, false))![`sha256:${a}`].confirmedCount).toBe(1);
  });
  it.each(['prompt', 'abbreviated', 'preview'])('does not promote %s text to full hash evidence', async (kind) => {
    const original = file(kind === 'preview'
      ? { parametersPreview: `Steps: 20, Model hash: ${a}`, padding: 'x'.repeat(40_000) }
      : { parameters: `Model hash: ${a} ${'synthetic prompt '.repeat(3_000)}\nSteps: 20${kind === 'abbreviated' ? `, Model hash: ${a.slice(0, 10)}` : ''}` });
    for (const compacted of [runtime(original), cache(original), cache(runtime(original))]) {
      expect((await deriveModelUsage([compacted], catalog, false))![`sha256:${a}`].confirmedCount).toBe(0);
    }
  });
});
