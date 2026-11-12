import type { IndexedImage } from '../../types';
import { GripVertical } from 'lucide-react';
import type { BoardAssetObject } from '../../services/boards/types';
import { imagePromptText, setPromptDrag } from '../../services/boards/prompts';
import { useBoardPrompts } from './BoardPromptContext';
export default function BoardImagePromptActions({ image, object, editable }: { image: IndexedImage; object: BoardAssetObject; editable: boolean }) {
  const prompts = useBoardPrompts();
  const text = imagePromptText(image);
  const input = { ...text, title: image.name, origin: { kind: 'image' as const, reference: object.reference } };
  if (!text.positivePrompt.trim()) return null;
  return <span className="flex items-center gap-2">
    <button type="button" className="board-icon-button" aria-label="Drag prompt to Canvas" title="Drag prompt to Canvas" draggable={editable} disabled={!editable} onDragStart={event => { if (editable) setPromptDrag(event.dataTransfer, input); }}><GripVertical size={14} /></button>
    <button type="button" className="board-button" disabled={!editable} onClick={() => prompts.add(input)}>Add prompt to Canvas</button>
  </span>;
}
