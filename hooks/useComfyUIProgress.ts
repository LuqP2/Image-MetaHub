/**
 * ComfyUI Progress Hook
 * WebSocket-based real-time progress tracking for ComfyUI generations
 */

import { useState, useRef, useCallback } from 'react';
import { ComfyUIProgressUpdate } from '../services/comfyUIApiClient';

export interface ComfyUIProgressState {
  isGenerating: boolean;
  currentNode: string | null;
  currentStep: number;
  totalSteps: number;
  progress: number;  // 0-1, overall progress
  queuePosition: number;
}

export function useComfyUIProgress() {
  const [progressState, setProgressState] = useState<ComfyUIProgressState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const promptIdRef = useRef<string>('');
  const clientIdRef = useRef<string>('');

  const startTracking = useCallback((serverUrl: string, promptId: string, clientId?: string) => {
    // Store prompt ID for reference
    promptIdRef.current = promptId;
    clientIdRef.current = clientId || generateClientId();

    // Convert http:// to ws://
    const wsUrl = serverUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientIdRef.current}`;

    console.log('[ComfyUI Progress] Connecting to WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[ComfyUI Progress] WebSocket connected');
      setProgressState({
        isGenerating: true,
        currentNode: null,
        currentStep: 0,
        totalSteps: 0,
        progress: 0,
        queuePosition: 0
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ComfyUIProgressUpdate;
        if (message.data?.prompt_id && message.data.prompt_id !== promptIdRef.current) {
          return;
        }

        // Progress update
        if (message.type === 'progress') {
          const value = message.data.value || 0;
          const max = message.data.max || 1;

          setProgressState(prev => ({
            ...prev,
            isGenerating: true,
            currentStep: value,
            totalSteps: max,
            progress: max > 0 ? value / max : 0,
            queuePosition: 0
          }));
        }

        // Node execution started
        if (message.type === 'executing') {
          if (message.data.node === null) {
            // Generation complete
            console.log('[ComfyUI Progress] Generation complete');
            setProgressState(prev => ({
              ...prev,
              isGenerating: false,
              progress: 1,
              currentStep: prev?.totalSteps || 0
            }));

            // Close WebSocket after a short delay
            setTimeout(() => {
              ws.close();
              setProgressState(null);
            }, 2000);
          } else {
            setProgressState(prev => ({
              ...prev,
              isGenerating: true,
              currentNode: message.data.node || null
            }));
          }
        }

        // Node execution completed
        if (message.type === 'executed') {
          console.log('[ComfyUI Progress] Node executed:', message.data.node);
        }

        // Status update (queue position)
        if (message.type === 'status') {
          const status = (message.data as any).status;
          if (status?.queue_remaining !== undefined) {
            setProgressState(prev => ({
              ...prev,
              isGenerating: true,
              queuePosition: status.queue_remaining
            }));
          }
        }
      } catch (error) {
        console.warn('[ComfyUI Progress] Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[ComfyUI Progress] WebSocket error:', error);
      setProgressState(prev => ({
        ...prev,
        isGenerating: false
      }));
    };

    ws.onclose = () => {
      console.log('[ComfyUI Progress] WebSocket closed');
      wsRef.current = null;
    };

    wsRef.current = ws;
  }, []);

  const stopTracking = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setProgressState(null);
    promptIdRef.current = '';
    clientIdRef.current = '';
  }, []);

  return { progressState, startTracking, stopTracking };
}

/**
 * Generate a unique client ID for WebSocket connections
 */
function generateClientId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
