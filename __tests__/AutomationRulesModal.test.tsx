import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AutomationRulesModal from '../components/AutomationRulesModal';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

describe('AutomationRulesModal', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    useSettingsStore.setState({ tagSuggestionLimit: 5 });
    useImageStore.setState({
      images: [],
      filteredImages: [],
      availableTags: [],
      recentTags: [],
      automationRules: [],
      collections: [],
      selectedModels: ['CyberRealistic'],
      excludedLoras: ['x'],
      selectedTags: ['bird'],
      selectedTagsMatchMode: 'all',
      isAnnotationsLoaded: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('captures current sidebar filters into the draft rule', () => {
    render(<AutomationRulesModal isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /use current filters/i }));

    expect((screen.getByLabelText('Checkpoints') as HTMLInputElement).value).toBe('CyberRealistic');
    expect((screen.getByLabelText('Exclude LoRAs') as HTMLInputElement).value).toBe('x');
    expect((screen.getByLabelText('Manual tags') as HTMLInputElement).value).toBe('bird');
  });

  it('creates a new rule from the editor', async () => {
    render(<AutomationRulesModal isOpen onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('cat, dog, CyberRealistic...'), {
      target: { value: 'cat' },
    });
    fireEvent.change(screen.getByPlaceholderText('animal, realistic...'), {
      target: { value: 'animal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(() => {
      expect(useImageStore.getState().automationRules).toHaveLength(1);
    });

    const [rule] = useImageStore.getState().automationRules;
    expect(rule.criteria.textConditions[0]).toMatchObject({ field: 'prompt', operator: 'contains', value: 'cat' });
    expect(rule.actions.addTags).toEqual(['animal']);
  });
});
