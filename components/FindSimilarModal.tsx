import { useTranslation, type Translate } from '../i18n/useTranslation';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, FolderTree, Layers, ListFilter, Search, SlidersHorizontal, X } from 'lucide-react';
import type { IndexedImage, SimilarSearchCriteria } from '../types';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { useThumbnail } from '../hooks/useThumbnail';
import {
  DEFAULT_SIMILAR_SEARCH_CRITERIA,
  MAX_SIMILAR_SEARCH_RESULTS,
  findSimilarImages,
  getSimilarSearchAvailability,
  getSimilarSearchSourceDetails,
} from '../services/similarImageSearch';

interface FindSimilarModalProps {
  isOpen: boolean;
  sourceImage: IndexedImage | null;
  allImages: IndexedImage[];
  currentViewImages?: IndexedImage[];
  initialCriteria?: Partial<SimilarSearchCriteria>;
  onClose: () => void;
  onOpenImage: (image: IndexedImage, navigationImages: IndexedImage[]) => void;
  onApplyGridFilter: (images: IndexedImage[]) => void;
}

const overlayClassName = 'fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-sm';
const panelClassName = 'flex h-[calc(100dvh-3rem)] max-h-[92dvh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl';
const pillButtonClassName = 'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors';

const useThumbnailUrl = (image: IndexedImage | null) => {
  useThumbnail(image);
  const resolved = useResolvedThumbnail(image || undefined);
  return resolved?.thumbnailUrl || image?.thumbnailUrl || '';
};

const formatModelSummary = (image: IndexedImage, t: Translate) => image.models[0] || t('imageViewer.similar.unknownModel');

const formatSimilarityPercent = (similarity: number | null) =>
  similarity == null ? null : `${Math.round(similarity * 100)}%`;

const formatThresholdPercent = (threshold: number) => `${Math.round(threshold * 100)}%`;

const formatLoraSummary = (image: IndexedImage, t: Translate) => {
  if (!image.loras || image.loras.length === 0) {
    return t('imageViewer.similar.noLoras');
  }

  return image.loras
    .map((lora) => (typeof lora === 'string' ? lora : lora.name || lora.model_name || t('imageViewer.preview.unknownLoRA')))
    .join(', ');
};

const SimilarImageCard = ({
  image,
  badge,
  similarityPercent,
  onClick,
  onOpenImage,
}: {
  image: IndexedImage;
  badge: React.ReactNode;
  similarityPercent: string | null;
  onClick?: () => void;
  onOpenImage: () => void;
}) => {
  const { t } = useTranslation();
  const thumbnailUrl = useThumbnailUrl(image);

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-gray-700 bg-gray-950/70 text-left transition-colors hover:border-gray-500 hover:bg-gray-950"
    >
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left"
        aria-label={t('imageViewer.similar.openImage', { name: image.name })}
      >
        <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950" />
          )}
          <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-gray-100">
            {badge}
          </div>
        </div>
      </button>
      <div className="space-y-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-100" title={image.name}>
              {image.name}
            </div>
            {similarityPercent && (
              <div className="text-xs font-medium text-emerald-300">{t('imageViewer.similar.promptMatch', { percent: similarityPercent })}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenImage}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-700 text-gray-300 transition-colors hover:border-cyan-400/70 hover:text-cyan-100"
            aria-label={t('imageViewer.similar.openImage', { name: image.name })}
            title={t('imageViewer.similar.open')}
          >
            <Eye className="h-4 w-4" />
          </button>
        </div>
        <div className="truncate text-xs text-cyan-200" title={formatModelSummary(image, t)}>
          {formatModelSummary(image, t)}
        </div>
        <div className="truncate text-xs text-gray-400" title={formatLoraSummary(image, t)}>
          {formatLoraSummary(image, t)}
        </div>
      </div>
    </div>
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
  initialCriteria,
  onClose,
  onOpenImage,
  onApplyGridFilter,
}: FindSimilarModalProps) {
  const { t } = useTranslation();
  const [criteria, setCriteria] = useState<SimilarSearchCriteria>(DEFAULT_SIMILAR_SEARCH_CRITERIA);

  useEffect(() => {
    if (!isOpen || !sourceImage) {
      return;
    }

    const nextCriteria = {
      ...DEFAULT_SIMILAR_SEARCH_CRITERIA,
      ...initialCriteria,
    };

    setCriteria({
      ...nextCriteria,
      promptThreshold: nextCriteria.promptThreshold ?? DEFAULT_SIMILAR_SEARCH_CRITERIA.promptThreshold,
    });
  }, [initialCriteria, isOpen, sourceImage]);

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

  if (!isOpen || !sourceImage || !availability || !sourceDetails || !execution || typeof document === 'undefined') {
    return null;
  }

  const filterDisabled = execution.results.length === 0 || !execution.hasActiveCriterion;
  const isResultLimited = execution.results.length >= MAX_SIMILAR_SEARCH_RESULTS;
  const resultImages = execution.results.map((result) => result.image);

  return createPortal(
    <div className={overlayClassName} role="dialog" aria-modal="true" aria-label={t('imageViewer.similar.dialog')}>
      <div className={panelClassName}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-gray-100">{t('imageViewer.similar.title')}</div>
            <div className="mt-1 text-xs text-gray-400">{t('imageViewer.similar.description')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-700 p-2 text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
            aria-label={t('imageViewer.similar.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-gray-800 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">{t('imageViewer.similar.source')}</div>
            <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/80">
              <div className="aspect-[4/5] overflow-hidden bg-gradient-to-br from-gray-800 via-gray-900 to-black">
                {sourceThumbnailUrl ? (
                  <img src={sourceThumbnailUrl} alt={sourceImage.name} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-gray-800 via-gray-900 to-black" />
                )}
              </div>
              <div className="space-y-2 p-4">
                <div className="truncate text-sm font-semibold text-gray-100" title={sourceImage.name}>
                  {sourceImage.name}
                </div>
                <div className="min-w-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-xs text-gray-300">
                  <div className="mb-1 truncate font-medium text-cyan-200" title={formatModelSummary(sourceImage, t)}>
                    {formatModelSummary(sourceImage, t)}
                  </div>
                  <div className="mb-1">{sourceImage.seed != null ? t('imageViewer.similar.seedValue', { seed: sourceImage.seed }) : t('imageViewer.similar.noSeed')}</div>
                  <div className="line-clamp-2 break-all" title={formatLoraSummary(sourceImage, t)}>
                    {formatLoraSummary(sourceImage, t)}
                  </div>
                </div>
                <div className="max-h-24 overflow-auto rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-xs leading-relaxed text-gray-300">
                  {sourceImage.prompt || ''}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {t('imageViewer.similar.rules')}
                </div>
                <div className="space-y-2 rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
                  <label className="flex items-start gap-3 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={criteria.prompt}
                      disabled={!availability.prompt}
                      onChange={(event) => setCriteria((current) => ({ ...current, prompt: event.target.checked }))}
                    />
                    <span className="block font-medium">{t('libraryGallery.prompt')}</span>
                  </label>

                  <div className="ml-6 rounded-lg border border-gray-800 bg-gray-900/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <span className={criteria.prompt && availability.prompt ? 'font-medium text-gray-200' : 'font-medium text-gray-500'}>
                        {t('imageViewer.similar.minimumSimilarity')}
                      </span>
                      <span className={criteria.prompt && availability.prompt ? 'font-semibold text-emerald-300' : 'font-semibold text-gray-500'}>
                        {formatThresholdPercent(criteria.promptThreshold)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={100}
                      step={1}
                      value={Math.round(criteria.promptThreshold * 100)}
                      disabled={!criteria.prompt || !availability.prompt}
                      onChange={(event) =>
                        setCriteria((current) => ({
                          ...current,
                          promptThreshold: Number(event.target.value) / 100,
                        }))
                      }
                      className="w-full accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t('imageViewer.similar.minimumSimilarity')}
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-gray-500">
                      <span>50%</span>
                      <span>100%</span>
                    </div>
                  </div>

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
                    <span className="block font-medium">{t('imageViewer.similar.loraNames')}</span>
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
                    <span className="block font-medium">{t('imageViewer.similar.loraWeight')}</span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={criteria.seed}
                      disabled={!availability.seed}
                      onChange={(event) => setCriteria((current) => ({ ...current, seed: event.target.checked }))}
                    />
                    <span className="block font-medium">{t('libraryGallery.seed')}</span>
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <Layers className="h-3.5 w-3.5" />
                  {t('imageViewer.similar.checkpointFilter')}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <ScopeButton
                    active={criteria.checkpointMode === 'ignore'}
                    onClick={() => setCriteria((current) => ({ ...current, checkpointMode: 'ignore' }))}
                  >
                    {t('imageViewer.similar.anyCheckpoint')}
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.checkpointMode === 'same'}
                    disabled={!availability.checkpoint}
                    onClick={() => setCriteria((current) => ({ ...current, checkpointMode: 'same' }))}
                  >
                    {t('imageViewer.similar.sameCheckpoint')}
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.checkpointMode === 'different'}
                    disabled={!availability.checkpoint}
                    onClick={() => setCriteria((current) => ({ ...current, checkpointMode: 'different' }))}
                  >
                    {t('imageViewer.similar.differentCheckpoint')}
                  </ScopeButton>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  <FolderTree className="h-3.5 w-3.5" />
                  {t('imageViewer.similar.scope')}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ScopeButton
                    active={criteria.scope === 'current-view'}
                    onClick={() => setCriteria((current) => ({ ...current, scope: 'current-view' }))}
                  >
                    {t('imageViewer.similar.currentView')}
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.scope === 'all-images'}
                    onClick={() => setCriteria((current) => ({ ...current, scope: 'all-images' }))}
                  >
                    {t('imageViewer.similar.allImages')}
                  </ScopeButton>
                  <ScopeButton
                    active={criteria.scope === 'same-folder'}
                    onClick={() => setCriteria((current) => ({ ...current, scope: 'same-folder' }))}
                  >
                    {t('imageViewer.similar.sameFolder')}
                  </ScopeButton>
                </div>
              </div>

              {!execution.hasActiveCriterion && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {t('imageViewer.similar.noCriteria')}
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-gray-800 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-100">
                    {isResultLimited ? t('imageViewer.similar.topMatches', { count: MAX_SIMILAR_SEARCH_RESULTS }) : t('imageViewer.similar.matches', { count: execution.results.length })}
                  </div>
                  <div className="text-xs text-gray-400">{t('imageViewer.similar.candidates', { count: execution.candidates.length })}</div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              {execution.results.length === 0 ? (
                <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/50 px-6 text-center">
                  <Search className="mb-3 h-6 w-6 text-gray-500" />
                  <div className="text-sm font-semibold text-gray-200">{t('imageViewer.similar.noMatches')}</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {execution.results.map((result, index) => (
                    <SimilarImageCard
                      key={result.image.id}
                      image={result.image}
                      similarityPercent={formatSimilarityPercent(result.promptSimilarity)}
                      badge={
                        <span>
                          #{index + 1}
                          {result.primaryCheckpoint ? ` · ${result.primaryCheckpoint}` : ''}
                        </span>
                      }
                      onClick={() => onOpenImage(result.image, resultImages)}
                      onOpenImage={() => onOpenImage(result.image, resultImages)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-5 py-4">
              <div />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                >
                  {t('batchExport.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => onApplyGridFilter(resultImages)}
                  disabled={filterDisabled}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
                >
                  <ListFilter className="h-4 w-4" />
                  {t('imageViewer.similar.apply')}
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
