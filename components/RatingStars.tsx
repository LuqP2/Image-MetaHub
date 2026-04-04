import React, { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import type { ImageRating } from '../types';

interface RatingStarsProps {
  rating?: ImageRating | null;
  onChange?: (rating: ImageRating | null) => void;
  size?: number;
  className?: string;
  disabled?: boolean;
}

type RatingTone = {
  active: string;
  inactive: string;
};

export const RATING_VALUES: ImageRating[] = [1, 2, 3, 4, 5];

const RATING_TONES: Record<ImageRating, RatingTone> = {
  1: {
    active: 'border-red-500/60 bg-red-500/20 text-red-200',
    inactive: 'border-red-500/25 text-red-300/70 hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-200',
  },
  2: {
    active: 'border-orange-500/60 bg-orange-500/20 text-orange-200',
    inactive: 'border-orange-500/25 text-orange-300/70 hover:border-orange-400/50 hover:bg-orange-500/10 hover:text-orange-200',
  },
  3: {
    active: 'border-yellow-500/60 bg-yellow-500/20 text-yellow-200',
    inactive: 'border-yellow-500/25 text-yellow-300/70 hover:border-yellow-400/50 hover:bg-yellow-500/10 hover:text-yellow-200',
  },
  4: {
    active: 'border-lime-500/60 bg-lime-500/20 text-lime-200',
    inactive: 'border-lime-500/25 text-lime-300/70 hover:border-lime-400/50 hover:bg-lime-500/10 hover:text-lime-200',
  },
  5: {
    active: 'border-green-500/60 bg-green-500/20 text-green-200',
    inactive: 'border-green-500/25 text-green-300/70 hover:border-green-400/50 hover:bg-green-500/10 hover:text-green-200',
  },
};

export const getRatingChipClasses = (value: ImageRating, active: boolean) => {
  const tone = RATING_TONES[value];
  return active ? tone.active : `bg-gray-950/30 text-gray-400 ${tone.inactive}`;
};

export const getRatingBadgeClasses = (value: ImageRating) =>
  `border ${RATING_TONES[value].active}`;

export const getRatingLabel = (value: ImageRating) => `${value} star${value === 1 ? '' : 's'}`;

interface RatingValueIconsProps {
  value: ImageRating;
  size?: number;
  className?: string;
  starClassName?: string;
}

export const RatingValueIcons: React.FC<RatingValueIconsProps> = ({
  value,
  size = 12,
  className = '',
  starClassName = 'fill-current',
}) => (
  <span className={`inline-flex items-center gap-0.5 ${className}`.trim()} aria-label={getRatingLabel(value)}>
    {Array.from({ length: value }, (_, index) => (
      <Star
        key={`${value}-${index}`}
        size={size}
        className={starClassName}
        strokeWidth={1.9}
      />
    ))}
  </span>
);

const RatingStars: React.FC<RatingStarsProps> = ({
  rating = null,
  onChange,
  size = 18,
  className = '',
  disabled = false,
}) => {
  const [hoverRating, setHoverRating] = useState<ImageRating | null>(null);
  const previewRating = useMemo(() => hoverRating ?? rating ?? null, [hoverRating, rating]);
  const isInteractive = !disabled && typeof onChange === 'function';

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`.trim()}
      onMouseLeave={() => setHoverRating(null)}
      aria-label={rating ? `Rating ${rating} of 5` : 'Unrated'}
    >
      {RATING_VALUES.map((value) => {
        const active = previewRating !== null && value <= previewRating;
        return (
          <button
            key={value}
            type="button"
            disabled={!isInteractive}
            onMouseEnter={() => {
              if (isInteractive) {
                setHoverRating(value);
              }
            }}
            onClick={() => {
              if (!isInteractive) {
                return;
              }
              onChange(value === rating ? null : value);
            }}
            className={`inline-flex items-center justify-center rounded-md transition-all ${
              size <= 16 ? 'h-6 w-6' : 'h-7 w-7'
            } ${
              active
                ? 'text-amber-400'
                : 'text-gray-500 hover:bg-gray-800/60 hover:text-amber-300'
            } ${!isInteractive ? 'cursor-default opacity-90' : ''}`.trim()}
            title={rating === value ? `Clear rating ${value}` : `Set rating ${value}`}
            aria-label={rating === value ? `Clear rating ${value}` : `Set rating ${value}`}
          >
            <Star size={size} className={active ? 'fill-current' : ''} strokeWidth={1.9} />
          </button>
        );
      })}
    </div>
  );
};

export default RatingStars;
