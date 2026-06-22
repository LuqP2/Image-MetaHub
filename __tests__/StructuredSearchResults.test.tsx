import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StructuredSearchResults from '../components/StructuredSearchResults';
import type { IndexedImage, StructuredSearchResult } from '../types';

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: () => null,
}));

const image = (id: string): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: {} as FileSystemFileHandle,
  metadata: {},
  metadataString: '',
  lastModified: 1000,
  models: [],
  loras: [],
  scheduler: '',
});

const result: StructuredSearchResult = {
  sessions: [{
    id: 'session-1',
    title: 'Chocolate cake tests',
    startTime: 1000,
    endTime: 2000,
    imageIds: ['match', 'context'],
    matchedImageIds: ['match'],
    representativeImageId: 'match',
    dominantModel: 'Flux',
    score: 42,
    imageResults: [{
      imageId: 'match',
      score: 30,
      reasons: [{
        field: 'prompt',
        label: 'Prompt',
        value: 'chocolate cake',
        matchType: 'exact',
        score: 7,
      }],
    }],
  }],
  facets: {
    models: [{ value: 'Flux', count: 1 }],
    loras: [],
    collections: [],
    dates: [],
    sessions: [{ value: 'session-1', count: 1 }],
  },
  warnings: [],
  matchedImageCount: 1,
  totalSessionImageCount: 2,
};

describe('StructuredSearchResults', () => {
  it('shows session counts and expands the full batch with match highlighting', () => {
    render(
      <StructuredSearchResults
        result={result}
        imagesById={new Map([['match', image('match')], ['context', image('context')]])}
        selectedImages={new Set()}
        sortMode="relevance"
        onSortModeChange={vi.fn()}
        onImageClick={vi.fn()}
        onAddQueryToken={vi.fn()}
      />,
    );

    expect(screen.getByText('1 matches of 2 images')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /view batch/i }));
    expect(screen.getByText('Full session context; matched images are highlighted')).toBeTruthy();
    expect(screen.getAllByText('Match')).toHaveLength(2);
  });

  it('adds structured facet tokens', () => {
    const onAddQueryToken = vi.fn();
    render(
      <StructuredSearchResults
        result={result}
        imagesById={new Map([['match', image('match')], ['context', image('context')]])}
        selectedImages={new Set()}
        sortMode="relevance"
        onSortModeChange={vi.fn()}
        onImageClick={vi.fn()}
        onAddQueryToken={onAddQueryToken}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Flux 1/i }));
    expect(onAddQueryToken).toHaveBeenCalledWith('model:Flux');
  });
});
