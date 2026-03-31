import React, { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import type { ImageRating } from '../types';

interface RatingStarsProps {
  rating?: ImageRating | null;
  onChange?: (rating: ImageRating | null) => void;
  size?: number;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  disabled?: boolean;
}

const STAR_VALUES: ImageRating[] = [1, 2, 3, 4, 5];

const RatingStars: React.FC<RatingStarsProps> = ({
  rating = null,
  onChange,
  size = 16,
  className = '',
  activeClassName = 'text-amber-400',
  inactiveClassName = 'text-gray-500 hover:text-amber-300',
  disabled = false,
}) => {
  const [hoverRating, setHoverRating] = useState<ImageRating | null>(null);
  const previewRating = useMemo(() => hoverRating ?? rating ?? 0, [hoverRating, rating]);
  const isInteractive = !disabled && typeof onChange === 'function';

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className}`.trim()}
      onMouseLeave={() => setHoverRating(null)}
      aria-label={rating ? `Rating ${rating} of 5` : 'Unrated'}
    >
      {STAR_VALUES.map((value) => {
        const active = value <= previewRating;
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
            className={`rounded p-0.5 transition-colors ${active ? activeClassName : inactiveClassName} ${!isInteractive ? 'cursor-default' : ''}`.trim()}
            title={rating === value ? `Clear ${value}-star rating` : `Set ${value}-star rating`}
            aria-label={rating === value ? `Clear ${value}-star rating` : `Set ${value}-star rating`}
          >
            <Star size={size} className={active ? 'fill-current' : ''} />
          </button>
        );
      })}
    </div>
  );
};

export default RatingStars;
