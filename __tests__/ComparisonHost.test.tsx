import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import ComparisonHost from '../components/ComparisonHost';
import { useImageStore } from '../store/useImageStore';
import { useComparisonUIStore, defaultComparisonUI } from '../store/useComparisonUIStore';
import { selectInlineComparisonOpen } from '../services/comparisonContracts';
const mocks = vi.hoisted(() => ({ open: vi.fn(), update: vi.fn(async () => ({ success: true })), close: vi.fn(async () => ({ success: true })), generate: vi.fn(), listener: null as null | ((event: any) => void) }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseComparison: true, showProModal: vi.fn() }) }));
vi.mock('../hooks/useGenerateWithA1111', () => ({ useGenerateWithA1111: () => ({ generateWithA1111: mocks.generate }) }));
vi.mock('../components/ComparisonSurface', () => ({ ComparisonSurface: ({ isOpen, onDetach, onClose }: any) => { const ui = useComparisonUIStore(state => state.ui); return isOpen ? <div data-testid="surface" data-ui={JSON.stringify(ui)}><button onClick={onDetach}>Detach</button><button onClick={onClose}>Close</button></div> : null; } }));
beforeEach(() => {
  mocks.open.mockReset(); mocks.open.mockResolvedValue({ success: true }); mocks.close.mockClear(); mocks.update.mockClear();
  window.electronAPI = { comparison: { open: mocks.open, close: mocks.close, update: mocks.update, onEvent: (callback: any) => { mocks.listener = callback; return () => { mocks.listener = null; }; } } } as any;
  useComparisonUIStore.setState({ ui: defaultComparisonUI() });
  useImageStore.setState({ comparisonImages: [{ id: 'd::a.png', name: 'a.png', directoryId: 'd', handle: { getFile() {} } }, { id: 'd::b.png', name: 'b.png', directoryId: 'd' }] as any, directories: [{ id:'d', path:'/Library ç', handle: { getFile() {} } }] as any, isComparisonModalOpen: true, isComparisonDetached: false });
});
afterEach(() => { cleanup(); delete window.electronAPI; });
function WorkspaceProbe() {
  const inlineComparison = useImageStore(selectInlineComparisonOpen);
  return <div data-testid="workspace" data-visible={String(!inlineComparison)} />;
}
function StoreHost() {
  const isOpen = useImageStore(state => state.isComparisonModalOpen);
  return <><ComparisonHost isOpen={isOpen} onClose={useImageStore.getState().closeComparisonModal} /><WorkspaceProbe /></>;
}
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
    act(() => { mocks.listener?.({ sessionId: snapshot.sessionId, type: 'command', command: { type:'ui', ui: remoteUI } }); mocks.listener?.({ sessionId: snapshot.sessionId, type:'returned' }); });
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
    act(() => mocks.listener?.({ sessionId: mocks.open.mock.calls[0][0].sessionId, type:'closed' })); expect(close).toHaveBeenCalled(); expect(useImageStore.getState().comparisonImages).toEqual([]);
  });
  it('exposes inline visibility separately when detached and restores it on return', async () => {
    render(<StoreHost />);
    expect(screen.getByTestId('workspace').getAttribute('data-visible')).toBe('false');
    fireEvent.click(screen.getByText('Detach'));
    await waitFor(() => expect(useImageStore.getState().isComparisonDetached).toBe(true));
    expect(useImageStore.getState().isComparisonModalOpen).toBe(true);
    expect(screen.getByTestId('workspace').getAttribute('data-visible')).toBe('true');
    const sessionId = mocks.open.mock.calls[0][0].sessionId;
    act(() => mocks.listener?.({ sessionId, type: 'returned' }));
    expect(useImageStore.getState().isComparisonDetached).toBe(false);
    expect(screen.getByTestId('workspace').getAttribute('data-visible')).toBe('false');
    expect(screen.getByTestId('surface')).toBeTruthy();
  });
  it('immediately cancels native opening when the inline comparison closes', async () => {
    let finish!: (result: { success: boolean }) => void;
    mocks.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ComparisonHost isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Detach'));
    const sessionId = mocks.open.mock.calls[0][0].sessionId;
    fireEvent.click(screen.getByText('Close'));
    expect(mocks.close).toHaveBeenCalledWith(sessionId);
    await act(async () => finish({ success: true }));
    expect(useImageStore.getState().isComparisonDetached).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure', 'reject'] as const)('ignores a canceled opening finishing with %s while a replacement is opening', async outcome => {
    let finishOld!: (result: { success: boolean; error?: string }) => void;
    let rejectOld!: (error: Error) => void;
    let finishNew!: (result: { success: boolean }) => void;
    mocks.open.mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    render(<StoreHost />); fireEvent.click(screen.getByText('Detach'));
    const old = mocks.open.mock.calls[0][0];
    fireEvent.click(screen.getByText('Close'));
    expect(mocks.close).toHaveBeenCalledWith(old.sessionId);
    act(() => useImageStore.setState({ comparisonImages: old.images.map((image: any, index: number) => ({ ...image, id: `new-${index}`, name: `new-${index}.png` })), isComparisonModalOpen: true }));
    fireEvent.click(screen.getByText('Detach'));
    const replacement = mocks.open.mock.calls[1][0]; expect(replacement.sessionId).not.toBe(old.sessionId);
    await act(async () => { if (outcome === 'reject') rejectOld(new Error('Late rejection')); else finishOld({ success: outcome === 'success', error: 'Late failure' }); });
    act(() => {
      mocks.listener?.({ sessionId: old.sessionId, type: 'command', command: { type: 'ui', ui: { ...defaultComparisonUI(), sharedZoom: { zoom: 99, x: 0, y: 0 } } } });
      for (const type of ['closed', 'returned', 'failed']) mocks.listener?.({ sessionId: old.sessionId, type, error: 'Stale error' });
    });
    expect(useImageStore.getState().comparisonImages.map(image => image.id)).toEqual(['new-0', 'new-1']);
    expect(useComparisonUIStore.getState().ui.sharedZoom.zoom).toBe(1);
    expect(useImageStore.getState().isComparisonDetached).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByRole('status').textContent).toContain('Opening');
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => finishNew({ success: true }));
    await waitFor(() => expect(useImageStore.getState().isComparisonDetached).toBe(true));
    expect(mocks.update.mock.calls.every(([snapshot]) => snapshot.sessionId === replacement.sessionId)).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ sessionId: replacement.sessionId, images: expect.arrayContaining([expect.objectContaining({ id: 'new-0' })]) }));
  });
  it('cancels a pending native window when the modal is closed through store state', async () => {
    let finish!: (result: { success: boolean }) => void;
    mocks.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<StoreHost />); fireEvent.click(screen.getByText('Detach'));
    const id = mocks.open.mock.calls[0][0].sessionId;
    act(() => useImageStore.getState().closeComparisonModal());
    expect(mocks.close).toHaveBeenCalledWith(id);
    await act(async () => finish({ success: true }));
    expect(useImageStore.getState().isComparisonDetached).toBe(false); expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByTestId('workspace').getAttribute('data-visible')).toBe('true');
  });
  it('cancels an opening on unmount and ignores its late success', async () => {
    let finish!: (result: { success: boolean }) => void;
    mocks.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<StoreHost />); fireEvent.click(screen.getByText('Detach'));
    const id = mocks.open.mock.calls[0][0].sessionId; view.unmount();
    expect(mocks.close).toHaveBeenCalledWith(id);
    await act(async () => finish({ success: true }));
    expect(useImageStore.getState().isComparisonDetached).toBe(false); expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['opening', 'detached'] as const)('ends the logical session when a %s comparison loses its second image', async phase => {
    let finish!: (result: { success: boolean }) => void;
    if (phase === 'opening') mocks.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<StoreHost />); fireEvent.click(screen.getByText('Detach'));
    const id = mocks.open.mock.calls[0][0].sessionId;
    if (phase === 'detached') await waitFor(() => expect(useImageStore.getState().isComparisonDetached).toBe(true));
    const updates = mocks.update.mock.calls.length;
    act(() => useImageStore.setState({ comparisonImages: useImageStore.getState().comparisonImages.slice(0, 1) }));
    expect(mocks.close).toHaveBeenCalledWith(id);
    if (phase === 'opening') await act(async () => finish({ success: true }));
    expect(useImageStore.getState().isComparisonModalOpen).toBe(false);
    expect(useImageStore.getState().isComparisonDetached).toBe(false);
    expect(useImageStore.getState().comparisonImages).toEqual([]);
    expect(mocks.update).toHaveBeenCalledTimes(updates);
    expect(screen.getByTestId('workspace').getAttribute('data-visible')).toBe('true');
  });

});
