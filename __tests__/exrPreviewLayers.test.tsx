import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ExrPreviewLayers } from '../components/ExrPreviewLayers';

afterEach(cleanup);
describe('EXR overview/detail compositing', () => {
  it('replaces the overview region only after detail pixels load', () => {
    const props = { overviewUrl: 'overview', detailUrl: 'detail', region: { x: 10, y: 20, width: 30, height: 40 }, width: 100, height: 100, name: 'synthetic.exr' };
    const { container, rerender } = render(<ExrPreviewLayers {...props} />);
    const clip = () => container.querySelector('clipPath path')!;
    const images = () => container.querySelectorAll('image');
    expect(clip().getAttribute('d')).toBe('M0 0H100V100H0Z ');
    expect(images()[1].getAttribute('visibility')).toBe('hidden');
    fireEvent.load(images()[1]);
    expect(clip().getAttribute('clip-rule')).toBe('evenodd');
    expect(clip().getAttribute('d')).toBe('M0 0H100V100H0Z M10 20h30v40h-30Z');
    expect(images()[1].getAttribute('visibility')).toBe('visible');
    rerender(<ExrPreviewLayers {...props} detailUrl="next-detail" />);
    expect(clip().getAttribute('d')).toBe('M0 0H100V100H0Z ');
    expect(images()[1].getAttribute('visibility')).toBe('hidden');
    rerender(<ExrPreviewLayers {...props} detailUrl={undefined} region={null} />);
    expect(images()).toHaveLength(1);
    expect(clip().getAttribute('d')).toBe('M0 0H100V100H0Z ');
    rerender(<ExrPreviewLayers {...props} />);
    expect(clip().getAttribute('d')).toBe('M0 0H100V100H0Z ');
    expect(images()[1].getAttribute('visibility')).toBe('hidden');
    fireEvent.load(images()[1]);
    expect(clip().getAttribute('d')).toBe('M0 0H100V100H0Z M10 20h30v40h-30Z');
  });
  it('uses independent clip definitions for simultaneous viewers', () => {
    const props = { overviewUrl: 'overview', width: 100, height: 100, name: 'synthetic.exr' };
    const { container } = render(<><ExrPreviewLayers {...props} /><ExrPreviewLayers {...props} /></>);
    const clips = container.querySelectorAll('clipPath');
    expect(clips[0].id).not.toBe(clips[1].id);
  });
});
