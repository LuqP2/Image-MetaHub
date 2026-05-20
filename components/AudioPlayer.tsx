import React from 'react';
import { Music } from 'lucide-react';
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
  diagnostics,
}) => {
  const mediaDiagnostics = useMediaDiagnostics({
    mediaKind: 'audio',
    fileName: diagnostics?.fileName ?? title,
    surface: diagnostics?.surface ?? 'audio-player',
    src,
  });

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
