import { describe, expect, it } from 'vitest';
import { allVariables, applyMutation, compilePrompt, emptyEditor, makeDocument, snapshotBlock } from '../services/promptLibrary/core.mjs';
import { exportCsv, exportJson, parseCsv, parseImport } from '../services/promptLibrary/importExport';
import { dice, findDuplicates } from '../services/promptLibrary/duplicates';
import { emptyFilters, filterItems } from '../services/promptLibrary/search';
import type { PromptBlock, PromptLibrarySnapshot, SavedPrompt } from '../types';
const block = (): PromptBlock => ({ id: crypto.randomUUID(), createdAt: 1, updatedAt: 1, revision: 1, text: '  soft\nlight  ', editor: { ...emptyEditor(), title: 'Light', category: 'Lighting' } });
const prompt = (positive = 'cat', negative = ''): SavedPrompt => ({ id: crypto.randomUUID(), createdAt: 1, sourceCreatedAt: null, source: null, textBasis: 'authored', positivePrompt: positive, negativePrompt: negative, editor: emptyEditor(), revision: 1 });
describe('Prompt Library composition and templates', () => {
  it('preserves literal text, excludes disabled parts and independently snapshots blocks', () => {
    const b = block(); const doc = makeDocument('cat', 'bad'); doc.positive.push(snapshotBlock(b));
    const p = { ...prompt(), editor: { ...emptyEditor(), document: doc } };
    expect(compilePrompt(p).positivePrompt).toBe('cat,   soft\nlight  ');
    b.text = 'harsh'; b.revision++;
    expect(compilePrompt(p).positivePrompt).toBe('cat,   soft\nlight  ');
    doc.positive[0].enabled = false;
    expect(compilePrompt(p).positivePrompt).toBe('  soft\nlight  ');
    doc.negativeSeparator = '\n'; doc.negative.push({ id: crypto.randomUUID(), kind: 'text', text: 'noise', enabled: true });
    expect(compilePrompt(p).negativePrompt).toBe('bad\nnoise');
  });
  it('expands once, shares variables across channels and reports missing required values', () => {
    const doc = makeDocument('a {{subject}} {{light}}', '{{subject}}'); doc.mode = 'template';
    doc.variables = [{ name: 'subject', label: 'Subject', type: 'text', required: true, defaultValue: '', options: [] }, { name: 'light', label: 'Light', type: 'select', required: false, defaultValue: 'soft', options: ['soft', 'hard'] }];
    const p = { ...prompt(), editor: { ...emptyEditor(), document: doc } };
    expect(compilePrompt(p).errors).toEqual(['Fill Subject.']);
    expect(compilePrompt(p, { subject: '{{other}}' })).toEqual({ positivePrompt: 'a {{other}} soft', negativePrompt: '{{other}}', errors: [] });
    expect(compilePrompt(p, { subject: 'cat', light: 'invalid' }).errors).toHaveLength(1);
    expect(compilePrompt(prompt('{{not_a_template}}')).positivePrompt).toBe('{{not_a_template}}');
  });
  it('rejects conflicting variables in inserted snapshots', () => {
    const doc = makeDocument(); const b = block(); b.editor.variables = [{ name: 'x', label: 'X', type: 'text', required: true, defaultValue: '', options: [] }];
    doc.variables = [{ ...b.editor.variables[0], defaultValue: 'different' }]; doc.positive.push(snapshotBlock(b));
    expect(() => allVariables(doc)).toThrow('Conflicting');
  });
  it('allows deliberate duplicates, enforces revisions and rejects invalid batches without changing input', () => {
    const p = prompt(); const before = { prompts: [p], blocks: [] };
    const duplicate = applyMutation(before, { action: 'duplicate', kind: 'prompt', id: p.id });
    expect(duplicate.prompts).toHaveLength(2); expect(duplicate.prompts[1].id).not.toBe(p.id);
    expect(() => applyMutation(before, { action: 'update', kind: 'prompt', item: p, expectedRevision: 2 })).toThrow('another window');
    expect(() => applyMutation(before, { action: 'bulk', kind: 'prompt', ids: [p.id, 'missing'], addTags: ['x'] })).toThrow();
    expect(before.prompts[0].editor?.tags).toEqual([]);
    const changed = applyMutation(before, { action: 'bulk', kind: 'prompt', ids: [p.id], addTags: ['Cat', 'cat', '  light '] });
    expect(changed.prompts[0].editor?.tags).toEqual(['cat', 'light']);
  });
});
describe('Prompt Library portability and discovery', () => {
  it('round-trips quoted CSV including newlines, commas, quotes, BOM and negative-only styles', () => {
    const p = { ...prompt('  cat, "soft"\nlight  ', 'bad'), editor: { ...emptyEditor(), title: 'A, "B"' } };
    const csv = '\uFEFF' + exportCsv([p, prompt('', 'negative-only')]);
    const result = parseImport(csv, 'csv');
    expect(result.prompts[0].positivePrompt).toBe(p.positivePrompt); expect(result.prompts[0].editor?.title).toBe(p.editor.title);
    expect(result.prompts[1].negativePrompt).toBe('negative-only');
    expect(() => parseCsv('"bad')).toThrow('Unclosed');
    const template = parseImport('name,prompt,negative_prompt\nstyle,"photo of {prompt}",bad', 'csv').prompts[0];
    expect(template.editor?.document?.mode).toBe('template');
    expect(exportCsv([template])).toContain('photo of {prompt}');
    expect(compilePrompt(template, { prompt: 'cat' }).positivePrompt).toBe('photo of cat');
  });
  it('JSON remaps block IDs, preserves snapshots without originals and omits private paths', () => {
    const b = block(); const p = prompt(); const doc = makeDocument('cat'); doc.positive.push(snapshotBlock(b)); p.editor!.document = doc;
    p.source = { kind: 'path', pathAtSave: { directoryPath: 'D:/synthetic-private', relativePath: 'image.png', fileSize: null, contentModifiedMs: null } }; p.editor!.preview = p.source;
    const json = exportJson({ prompts: [p], blocks: [b] }); expect(json).not.toContain('synthetic-private');
    const imported = parseImport(json, 'json'); const result = applyMutation({ prompts: [], blocks: [] }, { action: 'import', ...imported, keepDuplicates: false });
    expect(result.blocks[0].id).not.toBe(b.id); expect(result.prompts[0].editor?.document?.positive[1].blockId).toBe(result.blocks[0].id);
    expect(compilePrompt(result.prompts[0]).positivePrompt).toBe('cat,   soft\nlight  ');
    const orphan = applyMutation({ prompts: [], blocks: [] }, { action: 'import', prompts: imported.prompts, blocks: [], keepDuplicates: false });
    expect(compilePrompt(orphan.prompts[0]).positivePrompt).toBe('cat,   soft\nlight  ');
    expect(applyMutation(result, { action: 'import', ...imported, keepDuplicates: false }).prompts).toHaveLength(1);
  });
  it('filters accents and phrases over metadata, and keeps source dates honest', () => {
    const p = prompt('Café golden light'); p.editor!.metadata.model = 'Model-X'; p.editor!.tags = ['portrait'];
    expect(filterItems([p], { ...emptyFilters, query: 'cafe "golden light" model-x', tags: ['portrait'] })).toHaveLength(1);
    expect(filterItems([p], { ...emptyFilters, dateField: 'source', from: '2020-01-01' })).toHaveLength(0);
    const items = Array.from({ length: 10_000 }, (_, i) => ({ ...p, id: String(i), positivePrompt: `image ${i}` }));
    expect(filterItems(items, { ...emptyFilters, query: '"image 9999"' })).toHaveLength(1);
  });
  it('separates exact text from similar text and does not consider mismatched negative channels identical', () => {
    const p = prompt('a long cat portrait in soft studio light', 'noise'); const copy = prompt(p.positivePrompt, p.negativePrompt); const similar = prompt('a long cat portrait in soft studio lights', 'noise'); const other = prompt(p.positivePrompt, '');
    expect(findDuplicates(p, [copy, similar, other], false)).toHaveLength(1);
    expect(findDuplicates(p, [copy, similar, other], true)).toHaveLength(2);
    expect(dice('', 'x')).toBe(0); expect(dice('hi', 'HI')).toBe(1);
  });
});
