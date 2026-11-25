import React, { useEffect, useState } from 'react';
import type { Directory, IndexedImage } from '../../types';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';
import { resolveImageTeamContext } from '../../services/team/reviewService';

interface TeamPinOverlayProps {
  image: IndexedImage;
  directories: Directory[];
  imageRef: React.RefObject<HTMLImageElement | null>;
  zoom?: number;
  pan?: { x: number; y: number };
}

interface OverlayBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const TeamPinOverlay: React.FC<TeamPinOverlayProps> = ({
  image,
  directories,
  imageRef,
  zoom = 1,
  pan = { x: 0, y: 0 },
}) => {
  const workspacesById = useTeamWorkspaceStore((state) => state.workspacesById);
  const assetStatesByWorkspace = useTeamWorkspaceStore((state) => state.assetStatesByWorkspace);
  const pinPlacementActive = useTeamWorkspaceStore((state) => state.pinPlacementActive);
  const draftPin = useTeamWorkspaceStore((state) => state.draftPin);
  const highlightedCommentId = useTeamWorkspaceStore((state) => state.highlightedCommentId);
  const setDraftPin = useTeamWorkspaceStore((state) => state.setDraftPin);
  const setPinPlacementActive = useTeamWorkspaceStore((state) => state.setPinPlacementActive);
  const setHighlightedCommentId = useTeamWorkspaceStore((state) => state.setHighlightedCommentId);

  const [bounds, setBounds] = useState<OverlayBounds | null>(null);

  const context = resolveImageTeamContext(
    image,
    directories,
    workspacesById,
    assetStatesByWorkspace,
  );

  useEffect(() => {
    if (!context) return;
    const imgEl = imageRef.current;
    const parentEl = imgEl?.offsetParent as HTMLElement | null;
    if (!imgEl || !parentEl) return;

    const update = () => {
      const imgRect = imgEl.getBoundingClientRect();
      const parentRect = parentEl.getBoundingClientRect();
      if (imgRect.width <= 0 || imgRect.height <= 0) return;
      setBounds({
        left: imgRect.left - parentRect.left,
        top: imgRect.top - parentRect.top,
        width: imgRect.width,
        height: imgRect.height,
      });
    };

    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(imgEl);
    observer?.observe(parentEl);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [context, imageRef, zoom, pan.x, pan.y, image.id]);

  if (!context || !bounds) return null;

  const pinnedComments = (context.assetState?.comments ?? []).filter((c) => Boolean(c.pin));
  if (!pinPlacementActive && !draftPin && pinnedComments.length === 0) return null;

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!pinPlacementActive && !event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setDraftPin({
      x: Math.round(x * 10_000) / 10_000,
      y: Math.round(y * 10_000) / 10_000,
    });
    setPinPlacementActive(false);
  };

  return (
    <div
      data-no-window-drag="true"
      onClick={handleOverlayClick}
      className={`absolute z-20 ${pinPlacementActive ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
    >
      {pinnedComments.map((comment, idx) => {
        const isHighlighted = highlightedCommentId === comment.commentId;
        return (
          <button
            key={comment.commentId}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHighlightedCommentId(isHighlighted ? null : comment.commentId);
            }}
            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold shadow-lg transition-transform ${
              comment.resolved
                ? 'border-emerald-300/70 bg-emerald-900/70 text-emerald-100 opacity-60'
                : isHighlighted
                  ? 'scale-125 border-white bg-blue-500 text-white ring-4 ring-blue-400/40'
                  : 'border-white bg-amber-500 text-gray-950 hover:scale-110'
            }`}
            style={{
              left: `${(comment.pin?.x ?? 0) * 100}%`,
              top: `${(comment.pin?.y ?? 0) * 100}%`,
            }}
            title={`${comment.authorName || comment.deviceId}: ${comment.text}`}
          >
            {idx + 1}
          </button>
        );
      })}

      {draftPin && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-blue-500 text-[11px] font-bold text-white shadow-lg animate-pulse"
          style={{
            left: `${draftPin.x * 100}%`,
            top: `${draftPin.y * 100}%`,
          }}
        >
          +
        </div>
      )}
    </div>
  );
};
