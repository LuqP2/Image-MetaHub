export type DetectedGeneratorId =
  | 'comfyui'
  | 'a1111'
  | 'forge'
  | 'sdnext'
  | 'fooocus'
  | 'swarmui'
  | 'invoke'
  | 'unknown';

export type GeneratorRuntimeFamily = 'comfyui' | 'a1111' | 'none';

export interface DetectedGeneratorLaunch {
  id: DetectedGeneratorId;
  displayName: string;
  runtimeFamily: GeneratorRuntimeFamily;
}

const DETECTED_GENERATORS: Record<DetectedGeneratorId, DetectedGeneratorLaunch> = {
  comfyui: { id: 'comfyui', displayName: 'ComfyUI', runtimeFamily: 'comfyui' },
  a1111: { id: 'a1111', displayName: 'A1111', runtimeFamily: 'a1111' },
  forge: { id: 'forge', displayName: 'Forge', runtimeFamily: 'a1111' },
  sdnext: { id: 'sdnext', displayName: 'SD.Next', runtimeFamily: 'a1111' },
  fooocus: { id: 'fooocus', displayName: 'Fooocus', runtimeFamily: 'none' },
  swarmui: { id: 'swarmui', displayName: 'SwarmUI', runtimeFamily: 'none' },
  invoke: { id: 'invoke', displayName: 'Invoke', runtimeFamily: 'none' },
  unknown: { id: 'unknown', displayName: 'Generator', runtimeFamily: 'none' },
};

const PROVIDER_RULES: Array<{ id: Exclude<DetectedGeneratorId, 'unknown'>; patterns: RegExp[] }> = [
  {
    id: 'comfyui',
    patterns: [
      /\bcomfyui\b/i,
      /\bpython(?:\.exe)?\s+main\.py\b/i,
      /[\\/ ]main\.py(?:\s|$)/i,
    ],
  },
  {
    id: 'swarmui',
    patterns: [
      /\bswarmui\b/i,
      /\blaunch-(windows|linux|macos)\.(bat|sh)\b/i,
    ],
  },
  {
    id: 'fooocus',
    patterns: [
      /\bfooocus\b/i,
      /\bentry_with_update\.py\b/i,
    ],
  },
  {
    id: 'forge',
    patterns: [
      /\bforge\b/i,
      /stable-diffusion-webui-forge/i,
    ],
  },
  {
    id: 'sdnext',
    patterns: [
      /\bsd[._ -]?next\b/i,
      /stable-diffusion-next/i,
    ],
  },
  {
    id: 'invoke',
    patterns: [
      /\binvokeai-web\b/i,
      /\binvokeai\b/i,
    ],
  },
  {
    id: 'a1111',
    patterns: [
      /\bautomatic1111\b/i,
      /stable-diffusion-webui/i,
      /\bwebui-user\.(bat|sh)\b/i,
    ],
  },
];

export function detectGeneratorFromLaunchCommand(command: string): DetectedGeneratorLaunch {
  const normalized = typeof command === 'string' ? command.trim() : '';
  if (!normalized) {
    return DETECTED_GENERATORS.unknown;
  }

  for (const rule of PROVIDER_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return DETECTED_GENERATORS[rule.id];
    }
  }

  return DETECTED_GENERATORS.unknown;
}
