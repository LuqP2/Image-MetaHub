import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ComfyTextDrag from '../components/comfyui/ComfyTextDrag';
import { installComfyTextDrop } from '../services/comfyTextDrop.mjs';

afterEach(() => { cleanup(); delete window.electronAPI; });

it('transports literal text for left-button drops', () => {
  render(<ComfyTextDrag text={'café\n${literal}'} />);
  const transfer = { setData: vi.fn(), effectAllowed: '' };
  fireEvent.dragStart(screen.getByLabelText('Drag to node'), { dataTransfer: transfer });
  expect(transfer.effectAllowed).toBe('copy');
  expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'café\n${literal}');
  expect(transfer.setData).toHaveBeenCalledWith('application/x-imagemetahub-prompt-text', 'café\n${literal}');
});

it('disables dragging text with unresolved values', () => {
  render(<ComfyTextDrag text="{{pending}}" disabled />);
  const transfer = { setData: vi.fn() };
  fireEvent.dragStart(screen.getByLabelText('Drag to node'), { dataTransfer: transfer });
  expect(transfer.setData).not.toHaveBeenCalled();
});

it('adds on normal drop and offers Add / Replace only when Shift is held', () => {
  vi.useFakeTimers();
  const runtime = vi.fn((operation: string) => operation === 'dropQuery'
    ? { success: true, targets: [{ token: 'target', nodeTitle: 'Positive', field: 'text' }] }
    : { success: true, targets: [], message: 'Updated' });
  installComfyTextDrop(runtime, window.location.origin);
  const drop = (shiftKey: boolean) => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: 80, clientY: 90, shiftKey, dataTransfer: { types: ['application/x-imagemetahub-prompt-text'], getData: () => 'new text' } });
    document.dispatchEvent(event);
  };
  drop(false);
  expect(runtime).toHaveBeenCalledWith('drop', { text: 'new text', x: 80, y: 90 }, window.location.origin);
  runtime.mockClear();
  drop(true);
  expect(runtime).toHaveBeenCalledTimes(1);
  expect(runtime.mock.calls[0][0]).toBe('dropQuery');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Replace node text' }));
  expect(runtime).toHaveBeenLastCalledWith('applyDrop', { token: 'target', text: 'new text', mode: 'replace', separator: ', ' }, window.location.origin);
  expect(screen.queryByRole('menu')).toBeNull();
  drop(true);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add to node' }));
  expect(runtime).toHaveBeenLastCalledWith('applyDrop', { token: 'target', text: 'new text', mode: 'append', separator: ', ' }, window.location.origin);
  drop(true);
  runtime.mockClear();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(runtime).not.toHaveBeenCalled();
  vi.runOnlyPendingTimers(); vi.useRealTimers();
});
