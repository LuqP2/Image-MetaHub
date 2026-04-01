import React from 'react';

interface SettingRowProps {
  label: string;
  description?: string;
  control: React.ReactNode;
  className?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({ label, description, control, className = '' }) => {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3 md:flex-row md:items-start md:justify-between ${className}`}>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-gray-100">{label}</p>
        {description ? <p className="text-sm text-gray-400">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
};
