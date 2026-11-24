import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
