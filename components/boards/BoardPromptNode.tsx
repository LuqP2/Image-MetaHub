import { useTranslation } from '../../i18n/useTranslation';
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import BoardNodeControls from './BoardNodeControls';
import { useBoardEditor } from './BoardEditorContext';
import { useBoardPrompts } from './BoardPromptContext';

export default memo(function BoardPromptNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const { t } = useTranslation();
  const editor = useBoardEditor();
  const prompts = useBoardPrompts();
  if (data.object.type !== 'prompt') return null;
  const card = data.object;
  const count = prompts.counts(card.positivePrompt);
  return <article className="board-prompt" onDoubleClick={event => {
    event.stopPropagation(); editor.inspectSelection?.();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-board-positive-prompt]')?.focus());
  }}>
    <BoardNodeControls selected={!!selected} minWidth={220} minHeight={140} />
    <header><small>{t('librarySearch.prompt')}</small><strong>{card.title || t('promptLibrary.untitled')}</strong></header>
    <p>{card.positivePrompt || t('promptLibrary.noPositive')}</p>
    <footer>{card.negativePrompt && <span>{t('promptLibrary.hasNegative')}</span>}<span>{prompts.loading ? t('promptLibrary.loadingMatches') : t('promptLibrary.shortCounts', { canvasCount: count.canvas, libraryCount: count.library })}</span></footer>
  </article>;
});
