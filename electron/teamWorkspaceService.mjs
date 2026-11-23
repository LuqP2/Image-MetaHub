import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar from 'chokidar';
import { TeamWorkspaceRepository } from './teamWorkspaceRepository.mjs';

export const TEAM_DIR_NAME = '.imh-team';
export const TEAM_SCHEMA_VERSION = 1;
const IMMUTABLE_BATCH_FILENAME_RE = /^(\d{6})-([a-f0-9]{4,16})\.json$/;
const DEFAULT_FLUSH_DEBOUNCE_MS = 1200;
const DEFAULT_RECONCILE_INTERVAL_MS = 20_000;

const PROFILE_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EC4899',
  '#8B5CF6', '#06B6D4', '#EF4444', '#84CC16',
];

function computeInitials(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function defaultColorForDevice(deviceId) {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i += 1) {
    hash = ((hash << 5) - hash + deviceId.charCodeAt(i)) | 0;
  }
  return PROFILE_COLORS[Math.abs(hash) % PROFILE_COLORS.length];
}

async function writeJsonAtomic(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  const serialized = JSON.stringify(data, null, 2);
  await fsp.writeFile(tempPath, serialized, 'utf8');
  await fsp.rename(tempPath, filePath);
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class TeamWorkspaceService {
  constructor({
    userDataPath,
    flushDebounceMs = DEFAULT_FLUSH_DEBOUNCE_MS,
    reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
    enableWatcher = true,
    onWorkspaceUpdated = () => {},
    logger = console,
  }) {
    this.userDataPath = userDataPath;
    this.flushDebounceMs = flushDebounceMs;
    this.reconcileIntervalMs = reconcileIntervalMs;
    this.enableWatcher = enableWatcher;
    this.onWorkspaceUpdated = onWorkspaceUpdated;
    this.logger = logger;

    this.baseDir = path.join(userDataPath, 'team-workspaces');
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.repository = new TeamWorkspaceRepository({
      dbPath: path.join(this.baseDir, 'team-sync.sqlite'),
    });

    this.deviceIdentityPath = path.join(this.baseDir, 'device-identity.json');
    this.localProfile = this.#loadOrCreateLocalProfile();

    /** @type {Map<string, { manifest: any, rootPath: string, pendingOps: any[], flushTimer: any, reconcileTimer: any, watcher: any, watcherDebounce: any, syncState: 'idle' | 'syncing' | 'error', lastSyncedAt: string | null, error: string | null, members: any[] }>} */
    this.activeWorkspaces = new Map();
  }

  #loadOrCreateLocalProfile() {
    try {
      if (fs.existsSync(this.deviceIdentityPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.deviceIdentityPath, 'utf8'));
        if (parsed && typeof parsed.deviceId === 'string' && parsed.deviceId.trim()) {
          return {
            deviceId: parsed.deviceId,
            displayName: parsed.displayName || os.userInfo().username || 'Team Member',
            initials: parsed.initials || computeInitials(parsed.displayName || os.userInfo().username || 'Team Member'),
            color: parsed.color || defaultColorForDevice(parsed.deviceId),
            updatedAt: parsed.updatedAt || new Date().toISOString(),
          };
        }
      }
    } catch {
      // Fall through and create a fresh identity.
    }

    const deviceId = `dev-${crypto.randomUUID()}`;
    let fallbackName = 'Team Member';
    try {
      fallbackName = os.userInfo().username || os.hostname() || 'Team Member';
    } catch {
      // Ignore os.userInfo errors on restricted environments.
    }
    const profile = {
      deviceId,
      displayName: fallbackName,
      initials: computeInitials(fallbackName),
      color: defaultColorForDevice(deviceId),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.deviceIdentityPath, JSON.stringify(profile, null, 2), 'utf8');
    return profile;
  }

  getLocalProfile() {
    return { ...this.localProfile };
  }

  async updateLocalProfile({ displayName, initials, color }) {
    const cleanName = typeof displayName === 'string' && displayName.trim()
      ? displayName.trim().slice(0, 64)
      : this.localProfile.displayName;
    const cleanInitials = typeof initials === 'string' && initials.trim()
      ? initials.trim().slice(0, 3).toUpperCase()
      : computeInitials(cleanName);
    const cleanColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim())
      ? color.trim()
      : this.localProfile.color;

    this.localProfile = {
      deviceId: this.localProfile.deviceId,
      displayName: cleanName,
      initials: cleanInitials,
      color: cleanColor,
      updatedAt: new Date().toISOString(),
    };

    await writeJsonAtomic(this.deviceIdentityPath, this.localProfile);

    // Propagate updated display profile to all active workspaces.
    for (const active of this.activeWorkspaces.values()) {
      await this.#writeMemberProfile(active.rootPath);
      active.members = await this.#readMembers(active.rootPath);
      this.#notifyUpdated(active.manifest.workspaceId);
    }

    return this.getLocalProfile();
  }

  async detectWorkspace(rootPath) {
    const normalizedRoot = path.resolve(rootPath);
    const manifestPath = path.join(normalizedRoot, TEAM_DIR_NAME, 'workspace.json');
    const manifest = await readJsonSafe(manifestPath);
    if (!manifest || typeof manifest.workspaceId !== 'string' || typeof manifest.name !== 'string') {
      return null;
    }
    return { manifest, rootPath: normalizedRoot };
  }

  async initWorkspace(rootPath, { name, profile } = {}) {
    const normalizedRoot = path.resolve(rootPath);
    if (profile) {
      await this.updateLocalProfile(profile);
    }

    const existing = await this.detectWorkspace(normalizedRoot);
    if (existing) {
      return this.openWorkspace(normalizedRoot);
    }

    const teamDir = path.join(normalizedRoot, TEAM_DIR_NAME);
    await fsp.mkdir(path.join(teamDir, 'members'), { recursive: true });
    await fsp.mkdir(path.join(teamDir, 'ops'), { recursive: true });
    await fsp.mkdir(path.join(teamDir, 'prompts'), { recursive: true });
    await fsp.mkdir(path.join(teamDir, 'boards'), { recursive: true });
    await fsp.mkdir(path.join(teamDir, 'manifest'), { recursive: true });

    const manifest = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      workspaceId: crypto.randomUUID(),
      name: (typeof name === 'string' && name.trim()) ? name.trim() : path.basename(normalizedRoot),
      createdAt: new Date().toISOString(),
      createdByDeviceId: this.localProfile.deviceId,
    };

    await writeJsonAtomic(path.join(teamDir, 'workspace.json'), manifest);
    return this.openWorkspace(normalizedRoot);
  }

  async openWorkspace(rootPath, { profile } = {}) {
    const normalizedRoot = path.resolve(rootPath);
    if (profile) {
      await this.updateLocalProfile(profile);
    }

    const detected = await this.detectWorkspace(normalizedRoot);
    if (!detected) {
      throw new Error(`No Team Workspace manifest found at ${normalizedRoot}`);
    }

    const { manifest } = detected;
    this.repository.registerWorkspace({
      workspaceId: manifest.workspaceId,
      rootPath: normalizedRoot,
      name: manifest.name,
    });

    await this.#writeMemberProfile(normalizedRoot);

    let active = this.activeWorkspaces.get(manifest.workspaceId);
    if (!active) {
      active = {
        manifest,
        rootPath: normalizedRoot,
        pendingOps: [],
        flushTimer: null,
        reconcileTimer: null,
        watcher: null,
        watcherDebounce: null,
        syncState: 'idle',
        lastSyncedAt: null,
        error: null,
        members: [],
      };
      this.activeWorkspaces.set(manifest.workspaceId, active);
      this.#startHybridSync(active);
    } else {
      active.manifest = manifest;
      active.rootPath = normalizedRoot;
    }

    await this.reconcileWorkspace(manifest.workspaceId);
    return this.getWorkspaceSummary(manifest.workspaceId);
  }

  async closeWorkspace(workspaceId) {
    const active = this.activeWorkspaces.get(workspaceId);
    if (!active) return;

    await this.flushPendingOps(workspaceId);

    if (active.flushTimer) clearTimeout(active.flushTimer);
    if (active.watcherDebounce) clearTimeout(active.watcherDebounce);
    if (active.reconcileTimer) clearInterval(active.reconcileTimer);
    if (active.watcher) {
      try {
        await active.watcher.close();
      } catch {
        // Ignore close errors on network shares.
      }
    }
    this.activeWorkspaces.delete(workspaceId);
  }

  async queueOperation(workspaceId, opInput, { flushNow = false } = {}) {
    const active = this.activeWorkspaces.get(workspaceId);
    if (!active) {
      throw new Error(`Team Workspace ${workspaceId} is not active.`);
    }

    const cursor = this.repository.getCursor(workspaceId, this.localProfile.deviceId);
    const nextClock = cursor.lastLamportClock + 1;
    this.repository.advanceCursor(workspaceId, this.localProfile.deviceId, {
      nextSeq: cursor.nextSeq,
      lastLamportClock: nextClock,
    });

    const op = {
      ...opInput,
      opId: opInput.opId || crypto.randomUUID(),
      workspaceId,
      deviceId: this.localProfile.deviceId,
      lamportClock: nextClock,
      createdAt: opInput.createdAt || new Date().toISOString(),
      authorName: opInput.authorName || this.localProfile.displayName,
    };

    active.pendingOps.push(op);

    if (flushNow || this.flushDebounceMs <= 0) {
      if (active.flushTimer) {
        clearTimeout(active.flushTimer);
        active.flushTimer = null;
      }
      await this.flushPendingOps(workspaceId);
    } else if (!active.flushTimer) {
      active.flushTimer = setTimeout(() => {
        active.flushTimer = null;
        this.flushPendingOps(workspaceId).catch((error) => {
          this.logger.warn('[IMH Team] Failed to flush pending ops:', error);
        });
      }, this.flushDebounceMs);
    }

    return op;
  }

  /**
   * Flush all pending operations for this workspace into ONE immutable write-once batch file:
   * `.imh-team/ops/<deviceId>/<000001>-<shortHash>.json`
   */
  async flushPendingOps(workspaceId) {
    const active = this.activeWorkspaces.get(workspaceId);
    if (!active || active.pendingOps.length === 0) {
      return null;
    }

    const opsToFlush = active.pendingOps.splice(0, active.pendingOps.length);
    const deviceId = this.localProfile.deviceId;
    const cursor = this.repository.getCursor(workspaceId, deviceId);
    const sequence = cursor.nextSeq;

    const batchId = crypto.randomUUID();
    const batchPayload = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      batchId,
      workspaceId,
      deviceId,
      sequence,
      createdAt: new Date().toISOString(),
      ops: opsToFlush,
    };

    const shortHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(batchPayload))
      .digest('hex')
      .slice(0, 8);
    const filename = `${String(sequence).padStart(6, '0')}-${shortHash}.json`;
    const targetPath = path.join(active.rootPath, TEAM_DIR_NAME, 'ops', deviceId, filename);

    try {
      await writeJsonAtomic(targetPath, batchPayload);
      const maxClock = opsToFlush.reduce((acc, op) => Math.max(acc, op.lamportClock), cursor.lastLamportClock);
      this.repository.advanceCursor(workspaceId, deviceId, {
        nextSeq: sequence + 1,
        lastLamportClock: maxClock,
      });
      this.repository.applyBatchFile({
        workspaceId,
        deviceId,
        filename,
        ops: opsToFlush,
        localDeviceId: deviceId,
      });
      active.lastSyncedAt = new Date().toISOString();
      this.#notifyUpdated(workspaceId);
      return { filename, batchId, opCount: opsToFlush.length };
    } catch (error) {
      // Put ops back at front of queue so they aren't lost on transient network errors.
      active.pendingOps.unshift(...opsToFlush);
      active.syncState = 'error';
      active.error = error instanceof Error ? error.message : String(error);
      this.#notifyUpdated(workspaceId);
      throw error;
    }
  }

  /**
   * Reconcile `.imh-team/ops/<anyDeviceId>/<seq>-<hash>.json` against local SQLite.
   * Safe against partial writes, `.tmp` files, Dropbox conflicted copies, and missed SMB watcher events.
   */
  async reconcileWorkspace(workspaceId) {
    const active = this.activeWorkspaces.get(workspaceId);
    if (!active) {
      throw new Error(`Team Workspace ${workspaceId} is not active.`);
    }

    active.syncState = 'syncing';
    active.error = null;

    try {
      const opsRoot = path.join(active.rootPath, TEAM_DIR_NAME, 'ops');
      let totalAppliedFiles = 0;
      let totalAppliedOps = 0;

      if (fs.existsSync(opsRoot)) {
        const deviceEntries = await fsp.readdir(opsRoot, { withFileTypes: true });
        for (const entry of deviceEntries) {
          if (!entry.isDirectory()) continue;
          const remoteDeviceId = entry.name;
          const deviceOpsDir = path.join(opsRoot, remoteDeviceId);
          const files = (await fsp.readdir(deviceOpsDir))
            .filter((name) => IMMUTABLE_BATCH_FILENAME_RE.test(name))
            .sort();

          for (const filename of files) {
            if (this.repository.hasAppliedFile(workspaceId, remoteDeviceId, filename)) {
              continue;
            }
            const filePath = path.join(deviceOpsDir, filename);
            const batch = await readJsonSafe(filePath);
            if (!batch || batch.workspaceId !== workspaceId || !Array.isArray(batch.ops)) {
              // Skip unreadable/still-syncing files; next reconciliation pass will retry.
              continue;
            }
            const result = this.repository.applyBatchFile({
              workspaceId,
              deviceId: remoteDeviceId,
              filename,
              ops: batch.ops,
              localDeviceId: this.localProfile.deviceId,
            });
            if (!result.alreadyApplied) {
              totalAppliedFiles += 1;
              totalAppliedOps += result.appliedOps;
            }
          }
        }
      }

      active.members = await this.#readMembers(active.rootPath);
      active.syncState = 'idle';
      active.lastSyncedAt = new Date().toISOString();

      if (totalAppliedFiles > 0 || totalAppliedOps > 0) {
        this.#notifyUpdated(workspaceId);
      }

      return { appliedFiles: totalAppliedFiles, appliedOps: totalAppliedOps };
    } catch (error) {
      active.syncState = 'error';
      active.error = error instanceof Error ? error.message : String(error);
      this.#notifyUpdated(workspaceId);
      throw error;
    }
  }

  listOps(workspaceId) {
    return this.repository.listOps(workspaceId);
  }

  listAssetIdentities(workspaceId) {
    return this.repository.listAssetIdentities(workspaceId);
  }

  upsertAssetIdentities(workspaceId, identities) {
    this.repository.upsertAssetIdentities(workspaceId, identities);
  }

  getWorkspaceSummary(workspaceId) {
    const active = this.activeWorkspaces.get(workspaceId);
    if (!active) return null;
    const stats = this.repository.getWorkspaceStats(workspaceId);
    return {
      manifest: active.manifest,
      rootPath: active.rootPath,
      localProfile: this.getLocalProfile(),
      members: active.members,
      syncStatus: {
        workspaceId,
        rootPath: active.rootPath,
        name: active.manifest.name,
        state: active.syncState,
        lastSyncedAt: active.lastSyncedAt,
        appliedFileCount: stats.appliedFileCount,
        appliedOpCount: stats.appliedOpCount,
        pendingLocalOps: active.pendingOps.length,
        memberCount: active.members.length,
        error: active.error,
      },
    };
  }

  listActiveWorkspaces() {
    return Array.from(this.activeWorkspaces.keys())
      .map((workspaceId) => this.getWorkspaceSummary(workspaceId))
      .filter(Boolean);
  }

  async reconcileAllActive() {
    const results = [];
    for (const workspaceId of this.activeWorkspaces.keys()) {
      try {
        results.push({ workspaceId, ...(await this.reconcileWorkspace(workspaceId)) });
      } catch (error) {
        this.logger.warn(`[IMH Team] Reconcile failed for ${workspaceId}:`, error);
      }
    }
    return results;
  }

  async #writeMemberProfile(rootPath) {
    const memberPath = path.join(rootPath, TEAM_DIR_NAME, 'members', `${this.localProfile.deviceId}.json`);
    await writeJsonAtomic(memberPath, this.localProfile);
  }

  async #readMembers(rootPath) {
    const membersDir = path.join(rootPath, TEAM_DIR_NAME, 'members');
    if (!fs.existsSync(membersDir)) return [this.getLocalProfile()];
    const files = (await fsp.readdir(membersDir)).filter((name) => name.endsWith('.json'));
    const members = [];
    for (const file of files) {
      const parsed = await readJsonSafe(path.join(membersDir, file));
      if (parsed && typeof parsed.deviceId === 'string' && typeof parsed.displayName === 'string') {
        members.push(parsed);
      }
    }
    return members.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  #startHybridSync(active) {
    const workspaceId = active.manifest.workspaceId;

    const scheduleReconcile = () => {
      if (active.watcherDebounce) clearTimeout(active.watcherDebounce);
      active.watcherDebounce = setTimeout(() => {
        active.watcherDebounce = null;
        this.reconcileWorkspace(workspaceId).catch((error) => {
          this.logger.warn('[IMH Team] Watcher reconcile failed:', error);
        });
      }, 400);
    };

    if (this.enableWatcher) {
      const watchTargets = [
        path.join(active.rootPath, TEAM_DIR_NAME, 'ops'),
        path.join(active.rootPath, TEAM_DIR_NAME, 'members'),
      ];
      try {
        active.watcher = chokidar.watch(watchTargets, {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
          depth: 3,
        });
        active.watcher.on('add', scheduleReconcile);
        active.watcher.on('change', scheduleReconcile);
        active.watcher.on('error', (error) => {
          this.logger.warn('[IMH Team] Watcher error (periodic reconciliation remains active):', error);
        });
      } catch (error) {
        this.logger.warn('[IMH Team] Failed to start watcher (falling back to periodic reconciliation):', error);
      }
    }

    if (this.reconcileIntervalMs > 0) {
      active.reconcileTimer = setInterval(() => {
        this.reconcileWorkspace(workspaceId).catch((error) => {
          this.logger.warn('[IMH Team] Periodic reconcile failed:', error);
        });
      }, this.reconcileIntervalMs);
      if (typeof active.reconcileTimer.unref === 'function') {
        active.reconcileTimer.unref();
      }
    }
  }

  #notifyUpdated(workspaceId) {
    const summary = this.getWorkspaceSummary(workspaceId);
    if (summary) {
      this.onWorkspaceUpdated(summary);
    }
  }

  async dispose() {
    for (const workspaceId of Array.from(this.activeWorkspaces.keys())) {
      await this.closeWorkspace(workspaceId);
    }
    this.repository.close();
  }
}
