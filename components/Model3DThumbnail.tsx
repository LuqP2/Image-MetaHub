import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from 'lucide-react';
import type { IndexedImage } from '../types';
import Model3DViewer from './Model3DViewer';
import cacheManager from '../services/cacheManager';
import { getModel3DThumbnailId, type Model3DThumbnailVariant } from '../services/thumbnailCache';

const MAX_CONCURRENT_RENDERS = 2;
const MAX_CACHED_THUMBNAILS = 120;
let activeRenders = 0;
const waiters: Array<() => void> = [];
const thumbnailCache = new Map<string, string>();

const acquireRenderSlot = (): Promise<() => void> => new Promise((resolve) => {
  const start = () => {
    activeRenders += 1;
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      activeRenders = Math.max(0, activeRenders - 1);
      waiters.shift()?.();
    });
  };
  if (activeRenders < MAX_CONCURRENT_RENDERS) start();
  else waiters.push(start);
});

const rememberThumbnail = (key: string, blob: Blob): string => {
  const existing = thumbnailCache.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  thumbnailCache.set(key, url);
  if (thumbnailCache.size > MAX_CACHED_THUMBNAILS) {
    const oldest = thumbnailCache.entries().next().value as [string, string] | undefined;
    if (oldest) {
      thumbnailCache.delete(oldest[0]);
      URL.revokeObjectURL(oldest[1]);
    }
  }
  return url;
};

interface Model3DThumbnailProps {
  image: IndexedImage;
  directoryPath?: string;
  className?: string;
  variant?: Model3DThumbnailVariant;
}

const Model3DThumbnail: React.FC<Model3DThumbnailProps> = ({ image, directoryPath, className = '', variant = 'grid' }) => {
  const cacheKey = getModel3DThumbnailId(image, variant);
  const rootRef = useRef<HTMLDivElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(() => thumbnailCache.get(cacheKey) || null);
  const [cacheChecked, setCacheChecked] = useState(() => Boolean(thumbnailCache.get(cacheKey)) || !window.electronAPI);
  const [shouldRender, setShouldRender] = useState(false);
  const [failed, setFailed] = useState(false);

  const release = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
    setShouldRender(false);
  }, []);

  useEffect(() => {
    const cached = thumbnailCache.get(cacheKey) || null;
    setThumbnailUrl(cached);
    setCacheChecked(Boolean(cached) || !window.electronAPI);
    setFailed(false);
  }, [cacheKey]);

  useEffect(() => {
    if (thumbnailUrl || cacheChecked) return;
    let cancelled = false;
    void cacheManager.getCachedThumbnail(cacheKey).then((blob) => {
      if (!cancelled && blob) setThumbnailUrl(rememberThumbnail(cacheKey, blob));
    }).finally(() => {
      if (!cancelled) setCacheChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [cacheChecked, cacheKey, thumbnailUrl]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || !cacheChecked || thumbnailUrl || failed) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void acquireRenderSlot().then((releaseSlot) => {
        if (cancelled) {
          releaseSlot();
          return;
        }
        releaseRef.current = releaseSlot;
        setShouldRender(true);
      });
    }, { rootMargin: '160px' });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [cacheChecked, failed, thumbnailUrl]);

  useEffect(() => {
    if (!shouldRender) return;
    const timeout = window.setTimeout(() => {
      setFailed(true);
      release();
    }, 30000);
    return () => window.clearTimeout(timeout);
  }, [release, shouldRender]);

  const handleSnapshot = useCallback((blob: Blob) => {
    setThumbnailUrl(rememberThumbnail(cacheKey, blob));
    void cacheManager.cacheThumbnail(cacheKey, blob);
    release();
  }, [cacheKey, release]);

  const handleError = useCallback(() => {
    setFailed(true);
    release();
  }, [release]);

  return (
    <div ref={rootRef} className={`relative h-full w-full overflow-hidden bg-gray-950 ${className}`}>
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt={image.name} className="h-full w-full object-cover" draggable={false} />
      ) : shouldRender ? (
        <Model3DViewer
          image={image}
          directoryPath={directoryPath}
          showControls={false}
          compact
          onSnapshot={handleSnapshot}
          onError={handleError}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-950 text-violet-300">
          <Box className="h-7 w-7" />
          <span className="text-[10px] font-medium">3D</span>
          {failed && <span className="text-[9px] text-gray-500">Preview unavailable</span>}
        </div>
      )}
    </div>
  );
};

export default React.memo(Model3DThumbnail);
