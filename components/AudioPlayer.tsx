import React from 'react';
import { Music } from 'lucide-react';

interface AudioPlayerProps {
  src: string;
  title: string;
  autoPlay?: boolean;
  compact?: boolean;
  onContextMenu?: React.MouseEventHandler;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  title,
  autoPlay = false,
  compact = false,
  onContextMenu,
}) => {
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
      />
    </div>
  );
};

export default AudioPlayer;
