export const STACK_CARD_DRAG_TYPE = 'application/x-image-metahub-stack-card';
export interface StackCardDrag { boardId: string; stackId: string; objectId: string }
let active: StackCardDrag | null = null;
export function setStackCardDrag(dataTransfer: DataTransfer, payload: StackCardDrag) {
  active = payload;
  dataTransfer.effectAllowed = 'move';
  try { dataTransfer.setData(STACK_CARD_DRAG_TYPE, JSON.stringify(payload)); }
  catch { /* Native drag may restrict MIME data; retain the current gesture. */ }
}
export function hasStackCardDrag(dataTransfer: DataTransfer) {
  return active !== null || Array.from(dataTransfer.types).includes(STACK_CARD_DRAG_TYPE);
}
export function getStackCardDrag(dataTransfer: DataTransfer): StackCardDrag | null {
  try {
    const raw = dataTransfer.getData(STACK_CARD_DRAG_TYPE);
    if (!raw) return active;
    const value = JSON.parse(raw) as Partial<StackCardDrag>;
    return typeof value.boardId === 'string' && typeof value.stackId === 'string' && typeof value.objectId === 'string' ? value as StackCardDrag : null;
  } catch { return active; }
}
export function clearStackCardDrag() { active = null; }

/** Native drag snapshots can ignore the Canvas ancestor's zoom transform. */
export function setStackCardDragPreview(dataTransfer: DataTransfer, source: HTMLElement, pointer: { x: number; y: number }) {
  const bounds = source.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const preview = source.cloneNode(true) as HTMLElement;
  preview.removeAttribute('id');
  // Mount outside the transformed Canvas, using the size already visible on screen.
  Object.assign(preview.style, {
    position: 'fixed', left: '0', top: '0', width: `${bounds.width}px`, height: `${bounds.height}px`,
    minWidth: '0', minHeight: '0', maxWidth: 'none', maxHeight: 'none', margin: '0', padding: '0',
    transform: 'none', pointerEvents: 'none', zIndex: '-1', boxSizing: 'border-box',
  });
  const image = preview.querySelector('img');
  if (image) Object.assign(image.style, { display: 'block', width: '100%', height: '100%', objectFit: 'contain' });
  document.body.appendChild(preview);
  try {
    dataTransfer.setDragImage(preview, Math.max(0, Math.min(bounds.width, pointer.x - bounds.left)), Math.max(0, Math.min(bounds.height, pointer.y - bounds.top)));
  } finally {
    // Chromium captures the supplied element after dragstart has returned.
    setTimeout(() => preview.remove(), 0);
  }
}
