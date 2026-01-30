import React, { useState } from 'react';
import { Settings, Bug, BarChart3, Crown, Sparkles, ChevronDown } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';

interface HeaderProps {
  onOpenSettings: () => void;
  onOpenAnalytics: () => void;
  onOpenLicense: () => void;
  onOpenA1111Generate?: () => void;
  onOpenComfyUIGenerate?: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenSettings, onOpenAnalytics, onOpenLicense, onOpenA1111Generate, onOpenComfyUIGenerate }) => {
  const {
    canUseAnalytics,
    canUseA1111,
    canUseComfyUI,
    showProModal,
    isTrialActive,
    trialDaysRemaining,
    isPro,
    initialized,
    isExpired,
    isFree,
  } = useFeatureAccess();

  const [isGenerateDropdownOpen, setIsGenerateDropdownOpen] = useState(false);

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
    <header className="bg-gray-900/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 border-b border-gray-800/60 shadow-lg transition-all duration-300">
      <div className="container mx-auto flex items-center justify-between gap-6">
        <div className="flex items-center gap-4 group cursor-default">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <img src="logo1.png" alt="Image MetaHub" className="h-12 w-12 rounded-xl shadow-2xl relative z-10 transition-transform duration-300 group-hover:scale-105" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-tight text-white/90 group-hover:text-white transition-colors">Image MetaHub <span className="text-xs font-mono font-normal text-gray-500 ml-1">v0.12.2</span></h1>
            <button
              onClick={onOpenLicense}
              className={`mt-1 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border transition-all duration-300 hover:scale-105 ${statusConfig.classes}`}
              title={isFree ? 'Start trial or activate license' : 'Manage license and status'}
            >
              <Crown className="w-3 h-3" />
              {statusConfig.label.replace('Status: ', '')}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/LuqP2/Image-MetaHub/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium text-gray-400 hover:bg-white/5 hover:text-white flex items-center gap-2 group"
            title="Report a bug or provide feedback"
          >
            <Bug size={16} className="group-hover:text-red-400 transition-colors" />
            <span className="hidden sm:inline">Feedback</span>
          </a>
          
          <div className="w-px h-6 bg-gray-700/50 mx-1"></div>

          {/* Generate Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsGenerateDropdownOpen(!isGenerateDropdownOpen)}
              onBlur={() => setTimeout(() => setIsGenerateDropdownOpen(false), 200)}
              className="px-4 py-2 rounded-xl transition-all duration-300 text-sm font-medium text-gray-100 hover:text-white flex items-center gap-2 bg-gradient-to-r from-purple-600/80 to-blue-600/80 hover:from-purple-500 hover:to-blue-500 shadow-lg shadow-purple-900/20 hover:shadow-purple-700/30 border border-white/10 group"
              title={(canUseA1111 || canUseComfyUI) ? "Generate new image" : "Generate new image (Pro Feature)"}
            >
              <Sparkles size={16} className="text-purple-200 group-hover:text-white transition-colors" />
              Generate
              {!canUseA1111 && !canUseComfyUI && initialized && (
                <Crown className="w-3 h-3 text-yellow-300 absolute -top-1.5 -right-1.5 drop-shadow-md" />
              )}
              <ChevronDown size={14} className={`transition-transform duration-300 ${isGenerateDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isGenerateDropdownOpen && (
              <div className="absolute right-0 mt-3 w-56 bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-2xl py-2 z-50 transform origin-top-right transition-all animate-in fade-in zoom-in-95 duration-200">
                <button
                  onClick={() => {
                    setIsGenerateDropdownOpen(false);
                    if (canUseA1111) {
                      onOpenA1111Generate?.();
                    } else {
                      showProModal('a1111');
                    }
                  }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-between group"
                  title={!canUseA1111 && initialized ? 'Pro feature - start trial' : undefined}
                >
                  <span className="font-medium">with A1111 WebUI</span>
                  {!canUseA1111 && initialized && <Crown className="w-3 h-3 text-yellow-400 opacity-70 group-hover:opacity-100" />}
                </button>
                <button
                  onClick={() => {
                    setIsGenerateDropdownOpen(false);
                    if (canUseComfyUI) {
                      onOpenComfyUIGenerate?.();
                    } else {
                      showProModal('comfyui');
                    }
                  }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-between group"
                  title={!canUseComfyUI && initialized ? 'Pro feature - start trial' : undefined}
                >
                  <span className="font-medium">with ComfyUI</span>
                  {!canUseComfyUI && initialized && <Crown className="w-3 h-3 text-yellow-400 opacity-70 group-hover:opacity-100" />}
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-gray-700/50 mx-1"></div>
          
          {/* Discreet Get Pro link */}
          {!isPro && (
            <a
              href="https://lucasphere4660.gumroad.com/l/qmjima"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden lg:inline-flex text-xs font-semibold text-yellow-500 hover:text-yellow-300 transition-colors px-3 py-1.5 rounded-lg bg-yellow-900/10 border border-yellow-700/20 hover:bg-yellow-900/30 hover:border-yellow-500/50"
            >
              Get Pro
            </a>
          )}
          
          <div className="flex items-center bg-gray-800/50 rounded-full p-1 border border-gray-700/50">
            <button
              onClick={() => {
                if (canUseAnalytics) {
                  onOpenAnalytics();
                } else {
                  showProModal('analytics');
                }
              }}
              className="p-2 rounded-full hover:bg-gray-700/80 text-gray-400 hover:text-white transition-all hover:shadow-lg relative group"
              title={canUseAnalytics ? 'Analytics (Pro)' : 'Analytics (Pro Feature) - start trial'}
            >
              <BarChart3 size={18} />
              <div className="absolute -top-0.5 -right-0.5 transition-transform group-hover:scale-110">
                <Crown className={`w-2.5 h-2.5 ${analyticsBadgeClass}`} />
              </div>
            </button>
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-full hover:bg-gray-700/80 text-gray-400 hover:text-white transition-all hover:rotate-45"
              title="Open Settings"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
