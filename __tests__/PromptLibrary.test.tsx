import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PromptLibrary from '../components/PromptLibrary';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { applyMutation, emptyEditor, makeDocument, snapshotBlock } from '../services/promptLibrary/core.mjs';
import { clearDraft, getDraft } from '../services/promptLibrary/sessionDraft';
import { usePromptBlockExtraction } from '../hooks/usePromptBlockExtraction';
import type { SavedPrompt, PromptBlock, PromptLibrarySnapshot } from '../types';
const mocks = vi.hoisted(() => ({ list: vi.fn(), mutate: vi.fn(), copy: vi.fn(), gate: vi.fn(), advanced: true }));
vi.mock('../services/savedPromptService', () => ({ listSavedPrompts: vi.fn(), listPromptLibrary: mocks.list, mutatePromptLibrary: mocks.mutate, removeSavedPrompt: vi.fn(), savePrompt: vi.fn(), subscribeSavedPromptChanges: vi.fn() }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseAdvancedPromptLibrary: mocks.advanced, showProModal: mocks.gate }) }));
vi.mock('../hooks/usePromptLibraryPreview', () => ({ usePromptLibraryPreview: () => ({ url: null, status: 'No preview' }), linkSessionPreview: vi.fn() }));
vi.mock('../utils/imageUtils', () => ({ copyTextToClipboard: mocks.copy }));
vi.mock('react-virtualized-auto-sizer', () => ({ default: ({ children }: { children: (dimensions: { width: number; height: number }) => React.ReactNode }) => children({ width: 500, height: 500 }) }));
const prompt = (id: string, text: string): SavedPrompt => ({ id, createdAt: 123, sourceCreatedAt: null, positivePrompt: text, negativePrompt: 'bad hands', textBasis: 'authored', source: null, revision: 1, updatedAt: 123, editor: { ...emptyEditor(), title: text } });
let data: PromptLibrarySnapshot;
beforeEach(() => {
  clearDraft(); data = { prompts: [prompt('one', 'Studio portrait'), prompt('two', 'Golden landscape')], blocks: [] };
  mocks.list.mockReset().mockImplementation(async () => data);
  mocks.mutate.mockReset().mockImplementation(async (command) => { const result = applyMutation(data, command); data = result; return result; });
  mocks.copy.mockReset().mockResolvedValue({ success: true }); mocks.gate.mockClear(); mocks.advanced = true;
  useSavedPromptStore.setState({ prompts: [], blocks: [], isLoading: false, error: null, selectedPromptId: null });
  Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true, writable: true });
});
afterEach(() => { cleanup(); clearDraft(); vi.restoreAllMocks(); });
async function editItem(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Open ${name}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
}
function fieldBlock(): PromptBlock {
  return { id: 'fields', text: 'She has {{color}} hair and is wearing {{clothes}}', createdAt: 1, revision: 1, editor: { ...emptyEditor(), title: 'Hair and clothes', tags: ['portrait'], variables: [
    { name: 'color', label: 'Color', type: 'text', required: true, defaultValue: '', options: ['red', 'blue'] },
    { name: 'clothes', label: 'Clothes', type: 'select', required: true, defaultValue: 'a dress', options: ['a dress', 'a jacket'] },
  ] } };
}
async function openFieldBlock() {
  render(<PromptLibrary onViewSource={vi.fn()} />);
  await screen.findByRole('button', { name: 'Open Studio portrait' });
  fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Hair and clothes' }));
}
describe('integrated Prompt Library', () => {
  it.each((['prompt', 'block'] as const).flatMap(kind => (['Edit', 'favorite', 'card favorite', 'card Edit'] as const).map(action => ({ kind, action }))))('waits for tag saves before $action on a $kind and uses the latest revision', async ({ kind, action }) => {
      data.blocks = [fieldBlock()];
      if (kind === 'block') await openFieldBlock();
      else { render(<PromptLibrary onViewSource={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: 'Open Studio portrait' })); }
      let finish: () => void = () => {};
      mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
      fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'new-tag' } });
      fireEvent.blur(screen.getByLabelText('Tags'));
      await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
      const title = kind === 'block' ? 'Hair and clothes' : 'Studio portrait';
      if (action === 'Edit') fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      else if (action === 'favorite') fireEvent.click(screen.getByRole('button', { name: 'Toggle favorite' }));
      else if (action === 'card favorite') fireEvent.click(screen.getByRole('button', { name: `Favorite ${title}` }));
      else { fireEvent.contextMenu(screen.getByRole('button', { name: `Open ${title}` }).closest('article')!); fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' })); }
      expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
      expect(mocks.mutate).toHaveBeenCalledTimes(1);
      await act(async () => { finish(); });
      const saved = () => (kind === 'block' ? data.blocks : data.prompts).find(item => item.id === (kind === 'block' ? 'fields' : 'one'))!;
      if (action.endsWith('Edit')) {
        const editor = await screen.findByRole('region', { name: 'Prompt editor' });
        expect(within(editor).getByRole('button', { name: 'Remove tag new-tag' })).toBeTruthy();
        expect(saved().revision).toBe(2);
      } else {
        await waitFor(() => expect(saved().revision).toBe(3));
        expect(saved().editor?.favorite).toBe(true);
        expect(mocks.mutate.mock.calls.map(([command]) => command.expectedRevision)).toEqual([1, 2]);
      }
      expect(saved().editor?.tags).toContain('new-tag');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  it.each([true, false])('opens context-menu Edit from the latest block after suggestion saving, already finished=%s', async finishedBeforeClick => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    let finish: () => void = () => {};
    mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Hair and clothes' }).closest('article')!);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    if (finishedBeforeClick) await act(async () => { finish(); });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    if (!finishedBeforeClick) {
      expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
      await act(async () => { finish(); });
    }
    await screen.findByRole('region', { name: 'Prompt editor' });
    expect((screen.getByLabelText('Suggested values for color') as HTMLTextAreaElement).value).toBe('green');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([true, false])('composes from the latest block suggestions after saving, already finished=%s', async finishedBeforeClick => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    let finish: () => void = () => {};
    mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Hair and clothes' }).closest('article')!);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    if (finishedBeforeClick) await act(async () => { finish(); });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Compose' }));
    if (!finishedBeforeClick) {
      expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
      expect(getDraft()).toBeNull();
      await act(async () => { finish(); });
    }
    await screen.findByRole('region', { name: 'Prompt editor' });
    const snapshot = getDraft()?.draft.editor?.document?.positive.find(part => part.kind === 'block');
    expect(snapshot).toMatchObject({ blockId: 'fields', blockRevision: 2, variables: [
      { name: 'color', options: ['green'] }, { name: 'clothes', options: ['a dress', 'a jacket'] },
    ] });
    expect(data.blocks[0].editor.variables[0].options).toEqual(['green']);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Color *')).toBeTruthy();
  });
  it.each([true, false])('searches from the latest card suggestions after saving, already finished=%s', async finishedBeforeClick => {
    data.blocks = [fieldBlock()];
    data.blocks[0].editor.variables[0].options = [];
    const findImages = vi.fn();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<PromptLibrary onViewSource={vi.fn()} onFindImages={findImages} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hair and clothes' }));
    let finish: () => void = () => {};
    mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Hair and clothes' }).closest('article')!);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    if (finishedBeforeClick) await act(async () => { finish(); });
    random.mockClear();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find images' }));
    if (!finishedBeforeClick) {
      expect(findImages).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
      await act(async () => { finish(); });
    }
    await waitFor(() => expect(findImages).toHaveBeenCalledWith('She has green hair and is wearing a dress'));
    expect(findImages).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['Add to Compose', 'Find images'])('cancels card action %s and preserves suggestions when saving fails', async action => {
    data.blocks = [fieldBlock()];
    const findImages = vi.fn();
    render(<PromptLibrary onViewSource={vi.fn()} onFindImages={findImages} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hair and clothes' }));
    let fail: () => void = () => {};
    mocks.mutate.mockImplementationOnce(() => new Promise((_, reject) => { fail = () => reject(new Error('Disk full')); }));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Hair and clothes' }).closest('article')!);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('menuitem', { name: action }));
    await act(async () => { fail(); });
    expect(screen.getAllByText('Disk full').length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
    expect(getDraft()).toBeNull();
    expect(findImages).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Suggested values for color') as HTMLTextAreaElement).value).toBe('green');
    expect(screen.getByRole('button', { name: 'Retry saving color' })).toBeTruthy();
    expect(data.blocks[0].revision).toBe(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it('serializes suggestion saves behind pending tag saves too', async () => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    let finish: () => void = () => {};
    mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'new-tag' } });
    fireEvent.blur(screen.getByLabelText('Tags'));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await waitFor(() => expect(data.blocks[0].revision).toBe(3));
    expect(data.blocks[0].editor.tags).toContain('new-tag');
    expect(data.blocks[0].editor.variables[0].options).toEqual(['green']);
    expect(mocks.mutate.mock.calls.map(([command]) => command.expectedRevision)).toEqual([1, 2]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['Edit', 'Toggle favorite'])('does not run %s when the pending tag save fails', async action => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    let fail: () => void = () => {};
    mocks.mutate.mockImplementationOnce(() => new Promise((_, reject) => { fail = () => reject(new Error('Disk full')); }));
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'new-tag' } });
    fireEvent.blur(screen.getByLabelText('Tags'));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: action, exact: true }));
    await act(async () => { fail(); });
    expect(await screen.findByText('Disk full')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(data.blocks[0].revision).toBe(1);
  });
  it.each([true, false])('finds images from suggested block values through the card menu and details, Pro=%s', async advanced => {
    mocks.advanced = advanced;
    data.blocks = [fieldBlock()];
    data.blocks[0].editor.variables[1].defaultValue = '';
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const findImages = vi.fn();
    render(<PromptLibrary onViewSource={vi.fn()} onFindImages={findImages} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
    const card = await screen.findByRole('button', { name: 'Open Hair and clothes' });
    fireEvent.contextMenu(card.closest('article')!);
    random.mockClear();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find images' }));
    expect(findImages).toHaveBeenLastCalledWith('She has blue hair and is wearing a jacket');
    expect(random).toHaveBeenCalledTimes(2);
    fireEvent.click(card);
    const find = screen.getByRole('button', { name: 'Find images' });
    expect((find as HTMLButtonElement).disabled).toBe(false);
    random.mockClear(); fireEvent.click(find);
    expect(findImages).toHaveBeenCalledTimes(2);
    expect(findImages).toHaveBeenLastCalledWith('She has blue hair and is wearing a jacket');
    expect(random).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.gate).not.toHaveBeenCalled();
    expect(data.blocks[0].text).toBe(fieldBlock().text);
  });
  it.each(['favorite', 'card favorite', 'tags'] as const)('waits for a pending suggestion save before changing %s', async action => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    let finish: () => void = () => {};
    mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    if (action === 'favorite') fireEvent.click(screen.getByRole('button', { name: 'Toggle favorite' }));
    else if (action === 'card favorite') fireEvent.click(screen.getByRole('button', { name: 'Favorite Hair and clothes' }));
    else {
      fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'new-tag' } });
      fireEvent.keyDown(screen.getByLabelText('Tags'), { key: 'Enter' });
    }
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    await act(async () => { finish(); });
    await waitFor(() => expect(data.blocks[0].revision).toBe(3));
    expect(data.blocks[0].editor.variables[0].options).toEqual(['green']);
    expect(action !== 'tags' ? data.blocks[0].editor.favorite : data.blocks[0].editor.tags.includes('new-tag')).toBe(true);
    expect(mocks.mutate.mock.calls.map(([command]) => command.expectedRevision)).toEqual([1, 2]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['prompt', 'block'] as const)('recovers an edited %s as a copy after its card is deleted', async kind => {
    data.blocks = [fieldBlock()];
    if (kind === 'block') { await openFieldBlock(); fireEvent.click(screen.getByRole('button', { name: 'Edit' })); }
    else { render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait'); }
    fireEvent.change(screen.getByLabelText(kind === 'block' ? 'Block text' : 'Prompt'), { target: { value: 'Draft to keep' } });
    const oldId = kind === 'block' ? 'fields' : 'one';
    const title = kind === 'block' ? 'Hair and clothes' : 'Studio portrait';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.contextMenu(screen.getByRole('button', { name: `Open ${title}` }).closest('article')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByText('This saved item was deleted. Save a copy to keep your draft.');
    expect((screen.getByLabelText(kind === 'block' ? 'Block text' : 'Prompt') as HTMLTextAreaElement).value).toBe('Draft to keep');
    expect((screen.getByRole('button', { name: kind === 'block' ? 'Save block' : 'Save', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save as a copy' }));
    await screen.findByRole('region', { name: 'Prompt details' });
    const saved = (kind === 'block' ? data.blocks : data.prompts).find(item => item.editor?.title === title)!;
    expect(saved.id).not.toBe(oldId);
    expect('text' in saved ? saved.text : saved.positivePrompt).toBe('Draft to keep');
    expect((kind === 'block' ? data.blocks : data.prompts).some(item => item.id === oldId)).toBe(false);
  });
  it.each(['prompt', 'block'] as const)('edits a saved %s in its existing details panel and keeps the browser beside it', async kind => {
    data.blocks = [fieldBlock()];
    if (kind === 'block') await openFieldBlock();
    else { render(<PromptLibrary onViewSource={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: 'Open Studio portrait' })); }
    const panel = screen.getByLabelText('Selected library item');
    const panelClass = panel.className;
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('region', { name: 'Prompt editor' }).parentElement).toBe(panel);
    expect(panel.className).toBe(panelClass);
    expect(screen.getByRole('button', { name: kind === 'block' ? 'Open Hair and clothes' : 'Open Studio portrait' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(kind === 'block' ? 'Block text' : 'Prompt'), { target: { value: 'Edited in place' } });
    fireEvent.click(screen.getByRole('button', { name: kind === 'block' ? 'Save block' : 'Save' }));
    await screen.findByRole('region', { name: 'Prompt details' });
    expect(screen.getByLabelText('Selected library item').className).toBe(panelClass);
    expect(kind === 'block' ? data.blocks[0].text : data.prompts.find(entry => entry.id === 'one')!.positivePrompt).toBe('Edited in place');
  });
  it('shows editable suggestions immediately and saves quick edits to separate fields without overwriting either', async () => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    const color = screen.getByLabelText('Suggested values for color');
    const clothes = screen.getByLabelText('Suggested values for clothes');
    expect((color as HTMLTextAreaElement).value).toBe('red\nblue');
    expect((clothes as HTMLTextAreaElement).value).toBe('a dress\na jacket');
    fireEvent.change(color, { target: { value: 'green\npurple' } });
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.blur(color, { relatedTarget: clothes });
    fireEvent.change(clothes, { target: { value: 'a coat\na suit' } });
    fireEvent.blur(clothes);
    await waitFor(() => expect(data.blocks[0].revision).toBe(3));
    expect(data.blocks[0].editor.variables.map(field => field.options)).toEqual([['green', 'purple'], ['a coat', 'a suit']]);
    expect(data.blocks[0].text).toBe(fieldBlock().text);
    expect(data.blocks[0].editor.tags).toEqual(['portrait']);
    expect(data.blocks[0].editor.variables[1].defaultValue).toBe('a dress');
    expect(mocks.mutate.mock.calls.map(([command]) => command.expectedRevision)).toEqual([1, 2]);
    expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
  });
  it('keeps failed suggestion edits visible and lets the user retry without entering Edit', async () => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    mocks.mutate.mockRejectedValueOnce(new Error('Disk full'));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    await screen.findByRole('alert');
    expect((color as HTMLTextAreaElement).value).toBe('green');
    expect(data.blocks[0].editor.variables[0].options).toEqual(['red', 'blue']);
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving color' }));
    await waitFor(() => expect(data.blocks[0].editor.variables[0].options).toEqual(['green']));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('keeps an external field change instead of silently overwriting it with a local suggestion edit', async () => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'local green' } });
    const updated = structuredClone(data.blocks[0]); updated.revision = 2; updated.editor.variables[0].options = ['external blue'];
    act(() => { data.blocks = [updated]; useSavedPromptStore.setState({ blocks: [updated] }); });
    fireEvent.blur(color);
    expect(await screen.findByText(/This field changed elsewhere/)).toBeTruthy();
    expect((color as HTMLTextAreaElement).value).toBe('local green');
    expect(data.blocks[0].editor.variables[0].options).toEqual(['external blue']);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('waits for a suggestion save before opening Edit with the latest revision', async () => {
    data.blocks = [fieldBlock()]; await openFieldBlock();
    let finish: () => void = () => {};
    mocks.mutate.mockImplementationOnce(command => new Promise(resolve => { finish = () => { data = applyMutation(data, command); resolve(data); }; }));
    const color = screen.getByLabelText('Suggested values for color');
    fireEvent.change(color, { target: { value: 'green' } }); fireEvent.blur(color);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    await act(async () => { finish(); });
    await screen.findByRole('region', { name: 'Prompt editor' });
    expect((screen.getByLabelText('Suggested values for color') as HTMLTextAreaElement).value).toBe('green');
    expect(screen.queryByText(/This item changed in another window/)).toBeNull();
  });
  it('finds images from the card menu and opened details without changing the saved prompt', async () => {
    const findImages = vi.fn();
    render(<PromptLibrary onViewSource={vi.fn()} onFindImages={findImages} />);
    const card = await screen.findByRole('button', { name: 'Open Studio portrait' });
    fireEvent.contextMenu(card.closest('article')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find images' }));
    expect(findImages).toHaveBeenLastCalledWith('Studio portrait');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: 'Find images' }));
    expect(findImages).toHaveBeenCalledTimes(2);
    expect(findImages).toHaveBeenLastCalledWith('Studio portrait');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('opens templates to fill required values before finding images, including on Free', async () => {
    mocks.advanced = false;
    data.prompts[0].editor!.title = 'Template';
    data.prompts[0].editor!.document = { ...makeDocument('Hello {{subject}}'), mode: 'template', variables: [{ name: 'subject', label: 'Subject', type: 'text', required: true, defaultValue: '', options: [] }] };
    const findImages = vi.fn();
    render(<PromptLibrary onViewSource={vi.fn()} onFindImages={findImages} />);
    fireEvent.contextMenu((await screen.findByRole('button', { name: 'Open Template' })).closest('article')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find images' }));
    expect(findImages).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Find images' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Subject *'), { target: { value: 'world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find images' }));
    expect(findImages).toHaveBeenLastCalledWith('Hello world');
    expect(mocks.gate).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('opens an optional-only template when its compiled search text is empty', async () => {
    data.prompts[0].editor!.title = 'Optional template';
    data.prompts[0].editor!.document = { ...makeDocument('{{subject}}'), mode: 'template', variables: [{ name: 'subject', label: 'Subject', type: 'text', required: false, defaultValue: '', options: [] }] };
    const findImages = vi.fn();
    render(<PromptLibrary onViewSource={vi.fn()} onFindImages={findImages} />);
    fireEvent.contextMenu((await screen.findByRole('button', { name: 'Open Optional template' })).closest('article')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find images' }));
    expect(findImages).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Find images' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'portrait' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find images' }));
    expect(findImages).toHaveBeenCalledWith('portrait');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each(['', '   \n\t '])('finds images using negative text when positive text is blank (%j)', async (positive) => {
    data.prompts[0].positivePrompt = positive;
    const findImages = vi.fn();
    render(<PromptLibrary onViewSource={vi.fn()} onFindImages={findImages} />);
    const card = await screen.findByRole('button', { name: 'Open Studio portrait' });
    fireEvent.contextMenu(card.closest('article')!);
    expect((screen.getByRole('menuitem', { name: 'Find images' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find images' }));
    expect(findImages).toHaveBeenCalledWith('bad hands');
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: 'Find images' }));
    expect(findImages).toHaveBeenCalledWith('bad hands');
    expect(findImages).toHaveBeenCalledTimes(2);
  });
  it('lets saved legacy Options fields use custom text and random suggestions without changing the saved prompt', async () => {
    data.prompts[0].editor!.document = { ...makeDocument('A {{color}} car'), mode: 'template', variables: [
      { name: 'color', label: 'Color', type: 'select', defaultValue: 'red', required: true, options: ['red', 'green', 'blue'] },
    ] };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      render(<PromptLibrary onViewSource={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open Studio portrait' }));
      const input = screen.getByRole('combobox', { name: 'Color *' });
      fireEvent.change(input, { target: { value: 'burgundy' } });
      fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
      await waitFor(() => expect(mocks.copy).toHaveBeenLastCalledWith('A burgundy car'));
      fireEvent.click(screen.getByRole('button', { name: 'Randomize Color' }));
      fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
      await waitFor(() => expect(mocks.copy).toHaveBeenLastCalledWith('A blue car'));
      expect(random).toHaveBeenCalledTimes(1);
      expect(mocks.mutate).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
  });
  it('selects cards in list and grid without opening details or toggling twice', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Studio portrait' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select card Studio portrait' }));
    expect((screen.getByLabelText('Select Studio portrait') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('region', { name: 'Prompt details' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Select Studio portrait'));
    expect((screen.getByLabelText('Select Studio portrait') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Select card Studio portrait' }).closest('article')!);
    expect((screen.getByLabelText('Select Studio portrait') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select card Studio portrait' }));
    expect((screen.getByLabelText('Select Studio portrait') as HTMLInputElement).checked).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done selecting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio portrait' }));
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
  });
  it('opens read-only details and keeps favorite changes independent of editing', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Studio portrait' }));
    expect(screen.queryByRole('region', { name: 'Prompt editor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle favorite' }));
    await waitFor(() => expect(data.prompts.find(p => p.id === 'one')?.editor?.favorite).toBe(true));
    expect(data.prompts.find(p => p.id === 'one')?.positivePrompt).toBe('Studio portrait');
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
  });
  it('shows real card information without placeholder titles or unknown-model noise', async () => {
    data.prompts[0].editor!.title = '';
    data.prompts[1].editor!.metadata.model = 'Flux';
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Studio portrait' });
    expect(screen.queryByText(/Untitled prompt/i)).toBeNull();
    expect(screen.getByText('Studio portrait')).toBeTruthy();
    expect(screen.getByText('Flux')).toBeTruthy();
    expect(screen.queryByText(/Unknown model/)).toBeNull();
    expect(screen.queryByText(/^prompt ·/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(screen.getAllByRole('button', { name: 'Open Studio portrait' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Open Golden landscape' })).toHaveLength(1);
    expect(screen.queryByText(/Untitled prompt/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio portrait' }));
    expect(screen.queryByText(/Untitled prompt/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a title/ })).toBeNull();
  });
  it('discards only the draft when cancelling an edit', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait');
    expect(screen.getByRole('complementary', { name: 'Composition result' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'changed draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
    expect(data.prompts.find(p => p.id === 'one')?.positivePrompt).toBe('Studio portrait');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('reveals bulk selection on demand and applies normalized tag chips to chosen items', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Studio portrait' });
    expect(screen.queryByLabelText('Select Studio portrait')).toBeNull();
    expect(screen.queryByText('0 selected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByLabelText('Select Studio portrait'));
    fireEvent.change(screen.getByLabelText('Bulk tags'), { target: { value: ' Lighting ' } });
    fireEvent.keyDown(screen.getByLabelText('Bulk tags'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));
    await waitFor(() => expect(data.prompts.find(p => p.id === 'one')?.editor?.tags).toEqual(['lighting']));
    expect(data.prompts.find(p => p.id === 'two')?.editor?.tags).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByLabelText('Select Studio portrait')).toBeNull();
  });
  it('filters using independent tag and model groups and resets without leaving details', async () => {
    data.prompts[0].editor!.tags = ['portrait']; data.prompts[0].editor!.metadata.model = 'Flux';
    data.prompts[1].editor!.tags = ['landscape'];
    render(<PromptLibrary onViewSource={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Studio portrait' }));
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = screen.getByRole('complementary', { name: 'Prompt filters' });
    fireEvent.click(within(panel).getByRole('button', { name: 'landscape' }));
    expect(screen.queryByRole('button', { name: 'Open Studio portrait' })).toBeNull();
    fireEvent.click(within(panel).getByLabelText('Flux'));
    expect(screen.getByText('No matching prompts')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('button', { name: 'Open Studio portrait' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
  });
  it('inserts a block through the searchable picker and preserves its snapshot', async () => {
    data.blocks = [{ id: 'light', createdAt: 1, updatedAt: 1, revision: 3, text: 'soft light', editor: { ...emptyEditor(), title: 'Studio light', category: 'Lighting', tags: ['soft'] } }];
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait');
    fireEvent.click(screen.getByRole('button', { name: 'Compose with blocks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add positive blocks' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose prompt blocks' });
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'missing' } });
    expect(within(dialog).getByText('No matching blocks.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'soft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Studio light/ }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 block' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Final prompt preview' })).getByText('Studio portrait, soft light')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(data.prompts.find(p => p.id === 'one')?.editor?.document?.positive[1]).toMatchObject({ text: 'soft light', blockRevision: 3, blockId: 'light' }));
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
  });
  it('opens a new unsaved composition from the Blocks context menu', async () => {
    data.blocks = [{ id: 'light', createdAt: 1, revision: 2, text: 'soft light', editor: { ...emptyEditor(), title: 'Lighting' } }];
    render(<PromptLibrary onViewSource={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
    const card = await screen.findByRole('button', { name: 'Open Lighting' });
    fireEvent.contextMenu(card.closest('article')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Compose' }));
    expect(screen.getByRole('button', { name: 'Compose with blocks' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('region', { name: 'Final prompt preview' })).getByText('soft light')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('offers explicit selected, filtered and entire-library export scopes', async () => {
    data.blocks = [{ id: 'block', createdAt: 1, updatedAt: 1, revision: 1, text: 'soft light', editor: emptyEditor() }];
    render(<PromptLibrary onViewSource={vi.fn()} />); await screen.findByRole('button', { name: 'Open Studio portrait' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' })); fireEvent.click(screen.getByLabelText('Select Studio portrait'));
    fireEvent.click(screen.getByRole('button', { name: 'Export selected' }));
    const dialog = screen.getByRole('dialog', { name: 'Import and export prompts' });
    expect(within(dialog).getByText(/1 prompts and 0 blocks/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Export scope'), { target: { value: 'filtered' } });
    expect(within(dialog).getByText(/2 prompts and 0 blocks/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Export scope'), { target: { value: 'library' } });
    expect(within(dialog).getByText(/2 prompts and 1 blocks/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(within(dialog).getByLabelText('Import styles.csv or Prompt Library JSON')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Export file' })).toBeNull();
  });
  it('copies literal blocks and keeps node-only drag out of the library, including on Free', async () => {
    mocks.advanced = false;
    const template = 'She has {{color}} hair and is wearing {{clothes}}';
    data.blocks = [{ id: 'synthetic-template', text: template, createdAt: 1, revision: 1, editor: { ...emptyEditor(), title: 'Hair and clothes', variables: [
      { name: 'color', label: 'Color', type: 'text', required: true, defaultValue: '', options: ['red', 'blue'] },
      { name: 'clothes', label: 'Clothes', type: 'select', required: true, defaultValue: '', options: ['a dress', 'a jacket'] },
    ] } }];
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Studio portrait' });
    fireEvent.click(screen.getByRole('button', { name: 'Blocks', exact: true }));
    const card = await screen.findByRole('button', { name: 'Open Hair and clothes' });
    expect(card.closest('article')!.draggable).toBe(false);
    fireEvent.contextMenu(card.closest('article')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(template));
    fireEvent.click(card);
    expect(screen.queryByText('Fill values')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy block' })); });
    expect(mocks.copy).toHaveBeenLastCalledWith(template);
    expect(screen.queryByLabelText('Drag to node')).toBeNull();
    expect(screen.queryByText(/Drag to a node/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Final prompt preview' }).parentElement!.draggable).toBe(false);
    expect(screen.getByLabelText('Suggested values for color').matches(':disabled')).toBe(true);
    expect(data.blocks[0].text).toBe(template);
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.gate).not.toHaveBeenCalled();
  });
  it('shows an empty state and disables Random', async () => {
    data.prompts = []; render(<PromptLibrary onViewSource={vi.fn()} />);
    expect(await screen.findByText('No saved prompts yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Library tools' }));
    expect((screen.getByRole('button', { name: 'Random' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('searches metadata and negative text, edits in-place, and copies both channels', async () => {
    data.prompts[0].editor!.metadata.model = 'Flux'; render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Studio portrait' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'flux "bad hands"' } });
    expect(screen.queryByRole('button', { name: 'Open Golden landscape' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio portrait' }));
    expect(screen.queryByLabelText('Prompt')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Prompt details' })).getByText('bad hands')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy both' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('Studio portrait\nNegative prompt: bad hands'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My portrait' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Open My portrait' }); expect(data.prompts.find((p) => p.id === 'one')?.revision).toBe(2);
  });
  it('creates a negative-only prompt on Free and gates advanced creation', async () => {
    mocks.advanced = false; render(<PromptLibrary onViewSource={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
    expect(screen.queryByLabelText('Negative prompt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add negative' }));
    fireEvent.change(screen.getByLabelText('Negative prompt'), { target: { value: 'negative only' } }); expect((screen.getByRole('button', { name: 'Add field', hidden: true }) as HTMLButtonElement).disabled).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(data.prompts.some((p) => p.positivePrompt === '' && p.negativePrompt === 'negative only')).toBe(true));
  });
  it('guards unsaved navigation and resumes after saving', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } }); fireEvent.click(screen.getByRole('button', { name: 'Open Golden landscape' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Changed'); fireEvent.click(screen.getByRole('button', { name: 'Open Golden landscape' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await screen.findByRole('region', { name: 'Prompt details' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Golden landscape');
    expect(data.prompts.find((p) => p.id === 'one')?.editor?.title).toBe('Changed');
  });
  it('recovers unsaved edits when the Library section remounts', async () => {
    const view = render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait');
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'draft only' } }); view.unmount(); render(<PromptLibrary onViewSource={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Studio portrait' })).toBeTruthy()); expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('draft only'); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('reveals a save failure while preserving the draft and cancelling pending navigation', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft' } });
    mocks.mutate.mockRejectedValueOnce(new Error('Disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Open Golden landscape' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await screen.findByText('Disk full'); expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Draft');
    expect(data.prompts[0].editor?.title).toBe('Studio portrait');
  });
  it('gates bulk and structure edits but retains metadata editing and template filling on Free', async () => {
    mocks.advanced = false; const editor = emptyEditor(); editor.title = 'Template'; editor.document = { ...makeDocument('Hello {{subject}}'), mode: 'template', variables: [{ name: 'subject', label: 'Subject', type: 'text', required: true, defaultValue: '', options: [] }] };
    data.prompts[0].editor = editor; data.prompts[0].positivePrompt = 'Hello {{subject}}'; render(<PromptLibrary onViewSource={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Template' })); fireEvent.change(screen.getByLabelText('Subject *'), { target: { value: 'world' } }); fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('Hello world')); fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getAllByRole('button', { name: /Add (prompt|negative) text/ }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select', hidden: true })); fireEvent.click(screen.getByLabelText('Select Template')); fireEvent.click(screen.getByRole('button', { name: 'Add tags' })); expect(mocks.gate).toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done selecting', hidden: true }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed template' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await screen.findByRole('button', { name: 'Open Renamed template' });
  });
  it('updates and reorders only a chosen snapshot instance', async () => {
    const block = { id: 'block', createdAt: 1, updatedAt: 1, revision: 1, text: 'soft light', editor: { ...emptyEditor(), title: 'Light' } };
    const editor = emptyEditor(); editor.title = 'Composition'; editor.document = makeDocument('portrait'); editor.document.positive.push(snapshotBlock(block));
    data.prompts[0].editor = editor; data.prompts[0].positivePrompt = 'portrait, soft light'; data.blocks = [{ ...block, revision: 2, text: 'hard light' }];
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Composition');
    fireEvent.click(screen.getByRole('button', { name: 'Show text' }));
    expect((screen.getByLabelText('positive part 2') as HTMLTextAreaElement).value).toBe('soft light'); vi.spyOn(window, 'confirm').mockReturnValue(true); fireEvent.click(screen.getByText('Update available')); fireEvent.click(screen.getByRole('button', { name: 'Update this block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move positive part 2 up' })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(data.prompts.find((p) => p.id === 'one')?.positivePrompt).toBe('hard light, portrait'));
  });
  it('keeps a draft after deletion failure and permits an explicit duplicate', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: 'Open Studio portrait' }));
    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }));
    mocks.mutate.mockRejectedValueOnce(new Error('Disk full')); vi.spyOn(window, 'confirm').mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Remove' })); await screen.findByText('Disk full');
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Item actions' })); fireEvent.click(screen.getByRole('button', { name: 'Duplicate' })); await screen.findByRole('button', { name: 'Open Studio portrait Copy' }); expect(data.prompts).toHaveLength(3);
  });
  it('preserves the local draft after another window changes its revision', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait'); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Local draft' } });
    act(() => useSavedPromptStore.setState({ prompts: data.prompts.map((p) => p.id === 'one' ? { ...p, revision: 2 } : p) })); await screen.findByText(/This item changed in another window/);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Local draft');
  });
  it('extracts literal text and restores focus after Escape', async () => {
    function Extract() { const extraction = usePromptBlockExtraction(); return <><button onClick={() => extraction.open('  selected\ntext  ')}>Extract</button>{extraction.dialog}</>; }
    render(<Extract />); const trigger = screen.getByRole('button', { name: 'Extract' }); trigger.focus(); fireEvent.click(trigger);
    expect((screen.getByLabelText('Block text') as HTMLTextAreaElement).value).toBe('  selected\ntext  '); fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Save block' })); await waitFor(() => expect(data.blocks[0]?.text).toBe('  selected\ntext  '));
    expect(await screen.findByText('Block saved.')).toBeTruthy();
    expect(screen.queryByLabelText('Block text')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Edit block' }));
    expect((screen.getByLabelText('Block text') as HTMLTextAreaElement).value).toBe('  selected\ntext  ');
    expect(data.blocks).toHaveLength(1);
  });
  it('copies, duplicates, edits and deletes saved items directly from their card menu', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />);
    const card = await screen.findByRole('button', { name: 'Open Studio portrait' });
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('Studio portrait\nNegative prompt: bad hands'));
    expect(screen.queryByRole('region', { name: 'Prompt details' })).toBeNull();
    fireEvent.contextMenu(card); fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    const duplicate = await screen.findByRole('button', { name: 'Open Studio portrait Copy' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.contextMenu(duplicate); fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(data.prompts).toHaveLength(2));
    fireEvent.contextMenu(card); fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByLabelText('Prompt')).toBeTruthy();
  });
  it('turns selected text into a field and preserves the rendered text through its default', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait');
    const text = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    text.setSelectionRange(0, 6); fireEvent.contextMenu(text);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make selection a fillable field' }));
    expect((screen.getByLabelText('positive part 1') as HTMLTextAreaElement).value).toBe('{{subject}} portrait');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(data.prompts[0].editor?.document?.variables[0]).toMatchObject({ name: 'subject', defaultValue: 'Studio', required: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('Studio portrait'));
  });

});
