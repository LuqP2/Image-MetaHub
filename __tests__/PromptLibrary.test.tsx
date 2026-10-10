import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PromptLibrary from '../components/PromptLibrary';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { applyMutation, emptyEditor, makeDocument, snapshotBlock } from '../services/promptLibrary/core.mjs';
import { clearDraft } from '../services/promptLibrary/sessionDraft';
import { usePromptBlockExtraction } from '../hooks/usePromptBlockExtraction';
import type { SavedPrompt, PromptLibrarySnapshot } from '../types';
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
describe('integrated Prompt Library', () => {
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
    expect(screen.getByRole('button', { name: /Add a title/ })).toBeTruthy();
  });
  it('discards only the draft when cancelling an edit', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Studio portrait');
    expect(screen.queryByRole('region', { name: 'Final prompt preview' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Positive prompt'), { target: { value: 'changed draft' } });
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
    fireEvent.click(screen.getByRole('button', { name: 'Add positive block' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a prompt block' });
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'missing' } });
    expect(within(dialog).getByText('No matching blocks.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'soft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Studio light/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Final prompt preview' })).getByText('Studio portrait, soft light')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(data.prompts.find(p => p.id === 'one')?.editor?.document?.positive[1]).toMatchObject({ text: 'soft light', blockRevision: 3, blockId: 'light' }));
    expect(screen.getByRole('region', { name: 'Prompt details' })).toBeTruthy();
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
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Prompt details' })).getByText('bad hands')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy both' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('Studio portrait\nNegative prompt: bad hands'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My portrait' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Open My portrait' }); expect(data.prompts.find((p) => p.id === 'one')?.revision).toBe(2);
  });
  it('creates a negative-only prompt on Free and gates advanced creation', async () => {
    mocks.advanced = false; render(<PromptLibrary onViewSource={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
    fireEvent.change(screen.getByLabelText('Negative prompt'), { target: { value: 'negative only' } }); fireEvent.click(screen.getByRole('button', { name: 'Add template fields' }));
    expect(mocks.gate).toHaveBeenCalledWith('prompt_library_advanced'); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    fireEvent.change(screen.getByLabelText('Positive prompt'), { target: { value: 'draft only' } }); view.unmount(); render(<PromptLibrary onViewSource={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Studio portrait' })).toBeTruthy()); expect((screen.getByLabelText('Positive prompt') as HTMLTextAreaElement).value).toBe('draft only'); expect(mocks.mutate).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Open Template' })); fireEvent.change(screen.getByLabelText('Subject *'), { target: { value: 'world' } }); fireEvent.click(screen.getByRole('button', { name: 'Copy Positive' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('Hello world')); fireEvent.click(screen.getByRole('button', { name: 'Edit' })); fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    expect(screen.getAllByRole('button', { name: 'Add free text' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select', hidden: true })); fireEvent.click(screen.getByLabelText('Select Template')); fireEvent.click(screen.getByRole('button', { name: 'Add tags' })); expect(mocks.gate).toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done selecting', hidden: true }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed template' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await screen.findByRole('button', { name: 'Open Renamed template' });
  });
  it('updates and reorders only a chosen snapshot instance', async () => {
    const block = { id: 'block', createdAt: 1, updatedAt: 1, revision: 1, text: 'soft light', editor: { ...emptyEditor(), title: 'Light' } };
    const editor = emptyEditor(); editor.title = 'Composition'; editor.document = makeDocument('portrait'); editor.document.positive.push(snapshotBlock(block));
    data.prompts[0].editor = editor; data.prompts[0].positivePrompt = 'portrait, soft light'; data.blocks = [{ ...block, revision: 2, text: 'hard light' }];
    render(<PromptLibrary onViewSource={vi.fn()} />); await editItem('Composition'); fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show text' }));
    expect((screen.getByLabelText('positive part 2') as HTMLTextAreaElement).value).toBe('soft light'); vi.spyOn(window, 'confirm').mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Update this block' }));
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
    expect(await screen.findByText('Block saved')).toBeTruthy();
    expect(screen.queryByLabelText('Block text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(trigger);
  });
});
