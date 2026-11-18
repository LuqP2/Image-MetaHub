import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BatchExportModal from '../components/BatchExportModal';
import { MetadataEditorModal } from '../components/MetadataEditorModal';
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

it('localizes metadata editor controls and JSON status without translating user values', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onApplyToSelected = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const onCopyEditableMetadata = vi.fn().mockResolvedValue(undefined);
  const prompt = 'Prompt {draft} 海';
  const model = 'FixtureModel_v9.safetensors';
  const tag = 'tag {fixture}';
  useSettingsStore.setState({ language: 'en' });
  render(
    <MetadataEditorModal
      isOpen
      onClose={onClose}
      imageId="fixture"
      initialMetadata={null}
      onSave={onSave}
      onApplyToSelected={onApplyToSelected}
      onCopyEditableMetadata={onCopyEditableMetadata}
      selectedImageCount={2}
    />,
  );
  expect(screen.getByRole('button', { name: 'Close metadata editor' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Editable JSON' }), { target: { value: '[]' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply JSON To Form' }));
  expect(screen.getByRole('status').textContent).toContain('Expected a JSON object.');

  act(() => useSettingsStore.setState({ language: 'es' }));
  expect(screen.getByRole('status').textContent).toContain('Se esperaba un objeto JSON.');
  fireEvent.change(screen.getByRole('textbox', { name: 'JSON editable' }), {
    target: { value: JSON.stringify({ prompt, model, tags: [tag] }) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar JSON al formulario' }));
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveProperty('value', prompt);
  expect(screen.getByRole('textbox', { name: 'Modelo principal' })).toHaveProperty('value', model);

  act(() => useSettingsStore.setState({ language: 'pt-BR' }));
  expect(screen.getByRole('status').textContent).toContain('foi aplicado ao formulário');
  expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveProperty('value', tag);
  fireEvent.click(screen.getByRole('button', { name: 'Copiar JSON' }));
  expect(await screen.findByText(/Metadados editáveis copiados/)).toBeTruthy();
  expect(onCopyEditableMetadata).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ prompt, model, tags: [tag] }),
    expect.stringContaining('"schema": "imagemetahub/editable-metadata"'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar à seleção (2)' }));
  expect(await screen.findByText('Metadados editáveis aplicados a 2 imagens selecionadas.')).toBeTruthy();
  expect(onApplyToSelected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt, model, tags: [tag] }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ imageId: 'fixture', prompt, model, tags: [tag] }));
  await act(async () => {});
  expect(onClose).toHaveBeenCalledTimes(1);
});
