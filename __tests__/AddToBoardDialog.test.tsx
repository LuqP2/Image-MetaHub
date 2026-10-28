import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddToBoardDialog from '../components/boards/AddToBoardDialog';
import hotkeyManager from '../services/hotkeyManager';
import { boardImage } from './helpers/boardIntegrationFixtures';
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseCanvas: true, showProModal: vi.fn() }) }));
vi.mock('../services/boards/boardService', () => ({ boardService: { list: async () => [] } }));
afterEach(cleanup);
describe('Add to Board dialog keyboard safety', () => {
  it('pauses library shortcuts, traps focus and closes with Escape', async () => {
    const close = vi.fn();
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AddToBoardDialog images={[boardImage()]} onClose={close} onAdded={vi.fn()} />); });
    expect(hotkeyManager.areHotkeysPaused()).toBe(true);
    const input = screen.getByLabelText('New board name');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view!.unmount();
    expect(hotkeyManager.areHotkeysPaused()).toBe(false);
  });
});
