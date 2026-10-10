import type { PromptBlock, SavedPrompt, PromptLibrarySnapshot } from '../../types';
import { emptyEditor, equivalentItem, makeDocument, normalizeEditor, portableItem, prepareItem } from './core.mjs';
import { itemTitle } from './search';
export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const endField = () => { row.push(field); field = ''; closed = false; };
  for(let i = 0; i < text.length; i++) {
    const c = text[i];
    if(quoted) {
      if(c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      }
      else if(c === '"') {
        quoted = false;
        closed = true;
      }
      else
        field += c;
    }
    else if(c === '"' && !field && !closed)
      quoted = true;
    else if(c === ',')
      endField();
    else if(c === '\r' || c === '\n') {
      if(c === '\r' && text[i + 1] === '\n')
        i++;
      endField();
      rows.push(row);
      row = [];
    }
    else {
      if(closed)
        throw new Error('Unexpected text after a closing CSV quote.');
      field += c;
    }
  }
  if(quoted)
    throw new Error('Unclosed CSV quote.');
  if(field || row.length || closed) {
    endField();
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.length));
}
export function parseImport(text: string, format: 'json' | 'csv'): PromptLibrarySnapshot {
  if(format === 'json') {
    const envelope = JSON.parse(text);
    if(envelope.format !== 'image-metahub-prompt-library' || envelope.schemaVersion !== 1 || !Array.isArray(envelope.prompts) || !Array.isArray(envelope.blocks))
      throw new Error('Unsupported Prompt Library JSON.');
    const clean = (kind: 'prompt' | 'block', item: SavedPrompt | PromptBlock) => {
      const value = { ...portableItem(item), ...prepareItem(kind, item) };
      value.editor.preview = null;
      return value;
    };
    return { prompts: envelope.prompts.map((p: SavedPrompt) => clean('prompt', p)), blocks: envelope.blocks.map((b: PromptBlock) => clean('block', b)) };
  }
  const rows = parseCsv(text);
  const header = rows.shift()?.map((s) => s.trim().toLowerCase()) || [];
  const name = header.indexOf('name'), positive = header.indexOf('prompt'), negative = header.indexOf('negative_prompt');
  if(name < 0 || positive < 0 || negative < 0)
    throw new Error('CSV requires name,prompt,negative_prompt headers.');
  const prompts = rows.map((row, i) => {
    if(row.length !== header.length)
      throw new Error(`CSV row ${i + 2} has the wrong number of columns.`);
    const editor = emptyEditor();
    editor.title = row[name];
    const positivePrompt = row[positive];
    const negativePrompt = row[negative];
    if(positivePrompt.includes('{prompt}') || negativePrompt.includes('{prompt}')) {
      editor.document = makeDocument(positivePrompt.replaceAll('{prompt}', '{{prompt}}'), negativePrompt.replaceAll('{prompt}', '{{prompt}}'));
      editor.document.mode = 'template';
      editor.document.variables = [{ name: 'prompt', label: 'Prompt', type: 'text', required: true, defaultValue: '', options: [] }];
    }
    return { id: crypto.randomUUID(), createdAt: Date.now(), textBasis: 'authored', source: null, sourceCreatedAt: null, ...prepareItem('prompt', { positivePrompt, negativePrompt, editor }) } as SavedPrompt;
  });
  return { prompts, blocks: [] };
}
export function exportJson(snapshot: PromptLibrarySnapshot) { return JSON.stringify({ format: 'image-metahub-prompt-library', schemaVersion: 1, prompts: snapshot.prompts.map(portableItem), blocks: snapshot.blocks.map(portableItem) }, null, 2); }
export function exportCsv(prompts: SavedPrompt[], resolved: Map<string, {
  positivePrompt: string;
  negativePrompt: string;
  errors: string[];
}> | null = null) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = prompts.map((p) => {
    const result = resolved?.get(p.id);
    if(result?.errors.length)
      throw new Error(`${itemTitle(p)}: fill template fields before exporting resolved text.`);
    let positive = result?.positivePrompt ?? p.positivePrompt, negative = result?.negativePrompt ?? p.negativePrompt;
    if(!resolved && p.editor?.document?.mode === 'template') {
      if(/\{\{(?!prompt\}\})/.test(positive + negative))
        throw new Error('This template has extra variables. Use resolved CSV or JSON.');
      positive = positive.replaceAll('{{prompt}}', '{prompt}');
      negative = negative.replaceAll('{{prompt}}', '{prompt}');
    }
    return [itemTitle(p), positive, negative].map(quote).join(',');
  });
  return ['name,prompt,negative_prompt', ...rows].join('\r\n');
}
export function importCounts(incoming: PromptLibrarySnapshot, existing: PromptLibrarySnapshot) {
  let duplicates = 0;
  for(const kind of ['prompts', 'blocks'] as const) {
    const identity = (item: SavedPrompt | PromptBlock) => equivalentItem(kind === 'blocks' ? 'block' : 'prompt', item);
    const seen = new Set(existing[kind].map(identity));
    for(const item of incoming[kind]) {
      const key = identity(item);
      if(seen.has(key))
        duplicates++;
      else
        seen.add(key);
    }
  }
  return { total: incoming.prompts.length + incoming.blocks.length, duplicates, templates: incoming.prompts.filter((p) => normalizeEditor(p.editor).document?.mode === 'template').length };
}
