import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import React, { useRef, useState } from 'react';
import type { PromptBlock, PromptVariable } from '../../types';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { activeBlockFields } from '../../services/promptLibrary/blockFields';
import { normalizeEditor, sameVariableDefinition } from '../../services/promptLibrary/core.mjs';
import { buttonClass, SuggestedValues } from './PromptVariables';

function FieldSuggestions({ variable, disabled, save, onDraftChange }: {
  variable: PromptVariable; disabled: boolean;
  save: (baseline: PromptVariable, options: string[]) => Promise<void>;
  onDraftChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<{ baseline: PromptVariable; options: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const persist = async () => {
    if (!draft || busy || disabled) return;
    setBusy(true); setError('');
    try { await save(draft.baseline, draft.options); setDraft(null); onDraftChange(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'promptLibrary.suggestionsFailed'); }
    finally { setBusy(false); }
  };
  return <fieldset disabled={disabled || busy} className="space-y-2 rounded-lg border border-gray-700 p-3" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void persist();
  }}>
    <legend className="px-1 text-xs font-semibold">{variable.label || variable.name}</legend>
    <SuggestedValues variable={{ ...variable, options: draft?.options || variable.options }} onChange={options => {
      setDraft(current => JSON.stringify(options) === JSON.stringify(variable.options) ? null : { baseline: current?.baseline || structuredClone(variable), options });
      onDraftChange(JSON.stringify(options) !== JSON.stringify(variable.options));
      setError('');
    }} />
    {busy && <p role="status" className="text-xs text-gray-400">{t('promptLibrary.savingSuggestions')}</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-xs text-red-400">{translatePromptMessage(error, t)}</p><button type="button" className={buttonClass} onClick={() => void persist()}>{t('promptLibrary.retryFieldSave', { variable: variable.name })}</button></div>}
  </fieldset>;
}

export default function BlockFieldSuggestions({ block, onPending, beforeSave, onDraftChange }: {
  block: PromptBlock; onPending: (operation: Promise<void>) => void;
  beforeSave?: () => Promise<void> | null;
  onDraftChange?: (name: string, dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const { canUseAdvancedPromptLibrary } = useFeatureAccess();
  const tail = useRef<Promise<void>>(Promise.resolve());
  const variables = activeBlockFields(block.text, normalizeEditor(block.editor).variables);
  if (!variables.length) return null;
  const save = (baseline: PromptVariable, options: string[]) => {
    const previous = beforeSave?.();
    // Read the latest item after the previous field finishes saving, so quick
    // edits to different fields preserve each other's values and revisions.
    const operation = tail.current.catch(() => undefined).then(async () => {
      if (previous) await previous;
      if (!canUseAdvancedPromptLibrary) return;
      const state = useSavedPromptStore.getState();
      const latest = state.blocks.find(entry => entry.id === block.id);
      if (!latest) throw new Error('promptLibrary.blockMissing');
      const editor = normalizeEditor(latest.editor);
      const current = activeBlockFields(latest.text, editor.variables).find(entry => entry.name === baseline.name);
      if (!current || !sameVariableDefinition(current, baseline)) throw new Error('promptLibrary.fieldChanged');
      const replacement = { ...current, options };
      const variables = editor.variables.some(entry => entry.name === current.name)
        ? editor.variables.map(entry => entry.name === current.name ? replacement : entry)
        : [...editor.variables, replacement];
      await state.mutate({ action: 'update', kind: 'block', item: { ...latest, editor: { ...editor, variables } }, expectedRevision: latest.revision || 1 });
    });
    tail.current = operation; onPending(operation);
    return operation;
  };
  return <section aria-label={t('promptLibrary.blockSuggestions')} className="space-y-3">
    <h3 className="text-sm font-semibold">{t('promptLibrary.fields')}</h3>
    <p className="text-xs text-gray-400">{t('promptLibrary.leaveFieldHelp')}</p>
    {variables.map(variable => <FieldSuggestions key={variable.name} variable={variable} disabled={!canUseAdvancedPromptLibrary} save={save} onDraftChange={dirty => onDraftChange?.(variable.name, dirty)} />)}
  </section>;
}
