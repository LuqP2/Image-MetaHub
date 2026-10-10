import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetProvenanceRepository, PROVENANCE_SCHEMA_VERSION, ProvenanceRepositoryLifecycle } from '../electron/provenanceRepository.mjs';
import { runSavedPromptPackagedSmoke } from '../electron/savedPromptPackagedSmoke.mjs';
import { emptyEditor, makeDocument, snapshotBlock } from '../services/promptLibrary/core.mjs';

const directories: string[] = [];
const repositories: AssetProvenanceRepository[] = [];
const temp = () => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-prompt-v2-')); directories.push(directory); return directory; };
const open = (databasePath: string) => { const repository = new AssetProvenanceRepository({ databasePath }); repository.open(); repositories.push(repository); return repository; };
afterEach(() => { for (const repository of repositories.splice(0)) repository.close(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('Prompt Library transactional repository', () => {
  it('migrates schema 7 without changing legacy text, IDs, source or dates', () => {
    const databasePath = path.join(temp(), 'catalog.sqlite');
    const legacy = new AssetProvenanceRepository({ databasePath }); legacy.open({ targetSchemaVersion: 7 });
    legacy.database.prepare('INSERT INTO saved_prompts(id,created_at,positive_prompt,negative_prompt,text_basis,source_json,prompt_digest,source_created_at) VALUES(?,?,?,?,?,?,?,?)').run('00000000-0000-4000-8000-000000000001', 123, '  legacy\ntext  ', 'negative', 'original', null, 'digest', 100);
    legacy.close(); const repository = open(databasePath);
    expect(repository.getStatus().schemaVersion).toBe(PROVENANCE_SCHEMA_VERSION);
    expect(repository.listPromptLibrary()).toMatchObject({ blocks: [], prompts: [{ id: '00000000-0000-4000-8000-000000000001', positivePrompt: '  legacy\ntext  ', negativePrompt: 'negative', textBasis: 'original', createdAt: 123, sourceCreatedAt: 100 }] });
    expect(repository.listSavedPrompts()[0].editor).toBeUndefined();
  });

  it('persists negative-only prompts and frozen snapshots after original edit/delete/reopen', () => {
    const databasePath = path.join(temp(), 'catalog.sqlite'); const repository = open(databasePath);
    const created = repository.mutatePromptLibrary({ action: 'create', kind: 'block', item: { text: '  soft light  ', editor: emptyEditor() } });
    const block = created.blocks[0]; const editor = emptyEditor(); editor.document = makeDocument(); editor.document.positive = [snapshotBlock(block)];
    const composed = repository.mutatePromptLibrary({ action: 'create', kind: 'prompt', item: { editor } });
    repository.mutatePromptLibrary({ action: 'update', kind: 'block', item: { ...block, text: 'hard light' }, expectedRevision: 1 });
    repository.mutatePromptLibrary({ action: 'remove', kind: 'block', id: block.id });
    repository.mutatePromptLibrary({ action: 'create', kind: 'prompt', item: { negativePrompt: '  bad hands  ' } });
    repository.close(); const reopened = open(databasePath).listPromptLibrary();
    expect(reopened.blocks).toEqual([]); expect(reopened.prompts.find((p) => p.id === composed.selectedId)?.positivePrompt).toBe('  soft light  ');
    expect(reopened.prompts.some((p) => p.positivePrompt === '' && p.negativePrompt === '  bad hands  ')).toBe(true);
  });

  it('rejects stale edits and rolls back multi-item persistence failures completely', () => {
    const repository = open(path.join(temp(), 'catalog.sqlite'));
    const first = repository.mutatePromptLibrary({ action: 'create', kind: 'prompt', item: { positivePrompt: 'first' } }).prompts[0];
    repository.mutatePromptLibrary({ action: 'update', kind: 'prompt', item: { ...first, negativePrompt: 'updated' }, expectedRevision: 1 });
    expect(() => repository.mutatePromptLibrary({ action: 'update', kind: 'prompt', item: first, expectedRevision: 1 })).toThrow('another window');
    const before = repository.listPromptLibrary();
    repository.database.exec("CREATE TRIGGER reject_import BEFORE INSERT ON saved_prompts WHEN NEW.positive_prompt = 'reject' BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");
    expect(() => repository.mutatePromptLibrary({ action: 'import', blocks: [{ text: 'new block' }], prompts: [{ positivePrompt: 'accepted' }, { positivePrompt: 'reject' }], keepDuplicates: true })).toThrow('simulated disk failure');
    expect(repository.listPromptLibrary()).toEqual(before);
    expect(() => repository.mutatePromptLibrary({ action: 'bulk', kind: 'prompt', ids: [first.id, 'missing'], addTags: ['tag'] })).toThrow('no longer exists');
    expect(repository.listPromptLibrary()).toEqual(before);
  });

  it('uses the shared packaged smoke scenario in a synthetic profile', () => {
    const userDataPath = temp(); const repositoryLifecycle = new ProvenanceRepositoryLifecycle({ userDataPath }); repositoryLifecycle.initialize();
    const result = runSavedPromptPackagedSmoke({ userDataPath, repositoryLifecycle, indexingEnabled: false });
    expect(result).toMatchObject({ blockSnapshotsPreserved: true });
    repositoryLifecycle.close();
  });
});
