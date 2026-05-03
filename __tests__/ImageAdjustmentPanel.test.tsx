import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageAdjustmentPanel from '../components/ImageAdjustmentPanel';
import { DEFAULT_IMAGE_ADJUSTMENTS } from '../services/imageEditingService';

describe('ImageAdjustmentPanel', () => {
  it('emits slider changes', () => {
    const onChange = vi.fn();
    render(
      <ImageAdjustmentPanel
        adjustments={DEFAULT_IMAGE_ADJUSTMENTS}
        onChange={onChange}
        onReset={vi.fn()}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('slider', { name: /brightness/i }), { target: { value: '140' } });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_IMAGE_ADJUSTMENTS,
      brightness: 140,
    });
  });

  it('resets adjustments', () => {
    const onReset = vi.fn();
    render(
      <ImageAdjustmentPanel
        adjustments={{ ...DEFAULT_IMAGE_ADJUSTMENTS, contrast: 80 }}
        onChange={vi.fn()}
        onReset={onReset}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onReset).toHaveBeenCalled();
  });

  it('wires save actions and disables them without changes', () => {
    const onSaveAs = vi.fn();
    const onOverwrite = vi.fn();
    const { rerender } = render(
      <ImageAdjustmentPanel
        adjustments={DEFAULT_IMAGE_ADJUSTMENTS}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onSaveAs={onSaveAs}
        onOverwrite={onOverwrite}
      />
    );

    expect(screen.getByRole('button', { name: /save as/i })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /overwrite/i })).toHaveProperty('disabled', true);

    rerender(
      <ImageAdjustmentPanel
        adjustments={{ ...DEFAULT_IMAGE_ADJUSTMENTS, saturation: 120 }}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onSaveAs={onSaveAs}
        onOverwrite={onOverwrite}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save as/i }));
    fireEvent.click(screen.getByRole('button', { name: /overwrite/i }));

    expect(onSaveAs).toHaveBeenCalled();
    expect(onOverwrite).toHaveBeenCalled();
  });

  it('disables controls while saving', () => {
    render(
      <ImageAdjustmentPanel
        adjustments={{ ...DEFAULT_IMAGE_ADJUSTMENTS, hue: 20 }}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
        isSaving
      />
    );

    expect(screen.getByRole('spinbutton', { name: /hue/i })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /overwrite/i })).toHaveProperty('disabled', true);
  });
});
