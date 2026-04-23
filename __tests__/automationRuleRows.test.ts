import { describe, expect, it } from 'vitest';
import type { AutomationRule } from '../types';
import {
  conditionRowsToCriteria,
  filterCriteriaToConditionRows,
  ruleToConditionRows,
} from '../utils/automationRuleRows';

const createRule = (overrides: Partial<AutomationRule>): AutomationRule => ({
  id: overrides.id ?? 'rule-1',
  name: overrides.name ?? 'Rule',
  enabled: overrides.enabled ?? true,
  criteria: overrides.criteria ?? {
    matchMode: 'all',
    textConditions: [],
    filters: { tagMatchMode: 'any', favoriteFilterMode: 'neutral', advancedFilters: {} },
  },
  actions: overrides.actions ?? { addTags: [], addToCollectionIds: [] },
  runOnNewImages: overrides.runOnNewImages ?? true,
  createdAt: 1,
  updatedAt: 1,
  lastAppliedAt: null,
  lastMatchCount: 0,
  lastChangeCount: 0,
});

describe('automation rule condition rows', () => {
  it('converts older rule criteria into editable rows', () => {
    const rows = ruleToConditionRows(createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [{ id: 'text-1', field: 'prompt', operator: 'contains', value: 'dog' }],
        filters: {
          models: ['CyberRealistic'],
          excludedLoras: ['x'],
          tags: ['bird'],
          tagMatchMode: 'all',
          favoriteFilterMode: 'include',
          ratings: [5],
          advancedFilters: { steps: { min: 10, max: 20 } },
        },
      },
    }));

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'prompt', operator: 'contains', value: 'dog' }),
      expect.objectContaining({ field: 'model', operator: 'includes', value: 'CyberRealistic' }),
      expect.objectContaining({ field: 'lora', operator: 'not_includes', value: 'x' }),
      expect.objectContaining({ field: 'tag', operator: 'includes', value: 'bird', groupMode: 'all' }),
      expect.objectContaining({ field: 'favorite', operator: 'is' }),
      expect.objectContaining({ field: 'rating', operator: 'equals', value: '5' }),
      expect.objectContaining({ field: 'steps', operator: 'between', value: '10', valueEnd: '20' }),
    ]));
  });

  it('converts rows back to compatible criteria without losing includes and excludes', () => {
    const criteria = conditionRowsToCriteria([
      { id: 'search', field: 'search', operator: 'contains', value: 'garden' },
      { id: 'prompt', field: 'prompt', operator: 'contains', value: 'cat' },
      { id: 'model', field: 'model', operator: 'includes', value: 'CyberRealistic' },
      { id: 'lora', field: 'lora', operator: 'not_includes', value: 'x' },
      { id: 'tag-all-1', field: 'tag', operator: 'includes', value: 'animal', groupMode: 'all' },
      { id: 'tag-all-2', field: 'tag', operator: 'includes', value: 'portrait', groupMode: 'all' },
      { id: 'tag', field: 'tag', operator: 'not_includes', value: 'Hidden' },
      { id: 'steps', field: 'steps', operator: 'between', value: '10', valueEnd: '20' },
    ], 'all');

    expect(criteria.textConditions).toEqual([
      { id: 'prompt', field: 'prompt', operator: 'contains', value: 'cat' },
    ]);
    expect(criteria.conditionRows).toHaveLength(8);
    expect(criteria.filters.searchQuery).toBe('garden');
    expect(criteria.filters.models).toEqual(['CyberRealistic']);
    expect(criteria.filters.excludedLoras).toEqual(['x']);
    expect(criteria.filters.tags).toEqual(['animal', 'portrait']);
    expect(criteria.filters.tagMatchMode).toBe('all');
    expect(criteria.filters.excludedTags).toEqual(['hidden']);
    expect(criteria.filters.advancedFilters?.steps).toEqual({ min: 10, max: 20 });
  });

  it('imports active sidebar filters as condition rows', () => {
    const rows = filterCriteriaToConditionRows({
      searchQuery: 'cat',
      models: ['CyberRealistic'],
      excludedLoras: ['x'],
      autoTags: ['portrait'],
      tagMatchMode: 'any',
      favoriteFilterMode: 'exclude',
      advancedFilters: {
        date: { from: '2026-04-01', to: '2026-04-10' },
        generationModes: ['img2img'],
        mediaTypes: ['audio'],
        telemetryState: 'present',
        hasVerifiedTelemetry: true,
        generationTimeMs: { min: 1000, max: 5000 },
        stepsPerSecond: { min: 2, max: 6 },
        vramPeakMb: { min: 2048, max: 6144 },
      },
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'search', operator: 'contains', value: 'cat' }),
      expect.objectContaining({ field: 'model', operator: 'includes', value: 'CyberRealistic' }),
      expect.objectContaining({ field: 'lora', operator: 'not_includes', value: 'x' }),
      expect.objectContaining({ field: 'autoTag', operator: 'includes', value: 'portrait' }),
      expect.objectContaining({ field: 'favorite', operator: 'is_not' }),
      expect.objectContaining({ field: 'date', operator: 'between', value: '2026-04-01', valueEnd: '2026-04-10' }),
      expect.objectContaining({ field: 'generationMode', operator: 'includes', value: 'img2img' }),
      expect.objectContaining({ field: 'mediaType', operator: 'includes', value: 'audio' }),
      expect.objectContaining({ field: 'telemetry', operator: 'is' }),
      expect.objectContaining({ field: 'verifiedTelemetry', operator: 'is' }),
      expect.objectContaining({ field: 'generationTimeMs', operator: 'between', value: '1000', valueEnd: '5000' }),
      expect.objectContaining({ field: 'stepsPerSecond', operator: 'between', value: '2', valueEnd: '6' }),
      expect.objectContaining({ field: 'vramPeakMb', operator: 'between', value: '2048', valueEnd: '6144' }),
    ]));
  });

  it('round-trips advanced filter rows for date, mode, media, telemetry, and performance ranges', () => {
    const criteria = conditionRowsToCriteria([
      { id: 'date', field: 'date', operator: 'between', value: '2026-04-01', valueEnd: '2026-04-10' },
      { id: 'mode', field: 'generationMode', operator: 'includes', value: 'img2img' },
      { id: 'media', field: 'mediaType', operator: 'includes', value: 'audio' },
      { id: 'telemetry', field: 'telemetry', operator: 'is', value: 'true' },
      { id: 'verified', field: 'verifiedTelemetry', operator: 'is', value: 'true' },
      { id: 'time', field: 'generationTimeMs', operator: 'between', value: '1000', valueEnd: '5000' },
      { id: 'speed', field: 'stepsPerSecond', operator: 'at_least', value: '2' },
      { id: 'vram', field: 'vramPeakMb', operator: 'at_most', value: '6144' },
    ], 'all');

    expect(criteria.filters.advancedFilters).toEqual(expect.objectContaining({
      date: { from: '2026-04-01', to: '2026-04-10' },
      generationModes: ['img2img'],
      mediaTypes: ['audio'],
      telemetryState: 'present',
      hasVerifiedTelemetry: true,
      generationTimeMs: { min: 1000, max: 5000 },
      stepsPerSecond: { min: 2, max: null },
      vramPeakMb: { min: null, max: 6144 },
    }));
  });
});
