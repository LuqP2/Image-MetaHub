import type {
  TeamExpectedModelEntry,
  TeamModelsComparison,
  TeamModelsManifest,
} from './teamWorkspaceTypes';

export interface LocalModelReference {
  name: string;
  fileName?: string | null;
  sha256?: string | null;
}

function normalizeModelName(value: string): string {
  const base = value.replace(/\\/g, '/').split('/').pop() ?? value;
  return base.trim().toLowerCase().replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '');
}

function normalizeSha(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{10,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Compare a Team Workspace's expected models manifest against locally installed models.
 * Matches by SHA-256 first (when available), then falls back to normalized model basename.
 */
export function compareLocalModelsAgainstManifest(
  manifest: TeamModelsManifest | null | undefined,
  localModels: LocalModelReference[],
): TeamModelsComparison {
  if (!manifest || !Array.isArray(manifest.models) || manifest.models.length === 0) {
    return { installed: [], missing: [] };
  }

  const localHashes = new Set<string>();
  const localNames = new Set<string>();

  for (const model of localModels) {
    const sha = normalizeSha(model.sha256);
    if (sha) {
      localHashes.add(sha);
      localHashes.add(sha.slice(0, 10)); // AutoV2 short hash compatibility
    }
    if (model.name) localNames.add(normalizeModelName(model.name));
    if (model.fileName) localNames.add(normalizeModelName(model.fileName));
  }

  const installed: TeamExpectedModelEntry[] = [];
  const missing: TeamExpectedModelEntry[] = [];

  for (const expected of manifest.models) {
    const expectedSha = normalizeSha(expected.sha256);
    const expectedName = normalizeModelName(expected.name);
    const matchedByHash = Boolean(
      expectedSha && (localHashes.has(expectedSha) || localHashes.has(expectedSha.slice(0, 10))),
    );
    const matchedByName = Boolean(expectedName && localNames.has(expectedName));

    if (matchedByHash || matchedByName) {
      installed.push(expected);
    } else {
      missing.push(expected);
    }
  }

  return { installed, missing };
}

/**
 * Convert absolute paths inside `workspaceRootPath` within a Board document to portable
 * POSIX workspace-relative paths (`$workspace/<relativePath>`), so Team Boards open across Windows and macOS.
 */
export function normalizeBoardPathsForTeam<T>(value: T, workspaceRootPath: string): T {
  const rootPosix = workspaceRootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const rootLower = rootPosix.toLowerCase();

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const candidatePosix = node.replace(/\\/g, '/');
      const candidateLower = candidatePosix.toLowerCase();
      if (candidateLower.startsWith(`${rootLower}/`)) {
        const rel = candidatePosix.slice(rootPosix.length + 1);
        return `$workspace/${rel}`;
      }
      return node;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  return walk(value) as T;
}

/**
 * Resolve portable `$workspace/<relativePath>` references back to local paths under `workspaceRootPath`.
 */
export function resolveTeamBoardPaths<T>(value: T, workspaceRootPath: string): T {
  const rootPosix = workspaceRootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = '$workspace/';

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string' && node.startsWith(prefix)) {
      const rel = node.slice(prefix.length).replace(/^\/+/, '');
      if (rel.split('/').some((seg) => seg === '..')) {
        return node;
      }
      return `${rootPosix}/${rel}`;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  return walk(value) as T;
}
