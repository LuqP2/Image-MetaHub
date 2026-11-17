import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DirectoryList from '../components/DirectoryList';
import FolderSelector from '../components/FolderSelector';
import { formatMessage } from '../i18n/messages.mjs';
import { useSettingsStore } from '../store/useSettingsStore';
import type { Directory } from '../types';
import { version } from '../package.json';

vi.mock('../components/ImageGrid', () => ({
  getActiveDragImageIds: () => [],
  clearActiveDragImageIds: vi.fn(),
}));

afterEach(() => {
  cleanup();
  useSettingsStore.getState().resetState();
});

it('localizes the welcome action and invokes the existing folder picker', () => {
  useSettingsStore.getState().setLanguage('es');
  const onSelectFolder = vi.fn();
  render(<FolderSelector onSelectFolder={onSelectFolder} />);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(`Image MetaHub v${version.split('.').slice(0, 2).join('.')}`);
  fireEvent.click(screen.getByRole('button', { name: 'Seleccionar carpeta de imágenes' }));
  expect(onSelectFolder).toHaveBeenCalledOnce();
});

it('renders localized folder actions in place and preserves the folder name and path', () => {
  const path = 'C:\\Fixtures\\海辺 {raw}';
  const directory = { id: path, name: '海辺 {raw}', path } as Directory;
  const onRemoveDirectory = vi.fn();
  useSettingsStore.getState().setLanguage('en');
  render(<DirectoryList directories={[directory]} onRemoveDirectory={onRemoveDirectory} onUpdateDirectory={vi.fn()} />);

  expect(screen.getByRole('button', { name: directory.name }).getAttribute('title')).toBe(`Select folder: ${path}`);
  act(() => useSettingsStore.getState().setLanguage('ja'));
  expect(screen.getByRole('button', { name: directory.name }).getAttribute('title')).toBe(`フォルダーを選択：${path}`);
  fireEvent.click(screen.getByRole('button', { name: 'フォルダーを登録解除' }));
  expect(onRemoveDirectory).toHaveBeenCalledWith(directory.id);
});

it('preserves the selected root path and localizes the warning and clipboard count', () => {
  const path = 'C:\\';
  const warning = formatMessage('pt-BR', 'libraryFolders.rootDiskWarning', { path });
  expect(warning).toContain(`“${path}”`);
  expect(warning).toContain('\n• Levar horas ou dias');
  expect(formatMessage('pt-BR', 'libraryFolders.pasteImages', { count: 1 })).toBe('Colar 1 imagem');
  expect(formatMessage('pt-BR', 'libraryFolders.pasteImages', { count: 2 })).toBe('Colar 2 imagens');
});
