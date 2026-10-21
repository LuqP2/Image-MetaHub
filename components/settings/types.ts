export type SettingsTab =
  | 'general'
  | 'library'
  | 'viewer'
  | 'integrations'
  | 'visual-search'
  | 'appearance'
  | 'privacy'
  | 'shortcuts'
  | 'license';

export type LegacySettingsTab = 'themes' | 'hotkeys' | 'privacy';

export type SettingsTabInput = SettingsTab | LegacySettingsTab;

export type SettingsFocusSection = 'license' | 'exr' | null;

export const resolveSettingsTab = (tab: SettingsTabInput | undefined): SettingsTab => {
  switch (tab) {
    case 'themes':
      return 'appearance';
    case 'hotkeys':
      return 'shortcuts';
    case 'privacy':
      return 'privacy';
    case 'viewer':
    case 'integrations':
    case 'visual-search':
    case 'general':
    case 'appearance':
    case 'library':
    case 'shortcuts':
    case 'license':
      return tab;
    default:
      return 'library';
  }
};
