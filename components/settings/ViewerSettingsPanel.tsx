import React from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';

export const ViewerSettingsPanel: React.FC = () => {
  const showFilenames = useSettingsStore((state) => state.showFilenames);
  const setShowFilenames = useSettingsStore((state) => state.setShowFilenames);
  const showFullFilePath = useSettingsStore((state) => state.showFullFilePath);
  const setShowFullFilePath = useSettingsStore((state) => state.setShowFullFilePath);
  const doubleClickToOpen = useSettingsStore((state) => state.doubleClickToOpen);
  const setDoubleClickToOpen = useSettingsStore((state) => state.setDoubleClickToOpen);

  return (
    <SettingsPanel title="Viewer" description="Control what appears in the library and how images open.">
      <SettingsSectionCard title="Behavior">
        <SettingRow
          label="Show filenames"
          description="Display the image filename under thumbnails."
          control={<SettingSwitch checked={showFilenames} onChange={setShowFilenames} />}
        />
        <SettingRow
          label="Show full path"
          description="Show folder path context instead of only the filename."
          control={<SettingSwitch checked={showFullFilePath} onChange={setShowFullFilePath} />}
        />
        <SettingRow
          label="Double-click to open"
          description="Keep single click for selection and open details on double click."
          control={<SettingSwitch checked={doubleClickToOpen} onChange={setDoubleClickToOpen} />}
        />
      </SettingsSectionCard>
    </SettingsPanel>
  );
};
