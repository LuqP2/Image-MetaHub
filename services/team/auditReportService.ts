import type { Directory, IndexedImage } from '../../types';
import { resolveImageTeamContext } from './reviewService';
import type {
  TeamAssetState,
  TeamReviewStatus,
  TeamWorkspaceSummary,
} from './teamWorkspaceTypes';

export interface ProvenanceAuditEntry {
  fileName: string;
  relativePath: string;
  sha256: string | null;
  generator: string | null;
  model: string | null;
  loras: string[];
  reviewStatus: TeamReviewStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalOpId: string | null;
  hasUnresolvedConflict: boolean;
  commentCount: number;
  commentsSummary: string;
}

export interface AuditReportMeta {
  workspaceName: string;
  workspaceId: string | null;
  generatedAt: string;
  metadataStrippedFromDeliverables: boolean;
}

function extractFileName(rawPath: string): string {
  const parts = rawPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || rawPath;
}

function normalizeLoraNames(loras: IndexedImage['loras']): string[] {
  if (!Array.isArray(loras)) return [];
  return loras
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

export function buildProvenanceAuditEntries(
  images: IndexedImage[],
  directories: Array<{ id: string; path: string }>,
  workspacesById: Record<string, TeamWorkspaceSummary>,
  assetStatesByWorkspace: Record<string, Record<string, TeamAssetState>>,
  sha256ByImageId?: Record<string, string>,
): ProvenanceAuditEntry[] {
  const dirList = directories as Directory[];
  return images.map((image) => {
    const context = resolveImageTeamContext(
      image,
      dirList,
      workspacesById,
      assetStatesByWorkspace,
    );
    const state = context?.assetState ?? null;
    const normalizedMeta = image.metadata?.normalizedMetadata;
    const generator = normalizedMeta?.generator ?? null;
    const model = image.models?.[0] ?? normalizedMeta?.model ?? null;
    const loras = normalizeLoraNames(image.loras);
    const comments = state?.comments ?? [];

    return {
      fileName: extractFileName(image.name),
      relativePath: context?.relativePath ?? image.name.replace(/\\/g, '/'),
      sha256: sha256ByImageId?.[image.id] ?? state?.contentHash ?? null,
      generator,
      model,
      loras,
      reviewStatus: state?.reviewStatus ?? 'none',
      approvedBy: state?.reviewDecision?.authorName ?? state?.reviewDecision?.deviceId ?? null,
      approvedAt: state?.reviewDecision?.createdAt ?? null,
      approvalOpId: state?.reviewDecision?.opId ?? null,
      hasUnresolvedConflict: Boolean(state?.reviewConflict),
      commentCount: comments.length,
      commentsSummary: comments
        .map((c) => `${c.authorName || c.deviceId}: ${c.text.replace(/\s+/g, ' ').trim()}`)
        .join(' | '),
    };
  });
}

/**
 * RFC 4180 CSV cell escaping with spreadsheet formula injection mitigation.
 * Cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` are prefixed with `'`.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function serializeAuditReportCsv(entries: ProvenanceAuditEntry[]): string {
  const headers = [
    'File Name',
    'Relative Path',
    'SHA-256',
    'Generator',
    'Model',
    'LoRAs',
    'Review Status',
    'Reviewed By',
    'Reviewed At',
    'Approval Op ID',
    'Unresolved Conflict',
    'Comment Count',
    'Comments',
  ];

  const rows = entries.map((entry) => [
    entry.fileName,
    entry.relativePath,
    entry.sha256 ?? '',
    entry.generator ?? '',
    entry.model ?? '',
    entry.loras.join('; '),
    entry.reviewStatus,
    entry.approvedBy ?? '',
    entry.approvedAt ?? '',
    entry.approvalOpId ?? '',
    entry.hasUnresolvedConflict ? 'yes' : 'no',
    entry.commentCount,
    entry.commentsSummary,
  ].map(escapeCsvCell).join(','));

  return [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n') + '\r\n';
}

export function serializeAuditReportJson(
  entries: ProvenanceAuditEntry[],
  meta: AuditReportMeta,
): string {
  return JSON.stringify(
    {
      format: 'image-metahub-provenance-audit',
      schemaVersion: 1,
      ...meta,
      totalAssets: entries.length,
      entries,
    },
    null,
    2,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function serializeAuditReportHtml(
  entries: ProvenanceAuditEntry[],
  meta: AuditReportMeta,
): string {
  const rowsHtml = entries
    .map(
      (e) => `<tr>
        <td>${escapeHtml(e.fileName)}</td>
        <td><code>${escapeHtml(e.relativePath)}</code></td>
        <td><code>${escapeHtml(e.sha256 ? e.sha256.slice(0, 16) : '—')}</code></td>
        <td>${escapeHtml(e.generator || '—')}</td>
        <td>${escapeHtml(e.model || '—')}</td>
        <td>${escapeHtml(e.loras.join(', ') || '—')}</td>
        <td>${escapeHtml(e.reviewStatus)}</td>
        <td>${escapeHtml(e.approvedBy || '—')}</td>
        <td>${escapeHtml(e.approvedAt || '—')}</td>
      </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<title>Provenance &amp; Approval Audit Report — ${escapeHtml(meta.workspaceName)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { color: #4B5563; font-size: 12px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #D1D5DB; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #F3F4F6; font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
</style>
</head>
<body>
  <h1>Provenance &amp; Approval Audit Report</h1>
  <div class="meta">
    Workspace: <strong>${escapeHtml(meta.workspaceName)}</strong> ·
    Generated: ${escapeHtml(meta.generatedAt)} ·
    Assets: ${entries.length} ·
    Deliverable metadata stripped: ${meta.metadataStrippedFromDeliverables ? 'Yes' : 'No'}
  </div>
  <table>
    <thead>
      <tr>
        <th>File</th>
        <th>Path</th>
        <th>SHA-256 (prefix)</th>
        <th>Generator</th>
        <th>Model</th>
        <th>LoRAs</th>
        <th>Status</th>
        <th>Reviewed By</th>
        <th>Reviewed At</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}
