import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import React, { useMemo, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { PromptLibrarySnapshot } from '../../types';
import { parseImport, exportJson, exportCsv, importCounts } from '../../services/promptLibrary/importExport';
import { compilePrompt } from '../../services/promptLibrary/core.mjs';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { usePromptDialogFocus } from '../../hooks/usePromptDialogFocus';
import { itemTitle } from '../../services/promptLibrary/search';
import { buttonClass, fieldClass } from './PromptVariables';
export default function PromptImportExportDialog({ snapshot, librarySnapshot, filteredSnapshot, scope, onClose }: {
  scope?: string;
  librarySnapshot?: PromptLibrarySnapshot;
  filteredSnapshot?: PromptLibrarySnapshot;
  snapshot: PromptLibrarySnapshot;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const existing = useSavedPromptStore();
  const [tab, setTab] = useState<'import' | 'export'>('export');
  const [exportScope, setExportScope] = useState<'current' | 'filtered' | 'library'>('current');
  const [format, setFormat] = useState<'json' | 'csv' | 'resolved'>('json');
  const exporting = exportScope === 'library' ? librarySnapshot || snapshot : exportScope === 'filtered' ? filteredSnapshot || snapshot : snapshot;
  const [incoming, setIncoming] = useState<PromptLibrarySnapshot | null>(null);
  const [error, setError] = useState('');
  const [keepDuplicates, setKeepDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => incoming ? importCounts(incoming, existing) : null, [incoming, existing.prompts, existing.blocks]);
  const dialogRef = usePromptDialogFocus(onClose, busy);
  const download = (format: 'json' | 'csv', resolved = false) => {
    try {
      const text = format === 'json' ? exportJson(exporting) : exportCsv(exporting.prompts, resolved ? new Map(exporting.prompts.map((p) => [p.id, compilePrompt(p)])) : null);
      const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'json' ? 'prompt-library.json' : resolved ? 'prompt-library-resolved.csv' : 'styles.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : 'promptLibrary.exportFailed');
    }
  };
  return createPortal(<div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4">
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('promptLibrary.transferTitle')}
      className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-auto ui-dialog p-5">
      <header className="flex items-center justify-between"><h2 className="font-semibold">{t('promptLibrary.importExport')}</h2><button disabled={busy} className="app-top-icon-button" aria-label={t('promptLibrary.closeTransfer')} onClick={onClose}><X size={16} /></button></header>
      <div className="app-top-segmented"><button className={`app-top-segment ${tab === 'export' ? 'app-top-segment-active' : ''}`} aria-pressed={tab === 'export'} onClick={() => setTab('export')}><Download size={14} />{t('promptLibrary.export')}</button><button className={`app-top-segment ${tab === 'import' ? 'app-top-segment-active' : ''}`} aria-pressed={tab === 'import'} onClick={() => setTab('import')}><Upload size={14} />{t('promptLibrary.import')}</button></div>
      {tab === 'export' && <div className="space-y-4">
        <label className="block space-y-1 text-xs">{t('promptLibrary.itemsExport')}<select aria-label={t('promptLibrary.exportScope')} className={fieldClass} value={exportScope} onChange={e => setExportScope(e.target.value as typeof exportScope)}><option value="current">{scope ?? t('promptLibrary.currentView')}</option>{filteredSnapshot && <option value="filtered">{t('promptLibrary.filteredView')}</option>}{librarySnapshot && <option value="library">{t('promptLibrary.entireLibrary')}</option>}</select></label>
        <p className="text-xs text-gray-400">{t(exportScope !== 'library' && exporting.prompts.length ? 'promptLibrary.exportCountsReferences' : 'promptLibrary.exportCounts', { prompts: exporting.prompts.length, blocks: exporting.blocks.length })}</p>
        <label className="block space-y-1 text-xs">{t('promptLibrary.format')}<select aria-label={t('promptLibrary.exportFormat')} className={fieldClass} value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="json">{t('promptLibrary.libraryJson')}</option><option value="csv">styles.csv</option><option value="resolved">{t('promptLibrary.resolvedCsv')}</option></select></label>
        <p className="text-xs text-gray-400">{format === 'json' ? t('promptLibrary.jsonExportHelp') : t('promptLibrary.csvExportHelp')}</p>
        {format === 'resolved' && <p className="text-xs text-gray-400">{t('promptLibrary.resolvedHelp')}</p>}
        <button className={buttonClass + ' !border-accent/40 !bg-accent/15'} disabled={format !== 'json' ? !exporting.prompts.length : !exporting.prompts.length && !exporting.blocks.length && !exporting.folders?.length} onClick={() => download(format === 'json' ? 'json' : 'csv', format === 'resolved')}><Download size={14} />{t('promptLibrary.exportFile')}</button>
      </div>}
      {tab === 'import' && <div className="space-y-4">
      <p className="text-xs text-gray-400">{t('promptLibrary.importHelp')}</p>
      <label className="block text-xs">{t('promptLibrary.importFile')}<input
          type="file"
          className={fieldClass}
          accept=".csv,.json"
          onChange={async (e) => {
            const file = e.target.files?.[0]; if(!file)
              return; setError(''); setIncoming(null); try {
                setIncoming(parseImport(await file.text(), file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'));
              }
            catch(cause) {
              setError(cause instanceof Error ? cause.message : 'promptLibrary.importFailed');
            }
          }} />
      </label>
      {counts && <div className="space-y-2 text-sm">
        <ul className="max-h-40 overflow-auto text-xs text-gray-400">
          {incoming && [...incoming.prompts, ...incoming.blocks].map((item, index) => <li key={index}>
            {itemTitle(item)}
          </li>)}
        </ul>
        <p>
          {t('promptLibrary.importSummary', { total: counts.total, duplicates: counts.duplicates, templates: counts.templates })}</p>
        <p className="text-xs text-gray-400">{t('promptLibrary.importPlaceholders', { source: '{prompt}', target: '{{prompt}}' })}</p>
        <label className="text-xs">
          <input
            type="checkbox"
            checked={keepDuplicates}
            onChange={(e) => setKeepDuplicates(e.target.checked)} />{t('promptLibrary.keepEquivalent')}</label>
        <button
          disabled={busy}
          className={buttonClass}
          onClick={async () => {
            if(!incoming)
              return; setBusy(true); try {
                await existing.mutate({ action: 'import', ...incoming, keepDuplicates });
                onClose();
              }
            catch(cause) {
              setError(cause instanceof Error ? cause.message : 'promptLibrary.importFailed');
            }
            finally {
              setBusy(false);
            }
          }}>{t('promptLibrary.confirmImport')}</button>
      </div>}
      </div>}
      {error && <p role="alert" className="text-sm text-red-400">
        {translatePromptMessage(error, t)}
      </p>}
      <button
        disabled={busy}
        className={buttonClass}
        onClick={onClose}>{t('promptLibrary.close')}</button>
    </section>
  </div>, document.body);
}
