import { useLayoutEffect, useRef, useState } from 'react';
import type { BoardSmartFrameObject } from '../../services/boards/queryTypes';

export default function BoardSetOperationDialog({ frames, disabled, confirm, close }: {
  frames: BoardSmartFrameObject[]; disabled: boolean; confirm(left: string, right: string): void; close(): void;
}) {
  const sorted = [...frames].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const [inverted, setInverted] = useState(false);
  const [left, right] = inverted ? [sorted[1], sorted[0]] : sorted;
  const dialogRef = useRef<HTMLDivElement>(null);
  const hasFrames = Boolean(left && right);
  useLayoutEffect(() => {
    if (!hasFrames) return;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current!;
    const focusFirst = () => (dialog.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? dialog).focus();
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    focusFirst();
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('focusin', containFocus);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [hasFrames]);
  if (!left || !right) return null;
  return <div className="board-dialog-backdrop"><div ref={dialogRef} tabIndex={-1} className="board-query-dialog" role="dialog" aria-modal="true" aria-label="Difference between frames"
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
          event.preventDefault(); first?.focus();
        }
      }
    }}>
    <h2>Difference</h2><p><strong>{left.title}</strong> minus <strong>{right.title}</strong></p>
    <p>Keep images in the first frame that are absent from the second.</p>
    <button className="board-button" disabled={disabled} onClick={() => setInverted(!inverted)}>Swap A and B</button>
    <button className="board-button" disabled={disabled} onClick={() => confirm(left.id, right.id)}>Create difference</button>
    <button className="board-button" onClick={close}>Cancel</button>
  </div></div>;
}
