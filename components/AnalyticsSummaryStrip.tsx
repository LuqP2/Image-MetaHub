import React, { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Layers, X } from 'lucide-react';
import type { IndexedImage } from '../types';

interface AnalyticsSummaryStripProps {
  images: IndexedImage[];
  allImages: IndexedImage[];
  onOpenAnalytics: () => void;
}

const DISMISS_KEY = 'analytics-summary-strip-dismissed';

const hasTelemetry = (image: IndexedImage) => {
  const analytics = image.metadata?.normalizedMetadata?.analytics ||
    (image.metadata?.normalizedMetadata as { _analytics?: Record<string, unknown> } | undefined)?._analytics;

  return Boolean(
    analytics &&
    (
      typeof analytics.generation_time_ms === 'number' ||
      typeof analytics.steps_per_second === 'number' ||
      typeof analytics.vram_peak_mb === 'number' ||
      typeof analytics.gpu_device === 'string'
    )
  );
};

const AnalyticsSummaryStrip: React.FC<AnalyticsSummaryStripProps> = ({
  images,
  allImages,
  onOpenAnalytics,
}) => {
  const [dismissed, setDismissed] = useState(() => (
    typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === 'true'
  ));

  const summary = useMemo(() => {
    const modelCounts = new Map<string, number>();
    let telemetryCount = 0;

    for (const image of images) {
      if (hasTelemetry(image)) {
        telemetryCount += 1;
      }

      for (const model of image.models || []) {
        if (typeof model === 'string' && model.trim().length > 0) {
          modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
        }
      }
    }

    let dominantModel: string | undefined;
    let dominantCount = 0;
    for (const [model, count] of modelCounts.entries()) {
      if (count > dominantCount) {
        dominantModel = model;
        dominantCount = count;
      }
    }

    return {
      totalImages: images.length,
      dominantModel,
      telemetryCoverage: images.length > 0 ? telemetryCount / images.length : 0,
      allImagesCount: allImages.length,
    };
  }, [allImages.length, images]);

  if (allImages.length === 0 || dismissed) {
    return null;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenAnalytics}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenAnalytics();
        }
      }}
      className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-sky-500/10 to-gray-900/80 px-4 py-2.5 text-left transition-colors hover:border-cyan-400/40 hover:from-cyan-500/15 hover:via-sky-500/15"
      title="Open Analytics Explorer"
    >
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2">
        <BarChart3 size={16} className="text-cyan-300" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-gray-100">Analytics Explorer</div>
          <div className="rounded-full border border-gray-700/80 bg-gray-950/70 px-2 py-0.5 text-[11px] font-medium text-gray-300">
            Open
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
          <span>{summary.totalImages.toLocaleString()} in scope</span>
          <span className="inline-flex items-center gap-1">
            <Layers size={11} />
            <span className="truncate max-w-[11rem]">{summary.dominantModel || 'N/A'}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={11} />
            {(summary.telemetryCoverage * 100).toFixed(0)}% telemetry
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(DISMISS_KEY, 'true');
          }
          setDismissed(true);
        }}
        className="rounded-full border border-gray-700/80 bg-gray-950/70 p-1.5 text-gray-500 transition-colors hover:border-gray-600 hover:text-gray-200"
        title="Dismiss analytics summary"
        aria-label="Dismiss analytics summary"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default AnalyticsSummaryStrip;
