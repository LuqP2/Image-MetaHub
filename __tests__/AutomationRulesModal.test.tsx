import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      availableModels: ['CyberRealistic'],
      availableLoras: ['x'],
      availableSamplers: ['Euler a'],
      availableSchedulers: ['karras'],
      availableGenerators: ['Automatic1111'],
      availableGpuDevices: ['NVIDIA RTX'],
      availableDimensions: ['512x768'],
      availableTags: [{ name: 'animal', count: 1 }, { name: 'bird', count: 1 }],
      availableAutoTags: [{ name: 'portrait', count: 1 }],
      recentTags: ['animal'],
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
    vi.restoreAllMocks();
    cleanup();
  });

  it('opens a clean guided editor for a new rule', () => {
    render(<AutomationRulesModal isOpen onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: /new rule/i })).toBeTruthy();
    expect(screen.getByText(/no conditions yet/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /add your first condition/i }));

    expect((screen.getByLabelText('Condition field') as HTMLSelectElement).value).toBe('prompt');
    expect((screen.getByLabelText('Condition operator') as HTMLSelectElement).value).toBe('contains');
    expect(screen.getByLabelText('Prompt value')).toBeTruthy();
  });

  it('captures current sidebar filters into editable condition rows', () => {
    render(<AutomationRulesModal isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /import current sidebar filters/i }));

    const fields = screen.getAllByLabelText('Condition field') as HTMLSelectElement[];
    const operators = screen.getAllByLabelText('Condition operator') as HTMLSelectElement[];

    expect(fields.map((field) => field.value)).toEqual(['model', 'lora', 'tag']);
    expect(operators.map((operator) => operator.value)).toEqual(['includes', 'not_includes', 'includes']);
    expect((screen.getByLabelText('Checkpoint value') as HTMLSelectElement).value).toBe('CyberRealistic');
    expect((screen.getByLabelText('LoRA value') as HTMLSelectElement).value).toBe('x');
    expect((screen.getByLabelText('Manual Tag value') as HTMLSelectElement).value).toBe('bird');
  });

  it('creates a new rule from condition rows and guided actions', async () => {
    render(<AutomationRulesModal isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /add your first condition/i }));
    fireEvent.change(screen.getByLabelText('Prompt value'), { target: { value: 'cat' } });
    fireEvent.change(screen.getByPlaceholderText('Add tag...'), { target: { value: 'animal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(() => {
      expect(useImageStore.getState().automationRules).toHaveLength(1);
    });

    const [rule] = useImageStore.getState().automationRules;
    expect(rule.criteria.conditionRows?.[0]).toMatchObject({ field: 'prompt', operator: 'contains', value: 'cat' });
    expect(rule.criteria.textConditions[0]).toMatchObject({ field: 'prompt', operator: 'contains', value: 'cat' });
    expect(rule.actions.addTags).toEqual(['animal']);
  });

  it('clears the editor after deleting the selected rule', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useImageStore.setState({
      automationRules: [
        {
          id: 'rule-1',
          name: 'Delete me',
          enabled: true,
          criteria: {
            matchMode: 'all',
            textConditions: [],
            conditionRows: [{ id: 'row-1', field: 'prompt', operator: 'contains', value: 'cat' }],
            filters: { tagMatchMode: 'any', favoriteFilterMode: 'neutral', advancedFilters: {} },
          },
          actions: { addTags: ['animal'], addToCollectionIds: [] },
          runOnNewImages: true,
          createdAt: 1,
          updatedAt: 1,
          lastAppliedAt: null,
          lastMatchCount: 0,
          lastChangeCount: 0,
        },
      ],
    });

    render(<AutomationRulesModal isOpen onClose={() => {}} />);

    fireEvent.click(screen.getAllByRole('button', { name: /delete/i }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(useImageStore.getState().automationRules).toEqual([]);
    });
    expect(screen.getByRole('heading', { name: /new rule/i })).toBeTruthy();
    expect(screen.getByText(/no conditions yet/i)).toBeTruthy();
  });
});
