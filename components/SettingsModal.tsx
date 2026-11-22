import { useTranslation } from '../i18n/useTranslation';
import { GeneralSettingsPanel } from './settings/GeneralSettingsPanel';
import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Settings,
  Eye,
  Keyboard,
  Link2,
  Palette,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import { AppearanceSettingsPanel } from './settings/AppearanceSettingsPanel';
import { IntegrationsSettingsPanel } from './settings/IntegrationsSettingsPanel';
import { LibrarySettingsPanel } from './settings/LibrarySettingsPanel';
import { LicenseSettingsPanel } from './settings/LicenseSettingsPanel';
import { PrivacySettingsPanel } from './settings/PrivacySettingsPanel';
import { SettingsSidebarNav } from './settings/SettingsSidebarNav';
import { ShortcutsSettingsPanel } from './settings/ShortcutsSettingsPanel';
import { ViewerSettingsPanel } from './settings/ViewerSettingsPanel';
import { VisualSearchSettingsPanel } from './settings/VisualSearchSettingsPanel';
import { type SettingsFocusSection, type SettingsTab, type SettingsTabInput, resolveSettingsTab } from './settings/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabInput;
  focusSection?: SettingsFocusSection;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'library',
  focusSection = null,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveSettingsTab(initialTab));

  useEffect(() => {
    if (isOpen) {
      setActiveTab(resolveSettingsTab(initialTab));
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (isOpen && focusSection === 'license') {
      setActiveTab('license');
    }
  }, [focusSection, isOpen]);

  const navigationItems = useMemo(
    () => [
      { id: 'general' as const, label: t("settings.navigation.general"), icon: Settings },
      { id: 'library' as const, label: t("settings.navigation.library"), icon: BookOpen },
      { id: 'viewer' as const, label: t("settings.navigation.viewer"), icon: Eye },
      { id: 'integrations' as const, label: t("settings.navigation.integrations"), icon: Link2 },
      { id: 'visual-search' as const, label: t("settings.navigation.visualSearch"), icon: Sparkles },
      { id: 'appearance' as const, label: t("settings.navigation.appearance"), icon: Palette },
      { id: 'privacy' as const, label: t("settings.navigation.privacy"), icon: Shield },
      { id: 'shortcuts' as const, label: t("settings.navigation.shortcuts"), icon: Keyboard },
    ],
    [t]
  );

  const activePanel = (() => {
    switch (activeTab) {
      case 'general': return <GeneralSettingsPanel focusSection={focusSection} />;
      case 'library':
        return <LibrarySettingsPanel onClose={onClose} />;
      case 'viewer':
        return <ViewerSettingsPanel />;
      case 'integrations':
        return <IntegrationsSettingsPanel />;
      case 'visual-search':
        return <VisualSearchSettingsPanel />;
      case 'appearance':
        return <AppearanceSettingsPanel />;
      case 'privacy':
        return <PrivacySettingsPanel />;
      case 'shortcuts':
        return <ShortcutsSettingsPanel />;
      case 'license':
        return <LicenseSettingsPanel />;
      default:
        return <LibrarySettingsPanel onClose={onClose} />;
    }
  })();

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-3 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.navigation.settings")}
      onClick={onClose}
    >
      <div
        className="mx-auto my-3 flex min-h-0 w-full max-w-6xl max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-800 text-gray-100 shadow-2xl md:my-6 md:max-h-[calc(100vh-3rem)]"
        style={{
          minHeight: 'min(720px, calc(100vh - 1.5rem))',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700/80 px-4 py-4 md:px-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-100 md:text-2xl">{t("settings.navigation.settings")}</h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
            aria-label={t("settings.navigation.closeSettings")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 md:grid md:grid-cols-[260px_minmax(0,1fr)]">
          <SettingsSidebarNav
            items={navigationItems}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
          />

          <div className="min-h-0 border-t border-gray-700/80 md:border-l md:border-t-0">
            <div className="h-full overflow-y-auto px-4 py-4 md:px-6 md:py-6">
              {activePanel}
              <p className="mt-8 text-xs text-gray-500">
                {t("settings.navigation.changesAreSavedAutomaticallySomeChangesMay")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
