import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Check,
  GitCompare,
  HelpCircle,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import type {
  CleanupImageDecision,
  CleanupStack,
  CleanupTechnicalFlag,
  CleanupWave,
  Directory,
  IndexedImage,
} from '../types';
import type { ImageGroup } from '../utils/imageGrouping';
import {
  analyzeCleanupSession,
  applyCleanupDecision,
  isCleanupStaticImage,
  promoteUnreviewedToMaybe,
} from '../services/cleanupAssistantEngine';
import {
  loadCleanupDecisions,
  loadCleanupSignatures,
  saveCleanupDecisions,
  saveCleanupSignatures,
} from '../services/cleanupAssistantStorage';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { useThumbnail } from '../hooks/useThumbnail';
import { useImageStore } from '../store/useImageStore';
import { transferIndexedImages } from '../services/fileTransferService';
import TransferImagesModal, { type TransferDestination } from './TransferImagesModal';
import { useFeatureAccess } from '../hooks/useFeatureAccess';

interface CleanupAssistantWorkspaceProps {
  sessionGroup: ImageGroup;
  images: IndexedImage[];
  directories: Directory[];
  onBack: () => void;
  onOpenCompare: (images: IndexedImage[]) => void;
}

type AnalysisState =
  | { status: 'idle' | 'loading'; message: string; current: number; total: number }
  | { status: 'ready'; message: string; current: number; total: number }
  | { status: 'error'; message: string; current: number; total: number };

const waveLabels: Record<CleanupWave, string> = {
  'obvious-rejects': 'Obvious rejects',
  'choose-winners': 'Choose winners',
  'review-maybe': 'Review maybe',
  quarantine: 'Quarantine',
};

const flagLabels: Record<CleanupTechnicalFlag, string> = {
  near_duplicate: 'near duplicate',
  too_dark: 'too dark',
  too_bright: 'too bright',
  low_variation_from_previous: 'low variation',
  very_small_file: 'very small file',
  session_dimension_outlier: 'dimension outlier',
  decode_failed: 'decode failed',
  preview_or_grid_candidate: 'preview/grid',
  intermediate_output_candidate: 'intermediate output',
  upscale_duplicate_candidate: 'upscale duplicate',
};

const decisionClasses: Record<CleanupImageDecision, string> = {
  unreviewed: 'border-gray-700 bg-gray-900/80 text-gray-300',
  keep: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100',
  reject: 'border-rose-500/50 bg-rose-500/15 text-rose-100',
  maybe: 'border-amber-500/50 bg-amber-500/15 text-amber-100',
};

const getSessionId = (group: ImageGroup) => group.id;

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getDecision = (decisions: Map<string, CleanupImageDecision>, imageId: string): CleanupImageDecision =>
  decisions.get(imageId) ?? 'unreviewed';

const CleanupImageCard: React.FC<{
  image: IndexedImage;
  selected: boolean;
  decision: CleanupImageDecision;
  flags: CleanupTechnicalFlag[];
  onToggle: () => void;
}> = ({ image, selected, decision, flags, onToggle }) => {
  useThumbnail(image);
  const thumbnail = useResolvedThumbnail(image);
  const thumbnailUrl = thumbnail?.thumbnailUrl || image.thumbnailUrl || '';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group relative overflow-hidden rounded-2xl border text-left transition-all ${
        selected
          ? 'border-cyan-300 bg-cyan-500/10 shadow-lg shadow-cyan-500/20'
          : 'border-gray-800 bg-gray-950/70 hover:border-gray-600 hover:bg-gray-900'
      }`}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-gray-800 via-gray-900 to-black">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-600">
            <Sparkles className="h-8 w-8" />
          </div>
        )}
        {selected && (
          <div className="absolute right-2 top-2 rounded-full bg-cyan-500 p-1 text-white shadow-lg">
            <Check className="h-4 w-4" />
          </div>
        )}
        <div className={`absolute left-2 top-2 rounded-full border px-2 py-1 text-[10px] font-semibold ${decisionClasses[decision]}`}>
          {decision}
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="truncate text-sm font-semibold text-gray-100" title={image.name}>
          {image.name}
        </div>
        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {flags.slice(0, 3).map((flag) => (
              <span key={flag} className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-100">
                {flagLabels[flag]}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
};

const getVisibleStacks = (
  stacks: CleanupStack[],
  wave: CleanupWave,
  decisions: Map<string, CleanupImageDecision>,
) => {
  if (wave === 'obvious-rejects') {
    return stacks.filter((stack) => stack.kind === 'likely-rejects');
  }
  if (wave === 'choose-winners') {
    return stacks.filter((stack) => stack.kind !== 'likely-rejects');
  }
  if (wave === 'review-maybe') {
    return stacks.filter((stack) => stack.imageIds.some((imageId) => getDecision(decisions, imageId) === 'maybe'));
  }
  return [];
};

const CleanupAssistantWorkspace: React.FC<CleanupAssistantWorkspaceProps> = ({
  sessionGroup,
  images,
  directories,
  onBack,
  onOpenCompare,
}) => {
  const sessionId = getSessionId(sessionGroup);
  const setSuccess = useImageStore((state) => state.setSuccess);
  const setError = useImageStore((state) => state.setError);
  const transferProgress = useImageStore((state) => state.transferProgress);
  const { canUseFileManagement, showProModal } = useFeatureAccess();

  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: 'idle',
    message: 'Preparing cleanup session...',
    current: 0,
    total: 0,
  });
  const [stacks, setStacks] = useState<CleanupStack[]>([]);
  const [flagsByImageId, setFlagsByImageId] = useState<Map<string, CleanupTechnicalFlag[]>>(new Map());
  const [decisions, setDecisions] = useState<Map<string, CleanupImageDecision>>(new Map());
  const [wave, setWave] = useState<CleanupWave>('obvious-rejects');
  const [stackIndex, setStackIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [gridSize, setGridSize] = useState<6 | 9 | 12>(9);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferStatusText, setTransferStatusText] = useState('');

  const staticImages = useMemo(() => images.filter(isCleanupStaticImage), [images]);
  const imageMap = useMemo(() => {
    const map = new Map<string, IndexedImage>();
    for (const image of staticImages) {
      map.set(image.id, image);
    }
    return map;
  }, [staticImages]);

  useEffect(() => {
    let cancelled = false;

    const runAnalysis = async () => {
      setAnalysisState({ status: 'loading', message: 'Loading cleanup session...', current: 0, total: staticImages.length });
      try {
        const [savedDecisions, cachedSignatures] = await Promise.all([
          loadCleanupDecisions(sessionId),
          loadCleanupSignatures(staticImages.map((image) => image.id)),
        ]);

        if (cancelled) {
          return;
        }

        setDecisions(savedDecisions);
        const result = await analyzeCleanupSession(staticImages, {
          cachedSignatures,
          onProgress: (progress) => {
            if (!cancelled) {
              setAnalysisState({ status: 'loading', ...progress });
            }
          },
        });

        if (cancelled) {
          return;
        }

        setStacks(result.stacks);
        setFlagsByImageId(result.flagsByImageId);
        setAnalysisState({
          status: 'ready',
          message: `Ready: ${result.stacks.length} review stack${result.stacks.length === 1 ? '' : 's'}`,
          current: result.staticImages.length,
          total: result.staticImages.length,
        });
        await saveCleanupSignatures(Array.from(result.signatures.values()));
      } catch (error) {
        if (!cancelled) {
          setAnalysisState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Failed to analyze cleanup session.',
            current: 0,
            total: staticImages.length,
          });
        }
      }
    };

    void runAnalysis();

    return () => {
      cancelled = true;
    };
  }, [sessionId, staticImages]);

  const visibleStacks = useMemo(
    () => getVisibleStacks(stacks, wave, decisions),
    [decisions, stacks, wave],
  );
  const activeStack = visibleStacks[stackIndex] ?? visibleStacks[0] ?? null;
  const activeImages = useMemo(
    () => (activeStack ? activeStack.imageIds.map((imageId) => imageMap.get(imageId)).filter((image): image is IndexedImage => Boolean(image)) : []),
    [activeStack, imageMap],
  );
  const displayedImages = activeImages;

  useEffect(() => {
    setStackIndex(0);
    setSelectedIds(new Set());
  }, [wave]);

  useEffect(() => {
    if (stackIndex >= visibleStacks.length) {
      setStackIndex(Math.max(0, visibleStacks.length - 1));
    }
  }, [stackIndex, visibleStacks.length]);

  const counts = useMemo(() => {
    let keep = 0;
    let reject = 0;
    let maybe = 0;
    let unreviewed = 0;
    for (const image of staticImages) {
      const decision = getDecision(decisions, image.id);
      if (decision === 'keep') keep += 1;
      if (decision === 'reject') reject += 1;
      if (decision === 'maybe') maybe += 1;
      if (decision === 'unreviewed') unreviewed += 1;
    }
    return { keep, reject, maybe, unreviewed };
  }, [decisions, staticImages]);

  const rejectedImages = useMemo(
    () => staticImages.filter((image) => getDecision(decisions, image.id) === 'reject'),
    [decisions, staticImages],
  );
  const rejectedBytes = useMemo(
    () => rejectedImages.reduce((sum, image) => sum + (image.fileSize ?? 0), 0),
    [rejectedImages],
  );

  const persistDecisionUpdates = useCallback(async (nextDecisions: Map<string, CleanupImageDecision>, imageIds: string[]) => {
    setDecisions(nextDecisions);
    await saveCleanupDecisions(
      sessionId,
      imageIds.map((imageId) => ({
        imageId,
        decision: getDecision(nextDecisions, imageId),
      })),
    );
  }, [sessionId]);

  const markImages = useCallback(async (imageIds: string[], decision: CleanupImageDecision) => {
    if (imageIds.length === 0) {
      return;
    }
    const next = applyCleanupDecision(decisions, imageIds, decision);
    await persistDecisionUpdates(next, imageIds);
  }, [decisions, persistDecisionUpdates]);

  const handleWaveChange = useCallback(async (nextWave: CleanupWave) => {
    if (nextWave === 'review-maybe') {
      const next = promoteUnreviewedToMaybe(decisions, staticImages.map((image) => image.id));
      const changedIds = staticImages
        .map((image) => image.id)
        .filter((imageId) => getDecision(decisions, imageId) !== getDecision(next, imageId));
      if (changedIds.length > 0) {
        await persistDecisionUpdates(next, changedIds);
      }
    }
    setWave(nextWave);
  }, [decisions, persistDecisionUpdates, staticImages]);

  const toggleSelected = (imageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const handleNextStack = () => {
    setSelectedIds(new Set());
    setStackIndex((current) => Math.min(current + 1, Math.max(visibleStacks.length - 1, 0)));
  };

  const handleCompareTwo = () => {
    const selectedImages = Array.from(selectedIds)
      .map((imageId) => imageMap.get(imageId))
      .filter((image): image is IndexedImage => Boolean(image))
      .slice(0, 2);
    if (selectedImages.length === 2) {
      onOpenCompare(selectedImages);
    }
  };

  const handleTransferConfirm = async (directory: TransferDestination) => {
    if (!canUseFileManagement) {
      showProModal('file_management');
      return;
    }

    setIsTransferring(true);
    setTransferStatusText('Moving rejected images to quarantine...');
    try {
      const result = await transferIndexedImages({
        images: rejectedImages,
        destinationDirectory: directory,
        mode: 'move',
        onStatus: setTransferStatusText,
      });
      if (result.success) {
        setSuccess(`Moved ${result.transferredCount} rejected image${result.transferredCount === 1 ? '' : 's'} to quarantine.`);
        setIsTransferModalOpen(false);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to move rejected images.');
    } finally {
      setIsTransferring(false);
      setTransferStatusText('');
    }
  };

  const progressPercent = analysisState.total > 0
    ? Math.round((analysisState.current / analysisState.total) * 100)
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-gray-950 via-slate-950 to-gray-900 text-gray-100">
      <div className="border-b border-gray-800/80 bg-gray-950/90 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-white">Cleanup Assistant</h2>
              <p className="truncate text-sm text-gray-400">
                {sessionGroup.label} · {staticImages.length} static image{staticImages.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100">
            Review by stacks, not one by one.
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-gray-800 bg-gray-950/70 p-4 lg:border-b-0 lg:border-r">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Session cleanup</div>
            <div className="text-sm leading-relaxed text-gray-300">
              This session has <span className="font-semibold text-white">{staticImages.length}</span> static images.
              Review close variations in waves, then move rejects to quarantine.
            </div>
            {analysisState.status === 'loading' && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-cyan-200">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {analysisState.message}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                  <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            )}
            {analysisState.status === 'error' && (
              <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                {analysisState.message}
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
              <div className="text-xl font-bold text-emerald-100">{counts.keep}</div>
              <div className="text-xs text-emerald-200/80">Kept</div>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3">
              <div className="text-xl font-bold text-rose-100">{counts.reject}</div>
              <div className="text-xs text-rose-200/80">Rejected</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="text-xl font-bold text-amber-100">{counts.maybe}</div>
              <div className="text-xs text-amber-200/80">Maybe</div>
            </div>
            <div className="rounded-xl border border-gray-700 bg-gray-900 p-3">
              <div className="text-xl font-bold text-gray-100">{counts.unreviewed}</div>
              <div className="text-xs text-gray-400">Unreviewed</div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(Object.keys(waveLabels) as CleanupWave[]).map((candidateWave) => (
              <button
                key={candidateWave}
                type="button"
                onClick={() => void handleWaveChange(candidateWave)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  wave === candidateWave
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                    : 'border-gray-800 bg-gray-900/70 text-gray-300 hover:border-gray-700 hover:bg-gray-800/80'
                }`}
              >
                <span>{waveLabels[candidateWave]}</span>
                {candidateWave === 'quarantine' && <Archive className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col p-5">
          {wave === 'quarantine' ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="w-full max-w-xl rounded-3xl border border-gray-800 bg-gray-900/80 p-6 text-center shadow-2xl shadow-black/30">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-100">
                  <Archive className="h-7 w-7" />
                </div>
                <h3 className="text-2xl font-bold text-white">Move rejected to quarantine</h3>
                <p className="mt-2 text-sm text-gray-400">
                  {rejectedImages.length} rejected image{rejectedImages.length === 1 ? '' : 's'} · {formatBytes(rejectedBytes)}
                </p>
                <button
                  type="button"
                  disabled={rejectedImages.length === 0}
                  onClick={() => setIsTransferModalOpen(true)}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
                >
                  <Archive className="h-4 w-4" />
                  Choose quarantine folder
                </button>
              </div>
            </div>
          ) : activeStack ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {activeStack.kind === 'likely-rejects' ? (
                      <ShieldAlert className="h-5 w-5 text-amber-300" />
                    ) : (
                      <Sparkles className="h-5 w-5 text-cyan-300" />
                    )}
                    <h3 className="text-lg font-bold text-white">{activeStack.title}</h3>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">
                    Stack {stackIndex + 1} of {visibleStacks.length} · {activeStack.imageIds.length} image{activeStack.imageIds.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {[6, 9, 12].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setGridSize(size as 6 | 9 | 12)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                        gridSize === size
                          ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100'
                          : 'border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void markImages(Array.from(selectedIds), 'keep')}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  <ThumbsUp className="h-4 w-4" />
                  Keep selected
                </button>
                <button
                  type="button"
                  onClick={() => void markImages(activeStack.imageIds.filter((imageId) => !selectedIds.has(imageId)), 'reject')}
                  className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                >
                  <Trash2 className="h-4 w-4" />
                  Reject unselected
                </button>
                <button
                  type="button"
                  onClick={() => void markImages(activeStack.imageIds, 'reject')}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/20"
                >
                  <Trash2 className="h-4 w-4" />
                  Reject whole stack
                </button>
                <button
                  type="button"
                  onClick={() => void markImages(activeStack.imageIds, 'keep')}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20"
                >
                  <Check className="h-4 w-4" />
                  Keep all
                </button>
                <button
                  type="button"
                  onClick={() => void markImages(Array.from(selectedIds), 'maybe')}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20"
                >
                  <HelpCircle className="h-4 w-4" />
                  Mark selected as Maybe
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size !== 2}
                  onClick={handleCompareTwo}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-600"
                >
                  <GitCompare className="h-4 w-4" />
                  Compare two
                </button>
                <button
                  type="button"
                  onClick={handleNextStack}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20"
                >
                  <RotateCcw className="h-4 w-4" />
                  Next stack
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-3xl border border-gray-800 bg-black/20 p-4">
                <div className={`grid gap-4 ${
                  gridSize === 6 ? 'grid-cols-2 xl:grid-cols-3' : gridSize === 9 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
                }`}>
                  {displayedImages.map((image) => (
                    <CleanupImageCard
                      key={image.id}
                      image={image}
                      selected={selectedIds.has(image.id)}
                      decision={getDecision(decisions, image.id)}
                      flags={flagsByImageId.get(image.id) ?? []}
                      onToggle={() => toggleSelected(image.id)}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-3xl border border-gray-800 bg-gray-900/50 p-8 text-center text-gray-400">
              No stacks in this wave. Try the next wave, or move to quarantine when you are ready.
            </div>
          )}
        </main>
      </div>

      <TransferImagesModal
        isOpen={isTransferModalOpen}
        images={rejectedImages}
        directories={directories}
        mode="move"
        isSubmitting={isTransferring}
        statusText={transferStatusText}
        progress={transferProgress}
        onClose={() => setIsTransferModalOpen(false)}
        onConfirm={handleTransferConfirm}
      />
    </div>
  );
};

export default CleanupAssistantWorkspace;
