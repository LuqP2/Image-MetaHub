import React from 'react';

interface SettingsSectionCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  tone?: 'default' | 'danger';
}

export const SettingsSectionCard: React.FC<SettingsSectionCardProps> = ({
  title,
  description,
  children,
  className = '',
  tone = 'default',
}) => {
  const toneClassName =
    tone === 'danger'
      ? 'border-red-500/30 bg-red-950/20'
      : 'border-gray-700/50 bg-gray-900/90';

  return (
    <div className={`ui-card p-4 ${toneClassName} ${className}`}>
      <div className="mb-4 space-y-1">
        <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
        {description ? <p className="text-sm text-gray-400">{description}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
};
