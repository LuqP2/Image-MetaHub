import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BatchExportModal from '../components/BatchExportModal';
import { formatMessage, languages } from '../i18n/messages.mjs';
import { useSettingsStore } from '../store/useSettingsStore';
import type { IndexedImage } from '../types';

vi.mock('../services/userDataPersistenceAdapter', () => ({
  getPersistedShadowMetadata: async () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useSettingsStore.setState({ language: 'en' });
});

it('formats comparison plurals and preserves a filename in every locale', () => {
  const name = 'render {draft} 海.png';
  for (const language of languages) {
    const label = formatMessage(language, 'comparisonPane.removeFromComparison', { name });
    expect(label).toContain(name);
    const empty = formatMessage(language, 'comparison.imageCount', { count: 0 });
    const single = formatMessage(language, 'comparison.imageCount', { count: 1 });
    const multiple = formatMessage(language, 'comparison.imageCount', { count: 3 });
    expect(new Set([empty, single, multiple]).size).toBe(3);
  }
});

it('changes export labels and a completed result without changing the export request', async () => {
  const name = 'render {draft} 海.png';
  const image = {
    id: `fixture::${name}`, name, directoryId: 'fixture',
  } as IndexedImage;
  const exportBatchToFolder = vi.fn().mockResolvedValue({ success: true, exportedCount: 1, failedCount: 0 });
  vi.stubGlobal('electronAPI', {
    showDirectoryDialog: vi.fn().mockResolvedValue({ canceled: false, path: 'D:/synthetic-output' }),
    exportBatchToFolder,
  });
  useSettingsStore.setState({ language: 'en' });
  render(
    <BatchExportModal
      isOpen
      onClose={vi.fn()}
      selectedImageIds={new Set([image.id])}
      filteredImages={[image]}
      directories={[{ id: 'fixture', path: 'D:/synthetic-input' }]}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Export Images' })).toBeTruthy();

  act(() => useSettingsStore.setState({ language: 'pt-BR' }));
  expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
  expect(await screen.findByText('1 imagem exportada.')).toBeTruthy();
  expect(exportBatchToFolder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    files: [expect.objectContaining({ imageId: image.id, relativePath: name })],
    destDir: 'D:/synthetic-output',
    metadataPolicy: 'preserve',
    scope: 'single',
  }));

  act(() => useSettingsStore.setState({ language: 'es' }));
  expect(screen.getByRole('heading', { name: 'Exportar imágenes' })).toBeTruthy();
  expect(screen.getByText('Se exportó 1 imagen.')).toBeTruthy();
  expect(exportBatchToFolder).toHaveBeenCalledTimes(1);
});
