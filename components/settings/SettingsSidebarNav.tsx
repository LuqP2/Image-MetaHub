import { useTranslation } from '../../i18n/useTranslation';
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Crown } from 'lucide-react';
import { type SettingsTab } from './types';

interface NavItem {
  id: Exclude<SettingsTab, 'license'>;
  label: string;
  icon: LucideIcon;
}

interface SettingsSidebarNavProps {
  items: NavItem[];
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}

const baseButtonClassName =
  'ui-btn-ghost justify-start';

export const SettingsSidebarNav: React.FC<SettingsSidebarNavProps> = ({
  items,
  activeTab,
  onSelectTab,
}) => {
  const { t } = useTranslation();
  return (
    <aside className="border-b border-gray-700/80 md:flex md:h-full md:flex-col md:border-b-0">
      <div className="overflow-x-auto md:flex-1 md:overflow-visible">
        <div className="flex gap-2 px-3 py-3 md:flex-col md:px-4 md:py-5">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`${baseButtonClassName} ${
                  isActive
                    ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                }`}
              >
                <Icon size={16} />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-gray-700/80 px-3 py-3 md:px-4 md:py-4">
        <button
          type="button"
          onClick={() => onSelectTab('license')}
          className={`${baseButtonClassName} w-full justify-center md:justify-start ${
            activeTab === 'license'
              ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
              : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
          }`}
        >
          <Crown size={16} />
          <span>{t("settings.navigation.supportLicense")}</span>
        </button>
      </div>
    </aside>
  );
};
