import { describe, expect, it } from 'vitest';
import { buildManagedModels, reconcileModelCatalog } from '../services/modelLibrary/catalog';
import type { ModelLocation, ModelSource } from '../services/modelLibrary/types';

const source: ModelSource = {
  id: 'source-1', name: 'LoRAs', path: 'D:/models/loras', kind: 'lora', recursive: true, createdAt: 1, updatedAt: 1,
};

describe('model library catalog', () => {
  it.each(['Linux x86_64', 'MacIntel'])('keeps case-distinct files independent on %s', (platform) => {
    const paths = ['Foo.safetensors', 'foo.safetensors'];
    const scan = [{ sourceId: source.id, locations: paths.map((relativePath) => ({
      sourceId: source.id, relativePath, absolutePath: `/synthetic/models/${relativePath}`,
      fileName: relativePath, size: 10, createdAt: 2, modifiedAt: 3,
    })) }];
    const first = reconcileModelCatalog({ version: 1, locations: [], updatedAt: 0 }, [source], scan, 100, platform);
    expect(new Set(first.locations.map((location) => location.id)).size).toBe(2);
    first.locations.find((location) => location.fileName === 'Foo.safetensors')!.sha256 = 'a'.repeat(64);
    first.locations.find((location) => location.fileName === 'foo.safetensors')!.sha256 = 'b'.repeat(64);
    first.locations.find((location) => location.fileName === 'Foo.safetensors')!.civitai = { status: 'notFound', fetchedAt: 101, url: '' };
    const second = reconcileModelCatalog(first, [source], scan, 200, platform);
    expect(second.locations.find((location) => location.fileName === 'Foo.safetensors')).toMatchObject({ sha256: 'a'.repeat(64), civitai: { fetchedAt: 101 } });
    expect(second.locations.find((location) => location.fileName === 'foo.safetensors')).toMatchObject({ sha256: 'b'.repeat(64) });
    expect(second.locations.find((location) => location.fileName === 'foo.safetensors')!.civitai).toBeUndefined();
    expect(second.managedModels).toHaveLength(2);
  });

  it('retains Windows IDs and enrichment when only path casing changes', () => {
    const scanned = { sourceId: source.id, relativePath: 'Folder\\Foo.safetensors', absolutePath: 'D:/synthetic/Folder/Foo.safetensors', fileName: 'Foo.safetensors', size: 10, createdAt: 2, modifiedAt: 3 };
    const first = reconcileModelCatalog({ version: 1, locations: [], updatedAt: 0 }, [source], [{ sourceId: source.id, locations: [scanned] }], 100, 'Win32');
    first.locations[0].sha256 = 'a'.repeat(64);
    const second = reconcileModelCatalog(first, [source], [{ sourceId: source.id, locations: [{ ...scanned, relativePath: 'folder\\foo.safetensors' }] }], 200, 'Win32');
    expect(second.locations[0]).toMatchObject({ id: 'source-1:folder\\foo.safetensors', sha256: 'a'.repeat(64), discoveredAt: 100 });
  });

  it('classifies a mixed ComfyUI root per directory without treating filenames as types', () => {
    const mixed: ModelSource = { ...source, path: 'Z:\\synthetic\\ComfyUI\\Models', kind: 'auto' };
    const paths = ['LoRAs\\style\\a.safetensors', 'checkpoints/b.safetensors', 'unet/c.safetensors', 'diffusion_models/d.safetensors', 'vae/e.safetensors', 'text_encoders/f.safetensors', 'clip/g.safetensors', 'clip_vision/h.safetensors', 'controlnet/i.safetensors', 'upscale_models/j.safetensors', 'embeddings/k.safetensors', 'misc/lora-name.safetensors'];
    const scan = [{ sourceId: mixed.id, locations: paths.map((relativePath) => ({ sourceId: mixed.id, relativePath, absolutePath: `${mixed.path}/${relativePath}`, fileName: relativePath.split(/[\\/]/).pop()!, size: 10, createdAt: null, modifiedAt: null })) }];
    const catalog = reconcileModelCatalog({ version: 1, locations: [], updatedAt: 0 }, [mixed], scan);
    expect(Object.fromEntries(catalog.locations.map((location) => [location.relativePath, location.sourceKind]))).toEqual(Object.fromEntries(paths.map((path, index) => [path, ['lora', 'checkpoint', 'diffusion', 'diffusion', 'vae', 'textEncoder', 'textEncoder', 'clipVision', 'controlnet', 'upscaler', 'embedding', 'other'][index]])));
    const overridden = reconcileModelCatalog(catalog, [{ ...mixed, kind: 'checkpoint' }], scan);
    expect(overridden.locations.every((location) => location.sourceKind === 'checkpoint')).toBe(true);
  });

  it('recognizes an automatically classified dedicated folder, including nested files', () => {
    const dedicated: ModelSource = { ...source, kind: 'auto' };
    const scan = [{ sourceId: source.id, locations: [{ sourceId: source.id, relativePath: 'artist/model.safetensors', absolutePath: `${source.path}/artist/model.safetensors`, fileName: 'model.safetensors', size: 10, createdAt: null, modifiedAt: null }] }];
    expect(reconcileModelCatalog({ version: 1, locations: [], updatedAt: 0 }, [dedicated], scan).locations[0].sourceKind).toBe('lora');
  });

  it('keeps discovery time while reconciling a successfully scanned source', () => {
    const scan = [{ sourceId: source.id, locations: [{ sourceId: source.id, relativePath: 'folder/model.safetensors', absolutePath: 'D:/models/loras/folder/model.safetensors', fileName: 'model.safetensors', size: 10, createdAt: 2, modifiedAt: 3 }] }];
    const first = reconcileModelCatalog({ version: 1, locations: [], updatedAt: 0 }, [source], scan, 100);
    const second = reconcileModelCatalog(first, [source], scan, 200);
    expect(second.locations).toMatchObject([{ id: 'source-1:folder/model.safetensors', discoveredAt: 100, lastSeenAt: 200, sourceKind: 'lora' }]);
  });

  it('does not discard cached locations when a source scan fails', () => {
    const catalog = { version: 1 as const, updatedAt: 10, locations: [{ id: 'source-1:model.safetensors', sourceId: source.id, sourceKind: 'lora' as const, sourceName: 'LoRAs', relativePath: 'model.safetensors', absolutePath: 'D:/models/loras/model.safetensors', fileName: 'model.safetensors', size: 10, createdAt: null, modifiedAt: null, discoveredAt: 1, lastSeenAt: 10 }] };
    expect(reconcileModelCatalog(catalog, [source], [{ sourceId: source.id, locations: [], error: 'Disk unavailable' }], 20).locations).toEqual(catalog.locations);
  });

  it('builds logical managed identities before hashing and groups duplicate hashes afterward', () => {
    const locations = [
      { id: 'one', sha256: 'a'.repeat(64) },
      { id: 'two', sha256: 'a'.repeat(64) },
      { id: 'three' },
    ] as unknown as ModelLocation[];
    expect(buildManagedModels(locations)).toEqual([
      { id: `sha256:${'a'.repeat(64)}`, sha256: 'a'.repeat(64), primaryLocationId: 'one', locationIds: ['one', 'two'] },
      { id: 'location:three', sha256: undefined, primaryLocationId: 'three', locationIds: ['three'] },
    ]);
  });

  it('preserves Civitai enrichment when an unchanged file is rescanned', () => {
    const scan = [{ sourceId: source.id, locations: [{ sourceId: source.id, relativePath: 'model.safetensors', absolutePath: 'D:/models/loras/model.safetensors', fileName: 'model.safetensors', size: 10, createdAt: 2, modifiedAt: 3 }] }];
    const first = reconcileModelCatalog({ version: 1, locations: [], updatedAt: 0 }, [source], scan, 100);
    first.locations[0].civitai = { status: 'notFound', fetchedAt: 101, url: '' };
    expect(reconcileModelCatalog(first, [source], scan, 200).locations[0].civitai).toEqual(first.locations[0].civitai);
  });
});
