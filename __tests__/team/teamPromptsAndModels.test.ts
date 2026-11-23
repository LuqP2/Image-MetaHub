import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamWorkspaceService } from '../../electron/teamWorkspaceService.mjs';
import { compareLocalModelsAgainstManifest } from '../../services/team/teamModelsManifest';

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

describe('Team Prompt Library & Project Models Manifest', () => {
  it('shares prompts as individual atomic JSON files across devices and ignores conflicted/tmp files', async () => {
    const sharedFolder = makeTempDir('imh-prompts-shared-');
    const userDataA = makeTempDir('imh-prompts-devA-');
    const userDataB = makeTempDir('imh-prompts-devB-');

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
        name: 'Prompt Studio',
        profile: { displayName: 'Alice' },
      });
      const wsId = wsA.manifest.workspaceId;
      await serviceB.openWorkspace(sharedFolder, { profile: { displayName: 'Bob' } });

      const saved = await serviceA.saveTeamPrompt(wsId, {
        id: 'brand-hero',
        title: 'Brand Hero Lighting',
        positivePrompt: 'cinematic key light, 85mm lens, editorial portrait',
        negativePrompt: 'lowres, blurry',
        tags: ['Brand', 'Lighting'],
      });
      expect(saved.revision).toBe(1);
      expect(saved.tags).toEqual(['brand', 'lighting']);

      // Plant stray tmp and Dropbox conflicted copy
      const promptsDir = path.join(sharedFolder, '.imh-team', 'prompts');
      fs.writeFileSync(path.join(promptsDir, 'brand-hero.json.tmp.abc'), '{broken', 'utf8');
      fs.writeFileSync(path.join(promptsDir, 'brand-hero (conflicted copy).json'), '{}', 'utf8');

      const seenByB = await serviceB.listTeamPrompts(wsId);
      expect(seenByB).toHaveLength(1);
      expect(seenByB[0].title).toBe('Brand Hero Lighting');
      expect(seenByB[0].updatedByName).toBe('Alice');

      // Device B updates the prompt -> revision increments to 2
      const updated = await serviceB.saveTeamPrompt(wsId, {
        id: 'brand-hero',
        title: 'Brand Hero Lighting v2',
        positivePrompt: 'cinematic key light, 85mm lens, warm rim light',
      });
      expect(updated.revision).toBe(2);
      expect(updated.updatedByName).toBe('Bob');

      const deleted = await serviceA.deleteTeamPrompt(wsId, 'brand-hero');
      expect(deleted.deleted).toBe(true);
      expect(await serviceB.listTeamPrompts(wsId)).toHaveLength(0);
    } finally {
      await serviceA.dispose();
      await serviceB.dispose();
    }
  });

  it('persists expected project models manifest and compares installed vs missing models by hash or name', async () => {
    const sharedFolder = makeTempDir('imh-models-shared-');
    const userDataA = makeTempDir('imh-models-devA-');

    const serviceA = new TeamWorkspaceService({
      userDataPath: userDataA,
      enableWatcher: false,
      reconcileIntervalMs: 0,
      flushDebounceMs: 0,
    });

    try {
      const wsA = await serviceA.initWorkspace(sharedFolder, {
        name: 'VFX Studio',
        profile: { displayName: 'Lead' },
      });
      const wsId = wsA.manifest.workspaceId;

      const manifest = await serviceA.writeModelsManifest(wsId, [
        { name: 'flux1-dev-fp8.safetensors', type: 'checkpoint', sha256: 'a1b2c3d4e5f60718293a' },
        { name: 'studio-detail-lora.safetensors', type: 'lora' },
        { name: 'missing-style-lora.safetensors', type: 'lora' },
      ]);

      const readBack = await serviceA.readModelsManifest(wsId);
      expect(readBack?.models).toHaveLength(3);

      const diff = compareLocalModelsAgainstManifest(manifest, [
        { name: 'renamed-flux.safetensors', sha256: 'a1b2c3d4e5' }, // Matches via 10-char AutoV2 short hash!
        { name: 'models/loras/Studio-Detail-LoRA.safetensors' }, // Matches via normalized basename!
      ]);

      expect(diff.installed.map((m) => m.name)).toEqual([
        'flux1-dev-fp8.safetensors',
        'studio-detail-lora.safetensors',
      ]);
      expect(diff.missing.map((m) => m.name)).toEqual([
        'missing-style-lora.safetensors',
      ]);
    } finally {
      await serviceA.dispose();
    }
  });
});
