import { useTranslation } from '../i18n/useTranslation';
import React from 'react';
import { Crown, Sparkles, TrendingUp } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { TRIAL_DURATION_DAYS } from '../store/useLicenseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildProLicenseUrl } from '../utils/creatorAttribution';

interface ClusterUpgradeBannerProps {
  processedCount: number;
  remainingCount: number;
  clusterCount: number;
}

const ClusterUpgradeBanner: React.FC<ClusterUpgradeBannerProps> = ({
  processedCount,
  remainingCount,
  clusterCount,
}) => {
  const { t } = useTranslation();
  const { showProModal, canStartTrial } = useFeatureAccess();
  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const proLicenseUrl = buildProLicenseUrl(creatorAttributionToken, 'banner');

  return (
    <div className="mt-6 bg-gradient-to-r from-purple-900/30 to-blue-900/30 border border-purple-500/30 rounded-lg p-4">
      <div className="flex items-start gap-4">
        <div className="p-2 bg-purple-600/20 rounded-lg flex-shrink-0">
          <Sparkles className="w-6 h-6 text-purple-400" />
        </div>

        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            {t('licensing.clusterFound', { groups: clusterCount.toLocaleString(), images: processedCount.toLocaleString() })}
          </h3>

          <p className="text-gray-300 mb-3">
            {t('licensing.clusterRemaining', { count: remainingCount.toLocaleString() })}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => showProModal('clustering')}
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              <Crown className="w-4 h-4" />
              {t('licensing.unlockClustering')}</button>

            <a
              href={proLicenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold py-2 px-4 rounded-lg transition-colors border border-gray-700"
            >
              {t('licensing.learnMore')}
            </a>
          </div>

          {canStartTrial && (
            <p className="text-xs text-gray-400 mt-2">
              {t('licensing.clusterTrial', { days: TRIAL_DURATION_DAYS })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClusterUpgradeBanner;
