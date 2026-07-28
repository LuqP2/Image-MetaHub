import React from 'react';
import { Crown } from 'lucide-react';

interface ProBadgeProps {
  size?: 'sm' | 'md';
  tooltip?: string;
  /**
   * 'pill' (default) is the solid purple badge used in toolbars/sidebars.
   * 'subtle' is a muted, borderless crown-only variant meant for dense
   * lists (e.g. context menu items) where a full pill per row is too loud.
   * The Pro-feature information is still exposed to screen readers via
   * an sr-only label + title even though it's visually minimal.
   */
  variant?: 'pill' | 'subtle';
}

const ProBadge: React.FC<ProBadgeProps> = ({ size = 'sm', tooltip, variant = 'pill' }) => {
  const sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const title = tooltip || 'Pro Feature';

  if (variant === 'subtle') {
    return (
      <span
        className="inline-flex items-center gap-1 text-gray-500 shrink-0"
        title={title}
      >
        <Crown className={iconSize} aria-hidden="true" />
        <span className="sr-only">{title}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 bg-purple-600/20 text-purple-400 font-bold rounded ${sizeClasses} border border-purple-600/30`}
      title={title}
    >
      <Crown className={iconSize} />
      PRO
    </span>
  );
};

export default ProBadge;
