import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useComfyTextFeedback } from '../hooks/useComfyTextFeedback';
function renderFeedback() {
  let feedback!: ReturnType<typeof useComfyTextFeedback>;
  function Harness() { feedback = useComfyTextFeedback(); return <>{feedback.toast}</>; }
  render(<Harness />);
  return { result: { get current() { return feedback; } } };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('shows success briefly, restarts its lifetime on repeated actions and gives warnings longer', () => {
  vi.useFakeTimers();
  const { result } = renderFeedback();
  const success = () => result.current.report({ success: true, targets: [] }, 'replace', 'text', { token: 't', nodeId: '1', nodeTitle: 'Text Multiline', field: 'text', preview: '' });
  act(success);
  expect(screen.getByRole('status').textContent).toContain('Node text replaced');
  expect(screen.getByRole('status').textContent).toContain('Text Multiline · text');
  act(() => vi.advanceTimersByTime(2000)); act(success);
  act(() => vi.advanceTimersByTime(2000)); expect(screen.getByRole('status')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000)); expect(screen.queryByRole('status')).toBeNull();
  act(() => result.current.report({ success: false, code: 'selection', message: 'Select a text node in ComfyUI first', targets: [] }, 'replace', 'text', undefined, true));
  expect(screen.getByRole('alert').firstElementChild?.className).toContain('border-amber');
  act(() => vi.advanceTimersByTime(6999)); expect(screen.getByRole('alert')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1)); expect(screen.queryByRole('alert')).toBeNull();
});
it('shows unexpected write failures in red with clipboard fallback', () => {
  const { result } = renderFeedback();
  act(() => result.current.report(undefined, 'append', 'text'));
  expect(screen.getByRole('alert').textContent).toContain('Could not update node text');
  expect(screen.getByRole('alert').firstElementChild?.className).toContain('border-red');
  expect(screen.getByRole('button', { name: 'Copy text instead' })).toBeTruthy();
});
