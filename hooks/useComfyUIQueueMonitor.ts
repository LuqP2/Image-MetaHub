import { useEffect, useRef } from 'react';
import { ComfyUIApiClient, normalizeLoopbackServerUrl } from '../services/comfyUIApiClient';
import { GeneratedQueueOutput, useGenerationQueueStore } from '../store/useGenerationQueueStore';
import { useSettingsStore } from '../store/useSettingsStore';

type ComfyUIQueueEntry = {
  promptId: string;
  prompt?: string;
  nodeLabels: Record<string, string>;
};

type ComfyUIHistoryImage = {
  filename?: unknown;
  subfolder?: unknown;
  type?: unknown;
};

type ComfyUIMonitorMessage = {
  type?: string;
  data?: Record<string, unknown>;
};

const POLL_INTERVAL_MS = 1500;
const MONITOR_CLIENT_ID = 'image-metahub-monitor';

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

const extractNodeLabels = (entry: unknown): Record<string, string> => {
  const graph = getPromptGraphFromQueueEntry(entry);
  if (!graph || typeof graph !== 'object') {
    return {};
  }

  return Object.entries(graph as Record<string, unknown>).reduce<Record<string, string>>((labels, [nodeId, node]) => {
    if (!node || typeof node !== 'object') {
      return labels;
    }

    const record = node as { class_type?: unknown; _meta?: { title?: unknown } };
    const title = typeof record._meta?.title === 'string' ? record._meta.title.trim() : '';
    const classType = typeof record.class_type === 'string' ? record.class_type.trim() : '';
    labels[String(nodeId)] = title || classType || `Node ${nodeId}`;
    return labels;
  }, {});
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
        nodeLabels: extractNodeLabels(entry),
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

const getPromptHistory = (history: Record<string, unknown>, promptId: string): Record<string, unknown> | null => {
  const promptHistory = history[promptId];
  return promptHistory && typeof promptHistory === 'object'
    ? promptHistory as Record<string, unknown>
    : null;
};

const stringifyMessage = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = stringifyMessage(entry);
      if (message) {
        return message;
      }
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return stringifyMessage(record.exception_message) ||
      stringifyMessage(record.exception_type) ||
      stringifyMessage(record.message) ||
      stringifyMessage(record.error);
  }
  return null;
};

const getHistoryFailureMessage = (promptHistory: Record<string, unknown>): string | null => {
  const status = promptHistory.status;
  const statusRecord = status && typeof status === 'object' ? status as Record<string, unknown> : null;
  const statusText = typeof statusRecord?.status_str === 'string' ? statusRecord.status_str.toLowerCase() : '';
  const completed = statusRecord?.completed;

  if (statusText && statusText !== 'success') {
    return stringifyMessage(statusRecord?.messages) || `ComfyUI ${statusText}`;
  }

  if (completed === false && statusText) {
    return stringifyMessage(statusRecord?.messages) || `ComfyUI ${statusText}`;
  }

  return stringifyMessage(promptHistory.execution_error) ||
    stringifyMessage(promptHistory.error) ||
    stringifyMessage(promptHistory.exception);
};

const getWebSocketUrl = (serverUrl: string): string | null => {
  try {
    const resolvedServerUrl = normalizeLoopbackServerUrl(serverUrl);
    const url = new URL(resolvedServerUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = `clientId=${encodeURIComponent(MONITOR_CLIENT_ID)}`;
    return url.toString();
  } catch {
    return null;
  }
};

const getTrackedExternalPromptIds = () =>
  useGenerationQueueStore
    .getState()
    .items.filter((item) =>
      item.provider === 'comfyui' &&
      item.origin === 'comfyui-external' &&
      item.providerJobId &&
      item.status !== 'done' &&
      item.status !== 'failed' &&
      item.status !== 'canceled'
    )
    .map((item) => item.providerJobId!);

export function useComfyUIQueueMonitor() {
  const comfyUIEnabled = useSettingsStore((state) => state.comfyUIEnabled);
  const monitoringEnabled = useSettingsStore((state) => state.comfyUIQueueMonitoringEnabled);
  const serverUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const activePromptIdRef = useRef<string | null>(null);
  const nodeLabelsRef = useRef<Map<string, Record<string, string>>>(new Map());

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
        const promptHistory = getPromptHistory(history, promptId);
        if (isDisposed || !promptHistory) {
          return;
        }

        const failureMessage = getHistoryFailureMessage(promptHistory);
        if (failureMessage) {
          useGenerationQueueStore.getState().upsertExternalComfyUIJob({
            providerJobId: promptId,
            status: 'failed',
            progress: 1,
            error: failureMessage,
            completedAt: Date.now(),
            currentNode: null,
          });
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

        // Optimization: Replaced spread operator and `.map()` with `for` loops
        // to eliminate the O(N) allocation of intermediate arrays.
        // Impact: Reduces garbage collection pauses during polling.
        const activePromptIds = new Set<string>();
        for (const entry of running) {
          activePromptIds.add(entry.promptId);
        }
        for (const entry of pending) {
          activePromptIds.add(entry.promptId);
        }

        pending.forEach((entry) => {
          nodeLabelsRef.current.set(entry.promptId, entry.nodeLabels);
          useGenerationQueueStore.getState().upsertExternalComfyUIJob({
            providerJobId: entry.promptId,
            status: 'waiting',
            progress: 0,
            prompt: entry.prompt,
          });
        });

        running.forEach((entry) => {
          activePromptIdRef.current = entry.promptId;
          nodeLabelsRef.current.set(entry.promptId, entry.nodeLabels);
          useGenerationQueueStore.getState().upsertExternalComfyUIJob({
            providerJobId: entry.promptId,
            status: 'processing',
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
      const wsUrl = getWebSocketUrl(serverUrl);
      if (!wsUrl) {
        return null;
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        return null;
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ComfyUIMonitorMessage;
          const promptId = typeof message.data?.prompt_id === 'string'
            ? message.data.prompt_id
            : activePromptIdRef.current;
          if (!promptId) {
            return;
          }

          if (message.type === 'execution_error' || message.type === 'execution_interrupted') {
            useGenerationQueueStore.getState().upsertExternalComfyUIJob({
              providerJobId: promptId,
              status: 'failed',
              progress: 1,
              error: stringifyMessage(message.data) || (message.type === 'execution_interrupted' ? 'ComfyUI generation interrupted.' : 'ComfyUI generation failed.'),
              completedAt: Date.now(),
              currentNode: null,
            });
            return;
          }

          if (message.type === 'executing') {
            if (message.data?.node === null) {
              void markHistoryIfAvailable(promptId);
              return;
            }

            activePromptIdRef.current = promptId;
            const nodeId = typeof message.data?.node === 'string' || typeof message.data?.node === 'number'
              ? String(message.data.node)
              : null;
            const currentNode = nodeId
              ? nodeLabelsRef.current.get(promptId)?.[nodeId] || `Node ${nodeId}`
              : null;
            useGenerationQueueStore.getState().upsertExternalComfyUIJob({
              providerJobId: promptId,
              status: 'processing',
              currentNode,
            });
          }

          if (message.type === 'progress') {
            const value = typeof message.data?.value === 'number' ? message.data.value : 0;
            const max = typeof message.data?.max === 'number' ? message.data.max : 1;
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
      nodeLabelsRef.current.clear();
    };
  }, [comfyUIEnabled, monitoringEnabled, serverUrl]);
}
