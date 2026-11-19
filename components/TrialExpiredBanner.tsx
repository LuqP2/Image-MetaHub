import { useTranslation } from '../i18n/useTranslation';
import React from 'react';
import { Crown, X } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildProCheckoutUrl } from '../utils/creatorAttribution';

/**
 * Shown once to users whose Pro trial ended, until they dismiss it. Deliberately plain:
 * no countdown, no discount, no second chance to postpone — one CTA and one close button.
 */
const TrialExpiredBanner: React.FC = () => {
  const { t } = useTranslation();
  const { showTrialExpiredNotice, dismissTrialExpiredNotice } = useFeatureAccess();
  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const lifetimeCheckoutUrl = buildProCheckoutUrl('lifetime', creatorAttributionToken, 'trial_expired');
  const annualCheckoutUrl = buildProCheckoutUrl('annual', creatorAttributionToken, 'trial_expired');
  const monthlyCheckoutUrl = buildProCheckoutUrl('monthly', creatorAttributionToken, 'trial_expired');

  if (!showTrialExpiredNotice) return null;

  return (
    <div
      role="region"
      aria-label={t('licensing.endedRegion')}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-700/30 bg-amber-500/10 px-4 py-2.5 text-amber-100"
    >
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{t('licensing.endedTitle')}</span>{' '}
        <span className="text-amber-100/80">
          {t('licensing.endedBody')}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right">
          <a
            href={lifetimeCheckoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
          >
            <Crown className="h-4 w-4" />
            {t('licensing.lifetimePurchase')}
          </a>
          <p className="mt-1 text-xs text-amber-100/60">
            {t('licensing.refund')}
          </p>
          <div className="mt-1.5 flex justify-end gap-2 text-xs">
            <a
              href={annualCheckoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-100/70 underline-offset-2 hover:text-amber-50 hover:underline"
            >
              {t('settings.license.annualPurchase')}
            </a>
            <a
              href={monthlyCheckoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-100/70 underline-offset-2 hover:text-amber-50 hover:underline"
            >
              {t('settings.license.monthlyPurchase')}
            </a>
          </div>
        </div>

        <button
          onClick={dismissTrialExpiredNotice}
          className="rounded p-1 text-amber-200/70 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
          title={t('licensing.dismiss')}
          aria-label={t('licensing.dismissEnded')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TrialExpiredBanner;
