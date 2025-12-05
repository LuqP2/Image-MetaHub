import React from 'react';
import { Crown } from 'lucide-react';

interface ProBadgeProps {
  size?: 'sm' | 'md';
  tooltip?: string;
}

const ProBadge: React.FC<ProBadgeProps> = ({ size = 'sm', tooltip }) => {
  const sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <span
      className={`inline-flex items-center gap-1 bg-purple-600/20 text-purple-400 font-bold rounded ${sizeClasses} border border-purple-600/30`}
      title={tooltip || 'Pro Feature'}
    >
      <Crown className={iconSize} />
      PRO
    </span>
  );
};

export default ProBadge;
