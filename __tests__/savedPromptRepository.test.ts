import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetProvenanceRepository, PROVENANCE_SCHEMA_VERSION } from '../electron/provenanceRepository.mjs';
import { SavedPromptRepository } from '../electron/savedPromptRepository.mjs';

const temporaryDirectories: string[] = [];
const makeTempDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-prompts-'));
  temporaryDirectories.push(directory);
  return directory;
};

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('saved prompt repository', () => {
  it('migrates to the current schema and preserves literal prompts across reopen and idempotent removal', () => {
    const directory = makeTempDirectory();
    const databasePath = path.join(directory, 'catalog.sqlite');
    const repository = new AssetProvenanceRepository({ databasePath, randomUUID: () => uuid(1) });
    expect(repository.open().schemaVersion).toBe(PROVENANCE_SCHEMA_VERSION);

    const result = repository.savePrompt({
      positivePrompt: '  Literal\nPrompt  ',
      negativePrompt: '',
      textBasis: 'effective',
      source: null,
      sourceCreatedAt: 1_700_000_000_000,
    });
    expect(result).toMatchObject({
      status: 'saved',
      prompt: { positivePrompt: '  Literal\nPrompt  ', negativePrompt: '', sourceCreatedAt: 1_700_000_000_000 },
    });
    repository.close();

    const reopened = new AssetProvenanceRepository({ databasePath });
    reopened.open();
    expect(reopened.listSavedPrompts()).toEqual([result.prompt]);
    expect(reopened.removeSavedPrompt(result.prompt.id)).toEqual({ id: result.prompt.id, removed: true });
    expect(reopened.removeSavedPrompt(result.prompt.id)).toEqual({ id: result.prompt.id, removed: false });
    reopened.close();
  });

  it('migrates v6 bookmarks without inventing an image creation timestamp', () => {
    const directory = makeTempDirectory();
    const databasePath = path.join(directory, 'catalog.sqlite');
    let repository = new AssetProvenanceRepository({ databasePath });
    repository.open({ targetSchemaVersion: 6 });
    repository.database.prepare(`
      INSERT INTO saved_prompts (
        id, created_at, positive_prompt, negative_prompt, text_basis, source_json, prompt_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(2), 100, 'legacy prompt', '', 'effective', null, 'legacy-digest');
    repository.close();

    repository = new AssetProvenanceRepository({ databasePath });
    expect(repository.open().schemaVersion).toBe(PROVENANCE_SCHEMA_VERSION);
    expect(repository.listSavedPrompts()).toEqual([expect.objectContaining({
      id: uuid(2),
      sourceCreatedAt: null,
    })]);
    repository.close();
  });

  it('deduplicates only exact pairs and remains correct under digest collisions', () => {
    const directory = makeTempDirectory();
    const owner = new AssetProvenanceRepository({ databasePath: path.join(directory, 'catalog.sqlite') });
    owner.open();
    let nextId = 10;
    const prompts = new SavedPromptRepository({
      database: owner.database,
      digest: () => 'collision',
      randomUUID: () => uuid(nextId++),
      now: () => nextId,
    });
    const first = prompts.save({ positivePrompt: 'Cat', negativePrompt: 'bad', textBasis: 'effective', source: null });
    const differentCase = prompts.save({ positivePrompt: 'cat', negativePrompt: 'bad', textBasis: 'effective', source: null });
    const differentWhitespace = prompts.save({ positivePrompt: 'Cat ', negativePrompt: 'bad', textBasis: 'effective', source: null });
    const duplicate = prompts.save({ positivePrompt: 'Cat', negativePrompt: 'bad', textBasis: 'original', source: null });
    expect([first.status, differentCase.status, differentWhitespace.status, duplicate.status]).toEqual([
      'saved', 'saved', 'saved', 'already-saved',
    ]);
    expect(duplicate.prompt).toEqual(first.prompt);
    expect(prompts.list()).toHaveLength(3);
    owner.close();
  });

  it('keeps the first historical origin after a duplicate save from another image', () => {
    const directory = makeTempDirectory();
    const repository = new AssetProvenanceRepository({ databasePath: path.join(directory, 'catalog.sqlite') });
    repository.open();
    const sourceA = { kind: 'path' as const, pathAtSave: { directoryPath: directory, relativePath: 'a.png', fileSize: 1, contentModifiedMs: 2 } };
    const sourceB = { kind: 'path' as const, pathAtSave: { directoryPath: directory, relativePath: 'b.png', fileSize: 3, contentModifiedMs: 4 } };
    const first = repository.savePrompt({
      positivePrompt: 'same', negativePrompt: '', textBasis: 'effective', source: sourceA, sourceCreatedAt: 100,
    });
    const duplicate = repository.savePrompt({
      positivePrompt: 'same', negativePrompt: '', textBasis: 'effective', source: sourceB, sourceCreatedAt: 200,
    });
    expect(duplicate.status).toBe('already-saved');
    expect(duplicate.prompt.id).toBe(first.prompt.id);
    expect(duplicate.prompt.source).toEqual(sourceA);
    expect(duplicate.prompt.sourceCreatedAt).toBe(100);
    repository.close();
  });

  it('validates stable references, follows known moves, and reports overwrite changes', () => {
    const directory = makeTempDirectory();
    const originalPath = path.join(directory, 'source.png');
    fs.writeFileSync(originalPath, 'one');
    const stat = fs.statSync(originalPath);
    const repository = new AssetProvenanceRepository({ databasePath: path.join(directory, 'catalog.sqlite') });
    repository.open();
    const rootId = uuid(21);
    const assetId = uuid(22);
    const revisionId = uuid(23);
    const locationId = uuid(24);
    repository.ensureLibraryRoot({ rootId, absolutePath: directory, pathKey: directory.toLowerCase() });
    repository.createAssetWithRevisionAndLocation({
      assetId, revisionId, locationId, rootId, relativePath: 'source.png', relativePathKey: 'source.png',
      byteSize: stat.size, contentModifiedMs: stat.mtimeMs,
    });
    const saved = repository.savePrompt({
      positivePrompt: 'stable', negativePrompt: '', textBasis: 'effective',
      source: {
        kind: 'stable',
        reference: { assetId, revisionId, locationId, rootId },
        pathAtSave: { directoryPath: directory, relativePath: 'source.png', fileSize: stat.size, contentModifiedMs: stat.mtimeMs },
      },
    });
    expect(repository.resolveSavedPromptSource(saved.prompt.id)).toMatchObject({ status: 'available', absolutePath: originalPath, sourceChanged: false });

    const movedPath = path.join(directory, 'moved.png');
    fs.renameSync(originalPath, movedPath);
    repository.relocateLocation(locationId, { rootId, relativePath: 'moved.png', relativePathKey: 'moved.png' });
    expect(repository.resolveSavedPromptSource(saved.prompt.id)).toMatchObject({ status: 'available', absolutePath: movedPath, sourceChanged: false });

    fs.writeFileSync(movedPath, 'two-two');
    repository.addRevision(assetId, { revisionId: uuid(25), locationId, byteSize: 7, contentModifiedMs: fs.statSync(movedPath).mtimeMs });
    expect(repository.resolveSavedPromptSource(saved.prompt.id)).toMatchObject({ status: 'available', absolutePath: movedPath, sourceChanged: true });

    const invalidCombination = repository.savePrompt({
      positivePrompt: 'stale reference combination', negativePrompt: '', textBasis: 'effective',
      source: {
        kind: 'stable',
        reference: { assetId, revisionId, locationId, rootId },
        pathAtSave: { directoryPath: directory, relativePath: 'moved.png', fileSize: 7, contentModifiedMs: fs.statSync(movedPath).mtimeMs },
      },
    });
    expect(invalidCombination.prompt.source).toMatchObject({ kind: 'path' });
    repository.close();
  });

  it('downgrades an unconfirmed stable reference to a valid path and never inserts on failure', () => {
    const directory = makeTempDirectory();
    const repository = new AssetProvenanceRepository({ databasePath: path.join(directory, 'catalog.sqlite') });
    repository.open();
    const result = repository.savePrompt({
      positivePrompt: 'path fallback', negativePrompt: '', textBasis: 'effective',
      source: {
        kind: 'stable',
        reference: { assetId: uuid(31), revisionId: uuid(32), locationId: uuid(33), rootId: uuid(34) },
        pathAtSave: { directoryPath: directory, relativePath: 'source.png', fileSize: null, contentModifiedMs: null },
      },
    });
    expect(result.prompt.source).toEqual({
      kind: 'path',
      pathAtSave: { directoryPath: directory, relativePath: 'source.png', fileSize: null, contentModifiedMs: null },
    });

    repository.database.exec("CREATE TRIGGER reject_prompt BEFORE INSERT ON saved_prompts BEGIN SELECT RAISE(ABORT, 'commit failed'); END;");
    expect(() => repository.savePrompt({ positivePrompt: 'will fail', negativePrompt: '', textBasis: 'effective', source: null })).toThrow('commit failed');
    expect(repository.listSavedPrompts().map((prompt) => prompt.positivePrompt)).toEqual(['path fallback']);
    repository.close();
  });

  it('accepts in-root names beginning with two dots while rejecting an actual parent traversal', () => {
    const directory = makeTempDirectory();
    const repository = new AssetProvenanceRepository({ databasePath: path.join(directory, 'catalog.sqlite') });
    repository.open();
    const inRootPath = path.join('..drafts', 'image.png');
    const accepted = repository.savePrompt({
      positivePrompt: 'in-root dotted folder', negativePrompt: '', textBasis: 'effective',
      source: {
        kind: 'path',
        pathAtSave: { directoryPath: directory, relativePath: inRootPath, fileSize: null, contentModifiedMs: null },
      },
    });
    expect(accepted.prompt.source).toEqual({
      kind: 'path',
      pathAtSave: { directoryPath: directory, relativePath: inRootPath, fileSize: null, contentModifiedMs: null },
    });

    const rejected = repository.savePrompt({
      positivePrompt: 'actual parent traversal', negativePrompt: '', textBasis: 'effective',
      source: {
        kind: 'path',
        pathAtSave: { directoryPath: directory, relativePath: path.join('..', 'outside.png'), fileSize: null, contentModifiedMs: null },
      },
    });
    expect(rejected.prompt.source).toBeNull();
    repository.close();
  });

  it('serializes duplicate saves and includes prompts in verified catalog backups', async () => {
    const directory = makeTempDirectory();
    const databasePath = path.join(directory, 'catalog.sqlite');
    let nextId = 40;
    const repository = new AssetProvenanceRepository({
      databasePath,
      randomUUID: () => uuid(nextId++),
    });
    repository.open();
    const input = { positivePrompt: 'concurrent', negativePrompt: 'pair', textBasis: 'effective' as const, source: null };
    const results = await Promise.all([
      Promise.resolve().then(() => repository.savePrompt(input)),
      Promise.resolve().then(() => repository.savePrompt(input)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['already-saved', 'saved']);
    expect(new Set(results.map((result) => result.prompt.id)).size).toBe(1);

    const backupPath = path.join(directory, 'backup.sqlite');
    repository.createBackup(backupPath);
    repository.close();
    const backup = new AssetProvenanceRepository({ databasePath: backupPath, readOnly: true });
    backup.open();
    expect(backup.listSavedPrompts()).toEqual([results[0].prompt]);
    backup.close();
  });
});
