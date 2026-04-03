import React from 'react';
import { Check, X } from 'lucide-react';
import { InclusionFilterMode } from '../types';

export const getNextFilterMode = (mode: InclusionFilterMode): InclusionFilterMode => {
  if (mode === 'neutral') return 'include';
  if (mode === 'include') return 'exclude';
  return 'neutral';
};

export const getFilterModeLabel = (mode: InclusionFilterMode): string => {
  if (mode === 'include') return 'Include';
  if (mode === 'exclude') return 'Exclude';
  return 'Off';
};

interface TriStateToggleProps {
  mode: InclusionFilterMode;
  onClick: () => void;
  title: string;
}

const TriStateToggle: React.FC<TriStateToggleProps> = ({ mode, onClick, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={title}
    className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
      mode === 'include'
        ? 'border-gray-500 bg-gray-800 text-gray-100'
        : mode === 'exclude'
          ? 'border-rose-500/70 bg-rose-950/40 text-rose-200'
          : 'border-gray-600 bg-gray-700 text-transparent hover:border-gray-500 hover:bg-gray-700/80'
    }`}
  >
    {mode === 'include' ? <Check className="h-3 w-3" /> : mode === 'exclude' ? <X className="h-3 w-3" /> : <span className="h-3 w-3" />}
  </button>
);

export default TriStateToggle;
