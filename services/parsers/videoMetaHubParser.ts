import { type BaseMetadata } from '../../types';

type MetaHubVideoPayload = Record<string, any>;

const parseJsonSafe = (value: unknown): MetaHubVideoPayload | null => {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as MetaHubVideoPayload) : null;
  } catch {
    return null;
  }
};

const extractVideoMetaHubPayload = (rawData: unknown): MetaHubVideoPayload | null => {
  if (!rawData) {
    return null;
  }

  if (typeof rawData === 'object') {
    const data = rawData as MetaHubVideoPayload;
    if (data.videometahub_data && typeof data.videometahub_data === 'object') {
      return data.videometahub_data as MetaHubVideoPayload;
    }
    if (data.comment && typeof data.comment === 'string') {
      const parsed = parseJsonSafe(data.comment);
      if (parsed) {
        return parsed;
      }
    }
    if (data.media_type === 'video' || data.video) {
      return data;
    }
  }

  if (typeof rawData === 'string') {
    return parseJsonSafe(rawData);
  }

  return null;
};

const normalizeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const parseUserTags = (rawTags: unknown): string[] => {
  if (typeof rawTags !== 'string') {
    return [];
  }
  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
};

export const parseVideoMetaHubMetadata = (rawData: unknown): BaseMetadata | null => {
  const payload = extractVideoMetaHubPayload(rawData);
  if (!payload) {
    return null;
  }

  const video = (payload.video && typeof payload.video === 'object') ? payload.video : {};
  const width = normalizeNumber(video.width ?? payload.width, 0);
  const height = normalizeNumber(video.height ?? payload.height, 0);
  const userTags = parseUserTags(payload.imh_pro?.user_tags);

  return {
    prompt: payload.prompt || '',
    negativePrompt: payload.negativePrompt || '',
    model: payload.model || '',
    models: payload.model ? [payload.model] : [],
    width,
    height,
    seed: payload.seed,
    steps: normalizeNumber(payload.steps, 0),
    cfg_scale: payload.cfg,
    scheduler: payload.scheduler || '',
    sampler: payload.sampler_name || '',
    loras: payload.loras || [],
    tags: userTags,
    notes: payload.imh_pro?.notes || '',
    generator: payload.generator || 'ComfyUI',
    media_type: payload.media_type || 'video',
    video: payload.video || null,
    motion_model: payload.motion_model || null,
    vae: payload.vae,
    denoise: payload.denoise,
    model_hash: payload.model_hash,
    _analytics: payload.analytics || null,
    _metahub_pro: payload.imh_pro || null,
  };
};
