import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import BoardNodeControls from './BoardNodeControls';
import { useBoardEditor } from './BoardEditorContext';
import { useBoardPrompts } from './BoardPromptContext';

export default memo(function BoardPromptNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const editor = useBoardEditor();
  const prompts = useBoardPrompts();
  if (data.object.type !== 'prompt') return null;
  const card = data.object;
  const count = prompts.counts(card.positivePrompt);
  return <article className="board-prompt" onDoubleClick={event => {
    event.stopPropagation(); editor.inspectSelection?.();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Card positive prompt"]')?.focus());
  }}>
    <BoardNodeControls selected={!!selected} minWidth={220} minHeight={140} />
    <header><small>Prompt</small><strong>{card.title || 'Untitled prompt'}</strong></header>
    <p>{card.positivePrompt || '(No positive prompt)'}</p>
    <footer>{card.negativePrompt && <span>+ Negative</span>}<span>{prompts.loading ? 'Loading matches…' : `${count.canvas} on canvas · ${count.library} in library`}</span></footer>
  </article>;
});
