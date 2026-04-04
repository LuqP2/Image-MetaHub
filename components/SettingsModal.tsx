import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Eye,
  Keyboard,
  Link2,
  Palette,
  Shield,
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
      { id: 'library' as const, label: 'Library', icon: BookOpen },
      { id: 'viewer' as const, label: 'Viewer', icon: Eye },
      { id: 'integrations' as const, label: 'Integrations', icon: Link2 },
      { id: 'appearance' as const, label: 'Appearance', icon: Palette },
      { id: 'privacy' as const, label: 'Privacy', icon: Shield },
      { id: 'shortcuts' as const, label: 'Shortcuts', icon: Keyboard },
    ],
    []
  );

  const activePanel = (() => {
    switch (activeTab) {
      case 'library':
        return <LibrarySettingsPanel onClose={onClose} />;
      case 'viewer':
        return <ViewerSettingsPanel />;
      case 'integrations':
        return <IntegrationsSettingsPanel />;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 md:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-800 text-gray-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700/80 px-4 py-4 md:px-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-100 md:text-2xl">Settings</h1>
            <p className="text-sm text-gray-400">Organized by task so the common path stays short.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
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
                Changes are saved automatically. Some changes may take effect the next time the app starts.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
