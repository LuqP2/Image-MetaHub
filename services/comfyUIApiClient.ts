/**
 * ComfyUI API Client
 * Handles communication with ComfyUI server, workflow generation, and WebSocket progress tracking
 */

import { BaseMetadata } from '../types';
import { handleComfyUIError } from '../utils/comfyUIErrorHandler';

export interface ComfyUIConfig {
  serverUrl: string;        // e.g., "http://127.0.0.1:8188"
  timeout?: number;
}

export interface LoRAConfig {
  name: string;
  strength: number;
}

export interface WorkflowOverrides {
  model?: string;
  loras?: LoRAConfig[];
}

export interface ComfyUIWorkflow {
  prompt: {
    [nodeId: string]: {
      class_type: string;
      inputs: any;
    };
  };
  client_id: string;
}

export interface ComfyUIResponse {
  success: boolean;
  message?: string;
  error?: string;
  prompt_id?: string;  // ID for tracking generation
  images?: string[];    // Base64 encoded images
}

export interface ComfyUIProgressUpdate {
  type: 'status' | 'progress' | 'executing' | 'executed';
  data: {
    node?: string;
    value?: number;     // Current step
    max?: number;       // Total steps
    prompt_id?: string;
  };
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

export class ComfyUIApiClient {
  private config: ComfyUIConfig;
  private clientId: string;
  private ws: WebSocket | null = null;

  constructor(config: ComfyUIConfig) {
    this.config = {
      timeout: 10000, // 10 second default timeout
      ...config
    };
    this.clientId = generateClientId();
  }

  /**
   * Test connection to ComfyUI server
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/system_stats`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `Server returned ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Connection timeout. Is ComfyUI running?',
        };
      }

      const comfyError = handleComfyUIError(error);
      return {
        success: false,
        error: comfyError.userMessage,
      };
    }
  }

  /**
   * Get system stats from ComfyUI server
   */
  async getSystemStats(): Promise<any> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/system_stats`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch system stats: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.warn('Failed to fetch system stats:', error.message);
      throw error;
    }
  }

  /**
   * Get available nodes, models, samplers from ComfyUI
   */
  async getObjectInfo(): Promise<any> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/object_info`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch object info: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.warn('Failed to fetch object info:', error.message);
      throw error;
    }
  }

  /**
   * Build a basic txt2img workflow from BaseMetadata
   * Uses MetaHub Save Node for automatic metadata saving
   * Supports model and LoRA overrides for customization
   */
  buildWorkflowFromMetadata(metadata: BaseMetadata, overrides?: WorkflowOverrides): ComfyUIWorkflow {
    // Extract CFG scale - handle both cfgScale and cfg_scale
    const cfgScale = (metadata as any).cfgScale || metadata.cfg_scale || 7.0;

    // Use override model if provided, otherwise use metadata model or default
    const modelName = overrides?.model || metadata.model || "sd_xl_base_1.0.safetensors";

    // Dynamic node numbering based on LoRAs
    const loras = overrides?.loras || [];
    let currentNodeId = 1;

    const workflow: any = {};

    // Node 1: CheckpointLoader
    workflow["1"] = {
      "class_type": "CheckpointLoaderSimple",
      "inputs": {
        "ckpt_name": modelName
      }
    };
    currentNodeId = 2;

    // Node 2: MetaHub Timer
    workflow["2"] = {
      "class_type": "MetaHubTimerNode",
      "inputs": {
        "clip": ["1", 1]
      }
    };
    currentNodeId = 3;

    // Track last MODEL and CLIP outputs for chaining
    let lastModelOutput: [string, number] = ["1", 0];  // From CheckpointLoader
    let lastClipOutput: [string, number] = ["2", 0];   // From Timer

    // Inject LoRA Loader nodes if LoRAs are provided
    if (loras.length > 0) {
      loras.forEach((lora) => {
        const nodeId = currentNodeId.toString();
        workflow[nodeId] = {
          "class_type": "LoraLoader",
          "inputs": {
            "lora_name": lora.name,
            "strength_model": lora.strength,
            "strength_clip": lora.strength,
            "model": lastModelOutput,
            "clip": lastClipOutput
          }
        };

        // Update outputs for next node in chain
        lastModelOutput = [nodeId, 0];
        lastClipOutput = [nodeId, 1];
        currentNodeId++;
      });
    }

    // Node N: CLIPTextEncode (positive)
    const positiveNodeId = currentNodeId.toString();
    const positivePrompt = metadata.prompt || "";
    workflow[positiveNodeId] = {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": positivePrompt,
        "clip": lastClipOutput
      }
    };
    currentNodeId++;

    // Node N+1: CLIPTextEncode (negative)
    const negativeNodeId = currentNodeId.toString();
    const negativePrompt = metadata.negativePrompt || "";
    workflow[negativeNodeId] = {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": negativePrompt,
        "clip": lastClipOutput
      }
    };
    currentNodeId++;

    // Node N+2: EmptyLatentImage
    const latentNodeId = currentNodeId.toString();
    workflow[latentNodeId] = {
      "class_type": "EmptyLatentImage",
      "inputs": {
        "width": metadata.width || 1024,
        "height": metadata.height || 1024,
        "batch_size": 1
      }
    };
    currentNodeId++;

    // Node N+3: KSampler
    const samplerNodeId = currentNodeId.toString();
    workflow[samplerNodeId] = {
      "class_type": "KSampler",
      "inputs": {
        "seed": metadata.seed !== undefined ? metadata.seed : Math.floor(Math.random() * 1000000000),
        "steps": metadata.steps || 20,
        "cfg": cfgScale,
        "sampler_name": metadata.sampler || "euler",
        "scheduler": metadata.scheduler || "normal",
        "denoise": 1.0,
        "model": lastModelOutput,
        "positive": [positiveNodeId, 0],
        "negative": [negativeNodeId, 0],
        "latent_image": [latentNodeId, 0]
      }
    };
    currentNodeId++;

    // Node N+4: VAEDecode
    const vaeDecodeNodeId = currentNodeId.toString();
    workflow[vaeDecodeNodeId] = {
      "class_type": "VAEDecode",
      "inputs": {
        "samples": [samplerNodeId, 0],
        "vae": ["1", 2]  // Always from CheckpointLoader
      }
    };
    currentNodeId++;

    // Node N+5: MetaHubSaveNode
    const saveNodeId = currentNodeId.toString();
    workflow[saveNodeId] = {
      "class_type": "MetaHubSaveNode",
      "inputs": {
        "images": [vaeDecodeNodeId, 0],
        "filename_pattern": "MetaHub_%date%_%time%_%counter%",
        "file_format": "PNG",
        "generation_time_override": ["2", 4]  // Always from Timer node
      }
    };

    console.log('[ComfyUI] Built workflow:', {
      nodes: Object.keys(workflow).length,
      model: modelName,
      loras: loras.length
    });

    return {
      prompt: workflow,
      client_id: this.clientId
    };
  }

  /**
   * Queue a workflow for execution
   */
  async queuePrompt(workflow: ComfyUIWorkflow): Promise<ComfyUIResponse> {
    try {
      const controller = new AbortController();
      // 3 minute timeout for generation
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      const response = await fetch(`${this.config.serverUrl}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflow),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[ComfyUI] API error:', response.status, errorText);
        return {
          success: false,
          error: `API error: ${response.status} - ${errorText}`,
        };
      }

      const result = await response.json();

      return {
        success: true,
        message: 'Workflow queued successfully! Check ComfyUI for results.',
        prompt_id: result.prompt_id,
      };
    } catch (error: any) {
      console.error('[ComfyUI] Request failed:', error);

      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timeout. Generation may take longer.',
        };
      }

      const comfyError = handleComfyUIError(error);
      return {
        success: false,
        error: comfyError.userMessage,
      };
    }
  }

  /**
   * Get execution history for a specific prompt
   */
  async getHistory(promptId: string): Promise<any> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/history/${promptId}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch history: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.warn('Failed to fetch history:', error.message);
      throw error;
    }
  }

  /**
   * Get current queue status
   */
  async getQueue(): Promise<any> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/queue`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch queue: ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.warn('Failed to fetch queue:', error.message);
      throw error;
    }
  }

  /**
   * Connect to ComfyUI WebSocket for real-time progress updates
   */
  connectWebSocket(onProgress: (update: ComfyUIProgressUpdate) => void): void {
    try {
      // Convert http:// to ws://
      const wsUrl = this.config.serverUrl.replace(/^http/, 'ws') + `/ws?clientId=${this.clientId}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[ComfyUI] WebSocket connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Forward progress updates to callback
          if (message.type === 'progress' || message.type === 'executing' || message.type === 'executed' || message.type === 'status') {
            onProgress(message as ComfyUIProgressUpdate);
          }
        } catch (error) {
          console.warn('[ComfyUI] Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[ComfyUI] WebSocket error:', error);
        onProgress({
          type: 'status',
          data: {
            node: 'error'
          }
        });
      };

      this.ws.onclose = () => {
        console.log('[ComfyUI] WebSocket disconnected');
        this.ws = null;
      };
    } catch (error: any) {
      console.error('[ComfyUI] Failed to connect WebSocket:', error);
      const comfyError = handleComfyUIError(error);
      throw comfyError;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get client ID used for WebSocket connection
   */
  getClientId(): string {
    return this.clientId;
  }
}
