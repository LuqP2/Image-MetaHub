import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RatingStars from '../components/RatingStars';

describe('RatingStars', () => {
  it('calls onChange with the selected rating', () => {
    const onChange = vi.fn();

    render(<RatingStars rating={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Set 4-star rating'));

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('clears the rating when the active star is clicked again', () => {
    const onChange = vi.fn();

    render(<RatingStars rating={3} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Clear 3-star rating'));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
