import { useTranslation } from '../../i18n/useTranslation';
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
  const { t } = useTranslation();
  const showFilenames = useSettingsStore((state) => state.showFilenames);
  const setShowFilenames = useSettingsStore((state) => state.setShowFilenames);
  const hideAssociatedTextureMaps = useSettingsStore((state) => state.hideAssociatedTextureMaps);
  const setHideAssociatedTextureMaps = useSettingsStore((state) => state.setHideAssociatedTextureMaps);
  const showFullFilePath = useSettingsStore((state) => state.showFullFilePath);
  const setShowFullFilePath = useSettingsStore((state) => state.setShowFullFilePath);
  const doubleClickToOpen = useSettingsStore((state) => state.doubleClickToOpen);
  const setDoubleClickToOpen = useSettingsStore((state) => state.setDoubleClickToOpen);
  const skipDeleteConfirmation = useSettingsStore((state) => state.skipDeleteConfirmation);
  const setSkipDeleteConfirmation = useSettingsStore((state) => state.setSkipDeleteConfirmation);
  const tagSuggestionLimit = useSettingsStore((state) => state.tagSuggestionLimit);
  const setTagSuggestionLimit = useSettingsStore((state) => state.setTagSuggestionLimit);
  const recentTagChipLimit = useSettingsStore((state) => state.recentTagChipLimit);
  const setRecentTagChipLimit = useSettingsStore((state) => state.setRecentTagChipLimit);
  const autoPlayMedia = useSettingsStore((state) => state.autoPlayMedia);
  const setAutoPlayMedia = useSettingsStore((state) => state.setAutoPlayMedia);
  const slideshowIntervalSeconds = useSettingsStore((state) => state.slideshowIntervalSeconds);
  const setSlideshowIntervalSeconds = useSettingsStore((state) => state.setSlideshowIntervalSeconds);
  const slideshowShowFilename = useSettingsStore((state) => state.slideshowShowFilename);
  const setSlideshowShowFilename = useSettingsStore((state) => state.setSlideshowShowFilename);
  const imageViewerMode = useSettingsStore((state) => state.imageViewerMode);
  const setImageViewerMode = useSettingsStore((state) => state.setImageViewerMode);
  const reuseImageViewerWindow = useSettingsStore((state) => state.reuseImageViewerWindow);
  const setReuseImageViewerWindow = useSettingsStore((state) => state.setReuseImageViewerWindow);
  const imageViewerDefaultZoom = useSettingsStore((state) => state.imageViewerDefaultZoom);
  const setImageViewerDefaultZoom = useSettingsStore((state) => state.setImageViewerDefaultZoom);
  const isDesktop = typeof window !== 'undefined' && Boolean(window.electronAPI);

  return (
    <SettingsPanel title={t("settings.viewer.viewer")}>
      <SettingsSectionCard title={t("settings.viewer.behavior")}>
        <SettingRow
          label={t("settings.viewer.openImagesInDesktopWindows")}
          className={!isDesktop ? 'opacity-50' : ''}
          control={
            <SettingSwitch
              checked={isDesktop && imageViewerMode === 'detached'}
              onChange={(checked) => setImageViewerMode(checked ? 'detached' : 'inline')}
              disabled={!isDesktop}
            />
          }
        />
        <SettingRow
          label={t("settings.viewer.reuseASingleViewerWindow")}
          description={t("settings.viewer.openingAnotherImageSwitchesTheExistingViewer")}
          className={!isDesktop || imageViewerMode !== 'detached' ? 'opacity-50' : ''}
          control={
            <SettingSwitch
              checked={reuseImageViewerWindow}
              onChange={setReuseImageViewerWindow}
              disabled={!isDesktop || imageViewerMode !== 'detached'}
              ariaLabel={t("settings.viewer.reuseASingleViewerWindow")}
            />
          }
        />
        <SettingRow
          label={t("settings.viewer.defaultImageZoom")}
          control={
            <select
              value={imageViewerDefaultZoom}
              onChange={(event) => setImageViewerDefaultZoom(event.target.value as 'fit' | 'actual')}
              className="ui-select"
            >
              <option value="fit">{t("settings.viewer.fit")}</option>
              <option value="actual">1:1</option>
            </select>
          }
        />
        <SettingRow
          label={t("settings.viewer.showFilenamesOnGrid")}
          control={<SettingSwitch checked={showFilenames} onChange={setShowFilenames} />}
        />
        <SettingRow
          label={t("settings.viewer.hideAssociatedTextureMaps")}
          description={t("settings.viewer.keepLinkedImagesUnderTextureMapsOn")}
          control={<SettingSwitch checked={hideAssociatedTextureMaps} onChange={setHideAssociatedTextureMaps} ariaLabel={t("settings.viewer.hideAssociatedTextureMaps")} />}
        />
        <SettingRow
          label={t("settings.viewer.showFullPath")}
          className={!showFilenames ? 'opacity-50' : ''}
          control={
            <input
              type="checkbox"
              checked={showFullFilePath}
              disabled={!showFilenames}
              onChange={(event) => setShowFullFilePath(event.target.checked)}
              className="ui-checkbox w-4"
            />
          }
        />
        <SettingRow
          label={t("settings.viewer.doubleClickToOpen")}
          control={<SettingSwitch checked={doubleClickToOpen} onChange={setDoubleClickToOpen} />}
        />
        <SettingRow
          label={t("settings.viewer.skipDeleteConfirmation")}
          control={<SettingSwitch checked={skipDeleteConfirmation} onChange={setSkipDeleteConfirmation} />}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title={t("settings.viewer.playback")}>
        <SettingRow
          label={t("settings.viewer.autoPlayVideoAndAudio")}
          control={<SettingSwitch checked={autoPlayMedia} onChange={setAutoPlayMedia} />}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title={t("settings.viewer.slideshow")}>
        <SettingRow
          label={t("settings.viewer.defaultIntervalSeconds")}
          control={
            <input
              type="number"
              min={MIN_SLIDESHOW_INTERVAL_SECONDS}
              max={MAX_SLIDESHOW_INTERVAL_SECONDS}
              value={slideshowIntervalSeconds}
              onChange={(event) => setSlideshowIntervalSeconds(Number(event.target.value))}
              className="ui-input w-24 text-right"
            />
          }
        />
        <SettingRow
          label={t("settings.viewer.showFilenameOverlay")}
          description={t("settings.viewer.showFilenamesWhileASlideshowIsRunning")}
          control={<SettingSwitch checked={slideshowShowFilename} onChange={setSlideshowShowFilename} />}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title={t("settings.viewer.tagging")}>
        <SettingRow
          label={t("settings.viewer.suggestionListSize")}
          description={t("settings.viewer.tagSuggestionsRange", { min: MIN_TAG_UI_LIMIT, max: MAX_TAG_UI_LIMIT })}
          control={
            <input
              type="number"
              min={MIN_TAG_UI_LIMIT}
              max={MAX_TAG_UI_LIMIT}
              value={tagSuggestionLimit}
              onChange={(event) => setTagSuggestionLimit(Number(event.target.value) || DEFAULT_TAG_SUGGESTION_LIMIT)}
              className="ui-input w-24 text-right"
            />
          }
        />
        <SettingRow
          label={t("settings.viewer.recentTagChips")}
          description={t("settings.viewer.recentTagsRange", { min: MIN_TAG_UI_LIMIT, max: MAX_TAG_UI_LIMIT })}
          control={
            <input
              type="number"
              min={MIN_TAG_UI_LIMIT}
              max={MAX_TAG_UI_LIMIT}
              value={recentTagChipLimit}
              onChange={(event) => setRecentTagChipLimit(Number(event.target.value) || DEFAULT_RECENT_TAG_CHIP_LIMIT)}
              className="ui-input w-24 text-right"
            />
          }
        />
      </SettingsSectionCard>
    </SettingsPanel>
  );
};
