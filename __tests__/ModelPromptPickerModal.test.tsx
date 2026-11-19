import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ModelPromptPickerModal from '../components/ModelPromptPickerModal';
import type { IndexedImage } from '../types';
import type { ModelPromptOverlapGroup } from '../services/similarImageSearch';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'dir-1::image.png',
  name: overrides.name ?? 'image.png',
  handle: overrides.handle ?? ({} as FileSystemFileHandle),
  metadata: overrides.metadata ?? ({} as any),
  metadataString: overrides.metadataString ?? '',
  lastModified: overrides.lastModified ?? 1,
  directoryId: overrides.directoryId ?? 'dir-1',
  models: overrides.models ?? [],
  loras: overrides.loras ?? [],
  scheduler: overrides.scheduler ?? '',
  workflowNodes: overrides.workflowNodes ?? [],
  prompt: overrides.prompt ?? '',
  negativePrompt: overrides.negativePrompt ?? '',
  ...overrides,
});

afterEach(() => { cleanup(); useSettingsStore.setState({ language: 'en' }); });

describe('ModelPromptPickerModal', () => {
  it.each(languages)('renders overlap rows and forwards the original group in %s', language => {
    useSettingsStore.setState({ language });
    const t = (key, values?) => formatMessage(language, key, values);
    const onSelect = vi.fn();
    const group: ModelPromptOverlapGroup = {
      normalizedPrompt: 'space cathedral',
      promptPreview: 'Space cathedral with glowing arches',
      sourceCount: 3,
      alternateCheckpointCount: 2,
      sourceImage: createImage({
        id: 'source',
        name: 'source.png',
        prompt: 'Space cathedral with glowing arches',
        models: ['model-a'],
      }),
    };

    render(
      <ModelPromptPickerModal
        isOpen
        modelName="model-a"
        groups={[group]}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Space cathedral with glowing arches')).toBeTruthy();
    expect(screen.getByText(t('modelLibrary.inCheckpoint', { count: 3 }))).toBeTruthy();
    expect(screen.getByText(t('modelLibrary.alternateCheckpoints', { count: 2 }))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /space cathedral with glowing arches/i }));
    expect(onSelect).toHaveBeenCalledWith(group);
  });
});
