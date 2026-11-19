import { useTranslation } from '../i18n/useTranslation';
import React, { useEffect, useSyncExternalStore } from 'react';
import type { ModelInspectorItem } from '../services/modelLibrary/types';
import { changedDraftFields, conflictingDraftFields, modelMetadataDrafts } from '../services/modelLibrary/metadataDrafts';
import type { MetadataDraftValues } from '../services/modelLibrary/metadataDrafts';
import { getDefaultLoraSyntax } from '../services/modelLibrary/presentation';
import { executeModelCommand, modelButton, modelInput } from './ModelManagerPanels';

export default function ModelMetadataEditor({ item }: { item: ModelInspectorItem }) {
  const { t } = useTranslation();
  const fieldKeys = { name: 'modelLibrary.displayName', notes: 'modelLibrary.notes', tags: 'modelLibrary.tags', triggers: 'modelLibrary.triggers', strength: 'modelLibrary.strength' } as const;
  useSyncExternalStore(modelMetadataDrafts.subscribe, modelMetadataDrafts.getRevision, modelMetadataDrafts.getRevision);
  const key = modelMetadataDrafts.ensure(item);
  useEffect(() => { modelMetadataDrafts.sync(key, item.localMetadata); }, [key, item.localMetadata]);
  const draft = modelMetadataDrafts.get(key);
  const dirty = changedDraftFields(draft).length > 0;
  const conflicts = conflictingDraftFields(draft);
  const save = (overwrite = false) => { void modelMetadataDrafts.save(key, (patch) => executeModelCommand({ type: 'saveLocal', locationId: item.location.id, patch }), overwrite); };
  const field = (label: string, name: keyof MetadataDraftValues, type?: string) => <label className="block text-xs text-gray-400">{label}<input className={modelInput} type={type ?? 'text'} min={type === 'number' ? -10 : undefined} max={type === 'number' ? 10 : undefined} step={type === 'number' ? 0.05 : undefined} disabled={draft.saving} value={draft.values[name]} onChange={(event) => modelMetadataDrafts.change(key, name, event.target.value)} /></label>;
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3" aria-label={t('modelLibrary.yourMetadata')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{t('modelLibrary.yourMetadata')}</h3>{dirty && <span className="text-xs text-amber-300">{t('modelLibrary.unsaved')}</span>}{!draft.editing && <button className={modelButton} onClick={() => modelMetadataDrafts.edit(key)}>{t('modelLibrary.edit')}</button>}</div>
    {draft.editing ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      {field(t('modelLibrary.displayName'), 'name')}{field(t('modelLibrary.tagsComma'), 'tags')}
      {item.location.sourceKind === 'lora' && <>{field(t('modelLibrary.triggerOverride'), 'triggers')}{field(t('modelLibrary.strength'), 'strength', 'number')}<button type="button" className={modelButton} onClick={() => { void window.electronAPI?.copyTextToClipboard(getDefaultLoraSyntax(item.location, item.localMetadata)); }}>{t('modelLibrary.copyLora')}</button></>}
      <label className="block text-xs text-gray-400">{t('modelLibrary.notes')}<textarea rows={3} className={modelInput} disabled={draft.saving} value={draft.values.notes} onChange={(event) => modelMetadataDrafts.change(key, 'notes', event.target.value)} /></label>
      {draft.identityConflict && <div role="alert" className="space-y-2 text-xs text-amber-300"><p>{t('modelLibrary.identityConflict', { fields: draft.identityConflict.fields.map(name => t(fieldKeys[name])).join(', ') })}</p><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.resolveIdentityConflict(key, false)}>{t('modelLibrary.keepDraft')}</button><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.resolveIdentityConflict(key, true)}>{t('modelLibrary.useFileDraft')}</button></div>}
      {conflicts.length > 0 && <div role="alert" className="space-y-2 text-xs text-amber-300"><p>{t('modelLibrary.fieldsConflict', { fields: conflicts.map(name => t(fieldKeys[name])).join(', ') })}</p><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.discard(key)}>{t('modelLibrary.reloadValues')}</button><button type="button" className={modelButton} disabled={draft.saving} onClick={() => save(true)}>{t('modelLibrary.saveLocal')}</button></div>}
      {draft.error && <p role="alert" className="text-xs text-red-400">{draft.error}</p>}
      <div className="flex flex-wrap gap-2"><button className={modelButton} disabled={draft.saving || !dirty || conflicts.length > 0 || Boolean(draft.identityConflict)}>{draft.saving ? t('modelLibrary.saving') : t('modelLibrary.save')}</button><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.discard(key)}>{t('modelLibrary.discard')}</button><button type="button" className={modelButton} onClick={() => modelMetadataDrafts.close(key)}>{t('modelLibrary.closeEditor')}</button></div>
    </form> : <div className="space-y-1 text-xs text-gray-400"><p>{t('modelLibrary.displayNameValue', { value: item.localMetadata?.displayName || t('modelLibrary.default') })}</p><p>{t('modelLibrary.tagsValue', { value: item.localMetadata?.tags.join(', ') || t('modelLibrary.none') })}</p>{item.location.sourceKind === 'lora' && <><p>{t('modelLibrary.triggersValue', { value: item.localMetadata?.triggerWords?.join(', ') || t('modelLibrary.default') })}</p><p>{t('modelLibrary.strengthValue', { value: item.localMetadata?.defaultStrength ?? 1 })}</p></>}<p className="whitespace-pre-wrap break-words">{item.localMetadata?.notes || t('modelLibrary.noNotes')}</p>{draft.error && <p role="alert" className="text-red-400">{draft.error}</p>}</div>}
  </section>;
}
