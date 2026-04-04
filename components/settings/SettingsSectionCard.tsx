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
      : 'border-gray-700/80 bg-gray-900/70';

  return (
    <div className={`rounded-2xl border p-4 md:p-5 ${toneClassName} ${className}`}>
      <div className="mb-4 space-y-1">
        <h3 className="text-base font-semibold text-gray-100">{title}</h3>
        {description ? <p className="text-sm text-gray-400">{description}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
};
