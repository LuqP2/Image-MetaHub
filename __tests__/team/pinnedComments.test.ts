import { describe, expect, it } from 'vitest';
import { normalizeCommentPin, reduceTeamOps } from '../../services/team/teamOpsReducer';
import type { TeamOpEvent } from '../../services/team/teamWorkspaceTypes';

describe('Pinned visual comments', () => {
  it('validates and clamps/rejects invalid pin coordinates', () => {
    expect(normalizeCommentPin({ x: 0.251234, y: 0.759876 })).toEqual({ x: 0.2512, y: 0.7599 });
    expect(normalizeCommentPin({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    expect(normalizeCommentPin({ x: -0.1, y: 0.5 })).toBeNull();
    expect(normalizeCommentPin({ x: 1.2, y: 0.5 })).toBeNull();
    expect(normalizeCommentPin({ x: Number.NaN, y: 0.5 })).toBeNull();
    expect(normalizeCommentPin(null)).toBeNull();
  });

  it('preserves pins on pinned comments while staying backward-compatible with unpinned comments', () => {
    const ops: TeamOpEvent[] = [
      {
        opId: 'op-1',
        workspaceId: 'ws-1',
        deviceId: 'dev-a',
        lamportClock: 1,
        createdAt: '2026-11-23T10:00:00.000Z',
        assetKey: 'p:hero.png',
        relativePath: 'hero.png',
        contentHash: null,
        authorName: 'Director',
        type: 'add_comment',
        commentId: 'c-unpinned',
        text: 'Overall composition looks strong',
      },
      {
        opId: 'op-2',
        workspaceId: 'ws-1',
        deviceId: 'dev-a',
        lamportClock: 2,
        createdAt: '2026-11-23T10:01:00.000Z',
        assetKey: 'p:hero.png',
        relativePath: 'hero.png',
        contentHash: null,
        authorName: 'Director',
        type: 'add_comment',
        commentId: 'c-pinned',
        text: 'Fix reflection on visor',
        pin: { x: 0.42, y: 0.31 },
      },
    ];

    const state = reduceTeamOps(ops).get('p:hero.png');
    expect(state?.comments).toHaveLength(2);
    expect(state?.comments[0].pin).toBeNull();
    expect(state?.comments[1].pin).toEqual({ x: 0.42, y: 0.31 });
  });
});
