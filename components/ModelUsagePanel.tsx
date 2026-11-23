import { useTranslation } from '../i18n/useTranslation';
import React, { useState } from 'react';
import type { ModelInspectorItem, ModelUsageMode } from '../services/modelLibrary/types';
import { executeModelCommand, modelButton } from './ModelManagerPanels';

export default function ModelUsagePanel({ item, compact = false }: { item: ModelInspectorItem; compact?: boolean }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const usage = item.usage;
  if (usage?.status === 'unsupported') return <p className={compact ? 'border-t border-gray-700/35 px-3 py-2 text-[11px] text-gray-500' : 'text-xs text-gray-500'}>{t('modelLibrary.usageUnavailable')}</p>;
  const loading = !usage || usage.status === 'loading';
  const navigate = (mode: ModelUsageMode) => {
    setError('');
    void executeModelCommand({ type: 'viewLibrary', locationId: item.location.id, mode }).catch((error: Error) => setError(error.message));
  };
  if (compact) {
    return <section className="border-t border-gray-700/35 px-3 py-2 text-[11px]" aria-label={t('modelLibrary.libraryUsage')}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-gray-400">{loading ? t('modelLibrary.loadingUsage') : t(usage.status === 'partial' ? 'modelLibrary.usagePartial' : 'modelLibrary.usageCount', { count: usage.totalCount })}</p>
        <button className="shrink-0 font-medium text-accent hover:underline" onClick={() => navigate('total')}>{t('modelLibrary.viewLibrary')}</button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
    </section>;
  }
  return <section className="space-y-2 rounded-lg border border-gray-700/50 bg-gray-900/60 p-3 text-xs" aria-label={t('modelLibrary.libraryUsage')}>
    <p className="font-medium text-gray-200">{loading ? t('modelLibrary.loadingUsage') : t(usage.status === 'partial' ? 'modelLibrary.usagePartial' : 'modelLibrary.usageCount', { count: usage.totalCount })}</p>
    <div><button className={modelButton} onClick={() => navigate('total')}>{t('modelLibrary.viewLibrary')}</button></div>
    {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
  </section>;
}
