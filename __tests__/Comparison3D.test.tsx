import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ComparisonSurface } from '../components/ComparisonSurface';
import { useImageStore } from '../store/useImageStore';
import { defaultComparisonUI, useComparisonUIStore } from '../store/useComparisonUIStore';
vi.mock('../components/ComparisonMetadataPanel', () => ({ default: () => null }));
vi.mock('../components/ComparisonOverlayView', () => ({ default: () => null }));
const cameraCallbacks = new Map<string, (camera: ReturnType<typeof pose>, interacted: boolean) => void>();
const pose = (n: number) => ({ projection: 'perspective' as const, position: [n,2,1] as [number,number,number], target: [0,0,0] as [number,number,number], up: [0,1,0] as [number,number,number], zoom: 1, fov: 35 });
afterEach(() => { cleanup(); cameraCallbacks.clear(); });
vi.mock('../components/ComparisonPane', () => ({ default: ({ image, externalCamera, onCameraChange }: any) => { cameraCallbacks.set(image.id, onCameraChange); return <button data-testid={image.id} data-camera={JSON.stringify(externalCamera)} onClick={() => onCameraChange({ projection: 'perspective', position: [3,2,1], target: [0,0,0], up: [0,1,0], zoom: 1, fov: 35 }, true)}>{image.name}</button>; } }));
beforeEach(() => { useComparisonUIStore.setState({ ui: defaultComparisonUI() }); useImageStore.setState({ comparisonImages: [{ id:'a', name:'a.glb', metadata: { normalizedMetadata: {} } }, { id:'b', name:'b.obj', metadata: { normalizedMetadata: {} } }] as any, directories: [] }); });
describe('3D comparison', () => {
  it('disables pixel modes, syncs camera changes and preserves the displayed camera when disabling sync', () => {
    render(<ComparisonSurface isOpen onClose={vi.fn()} />);
    const toggle = screen.getByLabelText('Sync 3D cameras') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect((screen.getByRole('button',{ name:'Diff Map' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('b'));
    expect(screen.getByTestId('a').getAttribute('data-camera')).toBe(screen.getByTestId('b').getAttribute('data-camera'));
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(useComparisonUIStore.getState().ui.cameras3D.a).toEqual(useComparisonUIStore.getState().ui.cameras3D.b);
  });
  it.each([3, 4])('preserves the latest group pose after removing its leader from %s models', count => {
    act(() => useImageStore.setState({ comparisonImages: ['a','b','c','d'].slice(0,count).map(id => ({ id, name: `${id}.glb`, metadata: { normalizedMetadata: {} } })) as any }));
    render(<ComparisonSurface isOpen onClose={vi.fn()} />);
    act(() => cameraCallbacks.get('b')!(pose(5), true));
    act(() => cameraCallbacks.get('a')!(pose(9), true));
    const removedCallback = cameraCallbacks.get('a')!;
    act(() => useImageStore.getState().removeImageFromComparison(0));
    for (const id of ['b','c','d'].slice(0,count-1)) expect(JSON.parse(screen.getByTestId(id).getAttribute('data-camera')!)).toEqual(pose(9));
    act(() => cameraCallbacks.get('b')!(pose(2), false));
    expect(useComparisonUIStore.getState().ui.cameras3D.b).toEqual(pose(9));
    act(() => removedCallback(pose(1), true));
    expect(useComparisonUIStore.getState().ui.cameras3D.b).toEqual(pose(9));
    fireEvent.click(screen.getByLabelText('Sync 3D cameras'));
    act(() => cameraCallbacks.get('b')!(pose(4), true));
    expect(useComparisonUIStore.getState().ui.cameras3D.c).toEqual(pose(9));
    fireEvent.click(screen.getByLabelText('Sync 3D cameras'));
    act(() => useImageStore.getState().removeImageFromComparison(0));
    expect(useComparisonUIStore.getState().ui.cameras3D.c).toEqual(pose(4));
  });

});
