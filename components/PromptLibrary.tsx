import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

const PromptSourcePreview: React.FC<{
  prompt: SavedPrompt;
  onViewSource: (absolutePath: string) => void | Promise<void>;
  onError: (message: string) => void;
}> = ({ prompt, onViewSource, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolution, setResolution] = useState<Awaited<ReturnType<typeof resolveSavedPromptSource>> | null>(null);
  const [isResolving, setIsResolving] = useState(Boolean(prompt.source));
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!prompt.source) return undefined;
    let cancelled = false;
    let objectUrl: string | null = null;
    const resolve = async () => {
      setIsResolving(true);
      try {
        const next = await resolveSavedPromptSource(prompt.id);
        if (cancelled) return;
        setResolution(next);
        if (next.status === 'available' && window.electronAPI?.generateThumbnailFromPath) {
          const result = await window.electronAPI.generateThumbnailFromPath({ filePath: next.absolutePath, maxEdge: 420, quality: 82 });
          if (!cancelled && result.success && result.data) {
            objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)], { type: result.mimeType || 'image/webp' }));
            setThumbnailUrl(objectUrl);
          }
        }
      } catch (cause) {
        if (!cancelled) onError(cause instanceof Error ? cause.message : 'Could not resolve the saved source.');
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    };
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      void resolve();
      return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void resolve();
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [onError, prompt.id, prompt.source]);

  const available = resolution?.status === 'available';
  const changed = available && resolution.sourceChanged;
  return (
    <div ref={containerRef} className="relative h-36 overflow-hidden border-b border-gray-800 bg-gray-950">
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="Current source" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-gray-600">
          <ImageIcon size={25} strokeWidth={1.5} />
          <span>{isResolving ? 'Loading source…' : prompt.source ? 'Source unavailable' : 'No source'}</span>
        </div>
      )}
      {available && (
        <button
          type="button"
          onClick={() => void onViewSource(resolution.absolutePath)}
          className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/70 text-gray-100 shadow-md backdrop-blur-sm transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="View Source"
          aria-label="View Source"
        >
          <ExternalLink size={14} />
        </button>
      )}
      {changed && (
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => initializeSavedPromptSynchronization(), []);

  const filteredPrompts = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    if (!needle) return prompts;
    return prompts.filter((prompt) => (
      prompt.positivePrompt.toLocaleLowerCase().includes(needle)
      || prompt.negativePrompt.toLocaleLowerCase().includes(needle)
    ));
  }, [prompts, query]);

  const focusCard = useCallback((id: string) => {
    const card = cardRefs.current.get(id);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.focus({ preventScroll: true });
  }, []);

  const handleRandom = useCallback(() => {
    if (filteredPrompts.length === 0) return;
    const candidates = filteredPrompts.length > 1
      ? filteredPrompts.filter((prompt) => prompt.id !== selectedPromptId)
      : filteredPrompts;
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    select(selected.id);
    focusCard(selected.id);
  }, [filteredPrompts, focusCard, select, selectedPromptId]);

  const handleCopy = useCallback(async (text: string) => {
    const result = await copyTextToClipboard(text);
    if (!result.success) setActionError(result.error || 'Could not copy the prompt.');
  }, []);

  const empty = !isLoading && !error && prompts.length === 0;
  const noMatches = !isLoading && !error && prompts.length > 0 && filteredPrompts.length === 0;
  const countLabel = query ? `${filteredPrompts.length} of ${prompts.length}` : `${prompts.length} saved`;

  return (
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
        <button
          type="button"
          onClick={handleRandom}
          disabled={filteredPrompts.length === 0}
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

      {filteredPrompts.length > 0 && (
        <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 overflow-y-auto pb-4 pr-1">
          {filteredPrompts.map((prompt) => {
            const expanded = expandedId === prompt.id;
            const selected = selectedPromptId === prompt.id;
            const menuOpen = menuId === prompt.id;
            return (
              <article
                key={prompt.id}
                ref={(element) => {
                  if (element) cardRefs.current.set(prompt.id, element);
                  else cardRefs.current.delete(prompt.id);
                }}
                tabIndex={-1}
                aria-current={selected ? 'true' : undefined}
                className={`relative overflow-visible rounded-xl border bg-gray-900/75 shadow-sm outline-none transition-all ${
                  selected
                    ? 'border-accent ring-2 ring-accent/70 shadow-lg shadow-accent/10'
                    : 'border-gray-800 hover:border-gray-700'
                }`}
              >
                <div className="overflow-hidden rounded-t-xl">
                  <PromptSourcePreview prompt={prompt} onViewSource={onViewSource} onError={setActionError} />
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
                      <div className="text-[11px] text-gray-600">Saved {new Date(prompt.createdAt).toLocaleString()}</div>
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
  );
};

export default PromptLibrary;
