import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamWorkspaceService } from '../../electron/teamWorkspaceService.mjs';
import { reduceTeamOps } from '../../services/team/teamOpsReducer';
import {
  buildClientReviewSheetHtml,
  buildOpsFromClientFeedback,
  CLIENT_FEEDBACK_FORMAT,
  parseClientFeedbackFile,
} from '../../services/team/clientReviewSheetService';

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

describe('Offline Client Review Sheet (.html) & Feedback Import (.imh-feedback.json)', () => {
  it('generates offline CSP-locked HTML escaping </script> and rejecting external URLs', () => {
    const html = buildClientReviewSheetHtml({
      workspaceId: 'ws-1',
      workspaceName: 'Studio </script><script>alert(1)</script>',
      exportedAt: '2026-11-23T14:00:00.000Z',
      items: [
        {
          assetKey: 'p:shot_01.png',
          relativePath: 'shot_01.png',
          fileName: 'shot_01.png',
          currentStatus: 'in_review',
          baseOpId: 'op-10',
          contentHash: null,
          thumbnailDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
        },
      ],
    });

    expect(html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';");
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script\\u003e');
  });

  it('rejects feedback files belonging to a different workspace or invalid format', () => {
    const wrongWorkspace = JSON.stringify({
      format: CLIENT_FEEDBACK_FORMAT,
      schemaVersion: 1,
      workspaceId: 'ws-other',
      reviewerName: 'Client',
      exportedAt: '2026-11-23T14:00:00.000Z',
      items: [],
    });

    expect(() => parseClientFeedbackFile(wrongWorkspace, 'ws-1')).toThrow(/different Team Workspace/i);
    expect(() => parseClientFeedbackFile('{not-json', 'ws-1')).toThrow(/not valid JSON/i);
  });

  it('round-trips client feedback into TeamWorkspaceService and detects concurrent studio approval conflicts', async () => {
    const sharedFolder = makeTempDir('imh-client-review-shared-');
    const userData = makeTempDir('imh-client-review-dev-');

    const service = new TeamWorkspaceService({
      userDataPath: userData,
      enableWatcher: false,
      reconcileIntervalMs: 0,
      flushDebounceMs: 0,
    });

    try {
      const ws = await service.initWorkspace(sharedFolder, {
        name: 'Client Project',
        profile: { displayName: 'Art Director' },
      });
      const wsId = ws.manifest.workspaceId;

      // Studio marks shot_01 as in_review (op1) before sending offline Review Sheet
      const op1 = await service.queueOperation(wsId, {
        type: 'set_review_status',
        assetKey: 'p:shot_01.png',
        relativePath: 'shot_01.png',
        contentHash: null,
        status: 'in_review',
        baseOpId: null,
      }, { flushNow: true });

      // While client is reviewing offline, internal director rejects shot_01 from baseOpId = op1.opId
      await service.queueOperation(wsId, {
        type: 'set_review_status',
        assetKey: 'p:shot_01.png',
        relativePath: 'shot_01.png',
        contentHash: null,
        status: 'rejected',
        baseOpId: op1.opId,
      }, { flushNow: true });

      // Client sends back feedback approving shot_01 (based on op1.opId) + adding a comment
      const clientJson = JSON.stringify({
        format: CLIENT_FEEDBACK_FORMAT,
        schemaVersion: 1,
        workspaceId: wsId,
        reviewerName: 'Acme Marketing',
        exportedAt: '2026-11-23T15:00:00.000Z',
        items: [
          {
            assetKey: 'p:shot_01.png',
            relativePath: 'shot_01.png',
            contentHash: null,
            baseOpId: op1.opId,
            status: 'approved',
            comment: 'Love this lighting for the banner!',
          },
        ],
      });

      const parsed = parseClientFeedbackFile(clientJson, wsId);
      const ops = buildOpsFromClientFeedback(parsed);
      for (const op of ops) {
        await service.queueOperation(wsId, op, { flushNow: false });
      }
      await service.flushPendingOps(wsId);

      const reduced = reduceTeamOps(service.listOps(wsId)).get('p:shot_01.png');
      // Conflict MUST be detected instead of silently overwriting internal rejection or client approval!
      expect(reduced?.reviewConflict).not.toBeNull();
      expect(reduced?.reviewConflict?.competingDecisions.map((d) => d.status).sort()).toEqual([
        'approved',
        'rejected',
      ]);
      expect(reduced?.comments).toHaveLength(1);
      expect(reduced?.comments[0].authorName).toBe('Client: Acme Marketing');
      expect(reduced?.comments[0].text).toBe('Love this lighting for the banner!');
    } finally {
      await service.dispose();
    }
  });
});
