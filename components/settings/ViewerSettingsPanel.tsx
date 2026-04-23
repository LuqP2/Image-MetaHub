import React from 'react';
import {
  MAX_SLIDESHOW_INTERVAL_SECONDS,
  MIN_SLIDESHOW_INTERVAL_SECONDS,
  useSettingsStore,
} from '../../store/useSettingsStore';
import {
  DEFAULT_RECENT_TAG_CHIP_LIMIT,
  DEFAULT_TAG_SUGGESTION_LIMIT,
  MAX_TAG_UI_LIMIT,
  MIN_TAG_UI_LIMIT,
} from '../../utils/tagSuggestions';
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
  const tagSuggestionLimit = useSettingsStore((state) => state.tagSuggestionLimit);
  const setTagSuggestionLimit = useSettingsStore((state) => state.setTagSuggestionLimit);
  const recentTagChipLimit = useSettingsStore((state) => state.recentTagChipLimit);
  const setRecentTagChipLimit = useSettingsStore((state) => state.setRecentTagChipLimit);
  const slideshowIntervalSeconds = useSettingsStore((state) => state.slideshowIntervalSeconds);
  const setSlideshowIntervalSeconds = useSettingsStore((state) => state.setSlideshowIntervalSeconds);
  const slideshowShowFilename = useSettingsStore((state) => state.slideshowShowFilename);
  const setSlideshowShowFilename = useSettingsStore((state) => state.setSlideshowShowFilename);

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

      <SettingsSectionCard title="Slideshow">
        <SettingRow
          label="Default interval"
          description={`Seconds between slides. Range ${MIN_SLIDESHOW_INTERVAL_SECONDS}-${MAX_SLIDESHOW_INTERVAL_SECONDS}.`}
          control={
            <input
              type="number"
              min={MIN_SLIDESHOW_INTERVAL_SECONDS}
              max={MAX_SLIDESHOW_INTERVAL_SECONDS}
              value={slideshowIntervalSeconds}
              onChange={(event) => setSlideshowIntervalSeconds(Number(event.target.value))}
              className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          }
        />
        <SettingRow
          label="Show filename overlay"
          description="Show filenames while a slideshow is running."
          control={<SettingSwitch checked={slideshowShowFilename} onChange={setSlideshowShowFilename} />}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title="Tagging">
        <SettingRow
          label="Suggestion list size"
          description={`How many tag suggestions to show while typing. Range ${MIN_TAG_UI_LIMIT}-${MAX_TAG_UI_LIMIT}.`}
          control={
            <input
              type="number"
              min={MIN_TAG_UI_LIMIT}
              max={MAX_TAG_UI_LIMIT}
              value={tagSuggestionLimit}
              onChange={(event) => setTagSuggestionLimit(Number(event.target.value) || DEFAULT_TAG_SUGGESTION_LIMIT)}
              className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          }
        />
        <SettingRow
          label="Recent tag chips"
          description={`How many recent tags to show as quick-add chips. Range ${MIN_TAG_UI_LIMIT}-${MAX_TAG_UI_LIMIT}.`}
          control={
            <input
              type="number"
              min={MIN_TAG_UI_LIMIT}
              max={MAX_TAG_UI_LIMIT}
              value={recentTagChipLimit}
              onChange={(event) => setRecentTagChipLimit(Number(event.target.value) || DEFAULT_RECENT_TAG_CHIP_LIMIT)}
              className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          }
        />
      </SettingsSectionCard>
    </SettingsPanel>
  );
};
