import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderTree, GitCompare, Layers, Search, SlidersHorizontal, X } from 'lucide-react';
import type { IndexedImage, SimilarSearchCriteria, SimilarSearchResult } from '../types';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import {
  DEFAULT_SIMILAR_SEARCH_CRITERIA,
  findSimilarImages,
  getSimilarSearchAvailability,
  getSimilarSearchSourceDetails,
} from '../services/similarImageSearch';

interface FindSimilarModalProps {
  isOpen: boolean;
  sourceImage: IndexedImage | null;
  allImages: IndexedImage[];
  currentViewImages?: IndexedImage[];
  onClose: () => void;
  onOpenCompare: (images: IndexedImage[]) => void;
}

const overlayClassName = 'fixed inset-0 z-[150] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm';
const panelClassName = 'flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl';
const pillButtonClassName = 'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors';

const useThumbnailUrl = (image: IndexedImage | null) => {
  const resolved = useResolvedThumbnail(image || undefined);
  return resolved?.thumbnailUrl || image?.thumbnailUrl || '';
};

const formatModelSummary = (image: IndexedImage) => image.models[0] || 'Unknown checkpoint';

const formatLoraSummary = (image: IndexedImage) => {
  if (!image.loras || image.loras.length === 0) {
    return 'No LoRAs';
  }

  return image.loras
    .map((lora) => (typeof lora === 'string' ? lora : lora.name || lora.model_name || 'Unknown LoRA'))
    .join(', ');
};

const SimilarImageCard = ({
  image,
  selected,
  badge,
  onClick,
}: {
  image: IndexedImage;
  selected: boolean;
  badge: React.ReactNode;
  onClick?: () => void;
}) => {
  const thumbnailUrl = useThumbnailUrl(image);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border text-left transition-colors ${
        selected
          ? 'border-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-500/10'
          : 'border-gray-700 bg-gray-950/70 hover:border-gray-500 hover:bg-gray-950'
      }`}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">No preview</div>
        )}
        <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-gray-100">
          {badge}
        </div>
        {selected && (
          <div className="absolute right-2 top-2 rounded-full bg-cyan-500 p-1 text-white">
            <Check className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="truncate text-sm font-semibold text-gray-100" title={image.name}>
          {image.name}
        </div>
        <div className="truncate text-xs text-cyan-200" title={formatModelSummary(image)}>
          {formatModelSummary(image)}
        </div>
        <div className="truncate text-xs text-gray-400" title={formatLoraSummary(image)}>
          {formatLoraSummary(image)}
        </div>
      </div>
    </button>
  );
};

const ScopeButton = ({
  active,
  disabled = false,
  children,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`${pillButtonClassName} ${
      active
        ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-100'
        : 'border-gray-700 bg-gray-950/70 text-gray-300 hover:border-gray-500 hover:text-white'
    } ${disabled ? 'cursor-not-allowed opacity-50 hover:border-gray-700 hover:text-gray-300' : ''}`}
  >
    {children}
  </button>
);

export default function FindSimilarModal({
  isOpen,
  sourceImage,
  allImages,
  currentViewImages,
  onClose,
  onOpenCompare,
}: FindSimilarModalProps) {
  const [criteria, setCriteria] = useState<SimilarSearchCriteria>(DEFAULT_SIMILAR_SEARCH_CRITERIA);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen || !sourceImage) {
      return;
    }

    setCriteria(DEFAULT_SIMILAR_SEARCH_CRITERIA);
  }, [isOpen, sourceImage]);

  const availability = useMemo(
    () => (sourceImage ? getSimilarSearchAvailability(sourceImage) : null),
    [sourceImage],
  );

  const sourceDetails = useMemo(
    () => (sourceImage ? getSimilarSearchSourceDetails(sourceImage) : null),
    [sourceImage],
  );
  const sourceThumbnailUrl = useThumbnailUrl(sourceImage);

  const execution = useMemo(() => {
    if (!sourceImage) {
      return null;
    }

    return findSimilarImages({
      sourceImage,
      allImages,
      currentViewImages,
      criteria,
    });
  }, [allImages, criteria, currentViewImages, sourceImage]);

  useEffect(() => {
    if (!execution) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(execution.results.filter((result) => result.preselected).map((result) => result.image.id)));
  }, [execution]);

  if (!isOpen || !sourceImage || !availability || !sourceDetails || !execution || typeof document === 'undefined') {
    return null;
  }

  const hasPrompt = availability.prompt;
  const compareDisabled = selectedIds.size === 0 || !execution.hasActiveCriterion;

  const toggleSelection = (result: SimilarSearchResult) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(result.image.id)) {
        next.delete(result.image.id);
        return next;
      }

      if (next.size >= 3) {
        return current;
      }

      next.add(result.image.id);
      return next;
    });
  };

  const selectedResults = execution.results.filter((result) => selectedIds.has(result.image.id)).slice(0, 3);

  return createPortal(
    <div className={overlayClassName} role="dialog" aria-modal="true" aria-label="Find similar images">
      <div className={panelClassName}>
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-gray-100">Find similar...</div>
            <div className="text-sm text-gray-400">
              Same prompt, different checkpoint by default, without changing your global filters.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-700 p-2 text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
            aria-label="Close find similar dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b border-gray-800 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Source image</div>
            <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/80">
              <div className="aspect-[4/5] overflow-hidden bg-gradient-to-br from-gray-800 via-gray-900 to-black">
                {sourceThumbnailUrl ? (
                  <img src={sourceThumbnailUrl} alt={sourceImage.name} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-gray-500">No preview</div>
                )}
              </div>
              <div className="space-y-2 p-4">
                <div className="truncate text-sm font-semibold text-gray-100" title={sourceImage.name}>
                  {sourceImage.name}
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-xs text-gray-300">
                  <div className="mb-1 font-medium text-cyan-200">{formatModelSummary(sourceImage)}</div>
                  <div className="mb-1">{sourceImage.seed != null ? `Seed ${sourceImage.seed}` : 'No seed'}</div>
                  <div title={formatLoraSummary(sourceImage)}>{formatLoraSummary(sourceImage)}</div>
                </div>
                <div className="max-h-24 overflow-auto rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-xs leading-relaxed text-gray-300">
                  {sourceImage.prompt || 'No prompt metadata'}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Match rules
                </div>
                <div className="space-y-2 rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
                  <label className="flex items-start gap-3 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={criteria.prompt}
                      disabled={!availability.prompt}
                      onChange={(event) => setCriteria((current) => ({ ...current, prompt: event.target.checked }))}
                    />
                    <span>
                      <span className="block font-medium">Prompt</span>
                      <span className="text-xs text-gray-400">Exact normalized prompt match.</span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={criteria.lora}
                      disabled={!availability.lora}
                      onChange={(event) =>
                        setCriteria((current) => ({
                          ...current,
                          lora: event.target.checked,
                          matchLoraWeight: event.target.checked ? current.matchLoraWeight : false,
                        }))
                      }
                    />
                    <span>
                      <span className="block font-medium">LoRA names</span>
                      <span className="text-xs text-gray-400">Require the same normalized LoRA set.</span>
                    </span>
                  </label>

                  <label className="ml-6 flex items-start gap-3 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={criteria.matchLoraWeight}
                      disabled={!criteria.lora || !availability.lora}
                      onChange={(event) =>
                        setCriteria((current) => ({ ...current, matchLoraWeight: event.target.checked }))
                      }
                    />
                    <span>
                      <span className="block font-medium">Also match LoRA weight</span>
                      <span className="text-xs text-gray-500">Only active when LoRA matching is enabled.</span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={criteria.seed}
                      disabled={!availability.seed}
                      onChange={(event) => setCriteria((current) => ({ ...current, seed: event.target.checked }))}
                    />
                    <span>
                      <span className="block font-medium">Seed</span>
                      <span className="text-xs text-gray-400">Require the exact same seed.</span>
                    </span>
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <Layers className="h-3.5 w-3.5" />
                  Checkpoint
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <ScopeButton
                    active={criteria.checkpointMode === 'different'}
                    disabled={!availability.checkpoint}
                    onClick={() => setCriteria((current) => ({ ...current, checkpointMode: 'different' }))}
                  >
                    Different
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.checkpointMode === 'ignore'}
                    onClick={() => setCriteria((current) => ({ ...current, checkpointMode: 'ignore' }))}
                  >
                    Ignore
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.checkpointMode === 'same'}
                    disabled={!availability.checkpoint}
                    onClick={() => setCriteria((current) => ({ ...current, checkpointMode: 'same' }))}
                  >
                    Same
                  </ScopeButton>
                </div>
                {!availability.checkpoint && (
                  <div className="mt-2 text-xs text-amber-300">Checkpoint matching is disabled because the source image has no checkpoint metadata.</div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <FolderTree className="h-3.5 w-3.5" />
                  Scope
                </div>
                <div className="flex flex-wrap gap-2">
                  <ScopeButton
                    active={criteria.scope === 'current-view'}
                    onClick={() => setCriteria((current) => ({ ...current, scope: 'current-view' }))}
                  >
                    Current view
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.scope === 'all-images'}
                    onClick={() => setCriteria((current) => ({ ...current, scope: 'all-images' }))}
                  >
                    All images
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.scope === 'same-folder'}
                    onClick={() => setCriteria((current) => ({ ...current, scope: 'same-folder' }))}
                  >
                    Same folder
                  </ScopeButton>
                </div>
              </div>

              {!execution.hasActiveCriterion && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Enable at least one available criterion to search for matches.
                </div>
              )}

              {!hasPrompt && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  This source image has no prompt metadata, so prompt matching is unavailable.
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="border-b border-gray-800 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-100">
                    {execution.results.length} match{execution.results.length === 1 ? '' : 'es'}
                  </div>
                  <div className="text-xs text-gray-400">
                    Searching {execution.candidates.length} candidate image{execution.candidates.length === 1 ? '' : 's'} in{' '}
                    {criteria.scope === 'current-view' ? 'the current view' : criteria.scope === 'all-images' ? 'the full library' : 'the same folder'}.
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  Selected {selectedResults.length} of 3 compare slots.
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              {execution.results.length === 0 ? (
                <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/50 px-6 text-center">
                  <Search className="mb-3 h-6 w-6 text-gray-500" />
                  <div className="text-sm font-semibold text-gray-200">No matches found</div>
                  <div className="mt-2 max-w-md text-xs leading-relaxed text-gray-400">
                    Try relaxing checkpoint matching, turning off seed matching, or switching the scope to the full library.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {execution.results.map((result, index) => (
                    <SimilarImageCard
                      key={result.image.id}
                      image={result.image}
                      selected={selectedIds.has(result.image.id)}
                      badge={
                        <span>
                          #{index + 1}
                          {result.primaryCheckpoint ? ` · ${result.primaryCheckpoint}` : ''}
                        </span>
                      }
                      onClick={() => toggleSelection(result)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-5 py-4">
              <div className="text-xs text-gray-400">
                Compare will open with the source image plus the selected matches, capped at 4 images total.
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCompare([sourceImage, ...selectedResults.map((result) => result.image)].slice(0, 4))}
                  disabled={compareDisabled}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
                >
                  <GitCompare className="h-4 w-4" />
                  Open in Compare
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
