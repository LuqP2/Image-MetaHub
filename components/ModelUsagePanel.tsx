import React, { useState } from 'react';
import type { ModelInspectorItem, ModelUsageMode } from '../services/modelLibrary/types';
import { executeModelCommand, modelButton } from './ModelManagerPanels';

export default function ModelUsagePanel({ item, compact = false }: { item: ModelInspectorItem; compact?: boolean }) {
  const [error, setError] = useState('');
  const usage = item.usage;
  if (usage?.status === 'unsupported') return <p className="text-xs text-gray-500">Usage unavailable</p>;
  const loading = !usage || usage.status === 'loading';
  const navigate = (mode: ModelUsageMode) => {
    setError('');
    void executeModelCommand({ type: 'viewLibrary', locationId: item.location.id, mode }).catch((error: Error) => setError(error.message));
  };
  return <section className={compact ? 'px-3 pb-3 text-xs' : 'space-y-2 rounded-lg border border-gray-800 p-3 text-sm'} aria-label="Library usage">
    <p className="font-medium text-gray-200">{loading ? 'Loading Library usage…' : `${usage.totalCount} files in Library${usage.status === 'partial' ? ' · Partial' : ''}`}</p>
    {!loading && <p className="mt-1 text-xs text-gray-400">{usage.confirmedCount} confirmed by hash · {usage.nameMatchedCount} matched by name</p>}
    {!loading && usage.ambiguousCount > 0 && <p className="mt-1 text-xs text-amber-300">{usage.ambiguousCount} additional ambiguous matches</p>}
    {!loading && <p className="mt-1 text-xs text-gray-500" title="Based on the latest matching file date in your indexed Library">{compact ? 'Latest file' : 'Latest matching file'}: {usage.lastUsedAt !== null ? new Date(usage.lastUsedAt).toLocaleDateString() : '—'}</p>}
    {!compact && <p className="text-xs text-gray-500">Based on the latest matching file date in your indexed Library</p>}
    <div className="mt-2 flex flex-wrap gap-2"><button className={modelButton} onClick={() => navigate('total')}>View in Library</button>{!compact && <><button className={modelButton} onClick={() => navigate('confirmed')}>Confirmed only</button><button className={modelButton} onClick={() => navigate('ambiguous')}>Ambiguous matches</button></>}</div>
    {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
  </section>;
}
