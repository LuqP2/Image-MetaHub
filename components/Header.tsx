import React from 'react';
import { Settings, Bug, BarChart3, Crown } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';

interface HeaderProps {
  onOpenSettings: () => void;
  onOpenAnalytics: () => void;
  onOpenLicense: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenSettings, onOpenAnalytics, onOpenLicense }) => {
  const {
    canUseAnalytics,
    showProModal,
    isTrialActive,
    trialDaysRemaining,
    isPro,
    initialized,
    isExpired,
    isFree,
  } = useFeatureAccess();

  const statusConfig = (() => {
    if (!initialized) {
      return {
        label: 'Status: Checking license…',
        classes: 'text-gray-300 bg-gray-800/70 border-gray-700',
      };
    }
    if (isPro) {
      return {
        label: 'Status: Pro License',
        classes: 'text-green-300 bg-green-900/30 border-green-600/50',
      };
    }
    if (isTrialActive) {
      const daysLabel = `${trialDaysRemaining} ${trialDaysRemaining === 1 ? 'day' : 'days'} left`;
      return {
        label: `Status: Pro Trial (${daysLabel})`,
        classes: 'text-amber-200 bg-amber-900/30 border-amber-500/50',
      };
    }
    if (isExpired) {
      return {
        label: 'Status: Trial expired',
        classes: 'text-red-300 bg-red-900/30 border-red-600/50',
      };
    }
    return {
      label: 'Status: Free Version',
      classes: 'text-gray-300 bg-gray-800/60 border-gray-700',
    };
  })();

  const analyticsBadgeClass = isPro
    ? 'text-green-300'
    : isTrialActive
    ? 'text-amber-200'
    : 'text-purple-400';

  return (
    <header className="bg-gray-800/80 backdrop-blur-sm sticky top-0 z-10 p-4 shadow-md">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="logo1.png" alt="Image MetaHub" className="h-14 w-14 rounded-md" />
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-wider">Image MetaHub v0.12.0</h1>
            <button
              onClick={onOpenLicense}
              className={`mt-1 inline-flex items-center gap-2 text-xs font-semibold px-2 py-1 rounded-md border transition-colors ${statusConfig.classes}`}
              title={isFree ? 'Start trial or activate license' : 'Manage license and status'}
            >
              <Crown className="w-3 h-3" />
              {statusConfig.label}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/LuqP2/Image-MetaHub/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-2 rounded-lg transition-colors text-sm text-gray-400 hover:bg-gray-700 hover:text-gray-50 flex items-center gap-2"
            title="Report a bug or provide feedback"
          >
            <Bug size={16} />
            Feedback & Bugs
          </a>
          <div className="border-l border-gray-600 h-8 mx-2"></div>
          {/* Discreet Get Pro link */}
          {!isPro && (
            <a
              href="https://lucasphere4660.gumroad.com/l/qmjima"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-yellow-300 hover:text-yellow-200 underline px-2 py-1 rounded-md bg-yellow-900/20 border border-yellow-700/40"
            >
              Get Pro
            </a>
          )}
          <button
            onClick={() => {
              if (canUseAnalytics) {
                onOpenAnalytics();
              } else {
                showProModal('analytics');
              }
            }}
            className="p-2 rounded-full hover:bg-gray-700 transition-colors hover:shadow-lg hover:shadow-blue-400/30 relative"
            title={canUseAnalytics ? 'Analytics (Pro)' : 'Analytics (Pro Feature) - start trial'}
          >
            <BarChart3 size={20} />
            <div className="absolute -top-1 -right-1">
              <Crown className={`w-3 h-3 ${analyticsBadgeClass}`} />
            </div>
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-full hover:bg-gray-700 transition-colors hover:shadow-lg hover:shadow-accent/30"
            title="Open Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
