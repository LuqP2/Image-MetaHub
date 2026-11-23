import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Bug, Crown, Sparkles, Eye, EyeOff } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { ComfyUIApiClient } from '../services/comfyUIApiClient';
import { detectGeneratorFromLaunchCommand } from '../utils/detectGeneratorLaunch';
import { ProPlanSelectorModal } from './ProPlanSelector';
import { clearInternalImageDragData, getInternalImageDragId, hasInternalImageDragType } from '../utils/internalImageDrag';
import type { ExploreDimension, LibraryView } from '../types';
import { TRIAL_EXTENSION_DAYS, useLicenseStore } from '../store/useLicenseStore';
import { useTranslation } from '../i18n/useTranslation';
import { formatMessage } from '../i18n/messages.mjs';
import BrandLogo from './BrandLogo';


interface HeaderProps {
    workspaceToolbarRef?: React.Ref<HTMLDivElement>;
    onOpenSettings: () => void;
    onOpenLicense: () => void;
    onOpenTrialExtension?: () => void;
    onGeneratorSetupNeeded?: () => void;
    libraryView?: LibraryView;
    onLibraryViewChange?: (view: LibraryView) => void;
    onNavigateExplore?: (dimension: ExploreDimension) => void;
    onOpenDroppedImageInComfyUI?: (imageId: string) => void;
}

const Header: React.FC<HeaderProps> = ({
    workspaceToolbarRef,
    onOpenSettings,
    onOpenLicense,
    onOpenTrialExtension,
    onGeneratorSetupNeeded,
    libraryView,
    onLibraryViewChange,
    onNavigateExplore,
    onOpenDroppedImageInComfyUI,
}) => {
  const { t } = useTranslation();
  const {
    canUseComfyUI,
    canUseImageEditor,
    canUseModelManager,
    showProModal,
    isTrialActive,
    trialDaysRemaining,
    isPro,
    initialized,
    isExpired,
    isFree,
    canStartTrial,
    canExtendTrial,
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
  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const licensePlan = useLicenseStore((state) => state.licensePlan);
  const licenseExpiresAt = useLicenseStore((state) => state.licenseExpiresAt);
  const clustersCount = useImageStore((state) => state.clusters.length);
  const setSuccess = useImageStore((state) => state.setSuccess);
  const setError = useImageStore((state) => state.setError);

  const hasLaunchCommand = generatorLaunchCommand.trim().length > 0;
  const detectedGenerator = useMemo(
    () => detectGeneratorFromLaunchCommand(generatorLaunchCommand),
    [generatorLaunchCommand]
  );
  const [isLaunchingGenerator, setIsLaunchingGenerator] = useState(false);
  const [isComfyUIDragTarget, setIsComfyUIDragTarget] = useState(false);
  const [isPlanSelectorOpen, setIsPlanSelectorOpen] = useState(false);
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
      setError(t('shell.desktopOnly'));
      return;
    }

    if (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) {
      const openResult = await (window.electronAPI.openExternalUrl
        ? window.electronAPI.openExternalUrl(relevantServerUrl)
        : Promise.resolve({ success: false, error: t('shell.cannotOpen') }));
      if (!openResult.success) {
        setError(openResult.error || t('shell.openFailed', { provider: detectedGenerator.displayName }));
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
          ? t('shell.launchStartedChecking', { provider: detectedGenerator.displayName })
          : t('shell.launchStarted', { provider: detectedGenerator.displayName })
      );
      if (!shouldTrackStartup) {
        setIsLaunchingGenerator(false);
        launchPollingDeadlineRef.current = null;
      }
      return;
    }

    setIsLaunchingGenerator(false);
    setError(result.error || t('shell.launchFailed'));
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
          setSuccess(formatMessage(useSettingsStore.getState().language, 'shell.running', { provider: detectedGenerator.displayName }));
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
        ? t('shell.starting')
        : t('shell.startingProvider', { provider: detectedGenerator.displayName });
    }

    if (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) {
      return detectedGenerator.id === 'unknown'
        ? t('shell.openGenerator')
        : t('shell.openProvider', { provider: detectedGenerator.displayName });
    }

    return detectedGenerator.id === 'unknown'
      ? t('shell.launchGenerator')
      : t('shell.launchProvider', { provider: detectedGenerator.displayName });
  }, [detectedGenerator.displayName, detectedGenerator.id, hasRelevantServerUrl, isLaunchingGenerator, relevantConnectionStatus, t]);

  const generatorButtonClassName = useMemo(() => {
    if (isLaunchingGenerator) {
      return 'border-accent/45 bg-accent/15 text-accent cursor-wait hover:border-accent/45 hover:bg-accent/20 hover:text-accent';
    }

    if (
      (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) ||
      hasLaunchCommand
    ) {
      return 'border-accent/45 bg-accent/12 text-accent hover:border-accent/55 hover:bg-accent/18 hover:text-accent';
    }

    return 'text-gray-200';
  }, [hasLaunchCommand, hasRelevantServerUrl, isLaunchingGenerator, relevantConnectionStatus]);

  const generatorButtonTitle = useMemo(() => {
    if (isLaunchingGenerator) {
      return detectedGenerator.id === 'unknown'
        ? t('shell.waitingGenerator')
        : t('shell.waitingProvider', { provider: detectedGenerator.displayName });
    }

    if (relevantConnectionStatus === 'connected' && hasRelevantServerUrl) {
      return detectedGenerator.id === 'unknown'
        ? t('shell.openGeneratorHelp')
        : t('shell.openProviderHelp', { provider: detectedGenerator.displayName });
    }

    if (hasLaunchCommand) {
      return t('shell.runCommand');
    }

    return t('shell.addCommand');
  }, [detectedGenerator.displayName, detectedGenerator.id, hasLaunchCommand, hasRelevantServerUrl, isLaunchingGenerator, relevantConnectionStatus, t]);

  const statusConfig = (() => {
    if (!initialized) {
      return {
        label: t('shell.checkingLicense'),
        classes: 'text-gray-300',
      };
    }
    if (isTrialActive) {
      return {
        label: t('shell.trial', { days: trialDaysRemaining }),
        classes: 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:border-amber-400/50 hover:bg-amber-500/20 hover:text-amber-100',
      };
    }
    if (isExpired) {
      return {
        label: t('settings.license.trialExpired'),
        classes: 'border-amber-600/30 bg-amber-500/10 text-amber-200 hover:border-amber-500/40 hover:bg-amber-500/15 hover:text-amber-100',
      };
    }
    return {
      label: t('settings.license.free'),
      classes: 'border-amber-700/30 bg-amber-500/10 text-amber-200 hover:border-amber-600/40 hover:bg-amber-500/15 hover:text-amber-100',
    };
  })();

  const expiry = licenseExpiresAt ? Date.parse(licenseExpiresAt) : NaN;
  const licenseValidity = licensePlan === 'lifetime'
    ? t('settings.license.noExpiration')
    : (licensePlan === 'monthly' || licensePlan === 'annual') && Number.isFinite(expiry)
      ? t('settings.license.validThrough', { date: expiry })
      : null;
  const connectionStatus = comfyUILastConnectionStatus === 'connected'
    ? t('settings.integrations.connected')
    : comfyUILastConnectionStatus === 'error' ? t('shell.errorStatus') : t('libraryGallery.unknown');

  const classicMode = useSettingsStore((state) => state.classicMode);
  const viewTabs = useMemo(
    () => [
      { id: 'library' as const, label: t('settings.library.library') },
      { id: 'prompts' as const, label: t('metadataEditor.prompts') },
      { id: 'models' as const, label: t('libraryGallery.models') },
      ...(window.electronAPI ? [{ id: 'canvas' as const, label: t('comparison.canvas') }] : []),
      { id: 'editor' as const, label: t('shell.editor') },
      { id: 'comfyui' as const, label: 'ComfyUI' },
    ],
    [t]
  );
  // Classic mode: legacy labels as pure deep-links into Explore (no separate surfaces).
  const classicTabs = useMemo(
    () => (classicMode
      ? [
          { key: 'smart', label: t('shell.smartLibrary'), count: clustersCount > 0 ? clustersCount : null, run: () => onNavigateExplore?.('clusters') },
          { key: 'model', label: t('shell.modelView'), count: null, run: () => onNavigateExplore?.('models') },
          { key: 'collections', label: t('libraryGallery.collections'), count: null, run: () => onLibraryViewChange?.('collections') },
          { key: 'node', label: t('shell.nodeView'), count: null, run: () => onLibraryViewChange?.('library') },
        ]
      : []),
    [classicMode, clustersCount, onLibraryViewChange, onNavigateExplore, t]
  );
  const utilityButtonClassName = 'app-top-icon-button';
  const handleViewTabClick = useCallback((view: LibraryView) => {
    if (view === 'models' && !canUseModelManager) {
      showProModal('model_manager');
      return;
    }
    if (view === 'comfyui' && !canUseComfyUI) {
      showProModal('comfyui');
      return;
    }
    if (view === 'editor' && !canUseImageEditor) {
      showProModal('image_editor');
      return;
    }

    onLibraryViewChange?.(view);
  }, [canUseComfyUI, canUseImageEditor, canUseModelManager, onLibraryViewChange, showProModal]);

  return (
    <>
    <header className="sticky top-0 z-50 border-b border-gray-800/70 bg-gray-900/85 px-3 backdrop-blur-md shadow-lg shadow-black/20 transition-all duration-300">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 py-1.5 pr-2">
            <BrandLogo variant="header" />
            <div className="hidden xl:flex flex-col">
              <span className="text-sm font-semibold text-gray-100">
                {isPro ? 'Image MetaHub Pro' : isTrialActive ? t('shell.trialBrand') : 'Image MetaHub'}
              </span>
              <span className="text-[10px] text-gray-500">v0.23.1</span>
            </div>
          </div>
          {!isPro && !isTrialActive && (
            <button
              onClick={onOpenLicense}
              className={`app-top-pill shrink-0 text-[10px] uppercase tracking-[0.18em] ${statusConfig.classes}`}
              title={isFree
                ? (canStartTrial ? t('shell.startTrial') : t('settings.license.activateLicense'))
                : licenseValidity ?? t('shell.manageLicense')}
            >
              <Crown className="h-3 w-3" />
              <span>{statusConfig.label}</span>
            </button>
          )}

          {libraryView && onLibraryViewChange && (
            <div className="min-w-0 max-w-full overflow-x-auto scrollbar-thin">
              <nav aria-label={t('shell.workspaces')} className="flex w-max items-center gap-1">
                {viewTabs.map((tab) => {
                  const isComfyUITab = tab.id === 'comfyui';
                  return (
                    <button
                      key={tab.id}
                      aria-current={(tab.id === 'library' ? (libraryView === 'library' || libraryView === 'explore') : libraryView === tab.id) ? 'page' : undefined}
                      onClick={() => handleViewTabClick(tab.id)}
                      onDragEnter={isComfyUITab ? (event) => {
                        if (hasInternalImageDragType(event.dataTransfer)) {
                          event.preventDefault();
                          setIsComfyUIDragTarget(true);
                        }
                      } : undefined}
                      onDragOver={isComfyUITab ? (event) => {
                        if (hasInternalImageDragType(event.dataTransfer)) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'copy';
                        }
                      } : undefined}
                      onDragLeave={isComfyUITab ? (event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setIsComfyUIDragTarget(false);
                        }
                      } : undefined}
                      onDrop={isComfyUITab ? (event) => {
                        event.preventDefault();
                        setIsComfyUIDragTarget(false);
                        const imageId = getInternalImageDragId(event.dataTransfer);
                        if (!imageId) {
                          clearInternalImageDragData();
                          return;
                        }
                        if (!canUseComfyUI) {
                          showProModal('comfyui');
                          clearInternalImageDragData();
                          return;
                        }
                        onOpenDroppedImageInComfyUI?.(imageId);
                        clearInternalImageDragData();
                      } : undefined}
                      className={`app-workspace-tab ${
                        isComfyUITab && isComfyUIDragTarget
                          ? 'ring-2 ring-accent bg-accent/20 text-accent'
                          : ''
                      }`}
                      title={isComfyUITab ? t('shell.comfyDrop') : undefined}
                    >
                      <span>{tab.label}</span>
                      {isComfyUITab && libraryView === 'comfyui' && (
                        <span
                          role="status"
                          aria-label={t('shell.connection', { status: connectionStatus })}
                          title={t('shell.connection', { status: connectionStatus })}
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${comfyUILastConnectionStatus === 'connected' ? 'bg-green-400' : comfyUILastConnectionStatus === 'error' ? 'bg-red-400' : 'bg-gray-500'}`}
                        />
                      )}
                    </button>
                  );
                })}
                {classicTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={tab.run}
                    className="app-workspace-tab"
                    title={t('shell.opensExplore', { label: tab.label })}
                  >
                    <span>{tab.label}</span>
                    {tab.count ? (
                      <span className="rounded-full border border-gray-700/80 bg-gray-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </nav>
            </div>
          )}



        </div>

        <div className="flex shrink-0 items-center gap-2 py-1.5">
          {libraryView === 'comfyui' && <div ref={workspaceToolbarRef} className="flex items-center gap-1" />}
          <span className="app-top-divider" />

          <button
            onClick={handleLaunchGenerator}
            disabled={isLaunchingGenerator}
            className={`app-top-pill h-9 px-3 text-xs font-semibold shadow-sm ${generatorButtonClassName}`}
            title={generatorButtonTitle}
          >
            <Sparkles size={14} className={isLaunchingGenerator ? 'animate-pulse' : ''} />
            {generatorButtonLabel}
          </button>

          {!isPro && (
            <div className={`${canExtendTrial ? 'flex' : 'hidden lg:flex'} flex-col items-center gap-0.5`}>
              <button
                type="button"
                onClick={() => setIsPlanSelectorOpen(true)}
                className="app-top-pill h-9 border-amber-700/30 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 hover:border-amber-600/40 hover:bg-amber-500/15 hover:text-amber-100"
              >
                {t('shell.getPro')}
              </button>
              {canExtendTrial && onOpenTrialExtension && (
                <button type="button" onClick={onOpenTrialExtension} className="text-[11px] leading-tight text-accent hover:underline">
                  {t('shell.extendTrial', { days: TRIAL_EXTENSION_DAYS })}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={() => setEnableSafeMode(!enableSafeMode)}
              className={`${utilityButtonClassName} h-8 w-8 border-transparent bg-transparent ${enableSafeMode ? 'border-accent/40 bg-accent/15 text-accent hover:border-accent/50 hover:bg-accent/20 hover:text-accent' : 'text-gray-500 hover:text-gray-200'}`}
              title={enableSafeMode ? t('shell.safeOn') : t('shell.safeOff')} aria-label={enableSafeMode ? t('shell.safeOn') : t('shell.safeOff')}
            >
              {enableSafeMode ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <a
              href="https://github.com/LuqP2/Image-MetaHub/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              className={`${utilityButtonClassName} h-8 w-8 border-transparent bg-transparent`}
              title={t('shell.feedback')} aria-label={t('shell.feedback')}
            >
              <Bug size={16} />
            </a>
            <button
              onClick={onOpenSettings}
              className={`${utilityButtonClassName} h-8 w-8 border-transparent bg-transparent`}
              title={t('shell.openSettings')} aria-label={t('shell.openSettings')}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>
    </header>
    <ProPlanSelectorModal
      isOpen={isPlanSelectorOpen}
      onClose={() => setIsPlanSelectorOpen(false)}
      token={creatorAttributionToken}
      ctx="menu"
    />
    </>
  );
};

export default Header;
