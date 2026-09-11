import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const prompt = (id: string, positivePrompt: string, negativePrompt = ''): SavedPrompt => ({
  id,
  createdAt: Number(id.replace(/\D/g, '')) || 1,
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
    useSavedPromptStore.setState({ prompts: [], isLoading: false, error: null, selectedPromptId: null });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  it('shows an explicit empty state and disables Random', async () => {
    render(<PromptLibrary onViewSource={vi.fn()} />);
    expect(await screen.findByText('No saved prompts yet')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Random' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows literal positive and expandable negative text with both copy actions', async () => {
    serviceMocks.list.mockResolvedValue([prompt('prompt-1', '  Positive\nline  ', 'negative')]);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    expect((await screen.findByText(/Positive/)).textContent).toContain('Positive\nline');
    expect(screen.getByText('Negative prompt')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy Negative' })).toBeTruthy();
  });

  it('Random avoids the currently selected prompt when alternatives exist', async () => {
    const records = [prompt('prompt-1', 'one'), prompt('prompt-2', 'two')];
    serviceMocks.list.mockResolvedValue(records);
    useSavedPromptStore.setState({ selectedPromptId: 'prompt-1' });
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByText('one');
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    expect(useSavedPromptStore.getState().selectedPromptId).toBe('prompt-2');
  });

  it('requires inline confirmation and removes only the selected bookmark', async () => {
    serviceMocks.list.mockResolvedValue([prompt('prompt-1', 'one'), prompt('prompt-2', 'two')]);
    render(<PromptLibrary onViewSource={vi.fn()} />);
    await screen.findByText('one');
    const removeButtons = screen.getAllByRole('button', { name: 'Remove saved prompt' });
    fireEvent.click(removeButtons[0]);
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
