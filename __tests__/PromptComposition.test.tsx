import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PromptBlock, PromptDocument, PromptVariable, SavedPrompt } from '../types';
import { compilePrompt, emptyEditor, makeDocument, normalizeDocument, snapshotBlock } from '../services/promptLibrary/core.mjs';
import { appendAdditions, type CompositionAddition } from '../services/promptLibrary/composition';
import { clearDraft, getDraft } from '../services/promptLibrary/sessionDraft';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import PromptBlockPicker from '../components/promptLibrary/PromptBlockPicker';
import PromptComposer from '../components/promptLibrary/PromptComposer';
import PromptEditor from '../components/promptLibrary/PromptEditor';
import CompositionResult from '../components/promptLibrary/CompositionResult';
import ComfyUITextActions from '../components/comfyui/ComfyUITextActions';

const mocks = vi.hoisted(() => ({ copy: vi.fn(), apply: vi.fn(), targets: vi.fn(), advanced: true, gate: vi.fn() }));
vi.mock('../utils/imageUtils', () => ({ copyTextToClipboard: mocks.copy }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseAdvancedPromptLibrary: mocks.advanced, showProModal: mocks.gate }) }));
vi.mock('../hooks/usePromptLibraryPreview', () => ({ usePromptLibraryPreview: () => ({ url: null, status: 'No preview' }), linkSessionPreview: vi.fn() }));
vi.mock('react-virtualized-auto-sizer', () => ({ default: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) => children({ width: 400, height: 300 }) }));

const block = (id: string, text: string, variables: PromptVariable[] = []): PromptBlock => ({ id, text, revision: 2, createdAt: 1, updatedAt: 2, editor: { ...emptyEditor(), title: id, category: 'Lighting', variables } });
const light = block('Lighting', 'soft light');
const color = block('Color', 'blue background');
const subject: PromptVariable = { name: 'subject', label: 'Subject', type: 'text', defaultValue: '', required: true, options: [] };
const editorProps = { initial: { positivePrompt: '', negativePrompt: '', editor: emptyEditor() }, kind: 'prompt' as const, onSaved: vi.fn(), onClose: vi.fn(), onDirty: vi.fn(), onViewSource: vi.fn() };

beforeEach(() => {
  clearDraft(); clearDraft('comfyui'); mocks.advanced = true;
  mocks.copy.mockReset().mockResolvedValue({ success: true });
  mocks.gate.mockReset(); mocks.apply.mockReset().mockResolvedValue({ success: true, targets: [] });
  mocks.targets.mockReset().mockResolvedValue({ success: true, targets: [{ token: 'field', nodeId: '12', nodeTitle: 'Encoder', field: 'text', preview: '' }] });
  useSavedPromptStore.setState({ prompts: [], blocks: [light, color], isLoading: false, error: null });
  window.electronAPI = { comfyUIViewTextTargets: mocks.targets, comfyUIViewApplyText: mocks.apply } as never;
});
afterEach(() => { cleanup(); clearDraft(); clearDraft('comfyui'); delete window.electronAPI; vi.restoreAllMocks(); });

function picker(document = makeDocument('portrait', 'noise'), blocks = [light, color], channel: 'positive' | 'negative' = 'positive', values = {}) {
  const confirm = vi.fn((parts: CompositionAddition[]) => parts.length > 0); const close = vi.fn();
  render(<PromptBlockPicker blocks={blocks} document={document} channel={channel} values={values} onConfirm={confirm} onClose={close} />);
  return { confirm, close, preview: () => within(screen.getByRole('region', { name: 'Preview' })) };
}

it('stages repeated snapshots, reorders and removes them, then commits the whole batch once', () => {
  const document = makeDocument('portrait', 'noise'); const before = structuredClone(document);
  const { confirm, close, preview } = picker(document);
  expect((screen.getByRole('button', { name: 'Add 0 blocks' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add block Color' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' }));
  expect(preview().getByText('portrait, soft light, blue background, soft light')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Move positive part 2 up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove positive part 3' }));
  expect(preview().getByText('portrait, blue background, soft light')).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled(); expect(document).toEqual(before);
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 blocks' }));
  expect(confirm).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  const parts = confirm.mock.calls[0][0].flatMap(addition => addition.positive);
  expect(parts.map(p => p.blockId)).toEqual(['Color', 'Lighting']);
  expect(new Set(parts.map(p => p.id)).size).toBe(2);
  expect(parts.every(p => p.blockRevision === 2)).toBe(true);
});

it.each(['Cancel', 'Close block picker', 'Escape'])('cancels staged choices via %s without committing', action => {
  const { confirm, close } = picker();
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' }));
  if (action === 'Escape') fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  else fireEvent.click(screen.getByRole('button', { name: action }));
  expect(confirm).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
});

it('restores focus, traps keyboard navigation and leaves the dialog open on backdrop clicks', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open picker</button>{open && <PromptBlockPicker blocks={[light]} document={makeDocument()} channel="positive" values={{}} onConfirm={() => true} onClose={() => setOpen(false)} />}</>;
  }
  render(<Harness />); const opener = screen.getByRole('button', { name: 'Open picker' }); opener.focus(); fireEvent.click(opener);
  const search = screen.getByRole('searchbox'); expect(window.document.activeElement).toBe(search);
  const last = screen.getByRole('button', { name: 'Cancel' }); last.focus(); fireEvent.keyDown(last, { key: 'Tab' });
  expect(window.document.activeElement).toBe(screen.getByRole('button', { name: 'Close block picker' }));
  fireEvent.keyDown(window.document.activeElement!, { key: 'Tab', shiftKey: true }); expect(window.document.activeElement).toBe(last);
  fireEvent.click(screen.getByRole('dialog').parentElement!); expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(search, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(window.document.activeElement).toBe(opener);
});

it('keeps valid choices when a block conflicts with variables from the other channel', () => {
  const document = makeDocument('portrait'); document.mode = 'template'; document.negative.push(snapshotBlock(block('Negative', '{{subject}}', [subject])));
  const invalid = block('Conflict', '{{subject}}', [{ ...subject, defaultValue: 'different' }]);
  const { confirm } = picker(document, [light, invalid]);
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' })); fireEvent.click(screen.getByRole('button', { name: 'Add block Conflict' }));
  expect(screen.getByRole('alert').textContent).toContain('Conflicting definitions for subject');
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 block' }));
  expect(confirm.mock.calls[0][0].flatMap(addition => addition.positive).map(p => p.blockId)).toEqual(['Lighting']);
});

it('keeps reorder handles on the whole cards and preserves arrow ordering in the selected list', () => {
  const { preview } = picker();
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' })); fireEvent.click(screen.getByRole('button', { name: 'Add block Color' }));
  const handles = within(screen.getByRole('region', { name: 'Selected items' })).getAllByTitle('Drag to reorder');
  expect(handles.every(handle => handle.style.touchAction === 'none')).toBe(true);
  expect(handles.every(handle => !!handle.closest('article'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Move positive part 2 up' }));
  expect(preview().getByText('portrait, blue background, soft light')).toBeTruthy();
});

it('revalidates a pending batch when the parent composition changes', () => {
  const template = block('Template', '{{subject}}', [subject]);
  const confirm = vi.fn(() => true);
  const document = makeDocument('portrait');
  const props = { blocks: [template], document, channel: 'positive' as const, values: {}, onConfirm: confirm, onClose: vi.fn() };
  const view = render(<PromptBlockPicker {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add block Template' }));
  const changed = { ...document, negative: [snapshotBlock(block('External', '{{subject}}', [{ ...subject, defaultValue: 'different' }]))] };
  view.rerender(<PromptBlockPicker {...props} document={changed} />);
  expect(screen.getByRole('alert').textContent).toContain('Conflicting definitions for subject');
  expect((screen.getByRole('button', { name: 'Add 1 block' }) as HTMLButtonElement).disabled).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

it('previews the negative channel with its exact separator and current variable values', () => {
  const document = makeDocument('positive stays separate', 'noise'); document.negativeSeparator = '\n';
  const template = block('Template', '{{subject}}', [subject]);
  const { preview, confirm } = picker(document, [template], 'negative', { subject: '  soft\nlight  ' });
  fireEvent.click(screen.getByRole('button', { name: 'Add block Template' }));
  expect(preview().getByText((_, node) => node?.tagName === 'PRE' && node.textContent === 'noise\n  soft\nlight  ')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 block' })); expect(confirm).toHaveBeenCalledTimes(1);
});

it('allows adding a block with pending fields and preserves its snapshot after the original changes', () => {
  const template = block('Template', '{{subject}}', [subject]);
  const confirm = vi.fn((parts: CompositionAddition[]) => parts.length > 0);
  const props = { blocks: [template], document: makeDocument(), channel: 'positive' as const, values: {}, onConfirm: confirm, onClose: vi.fn() };
  const view = render(<PromptBlockPicker {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add block Template' }));
  expect(screen.getByText(/Fill pending fields/)).toBeTruthy();
  view.rerender(<PromptBlockPicker {...props} blocks={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 block' }));
  expect(confirm.mock.calls[0][0][0].positive).toMatchObject([{ text: '{{subject}}', blockRevision: 2, variables: [subject] }]);
});

it('filters a large virtualized catalog by search, category and favorite', () => {
  const blocks = Array.from({ length: 10000 }, (_, i) => block(`Block ${i}`, `text ${i}`));
  blocks[9999].editor.favorite = true;
  picker(makeDocument(), blocks);
  expect(screen.getAllByRole('button', { name: /Add block Block/ }).length).toBeLessThan(20);
  fireEvent.click(screen.getByRole('button', { name: 'Favorites only' }));
  expect(screen.getByRole('button', { name: 'Favorites only' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Favorites only' }).className).toContain('!bg-accent/15');
  expect(screen.getAllByRole('button', { name: /Add block Block/ })).toHaveLength(1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Block category' }), { target: { value: 'Lighting' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '9999' } });
  expect(screen.getByRole('button', { name: 'Add block Block 9999' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } }); expect(screen.getByText('No matching blocks.')).toBeTruthy();
});

it('anchors Preview outside the selected list and does not refer to a current prompt', () => {
  picker();
  const preview = screen.getByRole('region', { name: 'Preview' });
  const selected = screen.getByRole('region', { name: 'Selected items' });
  expect(selected.contains(preview)).toBe(false);
  expect(preview.nextElementSibling?.tagName).toBe('FOOTER');
  expect(screen.queryByText(/Includes your current/)).toBeNull();
});

it('adds complete saved prompts alongside blocks with both channels and template definitions intact', () => {
  const sourceDocument = makeDocument('  first\nline  ', 'source negative');
  sourceDocument.mode = 'template'; sourceDocument.positiveSeparator = '\n';
  sourceDocument.positive.push(snapshotBlock(block('Subject', '{{subject}}', [subject])));
  const saved: SavedPrompt = { id: 'saved', positivePrompt: '', negativePrompt: '', createdAt: 1, sourceCreatedAt: null, source: null, textBasis: 'authored', revision: 1, editor: { ...emptyEditor(), title: 'Full portrait', document: sourceDocument } };
  const before = structuredClone(saved);
  const document = makeDocument('existing positive', 'existing negative');
  const confirm = vi.fn((additions: CompositionAddition[]) => additions.length > 0);
  render(<PromptBlockPicker blocks={[light]} prompts={[saved]} document={document} channel="positive" values={{ subject: 'fox' }} onConfirm={confirm} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add prompt Full portrait' }));
  const preview = within(screen.getByRole('region', { name: 'Preview' }));
  expect(preview.getByLabelText('Prompt preview').textContent).toBe('existing positive, soft light,   first\nline  \nfox');
  expect(preview.getByLabelText('Negative prompt preview').textContent).toBe('existing negative, source negative');
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 items' }));
  const added = appendAdditions(document, confirm.mock.calls[0][0]);
  const restored = normalizeDocument(added)!;
  const result = compilePrompt({ editor: { ...emptyEditor(), document: restored } }, { subject: 'fox' });
  expect(result.positivePrompt).toBe(preview.getByLabelText('Prompt preview').textContent);
  expect(result.negativePrompt).toBe('existing negative, source negative');
  expect(result.errors).toEqual([]); expect(saved).toEqual(before);
});

it('starts in Text, enters Compose without empty cards, and requires confirmation to flatten it', () => {
  render(<PromptEditor {...editorProps} />);
  expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Compose with blocks' }));
  expect(screen.queryByLabelText('positive part 1')).toBeNull(); expect(screen.queryByLabelText('negative part 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add prompt text' })); fireEvent.change(screen.getByLabelText('positive part 1'), { target: { value: '  portrait\nexact text  ' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Text' })); expect(screen.getByLabelText('positive part 1')).toBeTruthy();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Text' }));
  expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('  portrait\nexact text  ');
});

it('preserves both literal channels when entering Compose and retains Free gating', () => {
  const initial = { ...editorProps.initial, positivePrompt: '  a\nb  ', negativePrompt: '\tnoise\n' };
  const view = render(<PromptEditor {...editorProps} initial={initial} />);
  mocks.advanced = false; view.rerender(<PromptEditor {...editorProps} initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Compose with blocks' })); expect(mocks.gate).toHaveBeenCalled(); expect(screen.queryByLabelText('positive part 1')).toBeNull();
  mocks.advanced = true; view.rerender(<PromptEditor {...editorProps} initial={initial} />); fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: initial.positivePrompt + 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compose with blocks' }));
  expect((screen.getByLabelText('positive part 1') as HTMLTextAreaElement).value).toBe(initial.positivePrompt + 'x');
  expect((screen.getByLabelText('negative part 1') as HTMLTextAreaElement).value).toBe(initial.negativePrompt);
});

it('prevents flattening a composition with unresolved required fields', () => {
  const document = makeDocument('{{subject}}'); document.mode = 'template'; document.variables = [subject];
  render(<PromptEditor {...editorProps} initial={{ ...editorProps.initial, editor: { ...emptyEditor(), document } }} />);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Text' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Compose with blocks' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('positive part 1')).toBeTruthy();
});

it('commits a modal batch into the composer once and matches the proposed preview', () => {
  const onChange = vi.fn();
  function Harness() {
    const [document, setDocument] = useState(makeDocument('portrait'));
    return <><PromptComposer document={document} blocks={[light, color]} disabled={false} onChange={next => { onChange(next); setDocument(next); }} onError={vi.fn()} onExtract={vi.fn()} /><p>{compilePrompt({ editor: { ...emptyEditor(), document } }).positivePrompt}</p></>;
  }
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Add positive blocks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' })); fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 blocks' }));
  expect(onChange).toHaveBeenCalledTimes(1); expect(screen.getByText('portrait, soft light, soft light')).toBeTruthy();
  const document = onChange.mock.calls[0][0] as PromptDocument;
  expect(new Set(document.positive.map(p => p.id)).size).toBe(3);
});

it('copies, drags and applies the same selected result channel, including negative-only drafts', async () => {
  const props = { positivePrompt: 'portrait', negativePrompt: 'noise', errors: [] };
  const view = render(<CompositionResult result={props} renderActions={channel => <ComfyUITextActions compact active sourceChannel={channel} positive={props.positivePrompt} negative={props.negativePrompt} />} />);
  await screen.findByRole('button', { name: 'Add to node' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Result channel' }), { target: { value: 'negative' } });
  expect(screen.queryByRole('button', { name: 'Copy prompt' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy negative' })); await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('noise'));
  const setData = vi.fn(); fireEvent.dragStart(screen.getByLabelText('Drag to node'), { dataTransfer: { setData } }); expect(setData).toHaveBeenCalledWith('text/plain', 'noise');
  fireEvent.click(screen.getByRole('button', { name: 'Add to node' })); await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ token: 'field', text: 'noise', mode: 'append', separator: ', ' }));
  view.rerender(<CompositionResult result={{ ...props, positivePrompt: '' }} />);
  expect(screen.queryByRole('combobox', { name: 'Result channel' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy negative' })).toBeTruthy();
});

it('keeps copying and applying disabled while template values are invalid', async () => {
  render(<CompositionResult result={{ positivePrompt: 'portrait', negativePrompt: '', errors: ['Fill Subject.'] }} renderActions={channel => <ComfyUITextActions compact active sourceChannel={channel} positive="portrait" errors={['Fill Subject.']} />} />);
  const apply = await screen.findByRole('button', { name: 'Add to node' });
  expect((apply as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole('button', { name: 'Copy prompt' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText('Drag to node').getAttribute('aria-disabled')).toBe('true');
  expect(getDraft()).toBeNull();
});
