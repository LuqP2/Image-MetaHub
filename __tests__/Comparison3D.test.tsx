import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ComparisonSurface } from '../components/ComparisonSurface';
import { useImageStore } from '../store/useImageStore';
import { defaultComparisonUI, useComparisonUIStore } from '../store/useComparisonUIStore';
vi.mock('../components/ComparisonMetadataPanel', () => ({ default: () => null }));
vi.mock('../components/ComparisonOverlayView', () => ({ default: () => null }));
vi.mock('../components/ComparisonPane', () => ({ default: ({ image, externalCamera, onCameraChange }: any) => <button data-testid={image.id} data-camera={JSON.stringify(externalCamera)} onClick={() => onCameraChange({ projection: 'perspective', position: [3,2,1], target: [0,0,0], up: [0,1,0], zoom: 1, fov: 35 }, true)}>{image.name}</button> }));
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
});
