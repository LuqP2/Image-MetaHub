import React, { FC, ReactNode, useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { lookupRef, peekCachedRef, type LookupResult } from '../services/civitai/civitaiLookup';
import { type ResourceRef } from '../services/civitai/resourceExtraction';

interface CivitaiResourceLinkProps {
  resource: ResourceRef;
  children: ReactNode;
}

type ViewState = 'idle' | 'loading' | LookupResult['status'];

const TOOLTIP_IDLE = 'Open on Civitai — makes a one-time request; the result is cached locally.';

/**
 * Wraps a model/LoRA label so it links to Civitai on demand. On mount it only
 * reads the local cache (no network). Clicking resolves the reference through
 * the Electron main process and opens the page in the browser; results are
 * cached so a reference is fetched at most once. When the Civitai lookup setting
 * is off, the label renders as plain text with no network affordance.
 */
export const CivitaiResourceLink: FC<CivitaiResourceLinkProps> = ({ resource, children }) => {
  const enabled = useSettingsStore((state) => state.civitaiLookupEnabled);
  const [state, setState] = useState<ViewState>('idle');
  const [url, setUrl] = useState<string | null>(null);

  const refIdentity = resource.hash ?? resource.modelVersionId;

  useEffect(() => {
    let cancelled = false;
    setState('idle');
    setUrl(null);
    peekCachedRef(resource).then((cached) => {
      if (cancelled || !cached) return;
      if (cached.status === 'found') {
        setUrl(cached.hit.url);
        setState('found');
      } else if (cached.status === 'notFound') {
        setState('notFound');
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refIdentity]);

  const open = (target: string) => {
    window.electronAPI?.openExternalUrl?.(target);
  };

  const handleClick = async () => {
    if (url) {
      open(url);
      return;
    }
    if (state === 'loading') return;
    setState('loading');
    const result = await lookupRef(resource);
    if (result.status === 'found') {
      setUrl(result.hit.url);
      setState('found');
      open(result.hit.url);
    } else {
      setState(result.status);
    }
  };

  // Setting disabled: plain text, no affordance.
  if (!enabled) {
    return <>{children}</>;
  }

  // Confirmed absent from Civitai: plain text with a quiet hint.
  if (state === 'notFound') {
    return (
      <span title="Not found on Civitai" className="text-gray-200">
        {children}
      </span>
    );
  }

  const title =
    state === 'unavailable'
      ? 'Civitai is unavailable right now. Click to try again.'
      : state === 'found'
        ? 'Open on Civitai'
        : TOOLTIP_IDLE;

  const colorClass =
    state === 'unavailable'
      ? 'text-amber-400 hover:text-amber-300 decoration-amber-400/40'
      : 'text-blue-400 hover:text-blue-300 decoration-blue-400/40';

  // `inline` (not inline-flex) so long, space-less model names wrap/break inside
  // the box instead of overflowing; the icon trails inline.
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
      title={title}
      className={`cursor-pointer break-all underline decoration-dotted underline-offset-2 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded-sm ${colorClass}`}
    >
      {children}
      {state === 'loading' ? (
        <Loader2 className="inline-block w-3 h-3 ml-0.5 align-[-2px] animate-spin" />
      ) : (
        <ExternalLink className="inline-block w-3 h-3 ml-0.5 align-[-2px]" />
      )}
    </span>
  );
};

export default CivitaiResourceLink;
