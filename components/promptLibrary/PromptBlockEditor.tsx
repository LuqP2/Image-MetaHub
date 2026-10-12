import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { PromptBlock } from '../../types';
import { normalizeEditor } from '../../services/promptLibrary/core.mjs';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { usePromptDialogFocus } from '../../hooks/usePromptDialogFocus';
import { buttonClass, fieldClass, VariableDefinitions } from './PromptVariables';
import PromptTagsInput from './PromptTagsInput';
import { createSelectionField, usePromptSelectionMenu } from '../../hooks/usePromptSelectionMenu';
export default function PromptBlockEditor({ initial, onClose, onSaved }: {
  initial: Partial<PromptBlock>;
  onClose: () => void;
  onSaved?: (id?: string) => void;
}) {
  const [editor, setEditor] = useState(normalizeEditor(initial.editor));
  const [text, setText] = useState(initial.text || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldStatus, setFieldStatus] = useState('');
  const selection = usePromptSelectionMenu();
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const mutate = useSavedPromptStore((s) => s.mutate);
  const dialogRef = usePromptDialogFocus(onClose, busy);
  const save = async () => {
    if(!canUseAdvancedPromptLibrary) {
      showProModal('prompt_library_advanced');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const id = await mutate({ action: initial.id ? 'update' : 'create', kind: 'block', item: { ...initial, text, editor }, expectedRevision: initial.revision || 1 });
      if (onSaved) onSaved(id); else onClose();
    }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save block');
    }
    finally {
      setBusy(false);
    }
  };
  return createPortal(<div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4" onClick={(e) => e.stopPropagation()}>
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Save prompt block"
      className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100">


      <h2 className="font-semibold">
        {initial.id ? 'Edit block' : 'Save Selection as Block'}
      </h2>
      <label className="block text-xs">{"Title"}<input
          className={fieldClass}
          placeholder="Name this block, e.g. Soft studio lighting"
          value={editor.title}
          onChange={(e) => setEditor({ ...editor, title: e.target.value })} />
      </label>


      <label className="block text-xs">{"Block text"}<textarea
          aria-label="Block text"
          rows={5}
          className={fieldClass}
          value={text}
          onChange={(e) => setText(e.target.value)} onContextMenu={e => selection.open(e, undefined, (selected, start, end) => { const field = createSelectionField(selected, editor.variables.map(v => v.name)); setText(text.slice(0, start) + '{{' + field.name + '}}' + text.slice(end)); setEditor({ ...editor, variables: [...editor.variables, field] }); setFieldStatus(`{{${field.name}}} replaces “${selected}”. Its default value preserves the original text.`); })} />
      </label>
      {fieldStatus && <p role="status" className="text-xs text-accent">{fieldStatus}</p>}


      {editor.preview && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editor.preview !== 'hidden'} onChange={e => setEditor({ ...editor, preview: e.target.checked ? initial.editor?.preview || null : 'hidden' })} />Use current image as preview</label>}
      <details className="space-y-3 rounded-lg border border-gray-700 p-3 text-xs"><summary className="cursor-pointer text-gray-400">Organization (optional)</summary>
      <label className="block pt-3 text-xs">{"Category"}<input
          list="block-categories"
          className={fieldClass}
          value={editor.category}
          onChange={(e) => setEditor({ ...editor, category: e.target.value })} />
        <datalist id="block-categories">
          {['Subject', 'Style', 'Lighting', 'Camera', 'Environment', 'Clothing', 'Negative'].map((v) => <option key={v}>
            {v}
          </option>)}
        </datalist>
      </label>


      <PromptTagsInput tags={editor.tags} onChange={tags => setEditor({ ...editor, tags })} />


      <label className="block text-xs">{"Notes"}<textarea
          className={fieldClass}
          value={editor.notes}
          onChange={(e) => setEditor({ ...editor, notes: e.target.value })} />
      </label>
      </details>
      <details className="space-y-3 rounded-lg border border-gray-700 p-3 text-xs"><summary className="cursor-pointer text-gray-400">Fillable text (optional)</summary><div className="pt-3"><VariableDefinitions variables={editor.variables} onChange={(variables) => setEditor({ ...editor, variables })} /></div></details>


      {error && <p role="alert" className="text-sm text-red-400">
        {error}
      </p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={onClose}>{"Cancel"}</button>
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save block'}
        </button>
      </div>
      {selection.menu}
    </section>
  </div>, document.body);
}
