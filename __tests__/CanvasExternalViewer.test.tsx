import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CanvasWorkspace from '../components/CanvasWorkspace';
import { useBoardStore } from '../store/useBoardStore';
import { addAssets } from '../services/boards/operations';
import { createBoardDocument } from '../services/boards/document.mjs';
import type { IndexedImage } from '../types';

const fixture = vi.hoisted(() => ({ asset: null as unknown, image: { id: 'external::reference.png', name: 'reference.png', metadata: { normalizedMetadata: {} } } }));
vi.mock('../hooks/useBoardAssets', () => ({ useBoardAssets: () => ({ images: [], directories: [], resolve: () => ({ status: 'resolved', image: fixture.image }) }) }));
vi.mock('../hooks/useBoardQueries', () => ({ useBoardQueries: () => vi.fn() }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseCanvas: true, canUseComparison: true, showProModal: vi.fn() }) }));
vi.mock('../components/boards/BoardPromptIntegration', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../components/BoardWorkspace', () => ({ default: ({ onOpenAsset }: { onOpenAsset: (asset: unknown) => void }) => <button onClick={() => onOpenAsset(fixture.asset)}>Open external card</button> }));
vi.mock('../components/ComparisonMetadataPanel', () => ({ default: () => null }));
vi.mock('../components/ImageModal', () => ({ default: ({ image, directoryPath, onClose }: { image: IndexedImage; directoryPath: string; onClose(): void }) => <div role="dialog" aria-label="External viewer"><span>{image.name}</span><span>{directoryPath}</span><button onClick={onClose}>Close external viewer</button></div> }));

afterEach(cleanup);
describe('Canvas external viewer', () => {
  it('opens the normal viewer directly without depending on the library id lookup', () => {
    const board = addAssets(createBoardDocument(), [{ name: 'reference.png', mediaType: 'image', reference: { kind: 'external', locator: { imageId: 'external', directoryPath: '/synthetic', relativePath: 'reference.png' } } }], { x: 0, y: 0 });
    useBoardStore.getState().adoptBoard(board); fixture.asset = board.objects[0];
    const libraryViewer = vi.fn();
    render(<CanvasWorkspace loading={false} onOpenImage={libraryViewer} onCompareImages={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open external card' }));
    expect(screen.getByRole('dialog', { name: 'External viewer' })).toBeTruthy();
    expect(screen.getByText('/synthetic')).toBeTruthy();
    expect(libraryViewer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close external viewer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
