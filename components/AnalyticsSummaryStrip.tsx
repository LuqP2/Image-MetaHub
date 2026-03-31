import React, { useMemo } from 'react';
import { BarChart3, CheckCircle2, Layers } from 'lucide-react';
import type { IndexedImage } from '../types';
import { buildAnalyticsExplorerData } from '../utils/analyticsUtils';

interface AnalyticsSummaryStripProps {
  images: IndexedImage[];
  allImages: IndexedImage[];
  onOpenAnalytics: () => void;
}

const AnalyticsSummaryStrip: React.FC<AnalyticsSummaryStripProps> = ({
  images,
  allImages,
  onOpenAnalytics,
}) => {
  const summary = useMemo(() => buildAnalyticsExplorerData({
    scopeImages: images,
    allImages,
    scopeMode: 'context',
  }), [allImages, images]);

  if (allImages.length === 0) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onOpenAnalytics}
      className="mb-3 flex w-full flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-sky-500/10 to-gray-900/80 px-5 py-4 text-left transition-colors hover:border-cyan-400/40 hover:from-cyan-500/15 hover:via-sky-500/15"
      title="Open Analytics Explorer"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2">
            <BarChart3 size={18} className="text-cyan-300" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-100">Analytics Explorer</div>
            <div className="text-xs text-gray-400">Current-scope pulse, with one click into the full workspace.</div>
          </div>
        </div>
        <div className="rounded-full border border-gray-700/80 bg-gray-950/70 px-3 py-1 text-xs font-medium text-gray-300">
          Open
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Scope</div>
          <div className="mt-1 font-semibold text-gray-100">{summary.totalImages.toLocaleString()} images</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-gray-500">
            <Layers size={12} />
            Dominant Model
          </div>
          <div className="mt-1 truncate font-semibold text-gray-100">{summary.dominantModel || 'N/A'}</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-gray-500">
            <CheckCircle2 size={12} />
            Telemetry
          </div>
          <div className="mt-1 font-semibold text-gray-100">{(summary.telemetryCoverage * 100).toFixed(0)}% coverage</div>
        </div>
      </div>
    </button>
  );
};

export default AnalyticsSummaryStrip;
