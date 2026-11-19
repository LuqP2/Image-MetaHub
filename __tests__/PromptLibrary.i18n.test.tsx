import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromptLibraryBrowser from '../components/promptLibrary/PromptLibraryBrowser';
import PromptFolders from '../components/promptLibrary/PromptFolders';
import { emptyEditor } from '../services/promptLibrary/core.mjs';
import { emptyFilters } from '../services/promptLibrary/search';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';
import type { SavedPrompt } from '../types';

vi.mock('../hooks/usePromptLibraryPreview', () => ({ usePromptLibraryPreview: () => ({ url: null }) }));
vi.mock('react-virtualized-auto-sizer', () => ({ default: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) => children({ width: 500, height: 500 }) }));

afterEach(() => { cleanup(); useSettingsStore.setState({ language: 'en' }); });

describe('Prompt Library localized cards and folder forms', () => {
  it.each(languages)('keeps card payloads and node action contracts in %s', language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    const title = 'Original {title} 海';
    const item: SavedPrompt = { id: 'original', createdAt: 1, sourceCreatedAt: null, positivePrompt: 'cat {{subject_2}}', negativePrompt: 'blur', textBasis: 'authored', source: null, editor: { ...emptyEditor(), title, tags: ['original-tag'], metadata: { model: 'OriginalModel.safetensors' } } };
    const before = JSON.stringify(item);
    const onOpen = vi.fn(), onContextAction = vi.fn(), onFilters = vi.fn();
    render(<PromptLibraryBrowser all={[item]} visible={[item]} filters={emptyFilters} onFilters={onFilters} selected={new Set()} selectionMode={false} onSelectionMode={vi.fn()} showFilters={false} onToggleFilters={vi.fn()} onOpen={onOpen} onSelect={vi.fn()} onFavorite={vi.fn()} onContextAction={onContextAction} canReplaceSelection />);
    const card = screen.getByRole('button', { name: t('promptLibrary.openNamed', { title }) });
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(item);
    expect(screen.getByText('OriginalModel.safetensors')).toBeTruthy();
    expect(screen.getByText('original-tag')).toBeTruthy();
    fireEvent.contextMenu(card.closest('article')!);
    fireEvent.click(screen.getByRole('menuitem', { name: t('promptLibrary.replaceSelectedNegative') }));
    expect(onContextAction).toHaveBeenCalledWith(item, 'replaceSelection', 'negative');
    fireEvent.change(screen.getByRole('combobox', { name: t('promptLibrary.sortPrompts') }), { target: { value: 'title' } });
    expect(onFilters).toHaveBeenLastCalledWith({ ...emptyFilters, sort: 'title' });
    act(() => { useSettingsStore.setState({ language: language === 'en' ? 'ja' : 'en' }); });
    const nextLanguage = language === 'en' ? 'ja' : 'en';
    expect(screen.getByRole('button', { name: formatMessage(nextLanguage, 'promptLibrary.openNamed', { title }) })).toBeTruthy();
    expect(onContextAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(item)).toBe(before);
  });

  it.each(languages)('preserves folder input and retranslates an existing error in %s', async language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    const mutate = vi.fn().mockRejectedValue(new Error('A folder with this name already exists.'));
    render(<PromptFolders folders={[]} value="all" onChange={vi.fn()} onMutate={mutate} onRemove={vi.fn()} removing={false} />);
    fireEvent.click(screen.getByRole('button', { name: t('promptLibrary.newFolder') }));
    fireEvent.change(screen.getByRole('textbox', { name: t('promptLibrary.folderName') }), { target: { value: 'Original {folder} 海' } });
    fireEvent.click(screen.getByRole('button', { name: t('promptLibrary.saveFolder') }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('promptLibrary.folderExists')));
    expect(mutate).toHaveBeenCalledWith({ action: 'folder-create', name: 'Original {folder} 海' });
    act(() => { useSettingsStore.setState({ language: language === 'en' ? 'ja' : 'en' }); });
    const nextLanguage = language === 'en' ? 'ja' : 'en';
    expect(screen.getByRole('alert').textContent).toBe(formatMessage(nextLanguage, 'promptLibrary.folderExists'));
    expect((screen.getByRole('textbox', { name: formatMessage(nextLanguage, 'promptLibrary.folderName') }) as HTMLInputElement).value).toBe('Original {folder} 海');
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
