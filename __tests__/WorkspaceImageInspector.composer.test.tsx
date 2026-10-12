import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceImageInspector from '../components/comfyui/WorkspaceImageInspector';
import type { IndexedImage, ShadowMetadata } from '../types';

const mocks = vi.hoisted(() => ({ shadow: vi.fn() }));
vi.mock('../services/userDataPersistenceAdapter', () => ({ getPersistedShadowMetadata: mocks.shadow }));
vi.mock('../hooks/useSavePrompt', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useSavePrompt')>(),
  useSavePrompt: () => vi.fn(),
}));

const image = (): IndexedImage => ({
  id: 'synthetic', name: 'synthetic.png', handle: {} as FileSystemFileHandle,
  metadata: { normalizedMetadata: { prompt: 'embedded positive', negativePrompt: 'embedded negative' } } as IndexedImage['metadata'],
  metadataString: '', lastModified: 1, models: [], loras: [], scheduler: '', fileType: 'image/png',
});
const props = (target: IndexedImage, onUseComposer = vi.fn()) => ({
  image: target, metadata: target.metadata!.normalizedMetadata!, thumbnail: null,
  currentPosition: 1, normalizedNavigationImages: [target],
  canNavigatePrevious: false, canNavigateNext: false, isGenerating: false, isCopying: false,
  generateFromMetadata: vi.fn(), copyToComfyUI: vi.fn(), onOpenQueue: vi.fn(),
  copyStatus: null, generateStatus: null, assetActionMessage: '', startImageFileDrag: vi.fn(),
  showInspectorSelectionContextMenu: vi.fn(), showInspectorFieldContextMenu: vi.fn(),
  copyInspectorValue: vi.fn(), onUseComposer,
});
beforeEach(() => { mocks.shadow.mockReset().mockResolvedValue(null); });
afterEach(cleanup);

it.each([
  ['shadow-only positive', '', '', '  shadow\npositive  ', ''],
  ['shadow-only negative', '', '', '', '  shadow\nnegative  '],
  ['shadow replacements', 'old positive', 'old negative', 'new positive', 'new negative'],
])('composes %s from authoritative shadow text', async (_name, embeddedPositive, embeddedNegative, positive, negative) => {
  const target = image();
  target.metadata!.normalizedMetadata!.prompt = embeddedPositive;
  target.metadata!.normalizedMetadata!.negativePrompt = embeddedNegative;
  mocks.shadow.mockResolvedValue({ imageId: target.id, prompt: positive, negativePrompt: negative, updatedAt: 1 } as ShadowMetadata);
  const onUseComposer = vi.fn();
  render(<WorkspaceImageInspector {...props(target, onUseComposer)} />);
  const button = screen.getByRole('button', { name: 'Use in composer' });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(onUseComposer).toHaveBeenCalledWith(positive, negative));
  expect(mocks.shadow).toHaveBeenCalledWith(target);
});

it('falls back to embedded text when no shadow is persisted', async () => {
  const target = image(); const onUseComposer = vi.fn();
  render(<WorkspaceImageInspector {...props(target, onUseComposer)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use in composer' }));
  await waitFor(() => expect(onUseComposer).toHaveBeenCalledWith('embedded positive', 'embedded negative'));
});

it('rejects an effective empty pair and reports shadow read failures without composing stale text', async () => {
  const target = image(); const onUseComposer = vi.fn();
  mocks.shadow.mockResolvedValue({ imageId: target.id, prompt: ' ', negativePrompt: '\n', updatedAt: 1 } as ShadowMetadata);
  render(<WorkspaceImageInspector {...props(target, onUseComposer)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use in composer' }));
  await screen.findByText('This image has no prompt to save.');
  expect(onUseComposer).not.toHaveBeenCalled();
  mocks.shadow.mockRejectedValue(new Error('Synthetic shadow read failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Use in composer' }));
  await screen.findByText('Synthetic shadow read failure');
  expect(onUseComposer).not.toHaveBeenCalled();
});

it('does not compose the previous image when navigation finishes before the shadow read', async () => {
  let resolveShadow!: (value: ShadowMetadata | null) => void;
  mocks.shadow.mockReturnValue(new Promise<ShadowMetadata | null>(resolve => { resolveShadow = resolve; }));
  const target = image(); const onUseComposer = vi.fn();
  const view = render(<WorkspaceImageInspector {...props(target, onUseComposer)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use in composer' }));
  expect((screen.getByRole('button', { name: 'Use in composer' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<WorkspaceImageInspector {...props({ ...target, id: 'next-image' }, onUseComposer)} />);
  resolveShadow(null);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Use in composer' }) as HTMLButtonElement).disabled).toBe(false));
  expect(onUseComposer).not.toHaveBeenCalled();
});
