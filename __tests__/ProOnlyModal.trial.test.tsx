import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProOnlyModal from '../components/ProOnlyModal';

afterEach(() => cleanup());

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  feature: 'image_editor' as const,
  isTrialActive: false,
  daysRemaining: 0,
  isExpired: false,
  isPro: false,
};

describe('ProOnlyModal trial availability', () => {
  it('offers only license activation when the runtime has no trial', () => {
    render(<ProOnlyModal
      {...baseProps}
      canStartTrial={false}
      onStartTrial={vi.fn(async () => false)}
    />);

    expect(screen.queryByRole('button', { name: /start 7-day trial/i })).toBeNull();
    expect(screen.getByRole('link', { name: /get lifetime license/i })).toBeTruthy();
  });

  it('waits for the trial action instead of closing the modal optimistically', () => {
    const onClose = vi.fn();
    const onStartTrial = vi.fn(async () => true);
    render(<ProOnlyModal
      {...baseProps}
      onClose={onClose}
      canStartTrial
      onStartTrial={onStartTrial}
    />);

    fireEvent.click(screen.getByRole('button', { name: /start 7-day trial/i }));

    expect(onStartTrial).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
