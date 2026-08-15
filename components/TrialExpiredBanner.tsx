import React from 'react';
import { Crown, X } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildProLicenseUrl } from '../utils/creatorAttribution';

/**
 * Shown once to users whose Pro trial ended, until they dismiss it. Deliberately plain:
 * no countdown, no discount, no second chance to postpone — one CTA and one close button.
 */
const TrialExpiredBanner: React.FC = () => {
  const { showTrialExpiredNotice, dismissTrialExpiredNotice } = useFeatureAccess();
  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const proLicenseUrl = buildProLicenseUrl(creatorAttributionToken, 'trial_expired');

  if (!showTrialExpiredNotice) return null;

  return (
    <div
      role="region"
      aria-label="Pro trial ended"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-700/30 bg-amber-500/10 px-4 py-2.5 text-amber-100"
    >
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Your Pro trial has ended.</span>{' '}
        <span className="text-amber-100/80">
          Compare View, the image editor, ComfyUI and Automatic1111 generation, Analytics, batch
          export, bulk tagging, file management and unlimited clustering are locked again. Your
          library, tags, favorites and metadata search keep working exactly as before.
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right">
          <a
            href={proLicenseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
          >
            <Crown className="h-4 w-4" />
            Get the lifetime license — $39
          </a>
          <p className="mt-1 text-xs text-amber-100/60">
            One-time, no subscription · 14-day refund, no questions asked
          </p>
        </div>

        <button
          onClick={dismissTrialExpiredNotice}
          className="rounded p-1 text-amber-200/70 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
          title="Dismiss"
          aria-label="Dismiss trial ended notice"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TrialExpiredBanner;
