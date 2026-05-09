import { useEffect, useRef } from 'react';
import { ComfyUIApiClient, ComfyUIProgressUpdate, normalizeLoopbackServerUrl } from '../services/comfyUIApiClient';
import { GeneratedQueueOutput, useGenerationQueueStore } from '../store/useGenerationQueueStore';
import { useSettingsStore } from '../store/useSettingsStore';

type ComfyUIQueueEntry = {
  promptId: string;
  prompt?: string;
};

type ComfyUIHistoryImage = {
  filename?: unknown;
  subfolder?: unknown;
  type?: unknown;
};

const POLL_INTERVAL_MS = 1500;

const isHistoryImage = (value: unknown): value is ComfyUIHistoryImage =>
  Boolean(value && typeof value === 'object' && 'filename' in value);

const getPromptIdFromQueueEntry = (entry: unknown): string | null => {
  if (Array.isArray(entry)) {
    const candidate = entry.find((value) => typeof value === 'string' && value.length > 8);
    return typeof candidate === 'string' ? candidate : null;
  }

  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    const candidate = record.prompt_id || record.promptId || record.id;
    return typeof candidate === 'string' ? candidate : null;
  }

  return null;
};

const getPromptGraphFromQueueEntry = (entry: unknown): unknown => {
  if (Array.isArray(entry)) {
    return entry.find((value) => value && typeof value === 'object' && !Array.isArray(value));
  }

  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    return record.prompt || record.workflow;
  }

  return null;
};

const extractPromptPreview = (entry: unknown): string | undefined => {
  const graph = getPromptGraphFromQueueEntry(entry);
  if (!graph || typeof graph !== 'object') {
    return undefined;
  }

  for (const node of Object.values(graph as Record<string, unknown>)) {
    if (!node || typeof node !== 'object') {
      continue;
    }
    const record = node as { class_type?: unknown; inputs?: Record<string, unknown> };
    const classType = typeof record.class_type === 'string' ? record.class_type.toLowerCase() : '';
    const text = record.inputs?.text;
    if (classType.includes('cliptextencode') && typeof text === 'string' && text.trim()) {
      return text.trim();
    }
  }

  return undefined;
};

const parseQueueEntries = (queue: Record<string, unknown>, key: 'queue_running' | 'queue_pending'): ComfyUIQueueEntry[] => {
  const entries = queue[key];
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry): ComfyUIQueueEntry | null => {
      const promptId = getPromptIdFromQueueEntry(entry);
      if (!promptId) {
        return null;
      }

      return {
        promptId,
        prompt: extractPromptPreview(entry),
      };
    })
    .filter((entry): entry is ComfyUIQueueEntry => Boolean(entry));
};

const extractHistoryOutputs = (
  history: Record<string, unknown>,
  promptId: string,
  client: ComfyUIApiClient
): GeneratedQueueOutput[] => {
  const promptHistory = history[promptId];
  if (!promptHistory || typeof promptHistory !== 'object') {
    return [];
  }

  const outputs = (promptHistory as { outputs?: unknown }).outputs;
  if (!outputs || typeof outputs !== 'object') {
    return [];
  }

  const images: GeneratedQueueOutput[] = [];
  Object.values(outputs as Record<string, unknown>).forEach((nodeOutput, nodeIndex) => {
    const nodeImages = (nodeOutput as { images?: unknown }).images;
    if (!Array.isArray(nodeImages)) {
      return;
    }

    nodeImages.filter(isHistoryImage).forEach((image, imageIndex) => {
      if (typeof image.filename !== 'string') {
        return;
      }

      const subfolder = typeof image.subfolder === 'string' ? image.subfolder : '';
      const type = typeof image.type === 'string' ? image.type : 'output';
      const relativePath = subfolder ? `${subfolder}/${image.filename}` : image.filename;
      images.push({
        id: `comfyui_external_${promptId}_${nodeIndex}_${imageIndex}`,
        kind: 'remote-url',
        url: client.getViewUrl({
          filename: image.filename,
          subfolder,
          type,
        }),
        relativePath,
        name: image.filename,
      });
    });
  });

  return images;
};

const getTrackedExternalPromptIds = () =>
  useGenerationQueueStore
    .getState()
    .items.filter((item) => item.provider === 'comfyui' && item.origin === 'comfyui-external' && item.providerJobId)
    .map((item) => item.providerJobId!);

export function useComfyUIQueueMonitor() {
  const comfyUIEnabled = useSettingsStore((state) => state.comfyUIEnabled);
  const monitoringEnabled = useSettingsStore((state) => state.comfyUIQueueMonitoringEnabled);
  const serverUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const activePromptIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!comfyUIEnabled || !monitoringEnabled || !serverUrl) {
      return;
    }

    let isDisposed = false;
    let intervalId: number | null = null;
    const client = new ComfyUIApiClient({ serverUrl });

    const markHistoryIfAvailable = async (promptId: string) => {
      try {
        const history = await client.getHistory(promptId) as Record<string, unknown>;
        if (isDisposed || !history[promptId]) {
          return;
        }

        const outputs = extractHistoryOutputs(history, promptId, client);
        useGenerationQueueStore.getState().upsertExternalComfyUIJob({
          providerJobId: promptId,
          status: 'done',
          progress: 1,
          generatedOutputs: outputs,
          completedAt: Date.now(),
          currentNode: null,
        });
      } catch {
        // History may not exist yet; the next poll/WebSocket event will try again.
      }
    };

    const pollQueue = async () => {
      try {
        const queue = await client.getQueue() as Record<string, unknown>;
        if (isDisposed) {
          return;
        }

        const running = parseQueueEntries(queue, 'queue_running');
        const pending = parseQueueEntries(queue, 'queue_pending');
        const activePromptIds = new Set([...running, ...pending].map((entry) => entry.promptId));

        pending.forEach((entry) => {
          useGenerationQueueStore.getState().upsertExternalComfyUIJob({
            providerJobId: entry.promptId,
            status: 'waiting',
            progress: 0,
            prompt: entry.prompt,
          });
        });

        running.forEach((entry) => {
          activePromptIdRef.current = entry.promptId;
          useGenerationQueueStore.getState().upsertExternalComfyUIJob({
            providerJobId: entry.promptId,
            status: 'processing',
            progress: 0,
            prompt: entry.prompt,
          });
        });

        await Promise.all(
          getTrackedExternalPromptIds()
            .filter((promptId) => !activePromptIds.has(promptId))
            .map(markHistoryIfAvailable)
        );
      } catch {
        // Keep the monitor quiet when ComfyUI is offline or restarting.
      }
    };

    const connectWebSocket = () => {
      const resolvedServerUrl = normalizeLoopbackServerUrl(serverUrl);
      const wsUrl = `${resolvedServerUrl.replace(/^http/, 'ws')}/ws?clientId=image-metahub-monitor`;
      const socket = new WebSocket(wsUrl);

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ComfyUIProgressUpdate;
          const promptId = message.data?.prompt_id || activePromptIdRef.current;
          if (!promptId) {
            return;
          }

          if (message.type === 'executing') {
            if (message.data.node === null) {
              void markHistoryIfAvailable(promptId);
              return;
            }

            activePromptIdRef.current = promptId;
            useGenerationQueueStore.getState().upsertExternalComfyUIJob({
              providerJobId: promptId,
              status: 'processing',
              currentNode: message.data.node || null,
            });
          }

          if (message.type === 'progress') {
            const value = message.data.value || 0;
            const max = message.data.max || 1;
            useGenerationQueueStore.getState().upsertExternalComfyUIJob({
              providerJobId: promptId,
              status: 'processing',
              currentStep: value,
              totalSteps: max,
              progress: max > 0 ? value / max : 0,
            });
          }
        } catch {
          // Ignore malformed WebSocket messages from custom ComfyUI builds.
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (!isDisposed) {
          window.setTimeout(() => {
            if (!isDisposed) {
              ws = connectWebSocket();
            }
          }, 3000);
        }
      };

      return socket;
    };

    let ws: WebSocket | null = connectWebSocket();
    void pollQueue();
    intervalId = window.setInterval(pollQueue, POLL_INTERVAL_MS);

    return () => {
      isDisposed = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      ws?.close();
      ws = null;
      activePromptIdRef.current = null;
    };
  }, [comfyUIEnabled, monitoringEnabled, serverUrl]);
}
