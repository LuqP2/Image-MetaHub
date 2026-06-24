import React from 'react';
import { AlertTriangle, ExternalLink, Music } from 'lucide-react';
import { type MediaDiagnosticsContext, useMediaDiagnostics } from '../hooks/useMediaDiagnostics';

interface AudioPlayerProps {
  src: string;
  title: string;
  autoPlay?: boolean;
  compact?: boolean;
  onContextMenu?: React.MouseEventHandler;
  onLoadedMetadata?: React.ReactEventHandler<HTMLAudioElement>;
  onCanPlay?: React.ReactEventHandler<HTMLAudioElement>;
  onPlaying?: React.ReactEventHandler<HTMLAudioElement>;
  externalPath?: string | null;
  diagnostics?: Omit<MediaDiagnosticsContext, 'mediaKind' | 'src'>;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  title,
  autoPlay = false,
  compact = false,
  onContextMenu,
  onLoadedMetadata,
  onCanPlay,
  onPlaying,
  externalPath,
  diagnostics,
}) => {
  const [audioRendererFailed, setAudioRendererFailed] = React.useState(false);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const handleAudioRendererError = React.useCallback(() => {
    setAudioRendererFailed(true);
  }, []);
  const mediaDiagnostics = useMediaDiagnostics({
    mediaKind: 'audio',
    fileName: diagnostics?.fileName ?? title,
    surface: diagnostics?.surface ?? 'audio-player',
    src,
    hasAudioTrack: true,
    onAudioRendererError: handleAudioRendererError,
  });

  React.useEffect(() => {
    setAudioRendererFailed(false);
    setOpenError(null);
  }, [src]);

  const openExternally = React.useCallback(async () => {
    if (!externalPath) return;
    const result = await window.electronAPI?.openPath?.(externalPath);
    if (!result?.success) {
      setOpenError(result?.error || 'Failed to open media externally.');
    }
  }, [externalPath]);

  if (audioRendererFailed) {
    return (
      <div
        data-media-element="true"
        className={`flex w-full flex-col items-center justify-center bg-black text-gray-100 ${compact ? 'gap-3 p-4' : 'h-full gap-5 p-8'}`}
        onContextMenu={onContextMenu}
      >
        <div className={`rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-200 ${compact ? 'p-3' : 'p-6'}`}>
          <AlertTriangle className={compact ? 'h-8 w-8' : 'h-16 w-16'} />
        </div>
        <div className="max-w-full text-center">
          <p className={`truncate font-medium text-gray-100 ${compact ? 'text-sm' : 'text-lg'}`} title={title}>
            Audio playback failed in Electron
          </p>
          <p className="mt-1 max-w-md text-xs text-gray-400">
            The macOS audio service failed while initializing playback.
          </p>
        </div>
        <button
          type="button"
          onClick={openExternally}
          disabled={!externalPath}
          className="inline-flex items-center gap-2 rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-100 transition-colors hover:border-gray-500 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ExternalLink className="h-4 w-4" />
          Open Externally
        </button>
        {openError && <p className="max-w-md text-center text-xs text-red-300">{openError}</p>}
      </div>
    );
  }

  return (
    <div
      data-media-element="true"
      className={`flex w-full flex-col items-center justify-center bg-black text-gray-100 ${compact ? 'gap-3 p-4' : 'h-full gap-5 p-8'}`}
      onContextMenu={onContextMenu}
    >
      <div className={`rounded-full border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 ${compact ? 'p-3' : 'p-6'}`}>
        <Music className={compact ? 'h-8 w-8' : 'h-16 w-16'} />
      </div>
      <div className="max-w-full text-center">
        <p className={`truncate font-medium text-gray-100 ${compact ? 'text-sm' : 'text-lg'}`} title={title}>
          {title}
        </p>
        <p className="mt-1 text-xs text-gray-400">Audio</p>
      </div>
      <audio
        src={src}
        controls
        autoPlay={autoPlay}
        preload="metadata"
        className="w-full max-w-2xl"
        onLoadStart={mediaDiagnostics.onLoadStart}
        onLoadedMetadata={(event) => {
          mediaDiagnostics.onLoadedMetadata(event);
          onLoadedMetadata?.(event);
        }}
        onCanPlay={(event) => {
          mediaDiagnostics.onCanPlay(event);
          onCanPlay?.(event);
        }}
        onPlay={mediaDiagnostics.onPlay}
        onPlaying={(event) => {
          mediaDiagnostics.onPlaying(event);
          onPlaying?.(event);
        }}
        onError={mediaDiagnostics.onError}
        onStalled={mediaDiagnostics.onStalled}
        onSuspend={mediaDiagnostics.onSuspend}
        onAbort={mediaDiagnostics.onAbort}
        onEmptied={mediaDiagnostics.onEmptied}
      />
    </div>
  );
};

export default AudioPlayer;
