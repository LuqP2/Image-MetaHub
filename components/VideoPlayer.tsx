import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, RotateCcw, Repeat } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  onEnded?: () => void;
  onError?: (error: string) => void;
}

/**
 * VideoPlayer component for displaying videos with custom controls
 */
const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  poster,
  className = '',
  autoPlay = false,
  loop = false,
  muted = true,
  onEnded,
  onError
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(muted);
  const [isLooping, setIsLooping] = useState(loop);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hideControlsTimer = useRef<NodeJS.Timeout | null>(null);

  // Toggle loop
  const toggleLoop = () => {
    if (videoRef.current) {
      videoRef.current.loop = !isLooping;
    }
    setIsLooping(!isLooping);
  };

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle play/pause toggle
  const togglePlay = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(err => {
        console.error('Video play error:', err);
        setError('Failed to play video');
        onError?.('Failed to play video');
      });
    }
    setIsPlaying(!isPlaying);
  };

  // Handle mute toggle
  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Handle seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // Handle fullscreen
  const toggleFullscreen = () => {
    if (!videoRef.current) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoRef.current.requestFullscreen().catch(err => {
        console.error('Fullscreen error:', err);
      });
    }
  };

  // Restart video
  const restartVideo = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    setCurrentTime(0);
    if (!isPlaying) {
      togglePlay();
    }
  };

  // Auto-hide controls
  const resetControlsTimer = () => {
    setShowControls(true);
    if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current);
    }
    if (isPlaying) {
      hideControlsTimer.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      onEnded?.();
    };
    const handleError = () => {
      const errorMsg = 'Failed to load video';
      setError(errorMsg);
      onError?.(errorMsg);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [onEnded, onError]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
      }
    };
  }, []);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 text-red-400 ${className}`}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div
      className={`relative group ${className}`}
      onMouseMove={resetControlsTimer}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain bg-black"
        autoPlay={autoPlay}
        loop={isLooping}
        muted={muted}
        playsInline
        onClick={togglePlay}
      />

      {/* Play button overlay (shown when paused) */}
      {!isPlaying && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={togglePlay}
        >
          <div className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors">
            <Play className="w-8 h-8 text-white ml-1" fill="white" />
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Progress bar */}
        <div className="mb-2">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
            style={{
              background: `linear-gradient(to right, rgb(168, 85, 247) ${(currentTime / duration) * 100}%, rgb(75, 85, 99) ${(currentTime / duration) * 100}%)`
            }}
          />
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="text-white hover:text-purple-400 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5" />
              )}
            </button>

            {/* Restart */}
            <button
              onClick={restartVideo}
              className="text-white hover:text-purple-400 transition-colors"
              title="Restart"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Mute/Unmute */}
            <button
              onClick={toggleMute}
              className="text-white hover:text-purple-400 transition-colors"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <VolumeX className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
            </button>

            {/* Loop toggle */}
            <button
              onClick={toggleLoop}
              className={`transition-colors ${
                isLooping ? 'text-purple-400' : 'text-white hover:text-purple-400'
              }`}
              title={isLooping ? 'Disable loop' : 'Enable loop'}
            >
              <Repeat className="w-4 h-4" />
            </button>

            {/* Time display */}
            <span className="text-white text-sm font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="text-white hover:text-purple-400 transition-colors"
              title="Fullscreen"
            >
              <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
