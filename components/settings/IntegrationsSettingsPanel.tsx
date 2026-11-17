import { useTranslation } from '../../i18n/useTranslation';
import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { IntegrationCard } from './IntegrationCard';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingSwitch } from './SettingSwitch';

export const IntegrationsSettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const generatorLaunchCommand = useSettingsStore((state) => state.generatorLaunchCommand);
  const setGeneratorLaunchCommand = useSettingsStore((state) => state.setGeneratorLaunchCommand);
  const generatorLaunchWorkingDirectory = useSettingsStore((state) => state.generatorLaunchWorkingDirectory);
  const setGeneratorLaunchWorkingDirectory = useSettingsStore((state) => state.setGeneratorLaunchWorkingDirectory);
  const a1111Enabled = useSettingsStore((state) => state.a1111Enabled);
  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const a1111AutoStart = useSettingsStore((state) => state.a1111AutoStart);
  const a1111LastConnectionStatus = useSettingsStore((state) => state.a1111LastConnectionStatus);
  const setA1111Enabled = useSettingsStore((state) => state.setA1111Enabled);
  const setA1111ServerUrl = useSettingsStore((state) => state.setA1111ServerUrl);
  const toggleA1111AutoStart = useSettingsStore((state) => state.toggleA1111AutoStart);
  const setA1111ConnectionStatus = useSettingsStore((state) => state.setA1111ConnectionStatus);

  const comfyUIEnabled = useSettingsStore((state) => state.comfyUIEnabled);
  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const comfyUILastConnectionStatus = useSettingsStore((state) => state.comfyUILastConnectionStatus);
  const comfyUIQueueMonitoringEnabled = useSettingsStore((state) => state.comfyUIQueueMonitoringEnabled);
  const setComfyUIEnabled = useSettingsStore((state) => state.setComfyUIEnabled);
  const setComfyUIServerUrl = useSettingsStore((state) => state.setComfyUIServerUrl);
  const setComfyUIConnectionStatus = useSettingsStore((state) => state.setComfyUIConnectionStatus);
  const setComfyUIQueueMonitoringEnabled = useSettingsStore((state) => state.setComfyUIQueueMonitoringEnabled);

  const [isTestingA1111Connection, setIsTestingA1111Connection] = useState(false);
  const [isTestingComfyUIConnection, setIsTestingComfyUIConnection] = useState(false);

  const handleTestA1111Connection = async () => {
    if (!a1111ServerUrl) {
      alert(t("settings.integrations.pleaseEnterAServerUrl"));
      return;
    }

    setIsTestingA1111Connection(true);
    setA1111ConnectionStatus('unknown');

    try {
      const { A1111ApiClient } = await import('../../services/a1111ApiClient');
      const client = new A1111ApiClient({ serverUrl: a1111ServerUrl });
      const result = await client.testConnection();

      if (result.success) {
        setA1111ConnectionStatus('connected');
      } else {
        setA1111ConnectionStatus('error');
        alert(t("settings.integrations.connectionFailure", { error: String(result.error) }));
      }
    } catch (error: any) {
      setA1111ConnectionStatus('error');
      alert(t("settings.integrations.connectionTestError", { error: error.message }));
    } finally {
      setIsTestingA1111Connection(false);
    }
  };

  const handleTestComfyUIConnection = async () => {
    if (!comfyUIServerUrl) {
      alert(t("settings.integrations.pleaseEnterAServerUrl"));
      return;
    }

    setIsTestingComfyUIConnection(true);
    setComfyUIConnectionStatus('unknown');

    try {
      const { ComfyUIApiClient } = await import('../../services/comfyUIApiClient');
      const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });
      const result = await client.testConnection();

      if (result.success) {
        setComfyUIConnectionStatus('connected');
      } else {
        setComfyUIConnectionStatus('error');
        alert(t("settings.integrations.connectionFailure", { error: String(result.error) }));
      }
    } catch (error: any) {
      setComfyUIConnectionStatus('error');
      alert(t("settings.integrations.connectionTestError", { error: error.message }));
    } finally {
      setIsTestingComfyUIConnection(false);
    }
  };

  return (
    <SettingsPanel title={t("settings.integrations.integrations")} description={t("settings.integrations.connectImageMetahubToYourLocalGeneration")}>
      <div className="grid gap-4">
        <IntegrationCard
          name={t("settings.integrations.generatorLauncher")}
          description={t("settings.integrations.pasteAnyLocalScriptOrCommandThe")}
          status={generatorLaunchCommand.trim() ? 'connected' : 'unknown'}
        >
          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="generator-launch-command">
              {t("settings.integrations.launchCommand")}
            </label>
            <textarea
              id="generator-launch-command"
              value={generatorLaunchCommand}
              onChange={(event) => setGeneratorLaunchCommand(event.target.value)}
              placeholder={t("settings.integrations.pasteYourLaunchScriptOrCommandHere")}
              rows={6}
              spellCheck={false}
              className="min-h-[140px] w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-sm text-gray-400">
              {t("settings.integrations.launchCommandHelp")}
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="generator-launch-working-directory">
              {t("settings.integrations.workingDirectory")}
            </label>
            <input
              id="generator-launch-working-directory"
              type="text"
              value={generatorLaunchWorkingDirectory}
              onChange={(event) => setGeneratorLaunchWorkingDirectory(event.target.value)}
              placeholder={t("settings.integrations.optionalFolderWhereTheLauncherCommandShould")}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-sm text-gray-400">
              {t("settings.integrations.workingDirectoryHelp")}
            </p>
          </div>
        </IntegrationCard>

        <div className="grid gap-4 xl:grid-cols-2">
        <IntegrationCard
          name="Automatic1111"
          description={t("settings.integrations.viewerActionsClipboardExportAndOptionalQuick")}
          status={a1111LastConnectionStatus}
        >
          <SettingRow
            label={t("settings.integrations.showInViewer")}
            control={<SettingSwitch checked={a1111Enabled} onChange={setA1111Enabled} />}
          />

          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="a1111-server-url">
              {t("settings.integrations.serverUrl")}
            </label>
            <input
              id="a1111-server-url"
              type="text"
              value={a1111ServerUrl}
              onChange={(event) => setA1111ServerUrl(event.target.value)}
              placeholder="http://127.0.0.1:7860"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <SettingRow
            label={t("settings.integrations.autoStartGeneration")}
            description={t("settings.integrations.startGeneratingImmediatelyWhenSendingParametersTo")}
            control={<SettingSwitch checked={a1111AutoStart} onChange={() => toggleA1111AutoStart()} />}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTestA1111Connection}
              disabled={isTestingA1111Connection}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-blue-500 enabled:hover:text-gray-950 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-300"
            >
              {isTestingA1111Connection ? t("settings.integrations.testing") : t("settings.integrations.testConnection")}
            </button>
            <p className="text-sm text-gray-400">{t("settings.integrations.a1111MustBeRunningWithTheApi")}</p>
          </div>
        </IntegrationCard>

        <IntegrationCard
          name="ComfyUI"
          description={t("settings.integrations.viewerActionsAndQuickGenerationWithReal")}
          status={comfyUILastConnectionStatus}
        >
          <SettingRow
            label={t("settings.integrations.showInViewer")}
            control={<SettingSwitch checked={comfyUIEnabled} onChange={setComfyUIEnabled} />}
          />

          <SettingRow
            label={t("settings.integrations.detectComfyuiGenerations")}
            description={t("settings.integrations.showGenerationsStartedInComfyuiIncludingThe")}
            control={<SettingSwitch checked={comfyUIQueueMonitoringEnabled} onChange={setComfyUIQueueMonitoringEnabled} />}
          />

          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="comfyui-server-url">
              {t("settings.integrations.serverUrl")}
            </label>
            <input
              id="comfyui-server-url"
              type="text"
              value={comfyUIServerUrl}
              onChange={(event) => setComfyUIServerUrl(event.target.value)}
              placeholder="http://127.0.0.1:8188"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTestComfyUIConnection}
              disabled={isTestingComfyUIConnection}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-blue-500 enabled:hover:text-gray-950 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-300"
            >
              {isTestingComfyUIConnection ? t("settings.integrations.testing") : t("settings.integrations.testConnection")}
            </button>
            <p className="text-sm text-gray-400">{t("settings.integrations.metahubSaveNodeIsRecommendedForFull")}</p>
          </div>

          <a
            href="https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200 light:text-accent light:hover:text-accent-strong"
          >
            <ExternalLink size={14} />
            MetaHub Save Node
          </a>
        </IntegrationCard>
        </div>
      </div>
    </SettingsPanel>
  );
};
