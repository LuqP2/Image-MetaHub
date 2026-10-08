import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import type { ModelCatalog, ModelKind, ModelLocation } from '../services/modelLibrary/types';
import { buildModelDescriptors, normalizeModelName, resolveManagedModelImages } from '../services/modelLibrary/imageAssociations';
import { deriveModelUsage } from '../services/modelLibrary/usage';
import { resolveScopeImageIds } from '../utils/imageScope';

const a = 'a'.repeat(64), b = 'b'.repeat(64);
const location = (id: string, fileName: string, sha256?: string, sourceKind: ModelKind = 'checkpoint'): ModelLocation => ({ id, fileName, sha256, sourceKind, sourceId: 'synthetic', sourceName: 'Synthetic', absolutePath: `/synthetic/${id}/${fileName}`, relativePath: fileName, size: 10, createdAt: 1, modifiedAt: 1, discoveredAt: 1, lastSeenAt: 1 });
const catalog = (...locations: ModelLocation[]): ModelCatalog => ({ version: 1, locations, updatedAt: 1 });
const image = (id: string, models: string[], hash?: string, lastModified = 10, loras: IndexedImage['loras'] = []): IndexedImage => ({ id, name: `${id}.png`, models, loras, lastModified, metadata: { normalizedMetadata: { model_hash: hash } }, metadataString: '', handle: {} as FileSystemFileHandle, scheduler: '' } as IndexedImage);

describe('derived model Library usage', () => {
  it('separates full hash, abbreviated hash, conflicting hash and ambiguous names', async () => {
    const models = catalog(location('one', 'Style_v1.safetensors', a), location('two', 'style-v1.safetensors', b));
    const files = [image('confirmed', ['renamed'], a.toUpperCase()), image('ambiguous', ['STYLE V1'], a.slice(0, 10)), image('conflict', ['style_v1'], 'c'.repeat(64)), image('nameOnly', ['style_v1'])];
    const usage = await deriveModelUsage(files, models, false);
    expect(usage?.[`sha256:${a}`]).toMatchObject({ confirmedCount: 1, nameMatchedCount: 0, ambiguousCount: 2, totalCount: 1 });
    expect(usage?.[`sha256:${b}`]).toMatchObject({ confirmedCount: 0, ambiguousCount: 2, totalCount: 0 });
  });
  it('uses every location filename, counts distinct copies and takes only valid principal dates', async () => {
    const models = catalog(location('one', 'Original.safetensors', a), location('copy', 'Renamed.safetensors', a));
    const files = [image('one', ['original'], undefined, 100), image('two', ['renamed'], undefined, 200), image('two', ['renamed'], a, 900), image('three', ['unrelated'], a, NaN), image('four', ['original'], undefined, 9e15)];
    const usage = await deriveModelUsage(files, models, false);
    expect(usage?.[`sha256:${a}`]).toMatchObject({ confirmedCount: 2, nameMatchedCount: 2, totalCount: 4, lastUsedAt: 900, status: 'ready' });
  });
  it('does not treat remote or editable titles as identity', async () => {
    const model = location('one', 'actual-v2.safetensors', a);
    model.fileMetadata = { modelName: 'Remote title', raw: {} };
    expect((await deriveModelUsage([image('one', ['Remote title'])], catalog(model), false))?.[`sha256:${a}`].totalCount).toBe(0);
    expect(normalizeModelName('folder/Actual v2.safetensors')).toBe(normalizeModelName('actual-v2'));
    expect(normalizeModelName('actual_v1.2')).not.toBe(normalizeModelName('actual_v12'));
  });
  it('deduplicates repeated LoRAs and lets stronger evidence win', async () => {
    const models = catalog(location('one', 'style.safetensors', a, 'lora'), location('two', 'style.safetensors', b, 'lora'));
    const files = [image('one', [], undefined, 100, ['style', { name: 'style', sha256: a }, { name: 'style', sha256: a }] as IndexedImage['loras'])];
    expect((await deriveModelUsage(files, models, false))?.[`sha256:${a}`]).toMatchObject({ totalCount: 1, confirmedCount: 1, ambiguousCount: 0 });
  });
  it.each([false, true])('uses LoRA model_hash for renamed files and same-name versions with compacted metadata=%s', async (compacted) => {
    const models = catalog(location('one', 'style.safetensors', a, 'lora'), location('two', 'style.safetensors', b, 'lora'));
    const files = [
      { id: 'renamed', name: 'old-name', model_hash: a.toUpperCase() },
      { id: 'matching', name: 'style', model_hash: a },
      { id: 'conflicting', name: 'style', model_hash: 'c'.repeat(64) },
    ].map(({ id, ...lora }) => {
      const file = image(id, [], undefined, 100, [lora] as IndexedImage['loras']);
      file.metadata = compacted ? { _rawMetadataCompacted: true } : { imagemetahub_data: { loras: [lora] } };
      return file;
    });
    const usage = (await deriveModelUsage(files, models, false))!;
    expect(usage[`sha256:${a}`]).toMatchObject({ totalCount: 2, confirmedCount: 2, nameMatchedCount: 0, ambiguousCount: 0 });
    expect(usage[`sha256:${b}`]).toMatchObject({ totalCount: 0, confirmedCount: 0, ambiguousCount: 0 });
    const descriptors = buildModelDescriptors(models);
    for (const mode of ['total', 'confirmed'] as const) {
      expect(resolveManagedModelImages(files, { ...descriptors[0], mode })).toEqual(new Set(['renamed', 'matching']));
      expect(resolveManagedModelImages(files, { ...descriptors[1], mode })).toEqual(new Set());
    }
  });
  it.each([undefined, null, 123, a.slice(0, 10), 'z'.repeat(64)])('does not confirm malformed or incomplete LoRA model_hash: %j', async (model_hash) => {
    const models = catalog(location('one', 'style.safetensors', a, 'lora'), location('two', 'style.safetensors', b, 'lora'));
    const file = image('incomplete', [], undefined, 100, [{ name: 'style', model_hash }] as IndexedImage['loras']);
    const usage = (await deriveModelUsage([file], models, false))!;
    for (const hash of [a, b]) expect(usage[`sha256:${hash}`]).toMatchObject({ totalCount: 0, confirmedCount: 0, ambiguousCount: 1 });
  });
  it('resolves hashes before attributing ambiguity to an unhashed competitor', async () => {
    const models = catalog(location('one', 'style.safetensors', a), location('two', 'style.safetensors'));
    const usage = await deriveModelUsage([image('one', ['style'], a)], models, false);
    expect(usage?.['location:two']).toMatchObject({ totalCount: 0, ambiguousCount: 0 });
  });
  it('uses full A1111 hashes already loaded in sampling parameters without changing parser output', async () => {
    const models = catalog(location('one', 'style.safetensors', a), location('lora', 'brush.safetensors', b, 'lora'));
    const file = image('one', ['renamed'], undefined, 100, ['brush']);
    file.metadata = { parameters: `synthetic prompt\nSteps: 20, Model: renamed, Model hash: ${a}, Lora hashes: "brush: ${b}"` };
    const usage = await deriveModelUsage([file], models, false);
    expect(usage?.[`sha256:${a}`].confirmedCount).toBe(1);
    expect(usage?.[`sha256:${b}`].confirmedCount).toBe(1);
    file.metadata.parameters = `prompt mentioning Model hash: ${a}\nSteps: 20, Model: renamed`;
    expect((await deriveModelUsage([file], models, false))?.[`sha256:${a}`].totalCount).toBe(0);
  });
  it('counts checkpoint and diffusion references together and leaves other categories unavailable', async () => {
    const models = catalog(location('one', 'diffusion.safetensors', a, 'diffusion'), location('vae', 'vae.safetensors', b, 'vae'));
    const usage = await deriveModelUsage([image('one', ['diffusion'], a)], models, true);
    expect(usage?.[`sha256:${a}`]).toMatchObject({ status: 'partial', totalCount: 1 });
    expect(usage?.[`sha256:${b}`]).toMatchObject({ status: 'unsupported', totalCount: 0 });
  });
  it.each(['checkpoint', 'diffusion'] as const)('associates renamed %s files using the full hash retained in the MetaHub payload', async (kind) => {
    const models = catalog(location('one', 'installed-name.safetensors', a, kind));
    const file = image('metahub-renamed', ['old-name']);
    file.metadata = { imagemetahub_data: { model: 'old-name', model_hash: a.toUpperCase() }, normalizedMetadata: { model: 'old-name' } } as IndexedImage['metadata'];
    const files = [file];
    const usage = (await deriveModelUsage(files, models, false))![`sha256:${a}`];
    expect(usage).toMatchObject({ totalCount: 1, confirmedCount: 1, nameMatchedCount: 0, ambiguousCount: 0 });
    expect(resolveManagedModelImages(files, buildModelDescriptors(models)[0])).toEqual(new Set([file.id]));
  });
  it('resolves same-name versions using the MetaHub hash and excludes a conflicting full hash', async () => {
    const models = catalog(location('one', 'style.safetensors', a), location('two', 'style.safetensors', b));
    const matching = image('metahub-matching', ['style']);
    matching.metadata = { imagemetahub_data: { model: 'style', model_hash: a } };
    const conflicting = image('metahub-conflicting', ['style']);
    conflicting.metadata = { imagemetahub_data: { model: 'style', model_hash: 'c'.repeat(64) } };
    const files = [matching, conflicting];
    const usage = (await deriveModelUsage(files, models, false))!;
    expect(usage[`sha256:${a}`]).toMatchObject({ totalCount: 1, confirmedCount: 1, ambiguousCount: 0 });
    expect(usage[`sha256:${b}`]).toMatchObject({ totalCount: 0, confirmedCount: 0, ambiguousCount: 0 });
    const descriptors = buildModelDescriptors(models);
    expect(resolveManagedModelImages(files, descriptors[0])).toEqual(new Set([matching.id]));
    expect(resolveManagedModelImages(files, descriptors[1])).toEqual(new Set());
  });
  it.each([null, [], 'invalid payload', { model_hash: a.slice(0, 10) }, { model_hash: 'z'.repeat(64) }])('does not confirm incomplete or malformed MetaHub hash evidence: %j', async (payload) => {
    const models = catalog(location('one', 'style.safetensors', a), location('two', 'style.safetensors', b));
    const file = image('metahub-incomplete', ['style']);
    file.metadata = { imagemetahub_data: payload };
    const usage = (await deriveModelUsage([file], models, false))!;
    expect(usage[`sha256:${a}`]).toMatchObject({ totalCount: 0, confirmedCount: 0, ambiguousCount: 1 });
    expect(usage[`sha256:${b}`]).toMatchObject({ totalCount: 0, confirmedCount: 0, ambiguousCount: 1 });
  });
  it('shares the principal, confirmed and ambiguous sets with navigation and retains empty scopes', async () => {
    const models = catalog(location('one', 'style.safetensors', a), location('two', 'style.safetensors', b));
    const files = [image('one', ['style'], a), image('two', ['style']), image('three', ['renamed'], a)];
    const usage = (await deriveModelUsage(files, models, false))![`sha256:${a}`];
    const descriptor = buildModelDescriptors(models)[0];
    for (const [mode, count] of [['total', usage.totalCount], ['confirmed', usage.confirmedCount], ['ambiguous', usage.ambiguousCount]] as const) {
      expect(resolveManagedModelImages(files, { ...descriptor, mode }).size).toBe(count);
    }
    expect(resolveScopeImageIds({ type: 'managedModel', id: descriptor.identity, label: 'style', managedModel: descriptor }, { images: [], clusters: [], collections: [] })).toEqual({ ids: new Set(), valid: true });
    expect((await deriveModelUsage([], models, false))![`sha256:${a}`]).toMatchObject({ totalCount: 0, lastUsedAt: null, status: 'ready' });
  });
  it('discards superseded work at a yield and rebuilds partial data', async () => {
    const models = catalog(location('one', 'style.safetensors', a));
    expect(await deriveModelUsage([image('one', ['style'])], models, false, () => true)).toBeNull();
    expect((await deriveModelUsage([image('one', ['style'])], models, true))![`sha256:${a}`]).toMatchObject({ totalCount: 1, status: 'partial' });
  });
  it('promotes location identity and removes ambiguity after identical copies are hashed', async () => {
    const models = catalog(location('one', 'style.safetensors'), location('two', 'style.safetensors'));
    const files = [image('one', ['style'])];
    expect((await deriveModelUsage(files, models, false))!['location:one']).toMatchObject({ totalCount: 0, ambiguousCount: 1 });
    for (const model of models.locations) model.sha256 = a;
    const descriptors = buildModelDescriptors(models);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({ identity: `sha256:${a}`, locationIds: ['one', 'two'] });
    expect((await deriveModelUsage(files, models, false))![`sha256:${a}`]).toMatchObject({ totalCount: 1, nameMatchedCount: 1, ambiguousCount: 0 });
    expect(resolveManagedModelImages(files, descriptors[0])).toEqual(new Set(['one']));
  });
});
