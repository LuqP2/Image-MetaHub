import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Copy,
  Dices,
  ExternalLink,
  Image as ImageIcon,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { SavedPrompt } from '../types';
import { resolveSavedPromptSource } from '../services/savedPromptService';
import { initializeSavedPromptSynchronization, useSavedPromptStore } from '../store/useSavedPromptStore';
import { copyTextToClipboard } from '../utils/imageUtils';

interface PromptLibraryProps {
  onViewSource: (absolutePath: string) => void | Promise<void>;
}

type SourcePresentation = {
  status: 'loading' | 'available' | 'unavailable';
  absolutePath?: string;
  sourceChanged?: boolean;
  thumbnailUrl?: string | null;
};

const PromptSourcePreview: React.FC<{
  prompt: SavedPrompt;
  presentation?: SourcePresentation;
  ensureSource: (prompt: SavedPrompt) => Promise<void>;
  onViewSource: (absolutePath: string) => void | Promise<void>;
  large?: boolean;
}> = ({ prompt, presentation, ensureSource, onViewSource, large = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prompt.source || presentation) return undefined;
    if (large || typeof IntersectionObserver === 'undefined') {
      void ensureSource(prompt);
      return undefined;
    }
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void ensureSource(prompt);
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ensureSource, large, presentation, prompt]);

  const available = presentation?.status === 'available';
  const heightClass = large ? 'h-[min(44vh,420px)] min-h-64' : 'h-36';
  return (
    <div ref={containerRef} className={`relative overflow-hidden bg-gray-950 ${heightClass}`}>
      {presentation?.thumbnailUrl ? (
        <img
          src={presentation.thumbnailUrl}
          alt="Current source"
          className={`h-full w-full ${large ? 'object-contain' : 'object-cover'}`}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-gray-600">
          <ImageIcon size={large ? 38 : 25} strokeWidth={1.5} />
          <span>
            {presentation?.status === 'loading' || (prompt.source && !presentation)
              ? 'Loading source…'
              : prompt.source
                ? 'Source unavailable'
                : 'No source'}
          </span>
        </div>
      )}
      {!large && available && presentation.absolutePath && (
        <button
          type="button"
          onClick={() => void onViewSource(presentation.absolutePath as string)}
          className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/70 text-gray-100 shadow-md backdrop-blur-sm transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="View Source"
          aria-label="View Source"
        >
          <ExternalLink size={14} />
        </button>
      )}
      {available && presentation.sourceChanged && (
        <span className="absolute bottom-2 left-2 rounded bg-amber-950/90 px-2 py-1 text-[10px] font-medium text-amber-200 shadow-md">
          Source has changed
        </span>
      )}
    </div>
  );
};

const PromptLibrary: React.FC<PromptLibraryProps> = ({ onViewSource }) => {
  const prompts = useSavedPromptStore((state) => state.prompts);
  const isLoading = useSavedPromptStore((state) => state.isLoading);
  const error = useSavedPromptStore((state) => state.error);
  const selectedPromptId = useSavedPromptStore((state) => state.selectedPromptId);
  const load = useSavedPromptStore((state) => state.load);
  const remove = useSavedPromptStore((state) => state.remove);
  const select = useSavedPromptStore((state) => state.select);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'saved' | 'created'>('saved');
  const [sortDirection, setSortDirection] = useState<'newest' | 'oldest'>('newest');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [randomPromptId, setRandomPromptId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sourcePresentations, setSourcePresentations] = useState<Record<string, SourcePresentation>>({});
  const sourcePresentationsRef = useRef<Record<string, SourcePresentation>>({});
  const sourceRequestsRef = useRef(new Map<string, Promise<void>>());
  const sourceObjectUrlsRef = useRef(new Set<string>());
  const isMountedRef = useRef(true);
  const randomButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => initializeSavedPromptSynchronization(), []);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const url of sourceObjectUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const updateSourcePresentation = useCallback((id: string, presentation: SourcePresentation) => {
    if (!isMountedRef.current) return;
    sourcePresentationsRef.current = { ...sourcePresentationsRef.current, [id]: presentation };
    setSourcePresentations(sourcePresentationsRef.current);
  }, []);

  const ensureSource = useCallback((prompt: SavedPrompt): Promise<void> => {
    if (!prompt.source) return Promise.resolve();
    const current = sourcePresentationsRef.current[prompt.id];
    if (current?.status === 'available' || current?.status === 'unavailable') return Promise.resolve();
    const pending = sourceRequestsRef.current.get(prompt.id);
    if (pending) return pending;

    updateSourcePresentation(prompt.id, { status: 'loading' });
    const request = (async () => {
      try {
        const resolution = await resolveSavedPromptSource(prompt.id);
        if (!isMountedRef.current) return;
        if (resolution.status === 'unavailable') {
          updateSourcePresentation(prompt.id, { status: 'unavailable' });
          return;
        }
        const availablePresentation: SourcePresentation = {
          status: 'available',
          absolutePath: resolution.absolutePath,
          sourceChanged: resolution.sourceChanged,
          thumbnailUrl: null,
        };
        updateSourcePresentation(prompt.id, availablePresentation);
        if (window.electronAPI?.generateThumbnailFromPath) {
          try {
            const result = await window.electronAPI.generateThumbnailFromPath({
              filePath: resolution.absolutePath,
              maxEdge: 840,
              quality: 84,
            });
            if (!isMountedRef.current) return;
            if (result.success && result.data) {
              const thumbnailUrl = URL.createObjectURL(new Blob(
                [new Uint8Array(result.data)],
                { type: result.mimeType || 'image/webp' },
              ));
              sourceObjectUrlsRef.current.add(thumbnailUrl);
              updateSourcePresentation(prompt.id, { ...availablePresentation, thumbnailUrl });
            }
          } catch {
            // Source navigation remains available when thumbnail generation fails.
          }
        }
      } catch (cause) {
        if (!isMountedRef.current) return;
        updateSourcePresentation(prompt.id, { status: 'unavailable' });
        setActionError(cause instanceof Error ? cause.message : 'Could not resolve the saved source.');
      } finally {
        sourceRequestsRef.current.delete(prompt.id);
      }
    })();
    sourceRequestsRef.current.set(prompt.id, request);
    return request;
  }, [updateSourcePresentation]);

  const visiblePrompts = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    const filtered = needle
      ? prompts.filter((prompt) => (
          prompt.positivePrompt.toLocaleLowerCase().includes(needle)
          || prompt.negativePrompt.toLocaleLowerCase().includes(needle)
        ))
      : [...prompts];

    return filtered.sort((left, right) => {
      const leftTime = sortBy === 'saved' ? left.createdAt : left.sourceCreatedAt;
      const rightTime = sortBy === 'saved' ? right.createdAt : right.sourceCreatedAt;
      if (leftTime === null && rightTime !== null) return 1;
      if (leftTime !== null && rightTime === null) return -1;
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return sortDirection === 'newest' ? rightTime - leftTime : leftTime - rightTime;
      }
      return right.createdAt - left.createdAt || right.id.localeCompare(left.id);
    });
  }, [prompts, query, sortBy, sortDirection]);

  const chooseRandom = useCallback((excludeId: string | null = selectedPromptId) => {
    if (visiblePrompts.length === 0) return;
    const candidates = visiblePrompts.length > 1
      ? visiblePrompts.filter((prompt) => prompt.id !== excludeId)
      : visiblePrompts;
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    select(selected.id);
    setRandomPromptId(selected.id);
    void ensureSource(selected);
  }, [ensureSource, select, selectedPromptId, visiblePrompts]);

  const closeRandom = useCallback(() => {
    setRandomPromptId(null);
    randomButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!randomPromptId) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRandom();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeRandom, randomPromptId]);

  const handleCopy = useCallback(async (text: string) => {
    const result = await copyTextToClipboard(text);
    if (!result.success) setActionError(result.error || 'Could not copy the prompt.');
  }, []);

  const randomPrompt = randomPromptId
    ? prompts.find((prompt) => prompt.id === randomPromptId) ?? null
    : null;
  const randomSource = randomPrompt ? sourcePresentations[randomPrompt.id] : undefined;
  const empty = !isLoading && !error && prompts.length === 0;
  const noMatches = !isLoading && !error && prompts.length > 0 && visiblePrompts.length === 0;
  const countLabel = query ? `${visiblePrompts.length} of ${prompts.length}` : `${prompts.length} saved`;

  return (
    <>
      <section className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3 overflow-hidden px-1">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800/80 pb-3">
          <div className="mr-1 flex items-center gap-2 text-sm font-semibold text-gray-200">
            <Bookmark size={16} />
            Prompt Library
            <span className="font-normal text-gray-500">{countLabel}</span>
          </div>
          <label className="relative min-w-[220px] flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
            <span className="sr-only">Search saved prompts</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search prompts…"
              className="h-9 w-full rounded-md border border-gray-700 bg-gray-900 pl-9 pr-8 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-accent/70 focus:ring-1 focus:ring-accent/40"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-200" aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </label>
          <label className="flex h-9 items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2 text-xs text-gray-500">
            Sort by
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as 'saved' | 'created')}
              className="rounded bg-gray-900 font-medium text-gray-200 outline-none [color-scheme:dark]"
              aria-label="Sort prompts by"
            >
              <option value="saved" className="bg-gray-900 text-gray-100">Saved</option>
              <option value="created" className="bg-gray-900 text-gray-100">Created</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSortDirection((current) => current === 'newest' ? 'oldest' : 'newest')}
            className="app-top-pill h-9 px-2.5 text-xs"
            aria-label={`Sort direction: ${sortDirection === 'newest' ? 'Newest' : 'Oldest'}`}
            title={`Sort direction: ${sortDirection === 'newest' ? 'Newest' : 'Oldest'}`}
          >
            {sortDirection === 'newest' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
            {sortDirection === 'newest' ? 'Newest' : 'Oldest'}
          </button>
          <button
            ref={randomButtonRef}
            type="button"
            onClick={() => chooseRandom()}
            disabled={visiblePrompts.length === 0}
            className="app-top-pill h-9 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Dices size={15} />
            Random
          </button>
        </div>

        {(error || actionError) && (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {actionError || error}
            {error && <button type="button" className="ml-3 underline" onClick={() => void load()}>Try again</button>}
          </div>
        )}

        {isLoading && prompts.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">Loading saved prompts…</div>
        )}
        {empty && (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 p-8 text-center">
            <Bookmark size={30} className="mb-3 text-gray-500" />
            <p className="font-medium text-gray-200">No saved prompts yet</p>
            <p className="mt-1 max-w-md text-sm text-gray-500">Use Save Prompt beside a prompt or from an image context menu.</p>
          </div>
        )}
        {noMatches && (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-gray-500">
            <Search size={27} className="mb-3" />
            <p className="font-medium text-gray-300">No matching prompts</p>
            <p className="mt-1">Try a different search.</p>
          </div>
        )}

        {visiblePrompts.length > 0 && (
          <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 overflow-y-auto pb-4 pr-1">
            {visiblePrompts.map((prompt) => {
              const expanded = expandedId === prompt.id;
              const menuOpen = menuId === prompt.id;
              return (
                <article key={prompt.id} className="relative overflow-visible rounded-xl border border-gray-800 bg-gray-900/75 shadow-sm transition-colors hover:border-gray-700">
                  <div className="overflow-hidden rounded-t-xl border-b border-gray-800">
                    <PromptSourcePreview
                      prompt={prompt}
                      presentation={sourcePresentations[prompt.id]}
                      ensureSource={ensureSource}
                      onViewSource={onViewSource}
                    />
                  </div>
                  <div className="p-3">
                    <p className={`whitespace-pre-wrap break-words text-sm leading-6 text-gray-100 ${expanded ? '' : 'line-clamp-4 min-h-24'}`}>
                      {prompt.positivePrompt}
                    </p>

                    {expanded && (
                      <div className="mt-3 space-y-3 border-t border-gray-800 pt-3">
                        {prompt.negativePrompt ? (
                          <div>
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Negative prompt</div>
                            <p className="whitespace-pre-wrap break-words text-sm leading-5 text-gray-300">{prompt.negativePrompt}</p>
                            <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-100" onClick={() => void handleCopy(prompt.negativePrompt)}>
                              <Copy size={12} /> Copy Negative
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No negative prompt</p>
                        )}
                        <div className="space-y-0.5 text-[11px] text-gray-600">
                          <div>Saved {new Date(prompt.createdAt).toLocaleString()}</div>
                          <div>{prompt.sourceCreatedAt ? `Created ${new Date(prompt.sourceCreatedAt).toLocaleString()}` : 'Created date unavailable'}</div>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-1.5">
                      <button type="button" className="app-top-pill px-2.5 py-1.5 text-xs" onClick={() => void handleCopy(prompt.positivePrompt)}>
                        <Copy size={13} /> Copy
                      </button>
                      <button
                        type="button"
                        className="app-top-pill px-2 py-1.5 text-xs"
                        onClick={() => setExpandedId(expanded ? null : prompt.id)}
                        aria-expanded={expanded}
                      >
                        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {expanded ? 'Less' : 'Details'}
                      </button>
                      <div className="relative ml-auto">
                        <button
                          type="button"
                          className="app-top-icon-button h-8 w-8 text-gray-500 hover:text-gray-200"
                          onClick={() => {
                            setMenuId(menuOpen ? null : prompt.id);
                            setConfirmingId(null);
                          }}
                          aria-label="Prompt actions"
                          aria-expanded={menuOpen}
                        >
                          <MoreHorizontal size={15} />
                        </button>
                        {menuOpen && (
                          <div className="absolute bottom-9 right-0 z-20 min-w-40 rounded-lg border border-gray-700 bg-gray-900 p-1.5 shadow-xl shadow-black/40">
                            {confirmingId === prompt.id ? (
                              <div className="p-1.5">
                                <p className="mb-2 text-xs text-gray-300">Remove this saved prompt?</p>
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500"
                                    onClick={async () => {
                                      try {
                                        await remove(prompt.id);
                                        setMenuId(null);
                                        setConfirmingId(null);
                                      } catch (cause) {
                                        setActionError(cause instanceof Error ? cause.message : 'Could not remove the saved prompt.');
                                      }
                                    }}
                                  >
                                    Remove
                                  </button>
                                  <button type="button" className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-100" onClick={() => setConfirmingId(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-gray-300 hover:bg-gray-800 hover:text-red-300" onClick={() => setConfirmingId(prompt.id)}>
                                <Trash2 size={13} /> Remove saved prompt
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {randomPrompt && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRandom();
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="Random saved prompt" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/60">
            <div className="relative border-b border-gray-800">
              <PromptSourcePreview
                prompt={randomPrompt}
                presentation={randomSource}
                ensureSource={ensureSource}
                onViewSource={onViewSource}
                large
              />
              <button type="button" onClick={closeRandom} className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/70 text-gray-200 backdrop-blur-sm hover:bg-black/90" aria-label="Close random prompt">
                <X size={17} />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto p-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Prompt</div>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-100">{randomPrompt.positivePrompt}</p>
              {randomPrompt.negativePrompt && (
                <div className="mt-5 border-t border-gray-800 pt-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Negative prompt</div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-300">{randomPrompt.negativePrompt}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 bg-gray-950/50 px-5 py-3">
              <button type="button" className="app-top-pill px-3 py-2 text-sm" onClick={() => void handleCopy(randomPrompt.positivePrompt)}>
                <Copy size={14} /> Copy
              </button>
              {randomPrompt.negativePrompt && (
                <button type="button" className="app-top-pill px-3 py-2 text-sm" onClick={() => void handleCopy(randomPrompt.negativePrompt)}>
                  <Copy size={14} /> Copy Negative
                </button>
              )}
              <button
                type="button"
                className="app-top-pill px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                disabled={randomSource?.status !== 'available' || !randomSource.absolutePath}
                onClick={() => {
                  if (!randomSource?.absolutePath) return;
                  const path = randomSource.absolutePath;
                  closeRandom();
                  void onViewSource(path);
                }}
              >
                <ExternalLink size={14} /> View Source
              </button>
              <button type="button" className="app-top-pill ml-auto px-3 py-2 text-sm" onClick={() => chooseRandom(randomPrompt.id)}>
                <Dices size={14} /> Another
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PromptLibrary;
