import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { IntegrationCard } from './IntegrationCard';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingSwitch } from './SettingSwitch';

export const IntegrationsSettingsPanel: React.FC = () => {
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
  const setComfyUIEnabled = useSettingsStore((state) => state.setComfyUIEnabled);
  const setComfyUIServerUrl = useSettingsStore((state) => state.setComfyUIServerUrl);
  const setComfyUIConnectionStatus = useSettingsStore((state) => state.setComfyUIConnectionStatus);

  const [isTestingA1111Connection, setIsTestingA1111Connection] = useState(false);
  const [isTestingComfyUIConnection, setIsTestingComfyUIConnection] = useState(false);

  const handleTestA1111Connection = async () => {
    if (!a1111ServerUrl) {
      alert('Please enter a server URL.');
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
        alert(`Connection failed: ${result.error}`);
      }
    } catch (error: any) {
      setA1111ConnectionStatus('error');
      alert(`Error testing connection: ${error.message}`);
    } finally {
      setIsTestingA1111Connection(false);
    }
  };

  const handleTestComfyUIConnection = async () => {
    if (!comfyUIServerUrl) {
      alert('Please enter a server URL.');
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
        alert(`Connection failed: ${result.error}`);
      }
    } catch (error: any) {
      setComfyUIConnectionStatus('error');
      alert(`Error testing connection: ${error.message}`);
    } finally {
      setIsTestingComfyUIConnection(false);
    }
  };

  return (
    <SettingsPanel title="Integrations" description="Connect Image MetaHub to your local generation tools.">
      <div className="grid gap-4">
        <IntegrationCard
          name="Generator Launcher"
          description="Paste any local script or command. The Header button will run it exactly as saved here."
          status={generatorLaunchCommand.trim() ? 'connected' : 'unknown'}
        >
          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="generator-launch-command">
              Launch command
            </label>
            <textarea
              id="generator-launch-command"
              value={generatorLaunchCommand}
              onChange={(event) => setGeneratorLaunchCommand(event.target.value)}
              placeholder="Paste your launch script or command here"
              rows={6}
              spellCheck={false}
              className="min-h-[140px] w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-sm text-gray-400">
              You can paste a full `.bat` / `.cmd` script or any shell command sequence. `Launch Generator` in the Header will execute it.
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="generator-launch-working-directory">
              Working directory
            </label>
            <input
              id="generator-launch-working-directory"
              type="text"
              value={generatorLaunchWorkingDirectory}
              onChange={(event) => setGeneratorLaunchWorkingDirectory(event.target.value)}
              placeholder="Optional: folder where the launcher command should run"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-sm text-gray-400">
              Set this when your command uses relative paths such as `python main.py`, `./webui.sh`, or `venv/Scripts/python.exe`.
            </p>
          </div>
        </IntegrationCard>

        <div className="grid gap-4 xl:grid-cols-2">
        <IntegrationCard
          name="Automatic1111"
          description="Viewer actions, clipboard export and optional quick generation."
          status={a1111LastConnectionStatus}
        >
          <SettingRow
            label="Show in viewer"
            control={<SettingSwitch checked={a1111Enabled} onChange={setA1111Enabled} />}
          />

          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="a1111-server-url">
              Server URL
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
            label="Auto-start generation"
            description="Start generating immediately when sending parameters to A1111."
            control={<SettingSwitch checked={a1111AutoStart} onChange={() => toggleA1111AutoStart()} />}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTestA1111Connection}
              disabled={isTestingA1111Connection}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
            >
              {isTestingA1111Connection ? 'Testing...' : 'Test connection'}
            </button>
            <p className="text-sm text-gray-400">A1111 must be running with the API enabled.</p>
          </div>
        </IntegrationCard>

        <IntegrationCard
          name="ComfyUI"
          description="Viewer actions and quick generation with real-time progress."
          status={comfyUILastConnectionStatus}
        >
          <SettingRow
            label="Show in viewer"
            control={<SettingSwitch checked={comfyUIEnabled} onChange={setComfyUIEnabled} />}
          />

          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
            <label className="text-sm font-medium text-gray-100" htmlFor="comfyui-server-url">
              Server URL
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
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
            >
              {isTestingComfyUIConnection ? 'Testing...' : 'Test connection'}
            </button>
            <p className="text-sm text-gray-400">MetaHub Save Node is recommended for full metadata support.</p>
          </div>

          <a
            href="https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200"
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
