import { type SyntheticEvent, useCallback, useMemo } from 'react';
import { isMacPlatform } from '../utils/platform';

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
  hasAudioTrack?: boolean;
  onAudioRendererError?: () => void;
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

export const isAudioRendererErrorMessage = (message?: string | null): boolean =>
  typeof message === 'string' && message.includes('AUDIO_RENDERER_ERROR');

const isMacElectronRenderer = (): boolean => {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return false;
  }

  return isMacPlatform();
};

export function useMediaDiagnostics(context: MediaDiagnosticsContext) {
  const logMediaEvent = useCallback(
    (event: SyntheticEvent<HTMLMediaElement>) => {
      const element = event.currentTarget;
      const mediaError = element.error;
      const errorMessage = getMediaErrorMessage(mediaError);

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
        errorMessage,
      });

      const shouldOfferMacAudioFallback = event.type === 'error'
        && isMacElectronRenderer()
        && (context.mediaKind === 'audio' || context.hasAudioTrack === true);

      if (event.type === 'error' && (isAudioRendererErrorMessage(errorMessage) || shouldOfferMacAudioFallback)) {
        context.onAudioRendererError?.();
      }
    },
    [context.fileName, context.hasAudioTrack, context.mediaKind, context.onAudioRendererError, context.src, context.surface],
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
