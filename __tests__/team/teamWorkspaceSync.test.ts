import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamWorkspaceService } from '../../electron/teamWorkspaceService.mjs';
import { reduceTeamOps } from '../../services/team/teamOpsReducer';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('TeamWorkspaceService immutable event sync', () => {
  it('waits for in-flight publication and drains concurrent flushNow operations', async () => {
    const shared = makeTempDir('imh-team-flush-race-');
    const a = new TeamWorkspaceService({ userDataPath: makeTempDir('imh-flush-A-'), enableWatcher: false, reconcileIntervalMs: 0 });
    const b = new TeamWorkspaceService({ userDataPath: makeTempDir('imh-flush-B-'), enableWatcher: false, reconcileIntervalMs: 0 });
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    try {
      const { manifest } = await a.initWorkspace(shared);
      const id = manifest.workspaceId;
      await b.openWorkspace(shared);
      const rename = fs.promises.rename.bind(fs.promises);
      const spy = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async (...args) => {
        entered(); await blocked; return rename(...args);
      });
      const op = { type: 'set_favorite', assetKey: 'p:synthetic.png', relativePath: 'synthetic.png', contentHash: null, isFavorite: true };
      const first = a.queueOperation(id, op, { flushNow: true });
      await started;
      let secondCompleted = false;
      const second = a.queueOperation(id, { ...op, isFavorite: false }, { flushNow: true }).then(result => { secondCompleted = true; return result; });
      await Promise.resolve();
      expect(secondCompleted).toBe(false);
      release();
      const queued = await Promise.all([first, second]);
      spy.mockRestore();
      expect(a.repository.listPendingOps(id)).toHaveLength(0);
      await b.reconcileWorkspace(id);
      expect(b.listOps(id).map(item => item.opId).sort()).toEqual(queued.map(item => item.opId).sort());
      expect(b.getWorkspaceSummary(id)?.syncStatus.appliedFileCount).toBe(2);
    } finally {
      release(); vi.restoreAllMocks(); await a.dispose(); await b.dispose();
    }
  });

  it('keeps failed publications durable and drains them on the next flush', async () => {
    const service = new TeamWorkspaceService({ userDataPath: makeTempDir('imh-flush-retry-'), enableWatcher: false, reconcileIntervalMs: 0 });
    try {
      const { manifest } = await service.initWorkspace(makeTempDir('imh-flush-retry-share-'));
      const id = manifest.workspaceId;
      const op = { type: 'set_favorite', assetKey: 'p:synthetic.png', relativePath: 'synthetic.png', contentHash: null, isFavorite: true };
      vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('synthetic publication failure'));
      await expect(service.queueOperation(id, op, { flushNow: true })).rejects.toThrow('synthetic publication failure');
      expect(service.repository.listPendingOps(id)).toHaveLength(1);
      await service.queueOperation(id, { ...op, isFavorite: false }, { flushNow: true });
      expect(service.repository.listPendingOps(id)).toHaveLength(0);
      expect(service.listOps(id)).toHaveLength(2);
    } finally { vi.restoreAllMocks(); await service.dispose(); }
  });

  it('notifies resource-only additions, edits and deletions without annotation operations', async () => {
    const shared = makeTempDir('imh-team-resources-');
    const notify = vi.fn();
    const a = new TeamWorkspaceService({
      userDataPath: makeTempDir('imh-resource-A-'), enableWatcher: false,
      reconcileIntervalMs: 0, onWorkspaceUpdated: notify,
    });
    const b = new TeamWorkspaceService({
      userDataPath: makeTempDir('imh-resource-B-'), enableWatcher: false, reconcileIntervalMs: 0,
    });
    try {
      const { manifest } = await a.initWorkspace(shared);
      const id = manifest.workspaceId;
      await b.openWorkspace(shared);
      await a.reconcileWorkspace(id);
      const checkChange = async (mutate: () => Promise<unknown>) => {
        notify.mockClear();
        await mutate();
        expect(await a.reconcileWorkspace(id)).toEqual({ appliedFiles: 0, appliedOps: 0 });
        expect(notify).toHaveBeenCalledTimes(1);
        notify.mockClear();
        await a.reconcileWorkspace(id);
        expect(notify).not.toHaveBeenCalled();
      };
      await checkChange(() => b.saveTeamPrompt(id, { id: 'prompt', positivePrompt: 'first' }));
      await checkChange(() => b.saveTeamPrompt(id, { id: 'prompt', positivePrompt: 'edited' }));
      await checkChange(() => b.deleteTeamPrompt(id, 'prompt'));
      await checkChange(() => b.saveTeamBoard(id, { boardId: 'board', document: { nodes: [] } }));
      await checkChange(() => b.saveTeamBoard(id, { boardId: 'board', expectedRevision: 1, document: { nodes: ['edited'] } }));
      await checkChange(() => b.deleteTeamBoard(id, 'board'));
      await checkChange(() => b.writeModelsManifest(id, [{ name: 'synthetic-model', type: 'checkpoint' }]));
      await checkChange(async () => fs.unlinkSync(path.join(shared, '.imh-team/manifest/expected-models.json')));
      await checkChange(() => b.updateLocalProfile({ displayName: 'Remote editor' }));
      expect(a.getWorkspaceSummary(id)?.members.some((member) => member.displayName === 'Remote editor')).toBe(true);
      await checkChange(async () => fs.unlinkSync(path.join(shared, '.imh-team/members', `${b.getLocalProfile().deviceId}.json`)));
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  it('writes immutable write-once batch files, ignores temp/conflicted copies, and reconciles two devices without watcher', async () => {
    const sharedFolder = makeTempDir('imh-team-shared-');
    const userDataA = makeTempDir('imh-team-devA-');
    const userDataB = makeTempDir('imh-team-devB-');

    const serviceA = new TeamWorkspaceService({
      userDataPath: userDataA,
      enableWatcher: false,
      reconcileIntervalMs: 0,
      flushDebounceMs: 0,
    });
    const serviceB = new TeamWorkspaceService({
      userDataPath: userDataB,
      enableWatcher: false,
      reconcileIntervalMs: 0,
      flushDebounceMs: 0,
    });

    try {
      const wsA = await serviceA.initWorkspace(sharedFolder, {
        name: 'Studio Alpha',
        profile: { displayName: 'Alice', color: '#3B82F6' },
      });
      const wsId = wsA.manifest.workspaceId;

      const wsB = await serviceB.openWorkspace(sharedFolder, {
        profile: { displayName: 'Bob', color: '#10B981' },
      });
      expect(wsB.manifest.workspaceId).toBe(wsId);

      // Device A queues two ops in two separate flushes -> must create 2 distinct immutable files
      const opA1 = await serviceA.queueOperation(wsId, {
        type: 'tags_add',
        assetKey: 'h:111|p:render_01.png',
        relativePath: 'render_01.png',
        contentHash: '111',
        tags: ['character', 'lighting'],
      }, { flushNow: true });

      await serviceA.queueOperation(wsId, {
        type: 'set_review_status',
        assetKey: 'h:111|p:render_01.png',
        relativePath: 'render_01.png',
        contentHash: '111',
        status: 'approved',
        baseOpId: null,
      }, { flushNow: true });

      const devAOpsDir = path.join(sharedFolder, '.imh-team', 'ops', serviceA.getLocalProfile().deviceId);
      const devAFiles = fs.readdirSync(devAOpsDir).sort();
      expect(devAFiles).toHaveLength(2);
      expect(devAFiles[0]).toMatch(/^000001-[a-f0-9]{8}\.json$/);
      expect(devAFiles[1]).toMatch(/^000002-[a-f0-9]{8}\.json$/);

      // Plant a stray .tmp file and a Dropbox-style conflicted copy -> must be ignored safely
      fs.writeFileSync(path.join(devAOpsDir, '000003-abcd1234.json.tmp.9999'), '{broken', 'utf8');
      fs.writeFileSync(path.join(devAOpsDir, '000001-abcd1234 (conflicted copy).json'), '{}', 'utf8');

      // Concurrently, before reconciling Device A, Device B rejects the same asset from baseOpId = null
      await serviceB.queueOperation(wsId, {
        type: 'set_review_status',
        assetKey: 'h:111|p:render_01.png',
        relativePath: 'render_01.png',
        contentHash: '111',
        status: 'needs_changes',
        baseOpId: null,
        note: 'Adjust rim light',
      }, { flushNow: true });

      // Periodic / explicit reconciliation without watcher events (SMB/NFS safe)
      const recB = await serviceB.reconcileWorkspace(wsId);
      expect(recB.appliedFiles).toBe(2);
      expect(recB.appliedOps).toBe(2);

      const recA = await serviceA.reconcileWorkspace(wsId);
      expect(recA.appliedFiles).toBe(1);
      expect(recA.appliedOps).toBe(1);

      // Second reconciliation is a complete no-op (idempotent)
      const recBAgain = await serviceB.reconcileWorkspace(wsId);
      expect(recBAgain.appliedFiles).toBe(0);
      expect(recBAgain.appliedOps).toBe(0);

      // Both devices converge to identical state AND detect the concurrent approval conflict
      const stateA = reduceTeamOps(serviceA.listOps(wsId)).get('h:111|p:render_01.png');
      const stateB = reduceTeamOps(serviceB.listOps(wsId)).get('h:111|p:render_01.png');

      expect(stateA).toEqual(stateB);
      expect(stateA?.tags).toEqual(['character', 'lighting']);
      expect(stateA?.reviewConflict).not.toBeNull();
      expect(stateA?.reviewConflict?.competingDecisions).toHaveLength(2);
      expect(opA1.opId).toBeTruthy();
    } finally {
      await serviceA.dispose();
      await serviceB.dispose();
    }
  });

  it('recovers durably queued pending ops from local SQLite after an unexpected crash before flush', async () => {
    const sharedFolder = makeTempDir('imh-crash-shared-');
    const userDataA = makeTempDir('imh-crash-devA-');
    const userDataB = makeTempDir('imh-crash-devB-');

    const serviceA1 = new TeamWorkspaceService({
      userDataPath: userDataA,
      enableWatcher: false,
      reconcileIntervalMs: 0,
      flushDebounceMs: 60_000, // Long debounce so op stays pending in SQLite
    });

    const wsA = await serviceA1.initWorkspace(sharedFolder, {
      name: 'Crash Safe Studio',
      profile: { displayName: 'Alice' },
    });
    const wsId = wsA.manifest.workspaceId;

    await serviceA1.queueOperation(wsId, {
      type: 'set_rating',
      assetKey: 'p:shot_crash.png',
      relativePath: 'shot_crash.png',
      contentHash: null,
      rating: 5,
    }, { flushNow: false });

    // Confirm op is queued in SQLite but NOT yet written to .imh-team/ops/
    const devAOpsDir = path.join(sharedFolder, '.imh-team', 'ops', serviceA1.getLocalProfile().deviceId);
    expect(fs.existsSync(devAOpsDir)).toBe(false);

    // Simulate abrupt crash: clear timer and close DB WITHOUT flushing pending ops
    const activeInternal = serviceA1.activeWorkspaces.get(wsId);
    if (activeInternal?.flushTimer) clearTimeout(activeInternal.flushTimer);
    serviceA1.repository.close();

    // Restart Device A with a fresh TeamWorkspaceService -> must automatically recover and flush!
    const serviceA2 = new TeamWorkspaceService({
      userDataPath: userDataA,
      enableWatcher: false,
      reconcileIntervalMs: 0,
      flushDebounceMs: 0,
    });
    const serviceB = new TeamWorkspaceService({
      userDataPath: userDataB,
      enableWatcher: false,
      reconcileIntervalMs: 0,
      flushDebounceMs: 0,
    });

    try {
      await serviceA2.openWorkspace(sharedFolder);
      expect(fs.existsSync(devAOpsDir)).toBe(true);
      expect(fs.readdirSync(devAOpsDir)).toHaveLength(1);

      await serviceB.openWorkspace(sharedFolder, { profile: { displayName: 'Bob' } });
      const stateB = reduceTeamOps(serviceB.listOps(wsId)).get('p:shot_crash.png');
      expect(stateB?.rating).toBe(5);
    } finally {
      await serviceA2.dispose();
      await serviceB.dispose();
    }
  });
});
