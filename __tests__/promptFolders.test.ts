import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb';
import { describe, expect, it } from 'vitest';
import { applyMutation, emptyEditor } from '../services/promptLibrary/core.mjs';
import { exportJson, parseImport } from '../services/promptLibrary/importExport';
import { AssetProvenanceRepository } from '../electron/provenanceRepository.mjs';
import { browserPromptLibrary } from '../services/savedPromptStorage';

describe('Prompt folders', () => {
  it('creates empty folders, rejects duplicate names, preserves membership on duplicate, and unfiles on delete', () => {
    const folder = applyMutation({ prompts: [], blocks: [] }, { action: 'folder-create', name: ' Portraits ' });
    expect(folder.folders).toHaveLength(1);
    expect(() => applyMutation(folder, { action: 'folder-create', name: 'portraits' })).toThrow('already exists');
    const id = folder.folders![0].id;
    const created = applyMutation(folder, { action: 'create', kind: 'prompt', item: { positivePrompt: 'face', editor: { ...emptyEditor(), folderId: id } } });
    const duplicated = applyMutation(created, { action: 'duplicate', kind: 'prompt', id: created.prompts[0].id });
    expect(duplicated.prompts.every(item => item.editor?.folderId === id)).toBe(true);
    const removed = applyMutation(duplicated, { action: 'folder-remove', id });
    expect(removed.prompts).toHaveLength(2);
    expect(removed.prompts.every(item => !item.editor?.folderId)).toBe(true);
    expect(removed.folders).toEqual([]);
  });
  it('round trips v2, remaps folders by name and accepts v1 exports', () => {
    let source = applyMutation({ prompts: [], blocks: [] }, { action: 'folder-create', name: 'Portraits' });
    source = applyMutation(source, { action: 'create', kind: 'block', item: { text: 'face', editor: { ...emptyEditor(), folderId: source.selectedId } } });
    const imported = parseImport(exportJson(source), 'json');
    const target = applyMutation({ prompts: [], blocks: [] }, { action: 'folder-create', name: 'portraits' });
    const merged = applyMutation(target, { action: 'import', ...imported, keepDuplicates: false });
    expect(merged.folders).toHaveLength(1);
    expect(merged.blocks[0].editor.folderId).toBe(target.folders![0].id);
    expect(parseImport(JSON.stringify({ format: 'image-metahub-prompt-library', schemaVersion: 1, prompts: [], blocks: [] }), 'json').folders).toEqual([]);
    const twice = applyMutation(merged, { action: 'import', ...imported, keepDuplicates: false });
    expect(twice.blocks).toHaveLength(1);
  });
  it('persists empty folders and membership transactionally in Electron', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-folders-'));
    const repo = new AssetProvenanceRepository({ databasePath: path.join(directory, 'catalog.sqlite') }); repo.open();
    try {
      const folder = repo.mutatePromptLibrary({ action: 'folder-create', name: 'Empty' });
      expect(repo.listPromptLibrary().folders).toEqual(folder.folders);
      repo.mutatePromptLibrary({ action: 'folder-rename', id: folder.selectedId, name: 'Renamed' });
      expect(repo.listPromptLibrary().folders[0].name).toBe('Renamed');
    } finally { repo.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it('persists empty folders and assignments in IndexedDB', async () => {
    installFakeIndexedDb({ completionAtTaskEnd: true });
    const folder = await browserPromptLibrary({ action: 'folder-create', name: 'Browser' });
    const result = await browserPromptLibrary({ action: 'create', kind: 'block', item: { text: 'light', editor: { ...emptyEditor(), folderId: folder.selectedId } } });
    const snapshot = await browserPromptLibrary();
    expect(snapshot.folders).toEqual(result.folders);
    expect(snapshot.blocks.find(item => item.id === result.selectedId)?.editor.folderId).toBe(folder.selectedId);
  });
});
