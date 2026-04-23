import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('ModelPromptPickerModal', () => {
  it('renders overlap rows and forwards the selected group', () => {
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
    expect(screen.getByText('3 in this checkpoint')).toBeTruthy();
    expect(screen.getByText('2 alternate checkpoints')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /space cathedral with glowing arches/i }));
    expect(onSelect).toHaveBeenCalledWith(group);
  });
});
