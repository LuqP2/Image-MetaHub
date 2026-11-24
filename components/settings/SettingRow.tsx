import React from 'react';

interface SettingRowProps {
  label: string;
  description?: string;
  control: React.ReactNode;
  className?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({ label, description, control, className = '' }) => {
  return (
    <div className={`flex flex-col gap-3 border-b border-gray-800/60 py-3 last:border-b-0 md:flex-row md:items-start md:justify-between ${className}`}>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-gray-100">{label}</p>
        {description ? <p className="text-sm text-gray-400">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
};
