import React from 'react';

interface SettingsPanelProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ title, description, children }) => {
  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-gray-100">{title}</h2>
        {description ? <p className="text-sm text-gray-400">{description}</p> : null}
      </header>
      {children}
    </section>
  );
};
