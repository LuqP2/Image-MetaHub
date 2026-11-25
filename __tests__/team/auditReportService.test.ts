import { describe, expect, it } from 'vitest';
import {
  buildProvenanceAuditEntries,
  escapeCsvCell,
  serializeAuditReportCsv,
  serializeAuditReportHtml,
  serializeAuditReportJson,
} from '../../services/team/auditReportService';
import { buildWorkspaceAssetKey } from '../../services/team/teamOpsReducer';
import type { TeamAssetState, TeamWorkspaceSummary } from '../../services/team/teamWorkspaceTypes';
import type { Directory, IndexedImage } from '../../types';

describe('Provenance & Approval Audit Report', () => {
  it('mitigates CSV spreadsheet formula injection and escapes quotes/newlines', () => {
    expect(escapeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(escapeCsvCell('+1+2')).toBe("'+1+2");
    expect(escapeCsvCell('-danger')).toBe("'-danger");
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(escapeCsvCell('plain, value')).toBe('"plain, value"');
  });

  it('builds structured CSV, JSON, and escaped HTML provenance reports', () => {
    const directories: Directory[] = [
      { id: 'dir-1', name: 'Campaign', path: 'Z:\\Agency\\Campaign', handle: null as unknown as FileSystemDirectoryHandle },
    ];
    const workspacesById: Record<string, TeamWorkspaceSummary> = {
      'ws-1': {
        manifest: {
          schemaVersion: 1,
          workspaceId: 'ws-1',
          name: 'Client <Acme> Campaign',
          createdAt: '2026-11-23T09:00:00.000Z',
          createdByDeviceId: 'dev-a',
        },
        rootPath: 'Z:/Agency/Campaign',
        localProfile: { deviceId: 'dev-a', displayName: 'Lead', initials: 'LD', color: '#3B82F6', updatedAt: '2026-11-23T09:00:00.000Z' },
        members: [],
        syncStatus: {
          workspaceId: 'ws-1',
          rootPath: 'Z:/Agency/Campaign',
          name: 'Client <Acme> Campaign',
          state: 'idle',
          lastSyncedAt: null,
          appliedFileCount: 1,
          appliedOpCount: 1,
          pendingLocalOps: 0,
          memberCount: 1,
          error: null,
        },
      },
    };

    const assetKey = buildWorkspaceAssetKey('finals/hero.png', null);
    const assetStatesByWorkspace: Record<string, Record<string, TeamAssetState>> = {
      'ws-1': {
        [assetKey]: {
          assetKey,
          relativePath: 'finals/hero.png',
          contentHash: 'abcdef1234567890abcdef1234567890',
          tags: ['approved'],
          rating: 5,
          isFavorite: true,
          reviewStatus: 'approved',
          reviewDecision: {
            opId: 'op-approve-99',
            status: 'approved',
            deviceId: 'dev-lead',
            authorName: 'Creative Director',
            lamportClock: 5,
            createdAt: '2026-11-23T12:30:00.000Z',
            baseOpId: null,
          },
          reviewConflict: null,
          comments: [
            {
              commentId: 'c1',
              opId: 'op-c1',
              deviceId: 'dev-lead',
              authorName: 'Creative Director',
              text: '=Approved for Q4 launch',
              pin: null,
              createdAt: '2026-11-23T12:29:00.000Z',
              lamportClock: 4,
              resolved: false,
              resolvedByDeviceId: null,
              resolvedByName: null,
              resolvedAt: null,
            },
          ],
          shadowPatch: null,
          lastLamportClock: 5,
        },
      },
    };

    const images: IndexedImage[] = [
      {
        id: 'img-1',
        directoryId: 'dir-1',
        name: 'finals/hero.png',
        handle: null as unknown as FileSystemFileHandle,
        metadata: {
          normalizedMetadata: {
            generator: 'ComfyUI',
            model: 'flux1-dev.safetensors',
          },
        } as unknown as IndexedImage['metadata'],
        metadataString: '',
        lastModified: Date.now(),
        models: ['flux1-dev.safetensors'],
        loras: ['brand-style-v2.safetensors'],
        scheduler: '',
      },
    ];

    const entries = buildProvenanceAuditEntries(images, directories, workspacesById, assetStatesByWorkspace);
    expect(entries).toHaveLength(1);
    expect(entries[0].approvedBy).toBe('Creative Director');
    expect(entries[0].approvalOpId).toBe('op-approve-99');

    const csv = serializeAuditReportCsv(entries);
    expect(csv).toContain('hero.png');
    expect(csv).toContain('flux1-dev.safetensors');
    expect(csv).toContain('brand-style-v2.safetensors');

    const json = JSON.parse(serializeAuditReportJson(entries, {
      workspaceName: 'Client <Acme> Campaign',
      workspaceId: 'ws-1',
      generatedAt: '2026-11-23T13:00:00.000Z',
      metadataStrippedFromDeliverables: true,
    }));
    expect(json.format).toBe('image-metahub-provenance-audit');
    expect(json.totalAssets).toBe(1);

    const html = serializeAuditReportHtml(entries, {
      workspaceName: 'Client <Acme> Campaign',
      workspaceId: 'ws-1',
      generatedAt: '2026-11-23T13:00:00.000Z',
      metadataStrippedFromDeliverables: true,
    });
    expect(html).toContain('Client &lt;Acme&gt; Campaign');
    expect(html).not.toContain('Client <Acme> Campaign');
    expect(html).toContain("Content-Security-Policy");
  });
});
