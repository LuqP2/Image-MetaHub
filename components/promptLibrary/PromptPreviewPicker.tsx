import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IndexedImage } from '../../types';
import { useImageStore } from '../../store/useImageStore';
import { useResolvedThumbnail } from '../../hooks/useResolvedThumbnail';
import { thumbnailManager } from '../../services/thumbnailManager';
import { buttonClass, fieldClass } from './PromptVariables';

function PreviewChoice({ image, disabled, onChoose }: { image: IndexedImage; disabled: boolean; onChoose: () => void }) {
  const thumbnail = useResolvedThumbnail(image);
  useEffect(() => { void thumbnailManager.loadIndexedThumbnail(image).catch(() => {}); }, [image.id, image.lastModified]);
  return <button type="button" disabled={disabled} className="min-w-0 rounded-lg border border-gray-700 p-2 text-left hover:border-accent focus-visible:outline focus-visible:outline-accent disabled:opacity-50" onClick={onChoose} title={image.name}>
    {thumbnail?.thumbnailUrl ? <img src={thumbnail.thumbnailUrl} alt="" className="h-24 w-full rounded object-contain" /> : <div className="flex h-24 items-center justify-center text-xs text-gray-500">{thumbnail?.thumbnailStatus === 'error' ? 'Thumbnail unavailable' : 'Loading…'}</div>}
    <p className="mt-1 truncate text-xs">{image.name}</p>
  </button>;
}

export default function PromptPreviewPicker({ busy, error, onChoose, onClose }: {
  busy: boolean; error: string; onChoose: (image: IndexedImage) => void; onClose: () => void;
}) {
  const images = useImageStore(state => state.images);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  const matches = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return images.filter(image => {
      if (!image.fileType?.startsWith('image/') && !/\.(png|jpe?g|webp|gif|avif)$/i.test(image.name)) return false;
      const metadata = image.metadata?.normalizedMetadata;
      const text = [image.name, metadata?.prompt, metadata?.negativePrompt, metadata?.model].join(' ').toLowerCase();
      return terms.every(term => text.includes(term));
    });
  }, [images, query]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [busy, onClose]);
  return createPortal(<div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/70 p-4" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Choose preview image" aria-busy={busy} className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 rounded-xl border border-gray-700 bg-gray-900 p-4 text-gray-100" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Choose preview image</h3><button type="button" className={buttonClass} disabled={busy} onClick={onClose}>Cancel</button></header>
      <input autoFocus aria-label="Search Library images" placeholder="Search Library by filename, prompt or model" className={fieldClass} value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setLimit(60); }} />
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {busy && <p role="status" className="text-xs text-gray-400">Saving preview…</p>}
      <div className="min-h-0 overflow-y-auto"><div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">{matches.slice(0, limit).map(image => <PreviewChoice key={image.id} image={image} disabled={busy} onChoose={() => onChoose(image)} />)}</div>
        {!matches.length && <p className="py-6 text-sm text-gray-400">{images.length ? 'No matching images.' : 'Add images to the Library to choose a preview.'}</p>}
        {matches.length > limit && <button type="button" className={buttonClass + ' mt-3'} disabled={busy} onClick={() => setLimit(value => value + 60)}>Show more</button>}
      </div>
    </section>
  </div>, document.body);
}
