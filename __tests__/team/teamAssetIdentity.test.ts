import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceAssetKey,
  normalizeWorkspaceRelativePath,
  resolveWorkspaceAssetIdentities,
} from '../../services/team/teamOpsReducer';

describe('workspace canonical asset identity', () => {
  it('normalizes Windows and POSIX relative paths identically and rejects traversal', () => {
    expect(normalizeWorkspaceRelativePath('shots\\scene_01\\render.png')).toBe('shots/scene_01/render.png');
    expect(normalizeWorkspaceRelativePath('/shots/scene_01/./render.png')).toBe('shots/scene_01/render.png');
    expect(() => normalizeWorkspaceRelativePath('../outside.png')).toThrow();
    expect(() => normalizeWorkspaceRelativePath('C:\\abs\\file.png')).toThrow();
  });

  it('preserves canonical workspaceAssetKey across unambiguous file renames', () => {
    const initialKey = buildWorkspaceAssetKey('shots/shot_01.png', 'deadbeef01');
    const previous = [
      {
        workspaceAssetKey: initialKey,
        relativePath: 'shots/shot_01.png',
        contentHash: 'deadbeef01',
      },
    ];

    const resolved = resolveWorkspaceAssetIdentities(
      [{ relativePath: 'shots\\shot_01_v2_final.png', contentHash: 'deadbeef01', fileSize: 1024 }],
      previous,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].identity.workspaceAssetKey).toBe(initialKey);
    expect(resolved[0].identity.relativePath).toBe('shots/shot_01_v2_final.png');
    expect(resolved[0].renamedFrom?.relativePath).toBe('shots/shot_01.png');
  });

  it('keeps duplicate files with identical contentHash distinct per path', () => {
    const resolved = resolveWorkspaceAssetIdentities(
      [
        { relativePath: 'client_a/hero.png', contentHash: 'samehash99' },
        { relativePath: 'client_b/hero.png', contentHash: 'samehash99' },
      ],
      [],
    );

    expect(resolved).toHaveLength(2);
    expect(resolved[0].identity.workspaceAssetKey).not.toBe(resolved[1].identity.workspaceAssetKey);
    expect(resolved[0].renamedFrom).toBeNull();
    expect(resolved[1].renamedFrom).toBeNull();
  });
});
