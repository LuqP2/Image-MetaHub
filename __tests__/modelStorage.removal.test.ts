// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createModelStorageController } from '../electron/modelStorage.mjs';
import type { ModelCatalog, ModelSource } from '../services/modelLibrary/types';

let directory: string;
let catalog: ModelCatalog;
let sources: ModelSource[];
let roots: Set<string>;
let timestamp: number;
let progress: { kind: string } | null;
let trash: ReturnType<typeof vi.fn>;
let confirm: ReturnType<typeof vi.fn>;
let controller: ReturnType<typeof createModelStorageController>;

async function addFile(id: string, filename = `${id}.safetensors`, sourceId = 's', bytes = 'synthetic model') {
  const absolutePath = path.join(directory, filename);
  await fs.writeFile(absolutePath, bytes);
  const stat = await fs.stat(absolutePath);
  const location = { id, sourceId, sourceKind: 'checkpoint' as const, sourceName: sourceId, absolutePath, relativePath: filename, fileName: filename, size: stat.size, modifiedAt: stat.mtimeMs, createdAt: 1, discoveredAt: 1, lastSeenAt: 1 };
  catalog.locations.push(location);
  return location;
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-model-removal-'));
  catalog = { version: 1, locations: [], updatedAt: 1 };
  sources = [{ id: 's', name: 'Synthetic', path: directory, kind: 'checkpoint', recursive: true, createdAt: 1, updatedAt: 1 }];
  roots = new Set([directory]); timestamp = 1; progress = null;
  trash = vi.fn(async (filePath: string) => { await fs.unlink(filePath); }); // Only test-created files.
  confirm = vi.fn(async () => true);
  controller = createModelStorageController({ getState: () => ({ catalog, sources, progress }), getRoots: () => roots, now: () => timestamp, trashItem: trash, confirm,
    onRemoved: (ids: string[]) => { catalog.locations = catalog.locations.filter((entry) => !ids.includes(entry.id)); } });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe('catalog-authorized model file removal', () => {
  it('shows changed or unavailable catalog files as stale without trusting cached hashes', async () => {
    const changed = await addFile('changed'), missing = await addFile('missing');
    changed.sha256 = missing.sha256 = 'a'.repeat(64);
    await fs.writeFile(changed.absolutePath, 'changed synthetic bytes');
    await fs.unlink(missing.absolutePath);
    const overview = await controller.overview();
    expect(overview.files.find((entry: { key: string }) => entry.key.endsWith('changed.safetensors'))).toMatchObject({ stale: true, sha256: undefined });
    expect(overview.files.find((entry: { key: string }) => entry.key.endsWith('missing.safetensors'))).toMatchObject({ stale: true, sha256: undefined, error: expect.any(String) });
    expect(trash).not.toHaveBeenCalled();
  });
  it('removes only selected paths and reconciles overlapping source records', async () => {
    const one = await addFile('one'); const copy = await addFile('copy');
    sources.push({ ...sources[0], id: 'overlap' });
    catalog.locations.push({ ...one, id: 'alias', sourceId: 'overlap' });
    one.sha256 = copy.sha256 = 'a'.repeat(64);
    const plan = await controller.prepare({ locationIds: ['one', 'alias'] });
    expect(plan.files).toHaveLength(1);
    expect(plan.remainingCopies[0].count).toBe(1);
    expect(trash).not.toHaveBeenCalled();
    expect(await controller.execute({ planId: plan.planId })).toEqual({ removedLocationIds: ['one', 'alias'], failures: [] });
    expect(trash).toHaveBeenCalledExactlyOnceWith(one.absolutePath);
    expect(catalog.locations.map((entry) => entry.id)).toEqual(['copy']);
    expect(await fs.readFile(copy.absolutePath, 'utf8')).toBe('synthetic model');
  });
  it('removes all explicitly selected copies and reports no remaining copies', async () => {
    const one = await addFile('one'); const copy = await addFile('copy');
    one.sha256 = copy.sha256 = 'a'.repeat(64);
    const plan = await controller.prepare({ locationIds: ['one', 'copy'] });
    expect(plan.remainingCopies.map((entry: { count: number }) => entry.count)).toEqual([0, 0]);
    expect((await controller.execute({ planId: plan.planId })).removedLocationIds).toEqual(['one', 'copy']);
    expect(catalog.locations).toHaveLength(0);
  });
  it('cancels natively without touching any file and consumes the plan', async () => {
    await addFile('one'); confirm.mockResolvedValue(false);
    const plan = await controller.prepare({ locationIds: ['one'] });
    expect(await controller.execute({ planId: plan.planId })).toMatchObject({ cancelled: true, removedLocationIds: [], failures: [] });
    expect(trash).not.toHaveBeenCalled(); expect(catalog.locations).toHaveLength(1);
    await expect(controller.execute({ planId: plan.planId })).rejects.toThrow(/expired/);
  });
  it('keeps failed files in the catalog and reports partial success', async () => {
    await addFile('one'); const copy = await addFile('copy');
    trash.mockImplementation(async (filePath: string) => { if (filePath === copy.absolutePath) throw new Error('Trash unavailable'); await fs.unlink(filePath); });
    const plan = await controller.prepare({ locationIds: ['one', 'copy'] });
    const result = await controller.execute({ planId: plan.planId });
    expect(result.removedLocationIds).toEqual(['one']);
    expect(result.failures).toEqual([{ path: copy.absolutePath, locationIds: ['copy'], error: 'Trash unavailable' }]);
    expect(catalog.locations.map((entry) => entry.id)).toEqual(['copy']);
    expect(await fs.stat(copy.absolutePath)).toBeTruthy();
  });
  it('revalidates each file after confirmation, including files changed midway through a batch', async () => {
    await addFile('one'); const copy = await addFile('copy');
    trash.mockImplementation(async (filePath: string) => { await fs.unlink(filePath); await fs.writeFile(copy.absolutePath, 'changed synthetic file'); });
    const plan = await controller.prepare({ locationIds: ['one', 'copy'] });
    const result = await controller.execute({ planId: plan.planId });
    expect(result.removedLocationIds).toEqual(['one']); expect(result.failures[0].error).toMatch(/changed/);
    expect(trash).toHaveBeenCalledTimes(1);
  });
  it.each(['size', 'mtime', 'identity'])('rejects a changed %s after preparation', async (change) => {
    const one = await addFile('one'); const plan = await controller.prepare({ locationIds: ['one'] });
    if (change === 'size') await fs.writeFile(one.absolutePath, 'larger synthetic model data');
    if (change === 'mtime') await fs.utimes(one.absolutePath, 1, 1);
    if (change === 'identity') { await fs.rename(one.absolutePath, `${one.absolutePath}.old`); await fs.writeFile(one.absolutePath, 'synthetic model'); await fs.utimes(one.absolutePath, 1, one.modifiedAt! / 1000); }
    expect((await controller.execute({ planId: plan.planId })).failures[0].error).toMatch(/changed/);
    expect(trash).not.toHaveBeenCalled();
  });
  it('rejects a file already changed when preparing', async () => {
    const one = await addFile('one'); await fs.writeFile(one.absolutePath, 'changed');
    await expect(controller.prepare({ locationIds: ['one'] })).rejects.toThrow(/changed/);
  });
  it.each(['expiry', 'catalog', 'roots'])('invalidates plans after %s changes', async (change) => {
    await addFile('one'); const plan = await controller.prepare({ locationIds: ['one'] });
    if (change === 'expiry') timestamp += 5 * 60_000;
    if (change === 'catalog') await addFile('two');
    if (change === 'roots') roots.clear();
    await expect(controller.execute({ planId: plan.planId })).rejects.toThrow(/expired|changed/);
    expect(confirm).not.toHaveBeenCalled(); expect(trash).not.toHaveBeenCalled();
  });
  it('rechecks catalog changes while the native confirmation is open', async () => {
    await addFile('one'); const plan = await controller.prepare({ locationIds: ['one'] });
    confirm.mockImplementation(async () => { sources = []; return true; });
    await expect(controller.execute({ planId: plan.planId })).rejects.toThrow(/changed/);
    expect(trash).not.toHaveBeenCalled();
  });
  it('rejects unknown IDs and never treats a supplied path as deletion authority', async () => {
    const one = await addFile('one');
    await expect(controller.prepare({ locationIds: ['unknown'], filePath: one.absolutePath })).rejects.toThrow(/Unknown/);
    await expect(controller.prepare({ filePath: one.absolutePath })).rejects.toThrow(/Choose/);
    expect(trash).not.toHaveBeenCalled();
  });
  it('rejects catalog paths outside their registered root and non-model files', async () => {
    const one = await addFile('one'); one.absolutePath = path.join(directory, '..', 'escape.safetensors');
    await expect(controller.prepare({ locationIds: ['one'] })).rejects.toThrow(/outside/);
    one.absolutePath = path.join(directory, 'not-model.txt');
    await expect(controller.prepare({ locationIds: ['one'] })).rejects.toThrow(/outside/);
  });
  it('blocks directory junctions and does not follow their target', async () => {
    const target = path.join(directory, 'target'); await fs.mkdir(target);
    const targetPath = path.join(target, 'one.safetensors'); await fs.writeFile(targetPath, 'synthetic');
    const junction = path.join(directory, 'junction'); await fs.symlink(target, junction, 'junction');
    const stats = await fs.stat(targetPath);
    catalog.locations.push({ id: 'one', sourceId: 's', absolutePath: path.join(junction, 'one.safetensors'), size: stats.size, modifiedAt: stats.mtimeMs } as ModelCatalog['locations'][number]);
    await expect(controller.prepare({ locationIds: ['one'] })).rejects.toThrow(/links|junctions/);
    expect(trash).not.toHaveBeenCalled();
  });
  it('counts hardlinked storage once but removes only the chosen directory entry', async () => {
    const one = await addFile('one'); const linkedPath = path.join(directory, 'linked.safetensors'); await fs.link(one.absolutePath, linkedPath);
    catalog.locations.push({ ...one, id: 'linked', absolutePath: linkedPath, relativePath: 'linked.safetensors' });
    const overview = await controller.overview();
    expect(overview.files[0].physicalId).toBe(overview.files[1].physicalId);
    const plan = await controller.prepare({ locationIds: ['one'] });
    expect(plan.remainingCopies[0].count).toBe(1);
    await controller.execute({ planId: plan.planId });
    expect(await fs.readFile(linkedPath, 'utf8')).toBe('synthetic model');
    expect(catalog.locations.map((entry) => entry.id)).toEqual(['linked']);
  });
  it('serializes native confirmation with scan/hash jobs and other removals', async () => {
    await addFile('one'); const plan = await controller.prepare({ locationIds: ['one'] });
    let finish!: (value: boolean) => void;
    confirm.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const removing = controller.execute({ planId: plan.planId });
    await expect(controller.runJob(async () => {})).rejects.toThrow(/removal/);
    await expect(controller.prepare({ locationIds: ['one'] })).rejects.toThrow(/current model job/);
    await expect(controller.execute({ planId: plan.planId })).rejects.toThrow(/current model job/);
    finish(false); await removing;
    let release!: () => void;
    const hashing = controller.runJob(() => new Promise<void>((resolve) => { release = resolve; }));
    await expect(controller.prepare({ locationIds: ['one'] })).rejects.toThrow(/current model job/);
    release(); await hashing;
    progress = { kind: 'updates' };
    await expect(controller.prepare({ locationIds: ['one'] })).rejects.toThrow(/current model job/);
  });
});
