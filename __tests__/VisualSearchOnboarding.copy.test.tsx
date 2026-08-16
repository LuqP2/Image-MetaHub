import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import VisualSearchOnboarding from '../components/VisualSearchOnboarding';
import { useSemanticStore } from '../store/useSemanticStore';
import { useSettingsStore } from '../store/useSettingsStore';

describe('VisualSearchOnboarding copy', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      semanticSearchEnabled: false,
      hasSeenVisualSearchOnboarding: false,
    });
    useSemanticStore.setState({ modelInstalled: false });
  });

  it('describes Find Similar without setup narration', () => {
    render(<VisualSearchOnboarding hasImages={true} />);

    expect(screen.getByText('Select any image to find visually related files, even without prompts or metadata.')).toBeTruthy();
    expect(screen.queryByText(/explicit model download/i)).toBeNull();
  });
});
