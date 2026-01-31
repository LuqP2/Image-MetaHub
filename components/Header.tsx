import React, { useState } from 'react';
import { Settings, Bug, BarChart3, Crown, Sparkles, ChevronDown, Layers, Layers2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';

interface HeaderProps {
    onOpenSettings: () => void;
    onOpenAnalytics: () => void;
    onOpenLicense: () => void;
    onOpenA1111Generate?: () => void;
    onOpenComfyUIGenerate?: () => void;
    libraryView?: 'library' | 'smart';
    onLibraryViewChange?: (view: 'library' | 'smart') => void;
}

const Header: React.FC<HeaderProps> = ({ 
    onOpenSettings, 
    onOpenAnalytics, 
    onOpenLicense, 
    onOpenA1111Generate, 
    onOpenComfyUIGenerate,
    libraryView,
    onLibraryViewChange
}) => {
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

  // Store hooks for View Controls
  const enableSafeMode = useSettingsStore((state) => state.enableSafeMode);
  const setEnableSafeMode = useSettingsStore((state) => state.setEnableSafeMode);
  const isStackingEnabled = useImageStore((state) => state.isStackingEnabled);
  const setStackingEnabled = useImageStore((state) => state.setStackingEnabled);
  const viewingStackPrompt = useImageStore((state) => state.viewingStackPrompt);
  const setViewingStackPrompt = useImageStore((state) => state.setViewingStackPrompt);
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const clustersCount = useImageStore((state) => state.clusters.length);

  // Store hooks for Smart Library Actions
  const directories = useImageStore((state) => state.directories);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const isClustering = useImageStore((state) => state.isClustering);
  const isAutoTagging = useImageStore((state) => state.isAutoTagging);
  const startClustering = useImageStore((state) => state.startClustering);
  const startAutoTagging = useImageStore((state) => state.startAutoTagging);

  const [isGenerateDropdownOpen, setIsGenerateDropdownOpen] = useState(false);

  const primaryPath = directories[0]?.path ?? '';
  const hasDirectories = directories.length > 0;
  const DEFAULT_SIMILARITY_THRESHOLD = 0.88;

  const handleGenerateClusters = () => {
    if (!primaryPath) return;
    startClustering(primaryPath, scanSubfolders, DEFAULT_SIMILARITY_THRESHOLD);
  };

  const handleGenerateAutoTags = () => {
    if (!primaryPath) return;
    startAutoTagging(primaryPath, scanSubfolders);
  };

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
        classes: 'text-amber-400 bg-amber-900/30 border-amber-500/50',
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
    ? 'text-amber-400'
    : 'text-purple-400';

  return (
    <header className="bg-gray-900/80 backdrop-blur-md sticky top-0 z-50 px-4 py-2 border-b border-gray-800/60 shadow-lg transition-all duration-300">
      <div className="container mx-auto flex items-center justify-between gap-4">
        
        {/* Left Side - Status Indicator */}
        <div className="flex items-center gap-4">
            <button
              onClick={onOpenLicense}
              className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border transition-all duration-300 hover:scale-105 ${statusConfig.classes}`}
              title={isFree ? 'Start trial or activate license' : 'Manage license and status'}
            >
              <Crown className="w-3 h-3" />
              {statusConfig.label.replace('Status: ', '')}
            </button>
        </div>

        {/* Center Side - View Controls (Only visible if libraryView is provided) */}
        {libraryView && onLibraryViewChange && (
            <div className="flex items-center gap-3 absolute left-1/2 transform -translate-x-1/2">
                <div className="flex items-center bg-gray-800/50 rounded-full p-1 border border-gray-700/50">
                    <button
                        onClick={() => onLibraryViewChange('library')}
                        className={`px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200 ${
                            libraryView === 'library' 
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' 
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        Library
                    </button>
                    <button
                        onClick={() => onLibraryViewChange('smart')}
                        className={`px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200 flex items-center gap-1.5 ${
                            libraryView === 'smart' 
                            ? 'bg-purple-600 text-white shadow-md shadow-purple-900/20' 
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        Smart Library
                        {clustersCount > 0 && (
                            <span className="bg-black/20 px-1.5 rounded-full text-[10px]">{clustersCount}</span>
                        )}
                    </button>
                </div>

                 <div className="w-px h-4 bg-gray-700/50 mx-1"></div>

                 {/* Stacking Toggle */}
                  <button
                     onClick={() => setStackingEnabled(!isStackingEnabled)}
                     className={`p-1.5 rounded-lg transition-all duration-200 ${
                         isStackingEnabled 
                         ? 'text-blue-400 bg-blue-500/10' 
                         : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                     }`}
                     title={isStackingEnabled ? "Disable stacking" : "Stack items by identical prompt"}
                  >
                     {isStackingEnabled ? <Layers2 size={16} /> : <Layers size={16} />}
                  </button>

                  {/* Back from Stack Button */}
                  {viewingStackPrompt && (
                    <button
                        onClick={() => {
                        setSearchQuery('');
                        setStackingEnabled(true);
                        setViewingStackPrompt(null);
                        }}
                        className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 text-blue-400 rounded-md hover:bg-blue-500/20 transition-colors text-xs font-medium"
                    >
                        <ArrowLeft size={12} />
                        Back
                    </button>
                  )}

                  {/* Safe Mode Toggle */}
                  <button
                    onClick={() => setEnableSafeMode(!enableSafeMode)}
                    className={`p-1.5 rounded-lg transition-all duration-200 ${
                        enableSafeMode
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-600 hover:text-gray-400'
                    }`}
                    title={enableSafeMode ? 'Safe Mode on' : 'Safe Mode off'}
                  >
                    {enableSafeMode ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
            </div>
        )}

        {/* Right Side - Actions */}
        <div className="flex items-center gap-3">
          
          {/* Smart Library Actions (Contextual) */}
          {libraryView === 'smart' && (
             <div className="flex items-center gap-2 mr-2 animate-in fade-in duration-300">
                <button
                    onClick={handleGenerateClusters}
                    disabled={!hasDirectories || isClustering}
                    className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isClustering ? 'text-blue-400/50 cursor-wait' : 'text-blue-400 hover:bg-blue-500/10 hover:text-blue-300'
                    }`}
                    title="Generate Clusters"
                >
                    <Layers size={14} className={isClustering ? 'animate-pulse' : ''}/>
                    <span className="hidden xl:inline">Cluster</span>
                </button>
                <button
                    onClick={handleGenerateAutoTags}
                    disabled={!hasDirectories || isAutoTagging}
                    className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isAutoTagging ? 'text-purple-400/50 cursor-wait' : 'text-purple-400 hover:bg-purple-500/10 hover:text-purple-300'
                    }`}
                    title="Generate Auto-Tags"
                >
                    <Sparkles size={14} className={isAutoTagging ? 'animate-pulse' : ''}/>
                    <span className="hidden xl:inline">Auto-Tag</span>
                </button>
                 <div className="w-px h-5 bg-gray-700/50 mx-1"></div>
             </div>
          )}

          <a
            href="https://github.com/LuqP2/Image-MetaHub/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-1.5 rounded-lg transition-all duration-200 text-xs font-medium text-gray-400 hover:bg-white/5 hover:text-white flex items-center gap-2 group"
            title="Report a bug or provide feedback"
          >
            <Bug size={14} className="group-hover:text-red-400 transition-colors" />
            <span className="hidden sm:inline">Feedback</span>
          </a>
          
          <div className="w-px h-5 bg-gray-700/50 mx-1"></div>

          {/* Generate Dropdown - Solid Blue Theme */}
          <div className="relative">
            <button
              onClick={() => setIsGenerateDropdownOpen(!isGenerateDropdownOpen)}
              onBlur={() => setTimeout(() => setIsGenerateDropdownOpen(false), 200)}
              className="px-3 py-1.5 rounded-lg transition-all duration-300 text-xs font-bold text-white hover:bg-blue-500 bg-blue-600 shadow-md shadow-blue-900/20 border border-blue-500/50 group flex items-center gap-2"
              title={(canUseA1111 || canUseComfyUI) ? "Generate new image" : "Generate new image (Pro Feature)"}
            >
              <Sparkles size={14} className="text-white/90 group-hover:text-white transition-colors" />
              Generate
              {!canUseA1111 && !canUseComfyUI && initialized && (
                <Crown className="w-3 h-3 text-amber-300 absolute -top-1.5 -right-1.5 drop-shadow-md" />
              )}
              <ChevronDown size={14} className={`transition-transform duration-300 ${isGenerateDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isGenerateDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-xl shadow-2xl py-2 z-50 transform origin-top-right transition-all animate-in fade-in zoom-in-95 duration-200">
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
                  {!canUseA1111 && initialized && <Crown className="w-3 h-3 text-amber-400 opacity-70 group-hover:opacity-100" />}
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
                  {!canUseComfyUI && initialized && <Crown className="w-3 h-3 text-amber-400 opacity-70 group-hover:opacity-100" />}
                </button>
              </div>
            )}
          </div>
          
          {/* Discreet Get Pro link - Unified Amber Theme */}
          {!isPro && (
            <a
              href="https://lucasphere4660.gumroad.com/l/qmjima"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden lg:inline-flex text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:text-amber-300 transition-colors px-3 py-1.5 rounded-full bg-amber-900/20 border border-amber-600/30 hover:bg-amber-900/40 hover:border-amber-500/50"
            >
              Get Pro
            </a>
          )}
          
          <div className="flex items-center bg-gray-800/50 rounded-full p-0.5 border border-gray-700/50">
            <button
              onClick={() => {
                if (canUseAnalytics) {
                  onOpenAnalytics();
                } else {
                  showProModal('analytics');
                }
              }}
              className="p-1.5 rounded-full hover:bg-gray-700/80 text-gray-400 hover:text-white transition-all hover:shadow-lg relative group"
              title={canUseAnalytics ? 'Analytics (Pro)' : 'Analytics (Pro Feature) - start trial'}
            >
              <BarChart3 size={16} />
              <div className="absolute -top-0.5 -right-0.5 transition-transform group-hover:scale-110">
                <Crown className={`w-2.5 h-2.5 ${analyticsBadgeClass}`} />
              </div>
            </button>
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-full hover:bg-gray-700/80 text-gray-400 hover:text-white transition-all hover:rotate-45"
              title="Open Settings"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
