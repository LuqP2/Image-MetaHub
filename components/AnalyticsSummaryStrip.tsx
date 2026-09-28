import React, { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Layers } from 'lucide-react';
import type { IndexedImage } from '../types';
import { hasTelemetryData } from '../utils/analyticsUtils';
import DiscoveryBanner from './DiscoveryBanner';

interface AnalyticsSummaryStripProps {
  images: IndexedImage[];
  allImages: IndexedImage[];
  onOpenAnalytics: () => void;
}

const DISMISS_KEY = 'analytics-summary-strip-dismissed';

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
      if (hasTelemetryData(image)) {
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
    <DiscoveryBanner
      icon={BarChart3}
      title="Analytics Explorer"
      description={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{summary.totalImages.toLocaleString()} in scope</span>
          <span className="inline-flex items-center gap-1">
            <Layers size={11} />
            <span className="max-w-[11rem] truncate">{summary.dominantModel || 'N/A'}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={11} />
            {(summary.telemetryCoverage * 100).toFixed(0)}% with metrics
          </span>
        </span>
      }
      actionLabel="Open"
      onAction={onOpenAnalytics}
      onDismiss={() => {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(DISMISS_KEY, 'true');
        }
        setDismissed(true);
      }}
      dismissLabel="Dismiss analytics summary"
    />
  );
};

export default AnalyticsSummaryStrip;
