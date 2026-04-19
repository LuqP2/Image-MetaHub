import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Tooltip from '../components/Tooltip';

describe('Tooltip', () => {
  it('renders a reusable tooltip for hover and focus states', () => {
    render(
      <Tooltip label="Compare Images">
        <button type="button">Compare</button>
      </Tooltip>,
    );

    expect(screen.getByRole('tooltip').textContent).toBe('Compare Images');
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy();
  });
});
