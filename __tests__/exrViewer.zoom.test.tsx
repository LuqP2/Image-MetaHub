import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import type { IndexedImage } from '../types';
import ExrViewer from '../components/ExrViewer';

const zoom = vi.hoisted(() => ({ setTransform: vi.fn(), centerOnInit: true }));
vi.mock('../components/SettingsModal', () => ({ default: () => null }));
vi.mock('react-zoom-pan-pinch', async () => {
  const React = await import('react');
  return {
    TransformComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TransformWrapper: React.forwardRef(function Wrapper({ onInit, centerOnInit, children }: {
      onInit: (instance: ReactZoomPanPinchRef) => void;
      centerOnInit: boolean;
      children: (controls: { zoomIn: () => void; zoomOut: () => void; resetTransform: () => void }) => React.ReactNode;
    }, ref) {
      const instance = React.useMemo(() => ({ state: { scale: 1, positionX: 0, positionY: 0 }, setTransform: zoom.setTransform }) as unknown as ReactZoomPanPinchRef, []);
      React.useImperativeHandle(ref, () => instance);
      React.useEffect(() => { zoom.centerOnInit = centerOnInit; onInit(instance); }, []);
      return <div>{children({ zoomIn() {}, zoomOut() {}, resetTransform() {} })}</div>;
    }),
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('EXR comparison zoom', () => {
  it('applies an existing synchronized transform when the asynchronous overview mounts', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    let complete!: (value: unknown) => void;
    const preview = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { exr: {
      status: vi.fn(async () => ({ success: true, value: { installed: true, enabled: true } })),
      inspect: vi.fn(async () => ({ success: true, value: { parts: [{ index: 0, width: 100, height: 100, pixelAspectRatio: 1, deep: false, channels: ['R', 'G', 'B'].map(name => ({ name, type: 'float' })) }] } })),
      config: vi.fn(async () => ({ success: true, value: { spaces: [], displays: [] } })),
      preview, cancel: vi.fn(), onChanged: vi.fn(() => () => {}),
    } } });
    const image = { id: 'renders::synthetic.exr', name: 'synthetic.exr', handle: { _filePath: 'D:\\renders\\synthetic.exr' } } as unknown as IndexedImage;
    render(<ExrViewer image={image} externalZoom={{ zoom: 3, x: -100, y: -80 }} />);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(zoom.setTransform).not.toHaveBeenCalled();
    await act(async () => complete({ success: true, value: { url: 'imh-exr://local/synthetic', width: 100, height: 100, mode: 'color' } }));
    await waitFor(() => expect(zoom.setTransform).toHaveBeenCalledWith(-100, -80, 3, 0));
    expect(zoom.centerOnInit).toBe(false);
  });
});
