import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PromptLibrary from '../components/PromptLibrary';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import type { SavedPrompt } from '../types';

const serviceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  resolve: vi.fn(),
}));

vi.mock('../services/savedPromptService', () => ({
  listSavedPrompts: serviceMocks.list,
  removeSavedPrompt: serviceMocks.remove,
  savePrompt: serviceMocks.save,
  subscribeSavedPromptChanges: serviceMocks.subscribe,
  resolveSavedPromptSource: serviceMocks.resolve,
}));

vi.mock('../utils/imageUtils', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue({ success: true }),
}));

const prompt = (
  id: string,
  positivePrompt: string,
  negativePrompt = '',
  sourceCreatedAt: number | null = null,
): SavedPrompt => ({
  id,
  createdAt: Number(id.replace(/\D/g, '')) || 1,
  sourceCreatedAt,
  positivePrompt,
  negativePrompt,
  textBasis: 'effective',
  source: null,
});

describe('PromptLibrary', () => {
  beforeEach(() => {
    serviceMocks.list.mockReset().mockResolvedValue([]);
    serviceMocks.remove.mockReset().mockResolvedValue({ id: 'prompt-1', removed: true });
    serviceMocks.subscribe.mockClear();
    serviceMocks.resolve.mockReset();
    useSavedPromptStore.setState({ prompts: [], isLoading: false, error: null, selectedPromptId: null });
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true, writable: true });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true, writable: true });
  });

  it('shows an explicit empty state and disables Random', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />);
    expect(await screen.findByText('No saved prompts yet')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Random' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a compact prompt and reveals the full negative prompt on expansion', async () => {
    serviceMocks.list.mockResolvedValue([prompt('prompt-1', '  Positive\nline  ', 'negative')]);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    expect((await screen.findByText(/Positive/)).textContent).toContain('Positive\nline');
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeTruthy();
    expect(screen.queryByText('Negative prompt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Negative prompt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy Negative' })).toBeTruthy();
  });

  it('filters live and case-insensitively across positive and negative prompt text', async () => {
    serviceMocks.list.mockResolvedValue([
      prompt('prompt-1', 'Golden landscape', 'rain'),
      prompt('prompt-2', 'Studio portrait', 'NOISY background'),
    ]);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByText('Golden landscape');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search saved prompts' }), { target: { value: 'noisy' } });
    expect(screen.queryByText('Golden landscape')).toBeNull();
    expect(screen.getByText('Studio portrait')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('opens the detail modal from the card while Copy stays in-place and shows feedback', async () => {
    serviceMocks.list.mockResolvedValue([prompt('prompt-1', 'card prompt', 'card negative')]);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    const card = (await screen.findByText('card prompt')).closest('article') as HTMLElement;

    fireEvent.click(card);
    expect(screen.getByRole('dialog', { name: 'Saved prompt details' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close prompt details' }));
    expect(document.activeElement).toBe(card);

    fireEvent.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(await within(card).findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Saved prompt details' })).toBeNull();
  });

  it('shows a resolved source thumbnail and opens the resolved file', async () => {
    const record = prompt('prompt-1', 'source prompt');
    record.source = {
      kind: 'path',
      pathAtSave: { directoryPath: 'D:/synthetic', relativePath: 'source.png', fileSize: 3, contentModifiedMs: 4 },
    };
    serviceMocks.list.mockResolvedValue([record]);
    serviceMocks.resolve.mockResolvedValue({ status: 'available', absolutePath: 'D:/synthetic/source.png', sourceChanged: false });
    const generateThumbnailFromPath = vi.fn().mockResolvedValue({
      success: true,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/webp',
    });
    Object.defineProperty(window, 'electronAPI', {
      value: { generateThumbnailFromPath },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:thumbnail'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const onViewSource = vi.fn();

    render(
      <React.StrictMode>
        <PromptLibrary onViewSource={onViewSource} />
      </React.StrictMode>,
    );
    expect((await screen.findByAltText('Current source') as HTMLImageElement).src).toContain('blob:thumbnail');
    fireEvent.click(screen.getByRole('button', { name: 'View Source' }));
    expect(onViewSource).toHaveBeenCalledWith('D:/synthetic/source.png');

    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    const dialog = screen.getByRole('dialog', { name: 'Saved prompt details' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'View Source' }));
    expect(onViewSource).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog', { name: 'Saved prompt details' })).toBeNull();
  });

  it('Random opens a modal, avoids immediate repetition, and closes without scrolling the grid', async () => {
    const records = [prompt('prompt-1', 'one'), prompt('prompt-2', 'two')];
    serviceMocks.list.mockResolvedValue(records);
    useSavedPromptStore.setState({ selectedPromptId: 'prompt-1' });
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByText('one');
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    expect(useSavedPromptStore.getState().selectedPromptId).toBe('prompt-2');
    expect(screen.getByRole('dialog', { name: 'Saved prompt details' })).toBeTruthy();
    expect(screen.getAllByText('two')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Another' })).toBeTruthy();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Saved prompt details' }).parentElement as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Saved prompt details' })).toBeNull();
    expect(screen.getByText('one')).toBeTruthy();
  });

  it('shows complete positive and negative text in the Random modal and Another changes the result', async () => {
    const first = prompt('prompt-1', 'first complete prompt', 'first negative');
    const second = prompt('prompt-2', 'second complete prompt', 'second negative');
    serviceMocks.list.mockResolvedValue([first, second]);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByText('first complete prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('second complete prompt')).toHaveLength(2);
    expect(screen.getByText('second negative')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Another' }));
    expect(screen.getAllByText('first complete prompt')).toHaveLength(2);
    expect(screen.getByText('first negative')).toBeTruthy();
  });

  it('sorts by saved or source-created time in either direction with unknown created dates last', async () => {
    const savedLater = prompt('prompt-2', 'saved later', '', 100);
    const createdLater = prompt('prompt-1', 'created later', '', 300);
    const unknown = prompt('prompt-3', 'unknown created');
    serviceMocks.list.mockResolvedValue([savedLater, createdLater, unknown]);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByText('saved later');

    const cardPrompts = () => screen.getAllByRole('article').map((card) => card.querySelector('p')?.textContent);
    expect(cardPrompts()).toEqual(['unknown created', 'saved later', 'created later']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort prompts by' }), { target: { value: 'created' } });
    expect(cardPrompts()).toEqual(['created later', 'saved later', 'unknown created']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort direction: Newest' }));
    expect(cardPrompts()).toEqual(['saved later', 'created later', 'unknown created']);
  });

  it('keeps removal behind a discreet action menu and requires confirmation', async () => {
    serviceMocks.list.mockResolvedValue([prompt('prompt-1', 'one'), prompt('prompt-2', 'two')]);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByText('one');
    expect(screen.queryByRole('button', { name: 'Remove saved prompt' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Prompt actions' })[0]);
    expect(screen.getByRole('button', { name: 'Remove saved prompt' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Remove saved prompt' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Prompt actions' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(serviceMocks.remove).toHaveBeenCalledTimes(1));
    expect(useSavedPromptStore.getState().prompts).toHaveLength(1);
  });

  it('does not let an older list response replace a newer one', async () => {
    let resolveOlder!: (value: SavedPrompt[]) => void;
    let resolveNewer!: (value: SavedPrompt[]) => void;
    serviceMocks.list
      .mockImplementationOnce(() => new Promise<SavedPrompt[]>((resolve) => { resolveOlder = resolve; }))
      .mockImplementationOnce(() => new Promise<SavedPrompt[]>((resolve) => { resolveNewer = resolve; }));
    const olderLoad = useSavedPromptStore.getState().load();
    const newerLoad = useSavedPromptStore.getState().load();
    resolveNewer([prompt('prompt-2', 'newer')]);
    await newerLoad;
    resolveOlder([prompt('prompt-1', 'older')]);
    await olderLoad;
    expect(useSavedPromptStore.getState().prompts.map((record) => record.positivePrompt)).toEqual(['newer']);
  });
});
