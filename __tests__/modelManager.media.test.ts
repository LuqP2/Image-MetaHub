import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { storeModelMedia, resolveModelMediaPath } from '../electron/modelMediaStore.mjs';
import { externalizeModelMedia } from '../services/modelLibrary/mediaStorage';
import { mergeModelMetadata } from '../services/modelLibrary/mergeMetadata';
import { normalizeModelLocalMetadata } from '../services/modelLibrary/localMetadataStorage';
import { getEffectiveModelPresentation } from '../services/modelLibrary/presentation';

const testParent = path.resolve('.tmp/model-media-tests');
let directory: string | undefined;
afterEach(async () => {
  if (directory) {
    if (path.dirname(path.resolve(directory)) !== testParent) throw new Error('Unsafe test cleanup.');
    await fs.rm(directory, { recursive: true, force: true }); directory = undefined;
  }
});

describe('model media references', () => {
  it('stores identical image bytes once and rejects references outside the media directory', async () => {
    await fs.mkdir(testParent, { recursive: true }); directory = await fs.mkdtemp(path.join(testParent, 'synthetic-'));
    const image = 'data:image/jpeg;base64,c3ludGhldGlj';
    const reference = await storeModelMedia(directory, image);
    expect(await storeModelMedia(directory, image)).toBe(reference);
    expect(await fs.readdir(directory)).toHaveLength(1);
    expect(await fs.readFile(resolveModelMediaPath(directory, reference), 'utf8')).toBe('synthetic');
    expect(() => resolveModelMediaPath(directory, 'imh-model-media://media/../../private.jpg')).toThrow();
    expect(() => resolveModelMediaPath(directory, 'imh-model-media://other/' + 'a'.repeat(64) + '.jpg')).toThrow();
    await expect(storeModelMedia(directory, 'data:text/plain;base64,c3ludGhldGlj')).rejects.toThrow();
  });
  it('migrates inline covers and examples before publishing, deduplicates conversions and is idempotent', async () => {
    const reference = `imh-model-media://media/${'a'.repeat(64)}.jpg`;
    const save = vi.fn(async () => ({ success: true, reference }));
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { modelManagerStoreMedia: save } });
    const inline = 'data:image/jpeg;base64,c3ludGhldGlj';
    const original = { catalog: { locations: [{ civitai: { coverImage: inline }, fileMetadata: { embeddedPreview: inline } }] }, localMetadata: { previewImage: inline, examples: [{ preview: inline, caption: 'Keep caption' }] } };
    const migrated = await externalizeModelMedia(original);
    expect(JSON.stringify(migrated)).not.toContain('data:image');
    expect(migrated.localMetadata.examples[0]).toEqual({ preview: reference, caption: 'Keep caption' });
    const saved = normalizeModelLocalMetadata({ id: 'location:synthetic', tags: [], previewImage: reference });
    expect(saved.previewImage).toBe(reference);
    expect(getEffectiveModelPresentation({ id: 'synthetic', fileName: 'synthetic.safetensors', sourceKind: 'lora' } as import('../services/modelLibrary/types').ModelLocation, saved).preview).toBe(reference);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await externalizeModelMedia(migrated)).toBe(migrated);
    expect(original.localMetadata.previewImage).toBe(inline);
  });
});

describe('metadata identity conflict policy', () => {
  it('uses the newer record for scalars, preserves divergent notes and favors SHA on ties', () => {
    const local = { id: 'location:a', updatedAt: 20, tags: ['a'], notes: 'foo', displayName: 'New name', favorite: false };
    const canonical = { id: 'sha256:a', updatedAt: 10, tags: ['b'], notes: 'bar', displayName: 'Old name', favorite: true };
    const merged = mergeModelMetadata(local, canonical, 'a'.repeat(64));
    expect(merged).toMatchObject({ displayName: 'New name', favorite: false, notes: 'foo\n\n---\n\nbar', tags: ['a', 'b'] });
    expect(mergeModelMetadata(local, { ...canonical, updatedAt: 20 }, 'a'.repeat(64)).displayName).toBe('Old name');
  });
});
