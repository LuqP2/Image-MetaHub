import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkspacePrompts from '../components/comfyui/WorkspacePrompts';
import WorkspaceContextPanel from '../components/comfyui/WorkspaceContextPanel';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { applyMutation, emptyEditor, makeDocument } from '../services/promptLibrary/core.mjs';
import { clearDraft, getDraft, rememberDraft } from '../services/promptLibrary/sessionDraft';
import PromptEditor from '../components/promptLibrary/PromptEditor';
import type { PromptLibrarySnapshot, PromptBlock } from '../types';
const mocks = vi.hoisted(() => ({ list: vi.fn(), mutate: vi.fn(), copy: vi.fn(), targets: vi.fn(), apply: vi.fn(), gate: vi.fn() }));
vi.mock('../services/savedPromptService', () => ({ listSavedPrompts: vi.fn(), listPromptLibrary: mocks.list, mutatePromptLibrary: mocks.mutate, subscribeSavedPromptChanges: vi.fn() }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseAdvancedPromptLibrary: true, canUseModelManager: true, showProModal: mocks.gate }) }));
vi.mock('../hooks/usePromptLibraryPreview', () => ({ usePromptLibraryPreview: () => ({ url: null, status: 'No preview' }), linkSessionPreview: vi.fn() }));
vi.mock('../utils/imageUtils', () => ({ copyTextToClipboard: mocks.copy }));
vi.mock('../components/ModelManagerPanels', () => ({ executeModelCommand: vi.fn() }));
vi.mock('../services/modelLibrary/manager', () => ({ useModelManager: () => ({
  loading: false, catalog: { locations: [{ id: 'lora', fileName: 'synthetic.safetensors', absolutePath: 'C:/synthetic/synthetic.safetensors', sourceKind: 'lora', size: 10 }], managedModels: [] },
  localMetadata: { 'location:lora': { displayName: 'Studio LoRA', triggerWords: ['studio_trigger'], favorite: true } },
}) }));
vi.mock('react-virtualized-auto-sizer', () => ({ default: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) => children({ width: 360, height: 450 }) }));
let data: PromptLibrarySnapshot;
beforeEach(() => {
  localStorage.clear(); clearDraft(); clearDraft('comfyui');
  data = { prompts: [{ id: 'portrait', positivePrompt: 'studio portrait', negativePrompt: 'noise', createdAt: 1, sourceCreatedAt: null, source: null, textBasis: 'authored', revision: 1, editor: { ...emptyEditor(), title: 'Portrait' } }], blocks: [] };
  mocks.list.mockResolvedValue(data);
  mocks.mutate.mockImplementation(async command => { const next = applyMutation(data, command); data = next; return next; });
  mocks.targets.mockResolvedValue({ success: true, targets: [{ token: 'field', nodeId: '12', nodeTitle: 'Positive', field: 'text', preview: 'old' }] });
  mocks.apply.mockResolvedValue({ success: true, targets: [], message: 'Updated Positive · text' });
  mocks.copy.mockResolvedValue({ success: true });
  useSavedPromptStore.setState({ prompts: [], blocks: [], error: null, isLoading: false, selectedPromptId: null });
  window.electronAPI = { comfyUIViewTextTargets: mocks.targets, comfyUIViewApplyText: mocks.apply } as never;
});
afterEach(() => {
  cleanup();
  // Reset the session navigation explicitly; remounts now retain it by design.
  render(<WorkspacePrompts active={false} request={null} onOpenLibrary={vi.fn()} onViewSource={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prompts', exact: true }));
  cleanup(); delete window.electronAPI; vi.clearAllMocks(); clearDraft(); clearDraft('comfyui'); clearDraft('comfyui-block');
});
function Harness() {
  const [collapsed, setCollapsed] = useState(false);
  return <WorkspaceContextPanel collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} active imagePanel={<p>Image context</p>} request={null} onOpenLibrary={vi.fn()} onViewSource={vi.fn()} />;
}
it('opens the Workspace editor with the latest item after a pending tag save', async () => {
  render(<WorkspacePrompts active request={null} onOpenLibrary={vi.fn()} onViewSource={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Portrait' }));
  let finish: () => void = () => {};
  mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'new-tag' } });
  fireEvent.blur(screen.getByLabelText('Tags'));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Edit saved prompt' }));
  expect(screen.queryByText('Edit saved prompt', { selector: 'h3' })).toBeNull();
  await act(async () => { finish(); });
  expect(await screen.findByText('Edit saved prompt', { selector: 'h3' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('button', { name: 'Remove tag new-tag' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('keeps negative composition optional and reveals it on demand', () => {
  const initial = { editor: { ...emptyEditor(), document: makeDocument('main text') } };
  render(<PromptEditor compact initial={initial} kind="prompt" onSaved={vi.fn()} onClose={vi.fn()} onDirty={vi.fn()} onViewSource={vi.fn()} />);
  expect(screen.queryByLabelText('negative part 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add negative prompt' }));
  fireEvent.change(screen.getByLabelText('negative part 1'), { target: { value: 'optional negative' } });
  expect(getDraft()?.draft.editor?.document?.negative[0].text).toBe('optional negative');
});
it('uses prompts and model trigger words in the same preserved Workspace composition and applies the compiled result', async () => {
  rememberDraft('prompt', { positivePrompt: 'separate library draft' }, { positivePrompt: 'separate library draft' });
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Prompts', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Portrait' }));
  fireEvent.click(screen.getByText('Use in Compose'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add to node' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Add to node' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ token: 'field', text: 'studio portrait', mode: 'append', separator: ', ' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
  fireEvent.click(await screen.findByRole('button', { name: /Studio LoRA/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add to positive' }));
  expect(screen.getByRole('tab', { name: 'Prompts' }).getAttribute('aria-selected')).toBe('true');
  await waitFor(() => expect(getDraft('comfyui')?.draft.editor?.document?.positive.some(part => part.text === 'studio_trigger')).toBe(true));
  expect(getDraft()?.draft.positivePrompt).toBe('separate library draft');
  const finalText = screen.getByRole('region', { name: 'Composition result' });
  expect(within(finalText).getByText('studio portrait, studio_trigger')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
  expect(screen.getByText('Image context')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse context panel' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  expect(await screen.findByRole('button', { name: 'Add to node' })).toBeTruthy();
  expect(screen.getByText('studio portrait, studio_trigger')).toBeTruthy();
});

it('inserts each Workspace request once in StrictMode and starts without empty free-text parts', async () => {
  const initial = { editor: { ...emptyEditor(), document: { ...makeDocument(), positive: [], negative: [] } } };
  const block = { id: 'light', text: 'soft light', editor: { ...emptyEditor(), title: 'Lighting' }, revision: 1, createdAt: 1 } as PromptBlock;
  useSavedPromptStore.setState({ blocks: [block] });
  const props = { initial, kind: 'prompt' as const, compact: true, draftContext: 'comfyui' as const, onDirty: vi.fn(), onSaved: vi.fn(), onClose: vi.fn(), onViewSource: vi.fn() };
  const renderEditor = (id: number) => <React.StrictMode><PromptEditor {...props} appendText={{ id, text: block.text, channel: 'positive', block }} /></React.StrictMode>;
  const view = render(renderEditor(100));
  await waitFor(() => expect(getDraft('comfyui')?.draft.editor?.document?.positive).toHaveLength(1));
  expect(getDraft('comfyui')?.draft.editor?.document?.negative).toHaveLength(0);
  view.rerender(renderEditor(100));
  expect(getDraft('comfyui')?.draft.editor?.document?.positive).toHaveLength(1);
  view.rerender(renderEditor(101));
  await waitFor(() => expect(getDraft('comfyui')?.draft.editor?.document?.positive).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: 'Add positive blocks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add block Lighting' }));
  expect(getDraft('comfyui')?.draft.editor?.document?.positive).toHaveLength(2);
  expect(screen.getByRole('dialog', { name: 'Choose prompt blocks' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 block' }));
  await waitFor(() => expect(getDraft('comfyui')?.draft.editor?.document?.positive).toHaveLength(3));
  expect(screen.queryByRole('dialog', { name: 'Choose prompt blocks' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Move positive part 3 up' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Enable positive part 2' }));
  expect(getDraft('comfyui')?.draft.editor?.document?.positive[1].enabled).toBe(false);
});

it('creates a block without replacing the composition and keeps the list visible beside filters', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Compose', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Add prompt text' }));
  const inputs = screen.getAllByRole('textbox', { name: /positive part/ });
  fireEvent.change(inputs.at(-1)!, { target: { value: 'synthetic draft preserved' } });
  const composition = getDraft('comfyui')?.draft;
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'New block' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Test lighting' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Block text' }), { target: { value: 'soft studio lighting' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
  await waitFor(() => expect(useSavedPromptStore.getState().blocks).toHaveLength(1));
  expect(getDraft('comfyui')?.draft).toEqual(composition);
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Filters', exact: true }));
  expect(screen.getByRole('button', { name: 'Open Test lighting' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add to selected node Test lighting' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ token: 'field', text: 'soft studio lighting', mode: 'append', separator: ', ' }));
  expect(getDraft('comfyui')?.draft).toEqual(composition);
  expect(getDraft('comfyui')?.draft.editor?.document?.positive.some(part => part.text === 'synthetic draft preserved')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Compose', exact: true }));
  expect((await screen.findByRole('button', { name: 'Add to node' })).closest('footer')?.getAttribute('aria-label')).toBe('Composition actions');
});

it('adds a block from its context menu to the preserved Workspace composition', async () => {
  data.blocks = [{ id: 'light', text: 'soft light', editor: { ...emptyEditor(), title: 'Lighting' }, createdAt: 1, revision: 1 } as PromptBlock];
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Compose', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Add prompt text' }));
  fireEvent.change(screen.getAllByRole('textbox', { name: /positive part/ }).at(-1)!, { target: { value: 'keep this text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  const card = await screen.findByRole('button', { name: 'Open Lighting' });
  fireEvent.contextMenu(card.closest('article')!);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Compose' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Composition result' }).textContent).toContain('keep this text, soft light'));
  expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
});

it('copies literal blocks and automatically fills every field once per drag, including repeated placeholders', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const template = 'She has {{color}} hair and is wearing {{clothes}}. {{color}} shoes.';
    data.blocks = [{ id: 'random-color', text: template, editor: { ...emptyEditor(), title: 'Color variations', variables: [
      { name: 'color', label: 'Color', type: 'select', defaultValue: '', required: true, options: ['red', 'green', 'blue'] },
      { name: 'clothes', label: 'Clothes', type: 'text', defaultValue: '', required: true, options: ['a dress', 'a jacket'] },
    ] }, createdAt: 1, revision: 1 }];
    const props = { active: true, request: null, onOpenLibrary: vi.fn(), onViewSource: vi.fn() };
    let view = render(<WorkspacePrompts {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
    const card = await screen.findByRole('button', { name: 'Open Color variations' });
    expect(random).not.toHaveBeenCalled();
    const setData = vi.fn();
    const expected = 'She has green hair and is wearing a jacket. green shoes.';
    fireEvent.dragStart(card.closest('article')!, { dataTransfer: { setData } });
    expect(setData.mock.calls).toEqual([['text/plain', expected], ['application/x-imagemetahub-prompt-text', expected]]);
    expect(random).toHaveBeenCalledTimes(2);
    random.mockReturnValueOnce(0).mockReturnValueOnce(0);
    fireEvent.dragStart(screen.getByRole('button', { name: 'Add to selected node Color variations' }), { shiftKey: true, dataTransfer: { setData } });
    expect(setData).toHaveBeenLastCalledWith('application/x-imagemetahub-prompt-text', 'She has red hair and is wearing a dress. red shoes.');
    expect(random).toHaveBeenCalledTimes(4);
    fireEvent.click(card);
    expect(screen.queryByText('Fill values')).toBeNull();
    expect(screen.queryByRole('button', { name: /Randomize/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Final prompt preview' }).textContent).toContain(template);
    view.unmount(); view = render(<WorkspacePrompts {...props} />);
    expect(screen.getByRole('region', { name: 'Final prompt preview' }).textContent).toContain(template);
    fireEvent.click(screen.getByRole('button', { name: 'Copy block' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(template));
    expect(random).toHaveBeenCalledTimes(4);
    fireEvent.dragStart(within(screen.getByRole('region', { name: 'Prompt details' })).getByLabelText('Drag to node'), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', expected);
    expect(random).toHaveBeenCalledTimes(6);
    fireEvent.dragStart(screen.getByRole('region', { name: 'Final prompt preview' }).querySelector('pre')!, { dataTransfer: { setData } });
    expect(random).toHaveBeenCalledTimes(8);
    fireEvent.click(screen.getByRole('button', { name: '+ Add to node' }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ token: 'field', text: expected, mode: 'append', separator: ', ' }));
    expect(random).toHaveBeenCalledTimes(10);
    const previewText = screen.getByRole('region', { name: 'Final prompt preview' }).querySelector('pre')!;
    const range = document.createRange(); range.selectNodeContents(previewText);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent.contextMenu(previewText); selection.removeAllRanges();
    fireEvent.click(screen.getByRole('button', { name: 'Send to selected node' }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2));
    expect(mocks.apply).toHaveBeenLastCalledWith({ token: 'field', text: expected, mode: 'append', separator: ', ' });
    expect(random).toHaveBeenCalledTimes(12);
    expect(data.blocks[0].text).toBe(template);
    expect(mocks.mutate).not.toHaveBeenCalled();
    view.unmount();
  } finally { random.mockRestore(); }
});

it('allows copying an incomplete block but prevents sending unresolved required fields to a node', async () => {
  data.blocks = [{ id: 'missing-options', text: '{{color}} hair', editor: { ...emptyEditor(), title: 'Needs suggestions', variables: [
    { name: 'color', label: 'Color', type: 'text', defaultValue: '', required: true, options: [] },
  ] }, createdAt: 1, revision: 1 }];
  render(<WorkspacePrompts active request={null} onOpenLibrary={vi.fn()} onViewSource={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  const card = await screen.findByRole('button', { name: 'Open Needs suggestions' });
  expect(card.closest('article')!.draggable).toBe(false);
  fireEvent.click(card);
  expect((screen.getByRole('button', { name: '+ Add to node' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Add suggested values or a default for Color/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy block' }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('{{color}} hair'));
  expect(mocks.apply).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
});

it('opens saved prompts first, preserves literal selected text, and requests a field when the node has several', async () => {
  data.prompts[0].positivePrompt = '  soft light\nportrait, details  ';
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  const navigation = screen.getByRole('button', { name: 'Compose', exact: true }).parentElement!;
  expect(within(navigation).getAllByRole('button').map(button => button.textContent)).toEqual(['Prompts', 'Blocks', 'Compose']);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Portrait' }));
  const text = document.querySelector('[data-prompt-text]')!;
  const range = document.createRange(); range.setStart(text.firstChild!, 0); range.setEnd(text.firstChild!, 14);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  fireEvent.contextMenu(text);
  selection.removeAllRanges();
  mocks.targets.mockResolvedValue({ success: true, targets: [
    { token: 'one', nodeId: '114', nodeTitle: 'Style & Prompt Encoder', field: 'text', preview: 'original' },
    { token: 'two', nodeId: '114', nodeTitle: 'Style & Prompt Encoder', field: 'style_text', preview: 'style' },
  ] });
  fireEvent.click(screen.getByRole('button', { name: 'Send to selected node' }));
  await screen.findByRole('combobox', { name: 'Send destination field' });
  expect(mocks.apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Send destination field' }), { target: { value: 'one' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add to selected field' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ token: 'one', text: '  soft light\np', mode: 'append', separator: ', ' }));
  expect(mocks.mutate).not.toHaveBeenCalled();
  view.unmount();
});

it('does not write when no compatible selected node exists', async () => {
  data.blocks = [{ id: 'test', text: 'soft light', editor: { ...emptyEditor(), title: 'Lighting' }, createdAt: 1, revision: 1 } as PromptBlock];
  mocks.targets.mockResolvedValue({ success: false, targets: [], message: 'Select a text node in ComfyUI.' });
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to selected node Lighting' }));
  expect(await screen.findByRole('button', { name: 'Copy text instead' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Select a text node in ComfyUI.');
  expect(mocks.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy text instead' }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('soft light'));
});


it('adds either prompt channel from its card and replaces node text from its context menu', async () => {
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add prompt to selected node Portrait' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenLastCalledWith({ token: 'field', text: 'studio portrait', mode: 'append', separator: ', ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add negative to selected node Portrait' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenLastCalledWith({ token: 'field', text: 'noise', mode: 'append', separator: ', ' }));
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Portrait' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Replace node text with prompt' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenLastCalledWith({ token: 'field', text: 'studio portrait', mode: 'replace', separator: ', ' }));
  expect(screen.getByRole('status').textContent).toContain('Node text replaced');
  expect(screen.queryByText('Updated Positive · text')).toBeNull();
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it('navigates saved items without collapsing the image preview', async () => {
  data.prompts.push({ ...data.prompts[0], id: 'second', positivePrompt: 'landscape', editor: { ...emptyEditor(), title: 'Landscape' } });
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Portrait' }));
  const preview = screen.getByText('Preview image').closest('details')!;
  preview.open = true; fireEvent(preview, new Event('toggle'));
  fireEvent.click(screen.getByRole('button', { name: 'Next item' }));
  expect(screen.getByRole('button', { name: 'Edit saved prompt' })).toBeTruthy();
  expect(screen.getByText('Preview image').closest('details')!.open).toBe(true);
  expect((screen.getByRole('button', { name: 'Next item' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous item' }));
  expect(screen.getByText('Preview image').closest('details')!.open).toBe(true);
  expect((screen.getByRole('button', { name: 'Previous item' }) as HTMLButtonElement).disabled).toBe(true);
});

it('disables Replace selected without a node selection and sends to the captured field when available', async () => {
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
  const card = await screen.findByRole('button', { name: 'Open Portrait' });
  fireEvent.contextMenu(card);
  expect((screen.getByRole('menuitem', { name: 'Replace selected with prompt' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close card menu' }));
  mocks.targets.mockResolvedValue({ success: true, targets: [{ token: 'selected-range', nodeId: '12', nodeTitle: 'Positive', field: 'text', preview: 'before old after', hasSelection: true }] });
  fireEvent.contextMenu(card);
  await waitFor(() => expect((screen.getByRole('menuitem', { name: 'Replace selected with prompt' }) as HTMLButtonElement).disabled).toBe(false));
  mocks.targets.mockResolvedValue({ success: true, targets: [] });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Replace selected with prompt' }));
  await waitFor(() => expect(mocks.apply).toHaveBeenLastCalledWith({ token: 'selected-range', text: 'studio portrait', mode: 'replaceSelection', separator: ', ' }));
});

it('restores composition, block details and block editing after the Workspace remounts', async () => {
  data.blocks = [{ id: 'light', text: 'soft light', editor: { ...emptyEditor(), title: 'Lighting' }, createdAt: 1, revision: 1 } as PromptBlock];
  const props = { active: true, request: null, onOpenLibrary: vi.fn(), onViewSource: vi.fn() };
  let view = render(<WorkspacePrompts {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compose', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Add prompt text' }));
  fireEvent.change(screen.getAllByRole('textbox', { name: /positive part/ }).at(-1)!, { target: { value: 'draft survives remount' } });
  view.unmount(); view = render(<WorkspacePrompts {...props} />);
  expect(screen.getByRole('region', { name: 'Prompt editor' })).toBeTruthy();
  expect((screen.getAllByRole('textbox', { name: /positive part/ }).at(-1)! as HTMLTextAreaElement).value).toBe('draft survives remount');
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Lighting' }));
  view.unmount(); view = render(<WorkspacePrompts {...props} />);
  expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit saved block' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit saved block' }));
  fireEvent.change(screen.getByLabelText('Block text'), { target: { value: 'block draft survives remount' } });
  view.unmount(); render(<WorkspacePrompts {...props} />);
  expect((screen.getByLabelText('Block text') as HTMLTextAreaElement).value).toBe('block draft survives remount');
  expect(getDraft('comfyui')?.draft.editor?.document?.positive.at(-1)?.text).toBe('draft survives remount');
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it.each(['existing', 'new'] as const)('restores a clean %s block editor and clears it after cancel', async kind => {
  data.blocks = [{ id: 'light', text: 'soft light', editor: { ...emptyEditor(), title: 'Lighting' }, createdAt: 1, revision: 1 } as PromptBlock];
  const props = { active: false, request: null, onOpenLibrary: vi.fn(), onViewSource: vi.fn() };
  let view = render(<WorkspacePrompts {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  if (kind === 'existing') {
    fireEvent.click(await screen.findByRole('button', { name: 'Open Lighting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit saved block' }));
  } else fireEvent.click(screen.getByRole('button', { name: 'New block' }));
  expect(getDraft('comfyui-block')).toBeNull();
  for (let repeat = 0; repeat < 2; repeat++) {
    view.unmount(); view = render(<WorkspacePrompts {...props} />);
    expect(screen.getByRole('region', { name: 'Prompt editor' })).toBeTruthy();
    expect((screen.getByLabelText('Block text') as HTMLTextAreaElement).value).toBe(kind === 'existing' ? 'soft light' : '');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(kind === 'existing' ? 'Lighting' : '');
    expect(getDraft('comfyui-block')).toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  view.unmount(); render(<WorkspacePrompts {...props} />);
  expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
  expect(await screen.findByRole('button', { name: 'Open Lighting' })).toBeTruthy();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
