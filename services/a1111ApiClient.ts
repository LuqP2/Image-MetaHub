import { BaseMetadata } from '../types';

export interface A1111Config {
  serverUrl: string;
  timeout?: number;
}

export interface A1111SendParams {
  prompt: string;
  negative_prompt?: string;
  steps?: number;
  sampler_name?: string;
  cfg_scale?: number;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
}

export interface A1111Response {
  success: boolean;
  message?: string;
  error?: string;
  images?: string[];
}

interface SamplerCache {
  list: string[];
  timestamp: number;
}

export class A1111ApiClient {
  private config: A1111Config;
  private samplerCache: SamplerCache | null = null;
  private modelCache: SamplerCache | null = null;
  private loraCache: SamplerCache | null = null;
  private readonly CACHE_DURATION = 300000; // 5 minutes in milliseconds

  constructor(config: A1111Config) {
    this.config = {
      timeout: 5000, // 5 second default timeout
      ...config
    };
  }

  /**
   * Test connection to A1111 server
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/sdapi/v1/options`, {
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
          error: 'Connection timeout. Is A1111 running?',
        };
      }
      return {
        success: false,
        error: `Connection failed: ${error.message}`,
      };
    }
  }

  /**
   * Get list of available samplers from A1111 server
   * Uses 5-minute cache to avoid excessive requests
   */
  async getSamplerList(): Promise<string[]> {
    // Check cache
    if (this.samplerCache && Date.now() - this.samplerCache.timestamp < this.CACHE_DURATION) {
      return this.samplerCache.list;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/sdapi/v1/samplers`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('Failed to fetch samplers list, using empty list');
        return [];
      }

      const samplers = await response.json();
      const list = samplers.map((s: any) => s.name);

      // Update cache
      this.samplerCache = { list, timestamp: Date.now() };
      return list;
    } catch (error: any) {
      console.warn('Failed to fetch samplers list:', error.message);
      return [];
    }
  }

  /**
   * Get list of available models from A1111 server
   */
  async getModelList(): Promise<string[]> {
    if (this.modelCache && Date.now() - this.modelCache.timestamp < this.CACHE_DURATION) {
      return this.modelCache.list;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/sdapi/v1/sd-models`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('Failed to fetch model list, using empty list');
        return [];
      }

      const models = await response.json();
      const list = models
        .map((m: any) => m.title || m.model_name || m.name)
        .filter((value: any) => typeof value === 'string' && value.length > 0);

      this.modelCache = { list, timestamp: Date.now() };
      return list;
    } catch (error: any) {
      console.warn('Failed to fetch model list:', error.message);
      return [];
    }
  }

  /**
   * Get list of available LoRAs from A1111 server
   */
  async getLoraList(): Promise<string[]> {
    if (this.loraCache && Date.now() - this.loraCache.timestamp < this.CACHE_DURATION) {
      return this.loraCache.list;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.serverUrl}/sdapi/v1/loras`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('Failed to fetch LoRA list, using empty list');
        return [];
      }

      const loras = await response.json();
      const list = loras
        .map((l: any) => l.name || l.alias || l.filename)
        .filter((value: any) => typeof value === 'string' && value.length > 0);

      this.loraCache = { list, timestamp: Date.now() };
      return list;
    } catch (error: any) {
      console.warn('Failed to fetch LoRA list:', error.message);
      return [];
    }
  }

  /**
   * Match input sampler name to available A1111 sampler
   * Uses fuzzy matching: case-insensitive, removes underscores and spaces
   */
  async matchSampler(inputSampler: string): Promise<string> {
    if (!inputSampler) {
      return 'Euler a'; // Default sampler
    }

    const availableSamplers = await this.getSamplerList();

    if (availableSamplers.length === 0) {
      // If we couldn't fetch samplers, return input as-is
      return inputSampler;
    }

    // Normalization function
    const normalize = (s: string) => s.toLowerCase().replace(/[_\s]/g, '');
    const normalized = normalize(inputSampler);

    // Try exact match first (normalized)
    const match = availableSamplers.find(s => normalize(s) === normalized);

    if (match) {
      return match;
    }

    // Fallback: return original input
    return inputSampler;
  }

  /**
   * Convert BaseMetadata to A1111 API format
   */
  private async metadataToA1111Params(metadata: BaseMetadata): Promise<A1111SendParams> {
    // Get sampler from metadata
    const samplerName = metadata.sampler || metadata.scheduler;
    const mappedSampler = await this.matchSampler(samplerName || 'Euler a');

    // Extract CFG scale - handle both cfgScale and cfg_scale
    const cfgScale = (metadata as any).cfgScale || metadata.cfg_scale || 7.0;

    return {
      prompt: metadata.prompt || '',
      negative_prompt: metadata.negativePrompt || '',
      steps: metadata.steps || 20,
      sampler_name: mappedSampler,
      cfg_scale: cfgScale,
      width: metadata.width || 512,
      height: metadata.height || 512,
      seed: metadata.seed !== undefined ? metadata.seed : -1,
      model: metadata.model,
    };
  }

  /**
   * Send parameters to A1111 txt2img endpoint
   */
  async sendToTxt2Img(
    metadata: BaseMetadata,
    options: { autoStart: boolean; numberOfImages?: number } = { autoStart: false, numberOfImages: 1 }
  ): Promise<A1111Response> {
    try {
      const params = await this.metadataToA1111Params(metadata);

      const requestBody: any = {
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        steps: params.steps,
        sampler_name: params.sampler_name,
        cfg_scale: params.cfg_scale,
        width: params.width,
        height: params.height,
        seed: params.seed,
        n_iter: options.numberOfImages || 1,
        save_images: options.autoStart,
        send_images: options.autoStart,
      };

      // If model is specified, add it to override_settings
      if (params.model) {
        requestBody.override_settings = {
          sd_model_checkpoint: params.model,
        };
      }

      const controller = new AbortController();
      // 3 minute timeout for generation (some models/steps can take longer)
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      const response = await fetch(`${this.config.serverUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[A1111] API error:', response.status, errorText);
        return {
          success: false,
          error: `API error: ${response.status} - ${errorText}`,
        };
      }

      const result = await response.json();

      return {
        success: true,
        message: options.autoStart
          ? 'Image generated successfully!'
          : 'Parameters sent to A1111 successfully!',
        images: result.images,
      };
    } catch (error: any) {
      console.error('[A1111] Request failed:', error);
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timeout. Generation may take longer.',
        };
      }
      return {
        success: false,
        error: `Failed to send to A1111: ${error.message}`,
      };
    }
  }
}
