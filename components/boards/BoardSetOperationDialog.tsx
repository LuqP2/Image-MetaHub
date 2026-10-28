import { useState } from 'react';
import type { BoardSmartFrameObject } from '../../services/boards/queryTypes';

export default function BoardSetOperationDialog({ frames, disabled, confirm, close }: {
  frames: BoardSmartFrameObject[]; disabled: boolean; confirm(left: string, right: string): void; close(): void;
}) {
  const sorted = [...frames].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const [inverted, setInverted] = useState(false);
  const [left, right] = inverted ? [sorted[1], sorted[0]] : sorted;
  if (!left || !right) return null;
  return <div className="board-dialog-backdrop"><div className="board-query-dialog" role="dialog" aria-modal="true" aria-label="Difference between frames"
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') close(); }}>
    <h2>Difference</h2><p><strong>{left.title}</strong> minus <strong>{right.title}</strong></p>
    <p>Keep images in the first frame that are absent from the second.</p>
    <button className="board-button" disabled={disabled} onClick={() => setInverted(!inverted)}>Swap A and B</button>
    <button className="board-button" disabled={disabled} onClick={() => confirm(left.id, right.id)}>Create difference</button>
    <button className="board-button" onClick={close}>Cancel</button>
  </div></div>;
}
