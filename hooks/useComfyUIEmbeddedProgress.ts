import { useEffect, useRef } from 'react';
import { decodeComfyUIPreviewFrame } from '../services/comfyUIApiClient';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';
import { ComfyEmbeddedWsMessage } from '../types';

/**
 * Enriches externally-queued ComfyUI jobs (those generated through the embedded
 * ComfyUI UI) with live step progress and KSampler-style preview images.
 *
 * The events come from the embedded view's own WebSocket, observed read-only by
 * comfyui-view-preload.js and relayed over IPC — see the queue monitor comment on
 * why we cannot open our own socket for these jobs. This hook only patches the
 * matching queue item (by prompt_id / providerJobId); item creation, final status
 * and outputs are still handled by useComfyUIQueueMonitor via REST polling.
 */
const toArrayBuffer = (buffer: unknown): ArrayBuffer | null => {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }
  // Typed array / Node Buffer arriving through IPC: copy out the exact view range.
  if (ArrayBuffer.isView(buffer)) {
    const view = buffer as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  // Serialized Node Buffer ({ type: 'Buffer', data: [...] }) or a plain byte array.
  const maybe = buffer as { data?: number[] } | number[] | null | undefined;
  if (maybe && Array.isArray((maybe as { data?: number[] }).data)) {
    return new Uint8Array((maybe as { data: number[] }).data).buffer;
  }
  if (Array.isArray(maybe)) {
    return new Uint8Array(maybe).buffer;
  }
  return null;
};

export function useComfyUIEmbeddedProgress() {
  const activePromptIdRef = useRef<string | null>(null);
  const previewUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.onComfyEmbeddedProgress) {
      return;
    }

    const clearPreview = (promptId: string) => {
      const url = previewUrlsRef.current.get(promptId);
      if (url) {
        URL.revokeObjectURL(url);
        previewUrlsRef.current.delete(promptId);
      }
    };

    const handleJson = (payload: { type?: string; data?: Record<string, unknown> }) => {
      const promptId = typeof payload.data?.prompt_id === 'string'
        ? payload.data.prompt_id
        : activePromptIdRef.current;
      if (!promptId) {
        return;
      }

      if (payload.type === 'execution_error' || payload.type === 'execution_interrupted') {
        clearPreview(promptId);
        useGenerationQueueStore.getState().upsertExternalComfyUIJob({
          providerJobId: promptId,
          status: 'processing',
          previewImageUrl: null,
        });
        return;
      }

      if (payload.type === 'executing') {
        if (payload.data?.node === null) {
          clearPreview(promptId);
          useGenerationQueueStore.getState().upsertExternalComfyUIJob({
            providerJobId: promptId,
            status: 'processing',
            previewImageUrl: null,
          });
          return;
        }
        activePromptIdRef.current = promptId;
        return;
      }

      if (payload.type === 'progress') {
        const value = typeof payload.data?.value === 'number' ? payload.data.value : 0;
        const max = typeof payload.data?.max === 'number' ? payload.data.max : 1;
        activePromptIdRef.current = promptId;
        useGenerationQueueStore.getState().upsertExternalComfyUIJob({
          providerJobId: promptId,
          status: 'processing',
          currentStep: value,
          totalSteps: max,
          progress: max > 0 ? value / max : 0,
        });
      }
    };

    const handleBinary = (buffer: unknown) => {
      const promptId = activePromptIdRef.current;
      const arrayBuffer = toArrayBuffer(buffer);
      const blob = arrayBuffer ? decodeComfyUIPreviewFrame(arrayBuffer) : null;
      if (!promptId || !blob) {
        return;
      }
      clearPreview(promptId);
      const url = URL.createObjectURL(blob);
      previewUrlsRef.current.set(promptId, url);
      useGenerationQueueStore.getState().upsertExternalComfyUIJob({
        providerJobId: promptId,
        status: 'processing',
        previewImageUrl: url,
      });
    };

    const unsubscribe = api.onComfyEmbeddedProgress((message: ComfyEmbeddedWsMessage) => {
      try {
        if (message.kind === 'json') {
          handleJson(message.payload);
        } else if (message.kind === 'binary') {
          handleBinary(message.buffer);
        }
      } catch {
        // Ignore malformed relayed events.
      }
    });

    return () => {
      unsubscribe?.();
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
      activePromptIdRef.current = null;
    };
  }, []);
}
