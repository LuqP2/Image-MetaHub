import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useImageStacking } from '../hooks/useImageStacking';
import type { IndexedImage } from '../types';

const makeImage = (id: string, prompt: string = '', negativePrompt: string = ''): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: { name: `${id}.png` } as FileSystemFileHandle,
  metadata: {
    normalizedMetadata: {
      prompt,
      negativePrompt
    }
  },
  metadataString: '',
  lastModified: Date.now(),
  models: [],
  loras: [],
  scheduler: '',
});

describe('useImageStacking', () => {
  it('does not stack if isEnabled is false', () => {
    const images = [
      makeImage('1', 'same prompt'),
      makeImage('2', 'same prompt'),
    ];
    const { result } = renderHook(() => useImageStacking(images, false));
    expect(result.current.stackedItems).toHaveLength(2);
    expect(result.current.stackedItems[0]).toEqual(images[0]);
    expect(result.current.stackedItems[1]).toEqual(images[1]);
  });

  it('stacks images with identical prompts', () => {
    const images = [
      makeImage('1', 'same prompt'),
      makeImage('2', 'same prompt'),
      makeImage('3', 'different prompt'),
    ];
    const { result } = renderHook(() => useImageStacking(images, true));
    expect(result.current.stackedItems).toHaveLength(2);

    const stack = result.current.stackedItems[0] as any;
    expect(stack.id).toBe('stack-1');
    expect(stack.count).toBe(2);
    expect(stack.images).toHaveLength(2);
    expect(stack.images[0].id).toBe('1');
    expect(stack.images[1].id).toBe('2');

    expect((result.current.stackedItems[1] as IndexedImage).id).toBe('3');
  });

  it('does not stack images with empty prompts', () => {
    const images = [
      makeImage('1', ''),
      makeImage('2', ''),
    ];
    const { result } = renderHook(() => useImageStacking(images, true));
    expect(result.current.stackedItems).toHaveLength(2);
  });

  it('handles multiple stacks in sequence', () => {
    const images = [
      makeImage('1', 'prompt A'),
      makeImage('2', 'prompt A'),
      makeImage('3', 'prompt B'),
      makeImage('4', 'prompt B'),
      makeImage('5', 'prompt C'),
    ];
    const { result } = renderHook(() => useImageStacking(images, true));
    expect(result.current.stackedItems).toHaveLength(3);

    expect((result.current.stackedItems[0] as any).count).toBe(2);
    expect((result.current.stackedItems[1] as any).count).toBe(2);
    expect((result.current.stackedItems[2] as IndexedImage).id).toBe('5');
  });

  it('considers both positive and negative prompts for stacking', () => {
    const images = [
      makeImage('1', 'prompt A', 'neg 1'),
      makeImage('2', 'prompt A', 'neg 2'),
    ];
    const { result } = renderHook(() => useImageStacking(images, true));
    expect(result.current.stackedItems).toHaveLength(2);
  });
});
