import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Bug, BarChart3, Crown, Sparkles, Layers, Layers2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { ComfyUIApiClient } from '../services/comfyUIApiClient';
import { detectGeneratorFromLaunchCommand } from '../utils/detectGeneratorLaunch';

type LibraryView = 'library' | 'smart' | 'model' | 'node' | 'collections';

interface HeaderProps {
    onOpenSettings: () => void;
    onOpenAnalytics: () => void;
    onOpenLicense: () => void;
    onGeneratorSetupNeeded?: () => void;
    libraryView?: LibraryView;
    onLibraryViewChange?: (view: LibraryView) => void;
}

const Header: React.FC<HeaderProps> = ({ 
    onOpenSettings, 
    onOpenAnalytics, 
    onOpenLicense, 
    onGeneratorSetupNeeded,
    libraryView,
    onLibraryViewChange
}) => {
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

  // Store hooks for View Controls
  const enableSafeMode = useSettingsStore((state) => state.enableSafeMode);
  const setEnableSafeMode = useSettingsStore((state) => state.setEnableSafeMode);
  const generatorLaunchCommand = useSettingsStore((state) => state.generatorLaunchCommand);
  const generatorLaunchWorkingDirectory = useSettingsStore((state) => state.generatorLaunchWorkingDirectory);
  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const a1111LastConnectionStatus = useSettingsStore((state) => state.a1111LastConnectionStatus);
  const setA1111ConnectionStatus = useSettingsStore((state) => state.setA1111ConnectionStatus);
  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const comfyUILastConnectionStatus = useSettingsStore((state) => state.comfyUILastConnectionStatus);
  const setComfyUIConnectionStatus = useSettingsStore((state) => state.setComfyUIConnectionStatus);
  const isStackingEnabled = useImageStore((state) => state.isStackingEnabled);
  const setStackingEnabled = useImageStore((state) => state.setStackingEnabled);
  const viewingStackPrompt = useImageStore((state) => state.viewingStackPrompt);
  const setViewingStackPrompt = useImageStore((state) => state.setViewingStackPrompt);
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const clustersCount = useImageStore((state) => state.clusters.length);
  const setSuccess = useImageStore((state) => state.setSuccess);
  const setError = useImageStore((state) => state.setError);

  // Store hooks for Smart Library Actions
  const directories = useImageStore((state) => state.directories);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const isClustering = useImageStore((state) => state.isClustering);
  const isAutoTagging = useImageStore((state) => state.isAutoTagging);
  const startClustering = useImageStore((state) => state.startClustering);
  const startAutoTagging = useImageStore((state) => state.startAutoTagging);

  const primaryPath = directories[0]?.path ?? '';
  const hasDirectories = directories.length > 0;
  const DEFAULT_SIMILARITY_THRESHOLD = 0.88;
  const hasLaunchCommand = generatorLaunchCommand.trim().length > 0;
  const detectedGenerator = useMemo(
    () => detectGeneratorFromLaunchCommand(generatorLaunchCommand),
    [generatorLaunchCommand]
  );
  const [isLaunchingGenerator, setIsLaunchingGenerator] = useState(false);
  const launchPollingDeadlineRef = useRef<number | null>(null);
  const relevantServerUrl =
    detectedGenerator.runtimeFamily === 'comfyui'
      ? comfyUIServerUrl
      : detectedGenerator.runtimeFamily === 'a1111'
      ? a1111ServerUrl
      : '';
  const hasRelevantServerUrl = relevantServerUrl.trim().length > 0;
  const relevantConnectionStatus =
    detectedGenerator.runtimeFamily === 'comfyui'
      ? comfyUILastConnectionStatus
      : detectedGenerator.runtimeFamily === 'a1111'
      ? a1111LastConnectionStatus
      : 'unknown';

  const handleGenerateClusters = () => {
    if (!primaryPath) return;
    startClustering(primaryPath, scanSubfolders, DEFAULT_SIMILARITY_THRESHOLD);
  };

  const handleGenerateAutoTags = () => {
    if (!primaryPath) return;
    startAutoTagging(primaryPath, scanSubfolders);
  };

  const checkGeneratorStatus = useCallback(async () => {
    if (!hasRelevantServerUrl || detectedGenerator.runtimeFamily === 'none') {
      return false;
    }

    const timeout = isLaunchingGenerator ? 2500 : 1500;
    const result =
      detectedGenerator.runtimeFamily === 'comfyui'
        ? await new ComfyUIApiClient({
            serverUrl: comfyUIServerUrl,
            timeout,
          }).testConnection()
        : await new A1111ApiClient({
            serverUrl: a1111ServerUrl,
            timeout,
          }).testConnection();

    if (detectedGenerator.runtimeFamily === 'comfyui') {
      setComfyUIConnectionStatus(result.success ? 'connected' : 'error');
    } else {
      setA1111ConnectionStatus(result.success ? 'connected' : 'error');
    }

    return result.success;
  }, [
    a1111ServerUrl,
    comfyUIServerUrl,
    detectedGenerator.runtimeFamily,
    hasRelevantServerUrl,
    isLaunchingGenerator,
    setA1111ConnectionStatus,
    setComfyUIConnectionStatus,
  ]);

  const handleLaunchGenerator = async () => {
    if (!window.electronAPI?.launchGenerator) {
      setError('Launch Generator is only available in the desktop app.');
      return;
    }

    if (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) {
      const openResult = await (window.electronAPI.openExternalUrl
        ? window.electronAPI.openExternalUrl(relevantServerUrl)
        : Promise.resolve({ success: false, error: 'Cannot open the generator from this environment.' }));
      if (!openResult.success) {
        setError(openResult.error || `Failed to open ${detectedGenerator.displayName}.`);
      }
      return;
    }

    if (!hasLaunchCommand) {
      onGeneratorSetupNeeded?.();
      return;
    }

    const shouldTrackStartup = detectedGenerator.runtimeFamily !== 'none' && hasRelevantServerUrl;
    if (shouldTrackStartup) {
      setIsLaunchingGenerator(true);
      launchPollingDeadlineRef.current = Date.now() + 30000;
      if (detectedGenerator.runtimeFamily === 'comfyui') {
        setComfyUIConnectionStatus('unknown');
      } else {
        setA1111ConnectionStatus('unknown');
      }
    }

    const result = await window.electronAPI.launchGenerator({
      command: generatorLaunchCommand,
      workingDirectory: generatorLaunchWorkingDirectory,
    });
    if (result.success) {
      setSuccess(
        shouldTrackStartup
          ? `${detectedGenerator.displayName} launch command started. Checking status...`
          : `${detectedGenerator.displayName} launch command started.`
      );
      if (!shouldTrackStartup) {
        setIsLaunchingGenerator(false);
        launchPollingDeadlineRef.current = null;
      }
      return;
    }

    setIsLaunchingGenerator(false);
    setError(result.error || 'Failed to launch generator.');
  };

  useEffect(() => {
    let cancelled = false;

    const runStatusCheck = async () => {
      try {
        const isConnected = await checkGeneratorStatus();
        if (cancelled) {
          return;
        }

        if (isConnected && isLaunchingGenerator) {
          setIsLaunchingGenerator(false);
          launchPollingDeadlineRef.current = null;
          setSuccess(`${detectedGenerator.displayName} is running.`);
          return;
        }

        if (
          isLaunchingGenerator &&
          launchPollingDeadlineRef.current &&
          Date.now() >= launchPollingDeadlineRef.current
        ) {
          setIsLaunchingGenerator(false);
          launchPollingDeadlineRef.current = null;
        }
      } catch {
        if (
          !cancelled &&
          isLaunchingGenerator &&
          launchPollingDeadlineRef.current &&
          Date.now() >= launchPollingDeadlineRef.current
        ) {
          setIsLaunchingGenerator(false);
          launchPollingDeadlineRef.current = null;
        }
      }
    };

    void runStatusCheck();
    const intervalId = window.setInterval(runStatusCheck, isLaunchingGenerator ? 2000 : 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [checkGeneratorStatus, detectedGenerator.displayName, hasRelevantServerUrl, isLaunchingGenerator, setSuccess]);

  const generatorButtonLabel = useMemo(() => {
    if (isLaunchingGenerator) {
      return detectedGenerator.id === 'unknown'
        ? 'Starting...'
        : `Starting ${detectedGenerator.displayName}...`;
    }

    if (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) {
      return detectedGenerator.id === 'unknown'
        ? 'Open Generator'
        : `Open ${detectedGenerator.displayName}`;
    }

    return detectedGenerator.id === 'unknown'
      ? 'Launch Generator'
      : `Launch ${detectedGenerator.displayName}`;
  }, [detectedGenerator.displayName, detectedGenerator.id, hasRelevantServerUrl, isLaunchingGenerator, relevantConnectionStatus]);

  const generatorButtonClassName = useMemo(() => {
    if (isLaunchingGenerator) {
      return 'border-accent/40 bg-accent/15 text-accent cursor-wait hover:border-accent/40 hover:bg-accent/20 hover:text-accent';
    }

    if (
      (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) ||
      hasLaunchCommand
    ) {
      return 'border-accent/60 bg-accent text-white hover:border-accent/60 hover:bg-accent/90 hover:text-white';
    }

    return 'text-gray-200';
  }, [hasLaunchCommand, hasRelevantServerUrl, isLaunchingGenerator, relevantConnectionStatus]);

  const generatorButtonTitle = useMemo(() => {
    if (isLaunchingGenerator) {
      return detectedGenerator.id === 'unknown'
        ? 'Waiting for the generator to come online'
        : `Waiting for ${detectedGenerator.displayName} to come online`;
    }

    if (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) {
      return detectedGenerator.id === 'unknown'
        ? 'Open the generator in your browser'
        : `Open ${detectedGenerator.displayName} in your browser`;
    }

    if (hasLaunchCommand) {
      return 'Run the saved generator launch command';
    }

    return 'Add a launch command in Settings > Integrations';
  }, [detectedGenerator.displayName, detectedGenerator.id, hasLaunchCommand, hasRelevantServerUrl, isLaunchingGenerator, relevantConnectionStatus]);

  const statusConfig = (() => {
    if (!initialized) {
      return {
        label: 'Checking license',
        classes: 'text-gray-300',
      };
    }
    if (isPro) {
      return {
        label: 'Pro',
        classes: 'text-gray-100',
      };
    }
    if (isTrialActive) {
      const daysLabel = `${trialDaysRemaining} ${trialDaysRemaining === 1 ? 'day' : 'days'} left`;
      return {
        label: `Trial • ${daysLabel}`,
        classes: 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:border-amber-400/50 hover:bg-amber-500/20 hover:text-amber-100',
      };
    }
    if (isExpired) {
      return {
        label: 'Trial expired',
        classes: 'border-amber-600/30 bg-amber-500/10 text-amber-200 hover:border-amber-500/40 hover:bg-amber-500/15 hover:text-amber-100',
      };
    }
    return {
      label: 'Free',
      classes: 'border-amber-700/30 bg-amber-500/10 text-amber-200 hover:border-amber-600/40 hover:bg-amber-500/15 hover:text-amber-100',
    };
  })();

  const analyticsBadgeClass = canUseAnalytics ? 'text-gray-500' : 'text-amber-400';
  const viewTabs = useMemo(
    () => [
      { id: 'library' as const, label: 'Library' },
      { id: 'smart' as const, label: 'Smart Library', count: clustersCount > 0 ? clustersCount : null },
      { id: 'model' as const, label: 'Model View' },
      { id: 'node' as const, label: 'Node View' },
      { id: 'collections' as const, label: 'Collections' },
    ],
    [clustersCount]
  );
  const utilityButtonClassName = 'app-top-icon-button';

  return (
    <header className="sticky top-0 z-50 border-b border-gray-800/70 bg-gray-900/85 px-4 py-2.5 backdrop-blur-md shadow-lg shadow-black/20 transition-all duration-300">
      <div className="container mx-auto flex items-center gap-4">
        <div className="shrink-0">
          <button
            onClick={onOpenLicense}
            className={`app-top-pill text-[10px] uppercase tracking-[0.18em] ${statusConfig.classes}`}
            title={isFree ? 'Start trial or activate license' : 'Manage license and status'}
          >
            <Crown className="h-3 w-3" />
            <span>{statusConfig.label}</span>
          </button>
        </div>

        <div className="flex min-w-0 flex-1 justify-center">
        {libraryView && onLibraryViewChange && (
          <div className="app-top-segmented max-w-full">
            {viewTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onLibraryViewChange(tab.id)}
                className={`app-top-segment whitespace-nowrap ${libraryView === tab.id ? 'app-top-segment-active' : ''}`}
              >
                <span>{tab.label}</span>
                {tab.count ? (
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                    libraryView === tab.id
                      ? 'border-white/20 bg-black/20 text-white/90'
                      : 'border-gray-700/80 bg-gray-950/80 text-gray-500'
                  }`}>
                    {tab.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {(libraryView === 'library' || libraryView === 'node') && (
            <>
              <button
                onClick={() => setStackingEnabled(!isStackingEnabled)}
                className={`${utilityButtonClassName} ${isStackingEnabled ? 'border-accent/40 bg-accent/15 text-accent hover:border-accent/50 hover:bg-accent/20 hover:text-accent' : ''}`}
                title={isStackingEnabled ? 'Disable stacking' : 'Stack items by identical prompt'}
              >
                {isStackingEnabled ? <Layers2 size={16} /> : <Layers size={16} />}
              </button>

              {viewingStackPrompt && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStackingEnabled(true);
                    setViewingStackPrompt(null);
                  }}
                  className="app-top-pill px-2.5 text-gray-300"
                  title="Return to the stacked results"
                >
                  <ArrowLeft size={12} />
                  <span>Back</span>
                </button>
              )}
            </>
          )}

          {libraryView === 'smart' && (
            <div className="app-top-segmented animate-in fade-in duration-300">
              <button
                onClick={handleGenerateClusters}
                disabled={!hasDirectories || isClustering}
                className={`app-top-segment ${isClustering ? 'text-accent cursor-wait hover:text-accent' : ''} ${!hasDirectories ? 'cursor-not-allowed opacity-50' : ''}`}
                title="Generate clusters"
              >
                <Layers size={14} className={isClustering ? 'animate-pulse' : ''} />
                <span>Cluster</span>
              </button>
              <button
                onClick={handleGenerateAutoTags}
                disabled={!hasDirectories || isAutoTagging}
                className={`app-top-segment ${isAutoTagging ? 'text-accent cursor-wait hover:text-accent' : ''} ${!hasDirectories ? 'cursor-not-allowed opacity-50' : ''}`}
                title="Generate auto-tags"
              >
                <Sparkles size={14} className={isAutoTagging ? 'animate-pulse' : ''} />
                <span>Auto-Tag</span>
              </button>
            </div>
          )}

          <span className="app-top-divider" />

          <button
            onClick={handleLaunchGenerator}
            disabled={isLaunchingGenerator}
            className={`app-top-pill h-10 px-4 text-sm font-semibold shadow-sm ${generatorButtonClassName}`}
            title={generatorButtonTitle}
          >
            <Sparkles size={14} className={isLaunchingGenerator ? 'animate-pulse' : ''} />
            {generatorButtonLabel}
          </button>

          {!isPro && (
            <a
              href="https://imagemetahub.com/getpro"
              target="_blank"
              rel="noopener noreferrer"
              className="app-top-pill hidden border-amber-700/30 bg-amber-500/10 text-[10px] uppercase tracking-[0.18em] text-amber-200 hover:border-amber-600/40 hover:bg-amber-500/15 hover:text-amber-100 lg:inline-flex"
            >
              Get Pro
            </a>
          )}

          <div className="app-top-segmented">
            <button
              onClick={() => setEnableSafeMode(!enableSafeMode)}
              className={`${utilityButtonClassName} h-8 w-8 border-transparent bg-transparent ${enableSafeMode ? 'border-accent/40 bg-accent/15 text-accent hover:border-accent/50 hover:bg-accent/20 hover:text-accent' : 'text-gray-500 hover:text-gray-200'}`}
              title={enableSafeMode ? 'Safe Mode on' : 'Safe Mode off'}
            >
              {enableSafeMode ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <a
              href="https://github.com/LuqP2/Image-MetaHub/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              className={`${utilityButtonClassName} h-8 w-8 border-transparent bg-transparent`}
              title="Report a bug or provide feedback"
            >
              <Bug size={16} />
            </a>
            <button
              onClick={() => {
                if (canUseAnalytics) {
                  onOpenAnalytics();
                } else {
                  showProModal('analytics');
                }
              }}
              className={`${utilityButtonClassName} relative h-8 w-8 border-transparent bg-transparent`}
              title={canUseAnalytics ? 'Analytics (Pro)' : 'Analytics (Pro Feature) - start trial'}
            >
              <BarChart3 size={16} />
              <div className="absolute -right-0.5 -top-0.5">
                <Crown className={`w-2.5 h-2.5 ${analyticsBadgeClass}`} />
              </div>
            </button>
            <button
              onClick={onOpenSettings}
              className={`${utilityButtonClassName} h-8 w-8 border-transparent bg-transparent`}
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
