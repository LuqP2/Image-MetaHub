import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import ComparisonHost from '../components/ComparisonHost';
import { useImageStore } from '../store/useImageStore';
import { useComparisonUIStore, defaultComparisonUI } from '../store/useComparisonUIStore';
const mocks = vi.hoisted(() => ({ open: vi.fn(), update: vi.fn(async () => ({ success: true })), close: vi.fn(async () => ({ success: true })), generate: vi.fn(), listener: null as null | ((event: any) => void) }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseComparison: true, showProModal: vi.fn() }) }));
vi.mock('../hooks/useGenerateWithA1111', () => ({ useGenerateWithA1111: () => ({ generateWithA1111: mocks.generate }) }));
vi.mock('../components/ComparisonSurface', () => ({ ComparisonSurface: ({ isOpen, onDetach, onClose }: any) => { const ui = useComparisonUIStore(state => state.ui); return isOpen ? <div data-testid="surface" data-ui={JSON.stringify(ui)}><button onClick={onDetach}>Detach</button><button onClick={onClose}>Close</button></div> : null; } }));
beforeEach(() => {
  mocks.open.mockReset(); mocks.open.mockResolvedValue({ success: true }); mocks.close.mockClear();
  window.electronAPI = { comparison: { open: mocks.open, close: mocks.close, update: mocks.update, onEvent: (callback: any) => { mocks.listener = callback; return () => { mocks.listener = null; }; } } } as any;
  useComparisonUIStore.setState({ ui: defaultComparisonUI() });
  useImageStore.setState({ comparisonImages: [{ id: 'd::a.png', name: 'a.png', directoryId: 'd', handle: { getFile() {} } }, { id: 'd::b.png', name: 'b.png', directoryId: 'd' }] as any, directories: [{ id:'d', path:'/Library ç', handle: { getFile() {} } }] as any, isComparisonModalOpen: true });
});
afterEach(() => { cleanup(); delete window.electronAPI; });
describe('comparison host transfer', () => {
  it('transfers cloneable records and restores UI changes without clearing the selected files', async () => {
    render(<ComparisonHost isOpen onClose={vi.fn()} />);
    act(() => useComparisonUIStore.setState({ ui: { ...defaultComparisonUI(), viewMode: 'flicker', isMetadataExpanded: true, sharedZoom: { zoom: 3, x: -20, y: -30 } } }));
    fireEvent.click(screen.getByText('Detach'));
    await waitFor(() => expect(screen.queryByTestId('surface')).toBeNull());
    const snapshot = mocks.open.mock.calls[0][0];
    expect(snapshot.images[0].handle).toBeUndefined(); expect(snapshot.directories[0].handle).toBeUndefined();
    expect(snapshot.ui).toMatchObject({ viewMode: 'flicker', isMetadataExpanded: true, sharedZoom: { zoom:3 } });
    const remoteUI = { ...snapshot.ui, viewMode: 'side-by-side', metadataViewMode: 'standard' };
    act(() => { mocks.listener?.({ type: 'command', command: { type:'ui', ui: remoteUI } }); mocks.listener?.({ type:'returned' }); });
    expect(JSON.parse(screen.getByTestId('surface').getAttribute('data-ui')!)).toEqual(remoteUI);
    expect(useImageStore.getState().comparisonImages).toHaveLength(2);
  });
  it('retains inline comparison when native opening fails', async () => {
    mocks.open.mockResolvedValue({ success: false, error:'ERR_FAILED' });
    render(<ComparisonHost isOpen onClose={vi.fn()} />); fireEvent.click(screen.getByText('Detach'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent','ERR_FAILED');
    expect(screen.getByTestId('surface')).toBeTruthy(); expect(useImageStore.getState().comparisonImages).toHaveLength(2);
  });
  it('native close clears the comparison and closes its main modal', async () => {
    const close = vi.fn(); render(<ComparisonHost isOpen onClose={close} />);
    fireEvent.click(screen.getByText('Detach')); await waitFor(() => expect(screen.queryByTestId('surface')).toBeNull());
    act(() => mocks.listener?.({ type:'closed' })); expect(close).toHaveBeenCalled(); expect(useImageStore.getState().comparisonImages).toEqual([]);
  });
});
