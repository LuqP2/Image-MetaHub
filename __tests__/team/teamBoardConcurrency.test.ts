import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamWorkspaceService } from '../../electron/teamWorkspaceService.mjs';
import {
  normalizeBoardPathsForTeam,
  resolveTeamBoardPaths,
} from '../../services/team/teamModelsManifest';

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

describe('Team Boards optimistic revision concurrency', () => {
  it('detects stale revision/hash writes without TTL locks and allows safe copy or explicit overwrite', async () => {
    const sharedFolder = makeTempDir('imh-board-shared-');
    const userDataA = makeTempDir('imh-board-devA-');
    const userDataB = makeTempDir('imh-board-devB-');

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
        name: 'Board Studio',
        profile: { displayName: 'Alice' },
      });
      const wsId = wsA.manifest.workspaceId;
      await serviceB.openWorkspace(sharedFolder, {
        profile: { displayName: 'Bob' },
      });

      // Device A creates board -> rev 1
      const createRes = await serviceA.saveTeamBoard(wsId, {
        boardId: 'moodboard-main',
        name: 'Main Moodboard',
        document: { nodes: [{ id: 'n1', label: 'Hero' }] },
        expectedRevision: 0,
      });
      expect(createRes.saved).toBe(true);
      expect(createRes.envelope?.revision).toBe(1);

      // Device B loads rev 1
      const loadedByB = await serviceB.loadTeamBoard(wsId, 'moodboard-main');
      expect(loadedByB?.revision).toBe(1);

      // Device A updates board -> rev 2
      const updateByA = await serviceA.saveTeamBoard(wsId, {
        boardId: 'moodboard-main',
        name: 'Main Moodboard',
        document: { nodes: [{ id: 'n1', label: 'Hero' }, { id: 'n2', label: 'Lighting' }] },
        expectedRevision: 1,
        expectedHash: createRes.envelope?.contentHash,
      });
      expect(updateByA.saved).toBe(true);
      expect(updateByA.envelope?.revision).toBe(2);

      // Device B tries to save based on stale rev 1 -> MUST conflict and preserve rev 2 on disk
      const staleSaveByB = await serviceB.saveTeamBoard(wsId, {
        boardId: 'moodboard-main',
        name: 'Main Moodboard',
        document: { nodes: [{ id: 'n1', label: 'Hero' }, { id: 'n3', label: 'Bob Edit' }] },
        expectedRevision: 1,
        expectedHash: loadedByB?.contentHash,
      });
      expect(staleSaveByB.saved).toBe(false);
      expect(staleSaveByB.conflict).toBe(true);
      expect(staleSaveByB.remote?.revision).toBe(2);
      expect(staleSaveByB.remote?.updatedByName).toBe('Alice');

      // On-disk file is still Alice's rev 2 (no silent overwrite)
      const stillRev2 = await serviceA.loadTeamBoard(wsId, 'moodboard-main');
      expect(stillRev2?.revision).toBe(2);

      // Device B can save as copy without clobbering
      const copyRes = await serviceB.saveTeamBoard(wsId, {
        boardId: 'moodboard-main-bob-copy',
        name: 'Main Moodboard (Bob Copy)',
        document: { nodes: [{ id: 'n1', label: 'Hero' }, { id: 'n3', label: 'Bob Edit' }] },
        expectedRevision: 0,
      });
      expect(copyRes.saved).toBe(true);

      // Or Device B can explicitly force-overwrite -> rev 3
      const forceRes = await serviceB.saveTeamBoard(wsId, {
        boardId: 'moodboard-main',
        name: 'Main Moodboard',
        document: { nodes: [{ id: 'n1', label: 'Hero' }, { id: 'n3', label: 'Bob Final' }] },
        expectedRevision: 1,
        forceOverwrite: true,
      });
      expect(forceRes.saved).toBe(true);
      expect(forceRes.envelope?.revision).toBe(3);

      const boards = await serviceA.listTeamBoards(wsId);
      expect(boards).toHaveLength(2);
    } finally {
      await serviceA.dispose();
      await serviceB.dispose();
    }
  });

  it('allows only one concurrent publication from the same revision, including creation', async () => {
    const shared = makeTempDir('imh-board-race-');
    const services = ['A', 'B'].map((device) => new TeamWorkspaceService({
      userDataPath: makeTempDir(`imh-board-race-${device}-`), enableWatcher: false,
      reconcileIntervalMs: 0, flushDebounceMs: 0,
    }));
    const [a, b] = services;
    try {
      const { manifest } = await a.initWorkspace(shared);
      const wsId = manifest.workspaceId;
      await b.openWorkspace(shared);
      for (const expectedRevision of [0, 1, 2]) {
        const results = await Promise.all(services.map((service, index) => service.saveTeamBoard(wsId, {
          boardId: 'contested', name: 'Concurrent Board', expectedRevision,
          document: { editor: index, round: expectedRevision },
        })));
        const winners = results.filter((result) => result.saved);
        const losers = results.filter((result) => !result.saved);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(winners[0].envelope.revision).toBe(expectedRevision + 1);
        expect(losers[0].remote).toEqual(winners[0].envelope);
        expect(await a.loadTeamBoard(wsId, 'contested')).toEqual(winners[0].envelope);
      }
      expect(fs.existsSync(path.join(shared, '.imh-team/boards/contested.imhboard.json.publish-lock'))).toBe(false);
    } finally {
      for (const service of services) await service.dispose();
    }
  });

  it('normalizes and resolves board asset paths across Windows and macOS mounts', () => {
    const winDoc = {
      items: [
        { path: 'Z:\\Studio\\ProjectA\\shots\\scene_01\\hero.png' },
        { path: 'C:\\OtherDrive\\outside.png' },
      ],
    };

    const portable = normalizeBoardPathsForTeam(winDoc, 'Z:\\Studio\\ProjectA');
    expect(portable.items[0].path).toBe('$workspace/shots/scene_01/hero.png');
    expect(portable.items[1].path).toBe('C:\\OtherDrive\\outside.png');

    const macResolved = resolveTeamBoardPaths(portable, '/Volumes/NAS/ProjectA');
    expect(macResolved.items[0].path).toBe('/Volumes/NAS/ProjectA/shots/scene_01/hero.png');
    expect(macResolved.items[1].path).toBe('C:\\OtherDrive\\outside.png');
  });
});
