import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { PromptBlock } from '../../types';
import { normalizeEditor } from '../../services/promptLibrary/core.mjs';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { usePromptDialogFocus } from '../../hooks/usePromptDialogFocus';
import { buttonClass, fieldClass } from './PromptVariables';
import BlockContentEditor from './BlockContentEditor';
import { activeBlockFields, rememberBlockFields } from '../../services/promptLibrary/blockFields';
import PromptTagsInput from './PromptTagsInput';
import { createSelectionField, usePromptSelectionMenu } from '../../hooks/usePromptSelectionMenu';
export default function PromptBlockEditor({ initial, onClose, onSaved }: {
  initial: Partial<PromptBlock>;
  onClose: () => void;
  onSaved?: (id?: string) => void;
}) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState(normalizeEditor(initial.editor));
  const [text, setText] = useState(initial.text || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldStatus, setFieldStatus] = useState<{ placeholder: string; text: string } | null>(null);
  const selection = usePromptSelectionMenu();
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const folders = useSavedPromptStore(s => s.folders) ?? [];
  const mutate = useSavedPromptStore((s) => s.mutate);
  const dialogRef = usePromptDialogFocus(onClose, busy);
  const variables = activeBlockFields(text, editor.variables);
  const save = async () => {
    if(!canUseAdvancedPromptLibrary) {
      showProModal('prompt_library_advanced');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const id = await mutate({ action: initial.id ? 'update' : 'create', kind: 'block', item: { ...initial, text, editor: { ...editor, variables } }, expectedRevision: initial.revision || 1 });
      if (onSaved) onSaved(id); else onClose();
    }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : 'promptLibrary.saveBlockFailed');
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
      aria-label={t('promptLibrary.saveBlockDialog')}
      className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100">


      <h2 className="font-semibold">
        {initial.id ? t('promptLibrary.editBlock') : t('promptLibrary.saveSelection')}
      </h2>
      <label className="block text-xs">{t('promptLibrary.title')}<input
          className={fieldClass}
          placeholder={t('promptLibrary.nameBlock')}
          value={editor.title}
          onChange={(e) => setEditor({ ...editor, title: e.target.value })} />
      </label>


      <BlockContentEditor text={text} variables={variables} rows={5} disabled={!canUseAdvancedPromptLibrary || busy}
        onTextChange={next => { setText(next); setEditor(current => ({ ...current, variables: rememberBlockFields(next, current.variables) })); }}
        onVariableChange={variable => setEditor(current => ({ ...current, variables: rememberBlockFields(text, [...current.variables.filter(entry => entry.name !== variable.name), variable]) }))}
        onContextMenu={e => selection.open(e, undefined, (selected, start, end) => { const field = createSelectionField(selected, editor.variables.map(v => v.name)); setText(text.slice(0, start) + '{{' + field.name + '}}' + text.slice(end)); setEditor({ ...editor, variables: [...editor.variables, field] }); setFieldStatus({ placeholder: '{{' + field.name + '}}', text: selected }); })} />
      {fieldStatus && <p role="status" className="text-xs text-accent">{t('promptLibrary.fieldReplaced', fieldStatus)}</p>}


      {editor.preview && <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="ui-checkbox" checked={editor.preview !== 'hidden'} onChange={e => setEditor({ ...editor, preview: e.target.checked ? initial.editor?.preview || null : 'hidden' })} />{t('promptLibrary.useCurrentPreview')}</label>}
      <details className="ui-disclosure space-y-3 rounded-lg border border-gray-700 p-3 text-xs"><summary className="cursor-pointer text-gray-400">{t('promptLibrary.organization')}</summary>
      <label className="block pt-3 text-xs">{t('promptLibrary.category')}<input
          list="block-categories"
          className={fieldClass}
          value={editor.category}
          onChange={(e) => setEditor({ ...editor, category: e.target.value })} />
        <datalist id="block-categories">
          {(['Subject', 'Style', 'Lighting', 'Camera', 'Environment', 'Clothing', 'Negative'] as const).map((v) => <option key={v} value={v}>
            {t(({ Subject: 'promptLibrary.subjectCategory', Style: 'promptLibrary.styleCategory', Lighting: 'promptLibrary.lightingCategory', Camera: 'promptLibrary.cameraCategory', Environment: 'promptLibrary.environmentCategory', Clothing: 'promptLibrary.clothingCategory', Negative: 'promptLibrary.negativeCategory' } as const)[v])}
          </option>)}
        </datalist>
      </label>


      <label className="block text-xs">{t('promptLibrary.folder')}<select aria-label={t('promptLibrary.blockFolder')} className={fieldClass} value={editor.folderId || ''} onChange={event => setEditor({ ...editor, folderId: event.target.value })}><option value="">{t('promptLibrary.unfiled')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><PromptTagsInput tags={editor.tags} onChange={tags => setEditor({ ...editor, tags })} />


      <label className="block text-xs">{t('promptLibrary.notes')}<textarea
          className={fieldClass}
          value={editor.notes}
          onChange={(e) => setEditor({ ...editor, notes: e.target.value })} />
      </label>
      </details>


      {error && <p role="alert" className="text-sm text-red-400">
        {translatePromptMessage(error, t)}
      </p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={onClose}>{t('promptLibrary.cancel')}</button>
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={() => void save()}>
          {busy ? t('promptLibrary.saving') : t('promptLibrary.saveBlock')}
        </button>
      </div>
      {selection.menu}
    </section>
  </div>, document.body);
}
