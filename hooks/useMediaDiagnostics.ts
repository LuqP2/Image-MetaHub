import { type SyntheticEvent, useCallback, useMemo } from 'react';

export const MEDIA_DIAGNOSTIC_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'canplay',
  'play',
  'playing',
  'error',
  'stalled',
  'suspend',
  'abort',
  'emptied',
] as const;

export type MediaDiagnosticEventName = typeof MEDIA_DIAGNOSTIC_EVENTS[number];

export interface MediaDiagnosticsContext {
  mediaKind: 'audio' | 'video';
  fileName: string;
  surface: string;
  src?: string | null;
}

const getSrcScheme = (src?: string | null): string | null => {
  if (!src) return null;

  const match = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(src);
  return match?.[1] ?? null;
};

const getMediaErrorMessage = (error: MediaError | null): string | null => {
  if (!error) return null;
  return error.message || null;
};

export function useMediaDiagnostics(context: MediaDiagnosticsContext) {
  const logMediaEvent = useCallback(
    (event: SyntheticEvent<HTMLMediaElement>) => {
      const element = event.currentTarget;
      const mediaError = element.error;

      window.electronAPI?.logMediaPlaybackEvent?.({
        mediaKind: context.mediaKind,
        surface: context.surface,
        eventName: event.type,
        fileName: context.fileName,
        srcScheme: getSrcScheme(context.src ?? element.currentSrc ?? element.src),
        currentTime: Number.isFinite(element.currentTime) ? element.currentTime : null,
        readyState: element.readyState,
        networkState: element.networkState,
        errorCode: mediaError?.code ?? null,
        errorMessage: getMediaErrorMessage(mediaError),
      });
    },
    [context.fileName, context.mediaKind, context.src, context.surface],
  );

  return useMemo(
    () => ({
      onLoadStart: logMediaEvent,
      onLoadedMetadata: logMediaEvent,
      onCanPlay: logMediaEvent,
      onPlay: logMediaEvent,
      onPlaying: logMediaEvent,
      onError: logMediaEvent,
      onStalled: logMediaEvent,
      onSuspend: logMediaEvent,
      onAbort: logMediaEvent,
      onEmptied: logMediaEvent,
    }),
    [logMediaEvent],
  );
}
