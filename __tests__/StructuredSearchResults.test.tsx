import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StructuredSearchResults from '../components/StructuredSearchResults';
import type { StructuredSearchResult } from '../types';

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
  it('keeps images as a first-class mode and opens session scopes in the standard grid', () => {
    const onOpenSession = vi.fn();
    render(
      <StructuredSearchResults
        result={result}
        mode="sessions"
        sortMode="relevance"
        activeSessionScope={null}
        onModeChange={vi.fn()}
        onSortModeChange={vi.fn()}
        onAddQueryToken={vi.fn()}
        onOpenSession={onOpenSession}
        onClearSessionScope={vi.fn()}
      />,
    );

    expect(screen.getByText('1 matches · 2 images')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /open matches/i }));
    expect(onOpenSession).toHaveBeenCalledWith(result.sessions[0], 'matches');
    fireEvent.click(screen.getByRole('button', { name: /open full session/i }));
    expect(onOpenSession).toHaveBeenCalledWith(result.sessions[0], 'full');
    expect(screen.queryByText(/full session context/i)).toBeNull();
  });

  it('adds structured facet tokens', () => {
    const onAddQueryToken = vi.fn();
    render(
      <StructuredSearchResults
        result={result}
        mode="images"
        sortMode="relevance"
        activeSessionScope={null}
        onModeChange={vi.fn()}
        onSortModeChange={vi.fn()}
        onAddQueryToken={onAddQueryToken}
        onOpenSession={vi.fn()}
        onClearSessionScope={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Flux 1/i }));
    expect(onAddQueryToken).toHaveBeenCalledWith('model:Flux');
  });
});
