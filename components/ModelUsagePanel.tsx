import { useTranslation } from '../i18n/useTranslation';
import React, { useState } from 'react';
import type { ModelInspectorItem, ModelUsageMode } from '../services/modelLibrary/types';
import { executeModelCommand, modelButton } from './ModelManagerPanels';

export default function ModelUsagePanel({ item, compact = false }: { item: ModelInspectorItem; compact?: boolean }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const usage = item.usage;
  if (usage?.status === 'unsupported') return <p className="text-xs text-gray-500">{t('modelLibrary.usageUnavailable')}</p>;
  const loading = !usage || usage.status === 'loading';
  const navigate = (mode: ModelUsageMode) => {
    setError('');
    void executeModelCommand({ type: 'viewLibrary', locationId: item.location.id, mode }).catch((error: Error) => setError(error.message));
  };
  return <section className={compact ? 'px-3 pb-3 text-xs' : 'space-y-2 rounded-lg border border-gray-800 p-3 text-sm'} aria-label={t('modelLibrary.libraryUsage')}>
    <p className="font-medium text-gray-200">{loading ? t('modelLibrary.loadingUsage') : t(usage.status === 'partial' ? 'modelLibrary.usagePartial' : 'modelLibrary.usageCount', { count: usage.totalCount })}</p>
    <div className="mt-2"><button className={modelButton} onClick={() => navigate('total')}>{t('modelLibrary.viewLibrary')}</button></div>
    {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
  </section>;
}
