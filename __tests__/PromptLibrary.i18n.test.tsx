import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromptLibraryBrowser from '../components/promptLibrary/PromptLibraryBrowser';
import PromptFolders from '../components/promptLibrary/PromptFolders';
import PromptImportExportDialog from '../components/promptLibrary/PromptImportExportDialog';
import PromptLibraryFiltersPanel from '../components/promptLibrary/PromptLibraryFilters';
import PromptEditor from '../components/promptLibrary/PromptEditor';
import PromptPreview from '../components/promptLibrary/PromptPreview';
import { clearDraft, getDraft } from '../services/promptLibrary/sessionDraft';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { emptyEditor } from '../services/promptLibrary/core.mjs';
import { emptyFilters } from '../services/promptLibrary/search';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';
import type { SavedPrompt } from '../types';

vi.mock('../hooks/usePromptLibraryPreview', () => ({ usePromptLibraryPreview: () => ({ url: null }) }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseAdvancedPromptLibrary: true, showProModal: vi.fn() }) }));
vi.mock('react-virtualized-auto-sizer', () => ({ default: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) => children({ width: 500, height: 500 }) }));

const originalMutate = useSavedPromptStore.getState().mutate;
afterEach(() => { cleanup(); clearDraft(); useSettingsStore.setState({ language: 'en' }); useSavedPromptStore.setState({ mutate: originalMutate }); });

describe('Prompt Library localized cards and folder forms', () => {
  it.each(languages)('creates a field in the negative channel and localizes every diagnostic in %s', async language => {
    clearDraft(); useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    const view = render(<PromptEditor initial={{ positivePrompt: 'original positive', negativePrompt: 'original negative 海' }} kind="prompt" onSaved={vi.fn()} onClose={vi.fn()} onDirty={vi.fn()} onViewSource={vi.fn()} />);
    const negative = screen.getByRole('textbox', { name: t('promptLibrary.negativePrompt'), exact: true }) as HTMLTextAreaElement;
    negative.setSelectionRange(0, negative.value.length);
    fireEvent.contextMenu(negative);
    fireEvent.click(screen.getByRole('menuitem', { name: t('promptLibrary.makeField') }));
    await waitFor(() => expect(getDraft()?.draft.editor?.document?.negative[0].text).toBe('{{subject}}'));
    expect(getDraft()?.draft.editor?.document?.positive[0].text).toBe('original positive');
    expect(getDraft()?.draft.editor?.document?.variables[0].defaultValue).toBe('original negative 海');
    view.unmount();
    render(<PromptPreview result={{ positivePrompt: '', negativePrompt: '', errors: ['Define variable subject_2.', 'Fill Original 海.'] }} />);
    expect(screen.getByRole('alert').textContent).toBe(t('promptLibrary.defineVariable', { variable: 'subject_2' }) + ' ' + t('promptLibrary.fillField', { field: 'Original 海' }));
  });

  it.each(languages)('imports the same CSV payload and retains filter enums in %s', async language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    const mutate = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
    useSavedPromptStore.setState({ prompts: [], blocks: [], mutate });
    const view = render(<PromptImportExportDialog snapshot={{ prompts: [], blocks: [] }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: t('promptLibrary.import'), exact: true }));
    const file = new File([], 'styles.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => 'name,prompt,negative_prompt\nOriginal 海,cat {prompt},blur' });
    fireEvent.change(screen.getByLabelText(t('promptLibrary.importFile')), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: t('promptLibrary.confirmImport') }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ action: 'import', keepDuplicates: false, prompts: [expect.objectContaining({ positivePrompt: 'cat {{prompt}}', negativePrompt: 'blur', editor: expect.objectContaining({ title: 'Original 海' }) })] }));
    view.unmount();
    const onChange = vi.fn();
    render(<PromptLibraryFiltersPanel all={[]} kind="prompt" filters={emptyFilters} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: t('promptLibrary.filterType') }), { target: { value: 'template' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, type: 'template' });
    fireEvent.change(screen.getByRole('combobox', { name: t('promptLibrary.dateField') }), { target: { value: 'source' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, dateField: 'source' });
  });

  it.each(languages)('keeps card payloads and node action contracts in %s', language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    const title = 'Original {title} 海';
    const item: SavedPrompt = { id: 'original', createdAt: 1, sourceCreatedAt: null, positivePrompt: 'cat {{subject_2}}', negativePrompt: 'blur', textBasis: 'authored', source: null, editor: { ...emptyEditor(), title, tags: ['original-tag'], metadata: { model: 'OriginalModel.safetensors', generator: '', sampler: '', scheduler: '', loras: [] } } };
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
