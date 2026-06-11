import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageAdjustmentPanel from '../components/ImageAdjustmentPanel';
import { DEFAULT_IMAGE_EDIT_RECIPE } from '../services/imageEditingService';

describe('ImageAdjustmentPanel', () => {
  it('emits slider changes', () => {
    const onChange = vi.fn();
    render(
      <ImageAdjustmentPanel
        recipe={DEFAULT_IMAGE_EDIT_RECIPE}
        onChange={onChange}
        onReset={vi.fn()}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('slider', { name: /brightness/i }), { target: { value: '140' } });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_IMAGE_EDIT_RECIPE,
      adjustments: {
        ...DEFAULT_IMAGE_EDIT_RECIPE.adjustments,
        brightness: 140,
      },
    });
  });

  it('resets adjustments', () => {
    const onReset = vi.fn();
    render(
      <ImageAdjustmentPanel
        recipe={{
          ...DEFAULT_IMAGE_EDIT_RECIPE,
          adjustments: { ...DEFAULT_IMAGE_EDIT_RECIPE.adjustments, contrast: 80 },
        }}
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
        recipe={DEFAULT_IMAGE_EDIT_RECIPE}
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
        recipe={{
          ...DEFAULT_IMAGE_EDIT_RECIPE,
          adjustments: { ...DEFAULT_IMAGE_EDIT_RECIPE.adjustments, saturation: 120 },
        }}
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
        recipe={{
          ...DEFAULT_IMAGE_EDIT_RECIPE,
          adjustments: { ...DEFAULT_IMAGE_EDIT_RECIPE.adjustments, hue: 20 },
        }}
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

  it('can disable overwrite independently from save as', () => {
    const onSaveAs = vi.fn();
    const onOverwrite = vi.fn();
    render(
      <ImageAdjustmentPanel
        recipe={{
          ...DEFAULT_IMAGE_EDIT_RECIPE,
          adjustments: { ...DEFAULT_IMAGE_EDIT_RECIPE.adjustments, brightness: 120 },
        }}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onSaveAs={onSaveAs}
        onOverwrite={onOverwrite}
        canOverwrite={false}
        overwriteUnavailableReason="Overwrite is only available for PNG images."
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save as/i }));
    fireEvent.click(screen.getByRole('button', { name: /overwrite/i }));

    expect(screen.getByRole('button', { name: /save as/i })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: /overwrite/i })).toHaveProperty('disabled', true);
    expect(onSaveAs).toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('emits transform and resize changes', () => {
    const onChange = vi.fn();
    render(
      <ImageAdjustmentPanel
        recipe={DEFAULT_IMAGE_EDIT_RECIPE}
        onChange={onChange}
        onReset={vi.fn()}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
        sourceDimensions={{ width: 100, height: 50 }}
        activeTab="transform"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rotate right/i }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      transform: expect.objectContaining({ rotation: 90 }),
    }));

    fireEvent.change(screen.getByRole('spinbutton', { name: /resize width/i }), { target: { value: '200' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      resize: expect.objectContaining({ enabled: true, width: 200, height: 100 }),
    }));
  });

  it('seeds resize controls from base dimensions when resize is enabled', () => {
    const onChange = vi.fn();
    render(
      <ImageAdjustmentPanel
        recipe={DEFAULT_IMAGE_EDIT_RECIPE}
        onChange={onChange}
        onReset={vi.fn()}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
        sourceDimensions={{ width: 100, height: 50 }}
        activeTab="transform"
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /^resize$/i }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      resize: expect.objectContaining({ width: 100, height: 50 }),
    }));
  });

  it('emits crop and AI upscale actions', () => {
    const onChange = vi.fn();
    const onAIUpscale = vi.fn();
    const { rerender } = render(
      <ImageAdjustmentPanel
        recipe={DEFAULT_IMAGE_EDIT_RECIPE}
        onChange={onChange}
        onReset={vi.fn()}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
        onAIUpscale={onAIUpscale}
        sourceDimensions={{ width: 100, height: 50 }}
        activeTab="crop"
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /enable crop/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      crop: expect.objectContaining({ enabled: true }),
    }));

    rerender(
      <ImageAdjustmentPanel
        recipe={DEFAULT_IMAGE_EDIT_RECIPE}
        onChange={onChange}
        onReset={vi.fn()}
        onSaveAs={vi.fn()}
        onOverwrite={vi.fn()}
        onAIUpscale={onAIUpscale}
        sourceDimensions={{ width: 100, height: 50 }}
        activeTab="enhance"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /ai upscale/i }));
    expect(onAIUpscale).toHaveBeenCalled();
  });
});
