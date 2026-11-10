import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { IndexedImage } from '../../types';
import { mediaSourceCache } from '../../services/mediaSourceCache';
import { useSettingsStore } from '../../store/useSettingsStore';

export default function BoardVideoPreview({ image, directoryPath, poster }: { image: IndexedImage; directoryPath?: string; poster?: string }) {
  const autoplay = useSettingsStore(state => state.canvasAutoplayVideos);
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<string>();
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(!autoplay);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setPaused(!autoplay); }, [autoplay]);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void mediaSourceCache.getOrLoad(image, directoryPath).then(url => {
      if (!cancelled) setSource(url);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [visible, image.id, image.handle, image.lastModified, directoryPath]);

  useEffect(() => {
    const element = video.current;
    if (!element || !source) return;
    let active = true;
    const play = () => void element.play().catch((error: unknown) => {
      // Scrolling away or hiding the window can interrupt an in-flight play().
      if (active && !document.hidden && !(error instanceof DOMException && error.name === 'AbortError')) setPaused(true);
    });
    if (visible && !paused && !document.hidden) play();
    else element.pause();
    const onVisibility = () => {
      if (document.hidden) { element.pause(); setMuted(true); }
      else if (visible && !paused) play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { active = false; element.pause(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [visible, paused, source]);

  useEffect(() => { if (!visible) setMuted(true); }, [visible]);

  return <div ref={root} className="board-video-preview">
    {failed ? <>{poster && <img src={poster} alt={image.name} draggable={false} />}<span className="board-video-error">Playback unavailable</span></>
      : <video ref={video} src={source} poster={poster} muted={muted} loop playsInline preload="metadata" aria-label={image.name} onError={() => setFailed(true)} />}
    {!failed && <div className="board-video-controls nodrag nopan" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <button type="button" aria-label={paused ? 'Play video' : 'Pause video'} onClick={event => { event.stopPropagation(); setPaused(value => !value); }}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
      <button type="button" aria-label={muted ? 'Unmute video' : 'Mute video'} aria-pressed={!muted} onClick={event => { event.stopPropagation(); setMuted(value => !value); }}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
    </div>}
  </div>;
}
