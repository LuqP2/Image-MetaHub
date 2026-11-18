import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImageEditorWorkspace from '../components/ImageEditorWorkspace';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { Directory, IndexedImage } from '../types';

vi.mock('../services/mediaSourceCache', () => ({
  mediaSourceCache: { getOrLoad: vi.fn().mockResolvedValue('blob:editor-fixture') },
}));

vi.mock('../services/imageEditingService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/imageEditingService')>(),
  renderImageEditorDocumentToPngBlob: vi.fn().mockResolvedValue(new Blob()),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useImageStore.setState({ directories: [] });
  useSettingsStore.setState({ language: 'en' });
});

it('keeps edits when the language changes and sends localized dialogs with the original file path', async () => {
  const fileName = 'test {fixture} 海.png';
  const image = { id: `source::${fileName}`, name: fileName, directoryId: 'source' } as IndexedImage;
  const directory = { id: 'source', name: 'Source', path: 'D:/synthetic-source' } as Directory;
  const confirm = vi.fn().mockReturnValue(false);
  const writeFile = vi.fn();
  const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true });
  const joinPaths = vi.fn(async (base: string, file: string) => ({ success: true, path: `${base}/${file}` }));
  const onBack = vi.fn();
  vi.stubGlobal('Image', class {
    naturalWidth = 64;
    naturalHeight = 64;
    onload: (() => void) | null = null;
    set src(_source: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:editor-preview'; }
    static revokeObjectURL() {}
  });
  vi.stubGlobal('confirm', confirm);
  vi.stubGlobal('electronAPI', { writeFile, showSaveDialog, joinPaths });
  useImageStore.setState({ directories: [directory] });
  useSettingsStore.setState({ language: 'en' });
  render(<ImageEditorWorkspace image={image} directoryPath={directory.path} onBack={onBack} />);

  const brightness = await screen.findByRole('spinbutton', { name: 'Brightness' });
  fireEvent.change(brightness, { target: { value: '120' } });
  expect(screen.getByText('· Unsaved edits', { exact: false })).toBeTruthy();

  act(() => useSettingsStore.setState({ language: 'pt-BR' }));
  expect(screen.getByRole('spinbutton', { name: 'Brilho' })).toHaveProperty('value', '120');
  expect(screen.getByRole('button', { name: 'Capturar cor' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  expect(confirm).toHaveBeenLastCalledWith('Sobrescrever a imagem original com o resultado do editor? Essa ação não pode ser desfeita.');
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
  expect(confirm).toHaveBeenLastCalledWith('Sair do editor de imagens e descartar o estado atual da edição?');
  expect(onBack).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();

  act(() => useSettingsStore.setState({ language: 'es' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar como' }));
  await waitFor(() => expect(showSaveDialog).toHaveBeenCalledExactlyOnceWith({
    title: 'Guardar imagen editada',
    defaultPath: 'D:/synthetic-source/test {fixture} 海-editor.png',
    filters: [{ name: 'Imagen PNG', extensions: ['png'] }],
  }));
  expect(writeFile).not.toHaveBeenCalled();
});
