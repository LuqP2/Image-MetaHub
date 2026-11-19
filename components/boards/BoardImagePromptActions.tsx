import { useTranslation } from '../../i18n/useTranslation';
import type { IndexedImage } from '../../types';
import { GripVertical } from 'lucide-react';
import type { BoardAssetObject } from '../../services/boards/types';
import { imagePromptText, setPromptDrag } from '../../services/boards/prompts';
import { useBoardPrompts } from './BoardPromptContext';
export default function BoardImagePromptActions({ image, object, editable }: { image: IndexedImage; object: BoardAssetObject; editable: boolean }) {
  const { t } = useTranslation();
  const prompts = useBoardPrompts();
  const text = imagePromptText(image);
  const input = { ...text, title: image.name, origin: { kind: 'image' as const, reference: object.reference } };
  if (!text.positivePrompt.trim()) return null;
  return <span className="flex items-center gap-2">
    <button type="button" className="board-icon-button" aria-label={t('promptLibrary.dragCanvas')} title={t('promptLibrary.dragCanvas')} draggable={editable} disabled={!editable} onDragStart={event => { if (editable) setPromptDrag(event.dataTransfer, input); }}><GripVertical size={14} /></button>
    <button type="button" className="board-button" disabled={!editable} onClick={() => prompts.add(input)}>{t('promptLibrary.addCanvas')}</button>
  </span>;
}
