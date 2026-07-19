import React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { IndexedImage } from '../types';
import { useHoverScrub } from '../hooks/useHoverScrub';

export interface ScopeCardProps {
  /** Images backing the cover hover-scrub (first is the default cover). */
  images: IndexedImage[];
  /** Fallback/placeholder icon and the icon shown in the count pill. */
  icon: LucideIcon;
  /** Alt text / accessible label for the cover image. */
  coverAlt: string;
  /** Content of the top-left count pill after the icon (e.g. a number or "3/5"). */
  countLabel: React.ReactNode;
  /** Card title (truncated). */
  title: string;
  /** title attribute for the heading (defaults to `title`). */
  titleAttr?: string;
  /** Footer content rendered under the title. */
  subtitle?: React.ReactNode;
  /** Accessible label for the card button. */
  ariaLabel?: string;
  /** Top-right badge (e.g. a collection's Auto/Linked tag). */
  badge?: React.ReactNode;
  /** Top-right secondary action (e.g. a model's "Match prompts" pill). */
  secondaryAction?: React.ReactNode;
  /** Full-cover overlay (e.g. a cluster's Pro lock). */
  overlay?: React.ReactNode;
  /** Blurs the cover image (e.g. locked clusters). */
  coverBlur?: boolean;
  /** Disables the hover-scrub pointer handlers (e.g. locked clusters). */
  disableScrub?: boolean;
  /** Active/selected styling (ring). */
  isActive?: boolean;
  onClick: () => void;
  /** Overrides the border/hover variant classes. */
  variantClassName?: string;
  /** Footer padding/spacing (defaults to p-3). */
  contentClassName?: string;
  /** Progress-bar fill color class (defaults to blue). */
  progressClassName?: string;
}

const BASE_CLASS =
  'group text-left bg-gray-900/60 border rounded-2xl overflow-hidden shadow-lg transition-all cursor-pointer';

const DEFAULT_VARIANT =
  'border-gray-800 hover:shadow-xl hover:shadow-blue-500/20 hover:border-blue-500/30';

const ACTIVE_VARIANT = 'border-blue-400/70 shadow-blue-500/20';

/**
 * Generic drill-in card for the "Explore" surfaces. Owns the shared cover
 * hover-scrub and card shell; per-dimension differences (badge, overlay,
 * secondary action, active ring) come in as slots. Replaces ModelCard,
 * StackCard and CollectionCard.
 */
const ScopeCard: React.FC<ScopeCardProps> = ({
  images,
  icon: Icon,
  coverAlt,
  countLabel,
  title,
  titleAttr,
  subtitle,
  ariaLabel,
  badge,
  secondaryAction,
  overlay,
  coverBlur = false,
  disableScrub = false,
  isActive = false,
  onClick,
  variantClassName,
  contentClassName = 'p-3',
  progressClassName = 'bg-blue-400/80',
}) => {
  const { cardRef, coverUrl, progress, hasMultiple, handlePointerMove, handlePointerLeave } =
    useHoverScrub(images);

  const variant = variantClassName ?? (isActive ? ACTIVE_VARIANT : DEFAULT_VARIANT);

  return (
    <button
      ref={cardRef}
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onPointerMove={disableScrub ? undefined : handlePointerMove}
      onPointerLeave={disableScrub ? undefined : handlePointerLeave}
      className={`${BASE_CLASS} ${variant}`}
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={coverAlt}
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
              coverBlur ? 'blur-lg' : ''
            }`}
            loading="lazy"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 text-gray-400 ${
              coverBlur ? 'blur-lg' : ''
            }`}
          >
            <Icon className="h-8 w-8 opacity-70" />
          </div>
        )}

        {overlay}

        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-gray-100">
          <Icon className="h-3.5 w-3.5" />
          {countLabel}
        </div>

        {badge && <div className="absolute right-3 top-3">{badge}</div>}
        {secondaryAction && <div className="absolute right-3 top-3">{secondaryAction}</div>}

        {/* Overlay gradient for text readability */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />

        {hasMultiple && (
          <div className="absolute bottom-3 left-3 right-3 z-10 h-1 overflow-hidden rounded-full bg-black/40">
            <div
              className={`h-full transition-all duration-100 ${progressClassName}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className={contentClassName}>
        <p className="truncate text-sm font-semibold text-gray-100" title={titleAttr ?? title}>
          {title}
        </p>
        {subtitle}
      </div>
    </button>
  );
};

export default ScopeCard;
