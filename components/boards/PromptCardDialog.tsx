import { useEffect, useState } from 'react';
import type { SavedPrompt } from '../../types';
import type { BoardPromptInput } from '../../services/boards/types';
import { allVariables, compilePrompt } from '../../services/promptLibrary/core.mjs';
import { getPreviewValues } from '../../services/promptLibrary/sessionDraft';
import { itemTitle } from '../../services/promptLibrary/search';
import { VariableValues, buttonClass } from '../promptLibrary/PromptVariables';
import { usePromptDialogFocus } from '../../hooks/usePromptDialogFocus';
import { useBoardStore } from '../../store/useBoardStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { addPromptToBoard } from '../../services/boards/prompts';

export function materializeCanvasPrompt(item: SavedPrompt, values?: Record<string, string>): BoardPromptInput {
  const result = compilePrompt(item, values);
  if (result.errors.length) throw new Error(result.errors.join(' '));
  if (!(result.positivePrompt.trim() || result.negativePrompt.trim())) throw new Error('Fill a prompt before adding it.');
  return { title: itemTitle(item), positivePrompt: result.positivePrompt, negativePrompt: result.negativePrompt, origin: { kind: 'library', id: item.id, revision: item.revision ?? 1 } };
}
export default function PromptCardDialog({ item, destination = false, initialValues, onPrepared, onClose }: { item: SavedPrompt; destination?: boolean; initialValues?: Record<string, string>; onPrepared(input: BoardPromptInput): void; onClose(): void }) {

  const [values, setValues] = useState<Record<string, string>>(() => initialValues ?? getPreviewValues('library', item.id));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = usePromptDialogFocus(onClose, busy);
  const [addedBoard, setAddedBoard] = useState<string | null>(null);
  const [name, setName] = useState('Untitled board');
  const summaries = useBoardStore(state => state.summaries);
  const { canUseCanvas, showProModal } = useFeatureAccess();
  const compiled = compilePrompt(item, values);
  let variables: ReturnType<typeof allVariables> = [];
  let variableError = '';
  try { variables = item.editor?.document?.mode === 'template' ? allVariables(item.editor.document) : []; } catch (cause) { variableError = String(cause); }
  useEffect(() => { if (destination) void useBoardStore.getState().loadBoardList().catch(cause => setError(String(cause))); }, [destination]);
  const prepare = async (id?: string) => {
    if (!canUseCanvas) { showProModal('canvas'); return; }
    setBusy(true); setError('');
    try {
      const input = materializeCanvasPrompt(item, values);
      if (addedBoard) { await useBoardStore.getState().flushBoard(addedBoard); onPrepared(input); return; }
      if (destination) {
        const store = useBoardStore.getState();
        const boardId = id ?? await store.createBoard(name.trim() || 'Untitled board');
        if (id) await store.openBoard(id);
        addPromptToBoard(boardId, input);
        setAddedBoard(boardId);
        await useBoardStore.getState().flushBoard(boardId);
      }
      onPrepared(input);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add prompt.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4" onKeyDown={event => event.stopPropagation()}>
    <section ref={ref} role="dialog" aria-modal="true" aria-label="Add prompt to Canvas" className="scrollbar-sidebar max-h-[85vh] w-full max-w-lg space-y-3 overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100">
      <h2>Add prompt to Canvas</h2><p className="text-xs text-gray-400">{itemTitle(item)} · Independent copy</p>
      {!!variables.length && <VariableValues variables={variables} values={values} onChange={setValues} />}
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{compiled.positivePrompt}{compiled.negativePrompt ? `\nNegative prompt: ${compiled.negativePrompt}` : ''}</pre>
      {(error || variableError || compiled.errors.length > 0) && <p role="alert" className="text-sm text-red-300">{error || variableError || compiled.errors.join(' ')}</p>}
      <fieldset disabled={busy || !!variableError || !!compiled.errors.length} className="flex flex-col gap-2">
        {addedBoard ? <button className={buttonClass} onClick={() => void prepare()}>Retry saving card</button> : destination ? <><label>New board name<input aria-label="New board name" className="board-input" value={name} onChange={event => setName(event.target.value)} /></label><button className={buttonClass} onClick={() => void prepare()}>Create board and add</button>{summaries.filter(board => !board.error).map(board => <button key={board.id} className={buttonClass} onClick={() => void prepare(board.id)}>{board.name}</button>)}</> : <button className={buttonClass} onClick={() => void prepare()}>Confirm values</button>}
      </fieldset>
      <button className={buttonClass} disabled={busy} onClick={onClose}>Cancel</button>
    </section>
  </div>;
}
