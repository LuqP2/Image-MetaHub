import type { BaseMetadata } from '../../types';

type BrowserMetaHubPayload = {
  schema?: string;
  metadata?: Record<string, any>;
  source?: Record<string, any>;
  image?: Record<string, any>;
  prompt?: Record<string, any>;
};

function toObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function isBrowserMetaHubPayload(rawData: unknown): rawData is BrowserMetaHubPayload {
  const payload = toObject(rawData);
  return Boolean(payload && typeof payload.schema === 'string' && payload.schema.startsWith('imagemetahub.browser/'));
}

export function parseBrowserMetaHubMetadata(rawData: unknown): BaseMetadata | null {
  let payload = rawData;

  if (toObject(rawData)?.imh_browser_data) {
    payload = toObject(rawData)?.imh_browser_data;
  } else if (toObject(rawData)?.imagemetahub_data) {
    payload = toObject(rawData)?.imagemetahub_data;
  }

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (!isBrowserMetaHubPayload(payload)) {
    return null;
  }

  const data = toObject(payload.metadata) || {};
  const source = toObject(payload.source) || {};
  const image = toObject(payload.image) || {};
  const prompt = toObject(payload.prompt) || {};

  const promptText = firstString(data.prompt, prompt.text);
  const model = firstString(data.model);
  const provider = firstString(data.provider, source.provider, 'Browser');
  const width = toNumber(data.width ?? image.width);
  const height = toNumber(data.height ?? image.height);

  return {
    prompt: promptText,
    negativePrompt: '',
    model,
    models: model ? [model] : [],
    width,
    height,
    steps: 0,
    scheduler: '',
    sampler: '',
    generator: provider,
    source_url: firstString(data.source_url, source.url),
    image_url: firstString(data.image_url, image.url),
    page_host: firstString(source.hostname),
    page_title: firstString(source.title),
    conversation_id: firstString(source.conversation_id),
    captured_at: firstString(data.captured_at),
    _detection_method: 'browser_metahub',
    _browser_context: payload,
  };
}
