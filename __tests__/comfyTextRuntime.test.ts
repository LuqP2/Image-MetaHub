import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { comfyTextRuntime } from '../services/comfyTextRuntime.mjs';
import { clearDraft, getDraft, rememberDraft } from '../services/promptLibrary/sessionDraft';
import { emptyEditor } from '../services/promptLibrary/core.mjs';

let widget: { name: string; type: string; value: string; callback?: () => void; options?: object };
let node: { id: number; title: string; type: string; widgets: typeof widget[]; inputs: { name: string; link: number | null }[] };
let graph: { beforeChange: ReturnType<typeof vi.fn>; afterChange: ReturnType<typeof vi.fn> };
let app: { graph: typeof graph; canvas: { graph: typeof graph; selected_nodes: Record<string, typeof node>; setDirty: ReturnType<typeof vi.fn> } };
const query = () => comfyTextRuntime('query');
const apply = (token: string, text = 'cat', mode = 'append') => comfyTextRuntime('apply', { token, text, mode, separator: ', ' });
beforeEach(() => {
  widget = { name: 'text', type: 'customtext', value: 'old', callback: vi.fn() };
  node = { id: 12, title: 'Positive', type: 'CLIPTextEncode', widgets: [widget], inputs: [] };
  graph = { beforeChange: vi.fn(), afterChange: vi.fn() };
  app = { graph, canvas: { graph, selected_nodes: { 12: node }, setDirty: vi.fn() } };
  Object.assign(window, { app, __imhTextTargets: undefined });
});
describe('ComfyUI selected text editing', () => {
  it('queries and edits on LAN-like origins without crypto.randomUUID', () => {
    const context = { window, document, crypto: { getRandomValues: crypto.getRandomValues.bind(crypto) } };
    const execute = (operation: string, payload = {}) => runInNewContext('(' + comfyTextRuntime.toString() + ')(' + JSON.stringify(operation) + ',' + JSON.stringify(payload) + ')', context);
    const first = execute('query').targets[0].token;
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(execute('query').targets[0].token).toBe(first);
    expect(execute('apply', { token: first, text: 'added', mode: 'append', separator: ', ' }).success).toBe(true);
    expect(widget.value).toBe('old, added');
    const next = execute('query').targets[0].token;
    expect(next).not.toBe(first);
    expect(execute('apply', { token: first, text: 'stale', mode: 'replace', separator: ', ' }).code).toBe('conflict');
    expect(execute('apply', { token: next, text: 'new', mode: 'replace', separator: ', ' }).success).toBe(true);
    expect(widget.value).toBe('new');
  });
  it('captures the exact selection only from a node text field without modifying the graph', () => {
    const input = document.createElement('textarea');
    input.value = 'prefix  café\n<lora:test:1>  suffix';
    document.body.append(input);
    input.focus(); input.setSelectionRange(6, input.value.length - 6);
    Object.assign(widget, { inputEl: input });
    const text = input.value.slice(input.selectionStart, input.selectionEnd);
    expect(comfyTextRuntime('selection', { text })).toMatchObject({ success: true, text });
    expect(comfyTextRuntime('selection', { text: 'stale' }).success).toBe(false);
    expect(graph.beforeChange).not.toHaveBeenCalled();
    Object.assign(widget, { inputEl: undefined });
    expect(comfyTextRuntime('selection', { text }).success).toBe(false);
    input.remove();
  });
  it('replaces only the selected range and rejects changed or absent selections', () => {
    const input = document.createElement('textarea'); input.value = 'before old after';
    document.body.append(input); input.focus(); input.setSelectionRange(7, 10);
    widget.value = input.value; Object.assign(widget, { inputEl: input });
    const target = query().targets[0]; expect(target.hasSelection).toBe(true);
    expect(apply(target.token, 'new', 'replaceSelection').success).toBe(true);
    expect(widget.value).toBe('before new after');
    expect(graph.beforeChange).toHaveBeenCalledTimes(1); expect(graph.afterChange).toHaveBeenCalledTimes(1);
    widget.value = input.value;
    const stale = query().targets[0]; input.setSelectionRange(0, 6);
    expect(apply(stale.token, 'new', 'replaceSelection').code).toBe('conflict');
    input.setSelectionRange(0, 0);
    const empty = query().targets[0]; expect(empty.hasSelection).toBe(false);
    expect(apply(empty.token, 'new', 'replaceSelection').code).toBe('conflict');
    expect(graph.beforeChange).toHaveBeenCalledTimes(1); input.remove();
  });
  it('appends literal Unicode and code-like text as one undoable change', () => {
    const token = query().targets[0].token;
    const text = 'café "quoted"\n${notCode}';
    expect(apply(token, text).success).toBe(true);
    expect(widget.value).toBe('old, ' + text);
    expect(widget.callback).toHaveBeenCalledTimes(1);
    expect(graph.beforeChange).toHaveBeenCalledTimes(1);
    expect(graph.afterChange).toHaveBeenCalledTimes(1);
    expect(apply(token).code).toBe('conflict');
  });
  it('replaces or appends into an empty destination without adding a leading separator', () => {
    expect(apply(query().targets[0].token, 'new', 'replace').success).toBe(true);
    expect(widget.value).toBe('new');
    widget.value = '';
    expect(apply(query().targets[0].token, 'cat').success).toBe(true);
    expect(widget.value).toBe('cat');
  });
  it('does not run DOM-widget callbacks twice', () => {
    let value = 'old';
    Object.defineProperty(widget, 'value', { get: () => value, set: (next: string) => { value = next; widget.callback?.(); }, configurable: true });
    expect(apply(query().targets[0].token).success).toBe(true);
    expect(widget.callback).toHaveBeenCalledTimes(1);
  });
  it('rejects stale field values, changed selection and recreated nodes with the same ID', () => {
    const token = query().targets[0].token;
    widget.value = 'edited';
    expect(apply(token).code).toBe('conflict');
    const next = query().targets[0].token;
    app.canvas.selected_nodes = { 12: { ...node, widgets: [{ ...widget }] } };
    expect(apply(next).code).toBe('conflict');
    expect(graph.beforeChange).not.toHaveBeenCalled();
  });
  it('invalidates destinations when the displayed graph changes', () => {
    const token = query().targets[0].token;
    app.canvas.graph = { beforeChange: vi.fn(), afterChange: vi.fn() };
    expect(apply(token).code).toBe('conflict');
  });
  it('lists multiple fields but excludes connected inputs and combo widgets', () => {
    node.widgets.push({ name: 'negative', type: 'text', value: '' }, { name: 'filename', type: 'combo', value: 'model' });
    expect(query().targets.map((target: { field: string }) => target.field)).toEqual(['text', 'negative']);
    node.inputs = [{ name: 'text', link: 4 }];
    expect(query().targets.map((target: { field: string }) => target.field)).toEqual(['negative']);
  });
  it('rejects empty text, ambiguous selections, readonly widgets and unavailable history', () => {
    expect(apply(query().targets[0].token, ' \n').code).toBe('invalid');
    app.canvas.selected_nodes.extra = { ...node, id: 13 };
    expect(query().code).toBe('selection');
    delete app.canvas.selected_nodes.extra;
    widget.options = { readOnly: true };
    expect(query().code).toBe('unsupported');
    widget.options = {};
    graph.beforeChange = undefined as never;
    expect(query().code).toBe('unsupported');
  });
  it('restores the prior value when a callback fails and closes the history bracket', () => {
    widget.callback = vi.fn(() => { throw new Error('synthetic callback'); });
    expect(apply(query().targets[0].token).code).toBe('unsupported');
    expect(widget.value).toBe('old');
    expect(graph.afterChange).toHaveBeenCalledTimes(1);
  });
  it('rejects navigation to another origin before looking up the graph', () => {
    expect(comfyTextRuntime('query', {}, 'http://untrusted.invalid').code).toBe('unavailable');
  });
  it('transports executable-looking text as serialized data in the injected script', () => {
    const token = query().targets[0].token;
    const text = '"); window.arbitraryRun = true; //\n café';
    const payload = { token, text, mode: 'replace', separator: ', ' };
    const script = '(' + comfyTextRuntime.toString() + ')("apply", ' + JSON.stringify(payload) + ')';
    expect(runInNewContext(script, { window, crypto }).success).toBe(true);
    expect(widget.value).toBe(text);
    expect((window as unknown as { arbitraryRun?: boolean }).arbitraryRun).toBeUndefined();
  });
});
it('isolates library and Workspace drafts and clears only the requested context', () => {
  clearDraft(); clearDraft('comfyui');
  const library = { positivePrompt: 'library', editor: emptyEditor() };
  const workspace = { positivePrompt: 'workspace', editor: emptyEditor() };
  rememberDraft('prompt', library, library);
  rememberDraft('prompt', workspace, workspace, null, 'comfyui');
  expect(getDraft()?.draft.positivePrompt).toBe('library');
  expect(getDraft('comfyui')?.draft.positivePrompt).toBe('workspace');
  clearDraft('comfyui');
  expect(getDraft('comfyui')).toBeNull();
  expect(getDraft()?.draft.positivePrompt).toBe('library');
  clearDraft();
});
