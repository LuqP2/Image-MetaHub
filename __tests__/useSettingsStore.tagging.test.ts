import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  DEFAULT_RECENT_TAG_CHIP_LIMIT,
  DEFAULT_TAG_SUGGESTION_LIMIT,
  MAX_TAG_UI_LIMIT,
  MIN_TAG_UI_LIMIT,
} from '../utils/tagSuggestions';

describe('useSettingsStore tagging preferences', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
  });

  it('starts with the expected tagging defaults', () => {
    const state = useSettingsStore.getState();

    expect(state.tagSuggestionLimit).toBe(DEFAULT_TAG_SUGGESTION_LIMIT);
    expect(state.recentTagChipLimit).toBe(DEFAULT_RECENT_TAG_CHIP_LIMIT);
  });

  it('clamps tagging preference setters to the supported range', () => {
    useSettingsStore.getState().setTagSuggestionLimit(MAX_TAG_UI_LIMIT + 100);
    useSettingsStore.getState().setRecentTagChipLimit(MIN_TAG_UI_LIMIT - 10);

    expect(useSettingsStore.getState().tagSuggestionLimit).toBe(MAX_TAG_UI_LIMIT);
    expect(useSettingsStore.getState().recentTagChipLimit).toBe(MIN_TAG_UI_LIMIT);
  });
});
