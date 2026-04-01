export type SettingsTab =
  | 'library'
  | 'viewer'
  | 'integrations'
  | 'appearance'
  | 'privacy'
  | 'shortcuts'
  | 'license';

export type LegacySettingsTab = 'general' | 'themes' | 'hotkeys' | 'privacy';

export type SettingsTabInput = SettingsTab | LegacySettingsTab;

export type SettingsFocusSection = 'license' | null;

export const resolveSettingsTab = (tab: SettingsTabInput | undefined): SettingsTab => {
  switch (tab) {
    case 'general':
      return 'library';
    case 'themes':
      return 'appearance';
    case 'hotkeys':
      return 'shortcuts';
    case 'privacy':
      return 'privacy';
    case 'viewer':
    case 'integrations':
    case 'appearance':
    case 'library':
    case 'shortcuts':
    case 'license':
      return tab;
    default:
      return 'library';
  }
};
