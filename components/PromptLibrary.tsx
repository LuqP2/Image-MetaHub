import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Dices, ExternalLink, Library, Trash2 } from 'lucide-react';
import type { SavedPrompt } from '../types';
import { resolveSavedPromptSource } from '../services/savedPromptService';
import { initializeSavedPromptSynchronization, useSavedPromptStore } from '../store/useSavedPromptStore';
import { copyTextToClipboard } from '../utils/imageUtils';

interface PromptLibraryProps {
  onViewSource: (absolutePath: string) => void | Promise<void>;
}

const PromptSourceAction: React.FC<{
  prompt: SavedPrompt;
  onViewSource: (absolutePath: string) => void | Promise<void>;
  onError: (message: string) => void;
}> = ({ prompt, onViewSource, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolution, setResolution] = useState<Awaited<ReturnType<typeof resolveSavedPromptSource>> | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const resolve = async () => {
      setIsResolving(true);
      try {
        const next = await resolveSavedPromptSource(prompt.id);
        if (cancelled) return;
        setResolution(next);
        if (next.status === 'available' && window.electronAPI?.generateThumbnailFromPath) {
          const result = await window.electronAPI.generateThumbnailFromPath({ filePath: next.absolutePath, maxEdge: 160, quality: 78 });
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
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [onError, prompt.id]);

  const unavailable = resolution?.status === 'unavailable';
  const changed = resolution?.status === 'available' && resolution.sourceChanged;
  return (
    <div ref={containerRef} className="flex items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-700 bg-gray-950 text-[9px] text-gray-600">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="Current source" className="h-full w-full object-cover" /> : 'No preview'}
      </div>
      <button
        type="button"
        className="app-top-pill px-2.5 py-1.5 text-xs"
        onClick={() => resolution?.status === 'available' && void onViewSource(resolution.absolutePath)}
        disabled={isResolving || !resolution || unavailable}
      >
        <ExternalLink size={13} />
        {isResolving || !resolution ? 'Checking…' : unavailable ? 'Source unavailable' : 'View Source'}
      </button>
      {changed && <span className="text-xs text-amber-300">Source has changed</span>}
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => initializeSavedPromptSynchronization(), []);

  const handleRandom = useCallback(() => {
    if (prompts.length === 0) return;
    const candidates = prompts.length > 1
      ? prompts.filter((prompt) => prompt.id !== selectedPromptId)
      : prompts;
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    select(selected.id);
    cardRefs.current.get(selected.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [prompts, select, selectedPromptId]);

  const handleCopy = useCallback(async (text: string) => {
    const result = await copyTextToClipboard(text);
    if (!result.success) setActionError(result.error || 'Could not copy the prompt.');
  }, []);

  const empty = !isLoading && !error && prompts.length === 0;
  const countLabel = useMemo(() => `${prompts.length} saved ${prompts.length === 1 ? 'prompt' : 'prompts'}`, [prompts.length]);

  return (
    <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/70 p-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-gray-100">
            <Library size={19} />
            Prompt Library
          </div>
          <p className="mt-1 text-sm text-gray-400">{countLabel}. Saved across your whole profile.</p>
        </div>
        <button
          type="button"
          onClick={handleRandom}
          disabled={prompts.length === 0}
          className="app-top-pill px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Dices size={15} />
          Random
        </button>
      </div>

      {(error || actionError) && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {actionError || error}
          {error && (
            <button type="button" className="ml-3 underline" onClick={() => void load()}>Try again</button>
          )}
        </div>
      )}

      {isLoading && prompts.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">Loading saved prompts…</div>
      )}
      {empty && (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 p-8 text-center">
          <Library size={30} className="mb-3 text-gray-500" />
          <p className="font-medium text-gray-200">No saved prompts yet</p>
          <p className="mt-1 max-w-md text-sm text-gray-500">Use Save Prompt beside a prompt or from an image context menu.</p>
        </div>
      )}

      {prompts.length > 0 && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 pr-1">
          {prompts.map((prompt) => {
            return (
              <article
                key={prompt.id}
                ref={(element) => {
                  if (element) cardRefs.current.set(prompt.id, element);
                  else cardRefs.current.delete(prompt.id);
                }}
                className={`rounded-xl border bg-gray-900/70 p-4 transition-colors ${
                  selectedPromptId === prompt.id ? 'border-accent/70 ring-1 ring-accent/30' : 'border-gray-800'
                }`}
              >
                <div className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-100">{prompt.positivePrompt}</div>
                {prompt.negativePrompt && (
                  <details className="mt-3 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-gray-400">Negative prompt</summary>
                    <div className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-300">{prompt.negativePrompt}</div>
                  </details>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" className="app-top-pill px-2.5 py-1.5 text-xs" onClick={() => void handleCopy(prompt.positivePrompt)}>
                    <Copy size={13} /> Copy
                  </button>
                  {prompt.negativePrompt && (
                    <button type="button" className="app-top-pill px-2.5 py-1.5 text-xs" onClick={() => void handleCopy(prompt.negativePrompt)}>
                      <Copy size={13} /> Copy Negative
                    </button>
                  )}
                  {prompt.source && (
                    <PromptSourceAction prompt={prompt} onViewSource={onViewSource} onError={setActionError} />
                  )}
                  <span className="ml-auto text-xs text-gray-500">{new Date(prompt.createdAt).toLocaleString()}</span>
                  {confirmingId === prompt.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                        onClick={async () => {
                          try { await remove(prompt.id); setConfirmingId(null); } catch (cause) {
                            setActionError(cause instanceof Error ? cause.message : 'Could not remove the saved prompt.');
                          }
                        }}
                      >Remove</button>
                      <button type="button" className="app-top-pill px-2.5 py-1.5 text-xs" onClick={() => setConfirmingId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button type="button" className="app-top-icon-button h-8 w-8 text-gray-400 hover:text-red-300" onClick={() => setConfirmingId(prompt.id)} title="Remove saved prompt" aria-label="Remove saved prompt">
                      <Trash2 size={14} />
                    </button>
                  )}
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
