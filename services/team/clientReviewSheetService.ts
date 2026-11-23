import type { TeamOpInput, TeamReviewStatus } from './teamWorkspaceTypes';

export const CLIENT_FEEDBACK_FORMAT = 'image-metahub-client-feedback';
export const CLIENT_FEEDBACK_SCHEMA_VERSION = 1;

export interface ClientReviewSheetItem {
  assetKey: string;
  relativePath: string;
  fileName: string;
  currentStatus: TeamReviewStatus;
  baseOpId: string | null;
  contentHash: string | null;
  thumbnailDataUrl: string;
}

export interface ClientReviewSheetInput {
  workspaceId: string;
  workspaceName: string;
  exportedAt: string;
  items: ClientReviewSheetItem[];
}

export interface ClientFeedbackItem {
  assetKey: string;
  relativePath: string;
  contentHash: string | null;
  baseOpId: string | null;
  status: TeamReviewStatus | null;
  comment: string | null;
}

export interface ParsedClientFeedback {
  format: typeof CLIENT_FEEDBACK_FORMAT;
  schemaVersion: number;
  workspaceId: string;
  reviewerName: string;
  exportedAt: string;
  items: ClientFeedbackItem[];
}

const ALLOWED_CLIENT_STATUSES = new Set<TeamReviewStatus>([
  'none',
  'in_review',
  'needs_changes',
  'approved',
  'rejected',
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely embed JSON inside a `<script type="application/json">` tag so `</script>`
 * or Unicode line separators can never break out of the tag.
 */
function serializeJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Build a 100% self-contained, offline, zero-CDN HTML Client Review Sheet.
 * - Strict CSP blocks all network requests and remote images.
 * - All user/item text is rendered via `textContent` (never `innerHTML`).
 * - Downloads a compact `.imh-feedback.json` file that preserves `baseOpId`
 *   so importing back into `.imh-team/` still detects concurrent studio edits.
 */
export function buildClientReviewSheetHtml(input: ClientReviewSheetInput): string {
  const embeddedPayload = serializeJsonForHtmlScript({
    format: CLIENT_FEEDBACK_FORMAT,
    schemaVersion: CLIENT_FEEDBACK_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    exportedAt: input.exportedAt,
    items: input.items.map((item) => ({
      assetKey: item.assetKey,
      relativePath: item.relativePath,
      fileName: item.fileName,
      currentStatus: item.currentStatus,
      baseOpId: item.baseOpId,
      contentHash: item.contentHash,
      thumbnailDataUrl: item.thumbnailDataUrl.startsWith('data:image/') ? item.thumbnailDataUrl : '',
    })),
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Client Review — ${escapeHtml(input.workspaceName)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0B0F17; color: #E5E7EB; }
  header { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; background: #111827; border-bottom: 1px solid #1F2937; }
  header h1 { margin: 0; font-size: 16px; }
  header .sub { font-size: 12px; color: #9CA3AF; }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  input[type="text"], textarea { background: #1F2937; color: #F9FAFB; border: 1px solid #374151; border-radius: 6px; padding: 7px 10px; font-size: 12px; }
  button { cursor: pointer; border-radius: 6px; border: 1px solid #374151; background: #1F2937; color: #E5E7EB; padding: 7px 12px; font-size: 12px; font-weight: 500; }
  button.primary { background: #2563EB; border-color: #3B82F6; color: #FFFFFF; }
  button.primary:hover { background: #1D4ED8; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; padding: 20px; }
  .card { background: #111827; border: 1px solid #1F2937; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .thumb-wrap { position: relative; aspect-ratio: 4 / 3; background: #030712; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .thumb-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; }
  .shot-num { position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.72); color: #F9FAFB; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px; }
  .body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .filename { font-size: 12px; font-weight: 600; word-break: break-all; }
  .status-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .status-btn { padding: 6px 4px; font-size: 11px; text-align: center; }
  .status-btn.active-approved { background: #059669; border-color: #10B981; color: #FFF; }
  .status-btn.active-needs_changes { background: #D97706; border-color: #F59E0B; color: #FFF; }
  .status-btn.active-rejected { background: #DC2626; border-color: #EF4444; color: #FFF; }
  textarea { width: 100%; resize: vertical; min-height: 54px; }
  .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.88); display: none; align-items: center; justify-content: center; z-index: 50; padding: 24px; }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: 95vw; max-height: 92vh; object-fit: contain; }
</style>
</head>
<body>
<header>
  <div>
    <h1 id="ws-title"></h1>
    <div class="sub" id="ws-meta"></div>
  </div>
  <div class="controls">
    <input id="reviewer-name" type="text" placeholder="Your name (required)" maxlength="64" />
    <button id="download-btn" class="primary" type="button">Download Feedback (.imh-feedback.json)</button>
  </div>
</header>
<main id="grid"></main>
<div id="lightbox" class="lightbox" role="dialog" aria-modal="true"><img id="lightbox-img" alt="" /></div>
<script id="imh-review-data" type="application/json">${embeddedPayload}</script>
<script>
(function() {
  var payload = JSON.parse(document.getElementById('imh-review-data').textContent);
  document.getElementById('ws-title').textContent = 'Client Review — ' + payload.workspaceName;
  document.getElementById('ws-meta').textContent = payload.items.length + ' assets · Offline review sheet (no uploads)';
  var decisions = {};
  var comments = {};
  var grid = document.getElementById('grid');
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightbox-img');
  lightbox.addEventListener('click', function() { lightbox.classList.remove('open'); });

  var statuses = [
    { key: 'approved', label: 'Approve' },
    { key: 'needs_changes', label: 'Changes' },
    { key: 'rejected', label: 'Reject' }
  ];

  payload.items.forEach(function(item, index) {
    var card = document.createElement('section');
    card.className = 'card';

    var thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';
    var badge = document.createElement('span');
    badge.className = 'shot-num';
    badge.textContent = '#' + (index + 1);
    thumbWrap.appendChild(badge);

    if (item.thumbnailDataUrl) {
      var img = document.createElement('img');
      img.src = item.thumbnailDataUrl;
      img.alt = item.fileName;
      img.addEventListener('click', function() {
        lightboxImg.src = item.thumbnailDataUrl;
        lightbox.classList.add('open');
      });
      thumbWrap.appendChild(img);
    }
    card.appendChild(thumbWrap);

    var body = document.createElement('div');
    body.className = 'body';

    var fname = document.createElement('div');
    fname.className = 'filename';
    fname.textContent = item.fileName;
    body.appendChild(fname);

    var row = document.createElement('div');
    row.className = 'status-row';
    var btnMap = {};
    statuses.forEach(function(st) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'status-btn';
      btn.textContent = st.label;
      btn.addEventListener('click', function() {
        decisions[item.assetKey] = decisions[item.assetKey] === st.key ? null : st.key;
        statuses.forEach(function(other) {
          btnMap[other.key].className = 'status-btn' + (decisions[item.assetKey] === other.key ? ' active-' + other.key : '');
        });
      });
      btnMap[st.key] = btn;
      row.appendChild(btn);
    });
    body.appendChild(row);

    var ta = document.createElement('textarea');
    ta.placeholder = 'Optional note...';
    ta.addEventListener('input', function() { comments[item.assetKey] = ta.value; });
    body.appendChild(ta);

    card.appendChild(body);
    grid.appendChild(card);
  });

  document.getElementById('download-btn').addEventListener('click', function() {
    var reviewer = (document.getElementById('reviewer-name').value || '').trim() || 'Client';
    var outItems = [];
    payload.items.forEach(function(item) {
      var st = decisions[item.assetKey] || null;
      var note = (comments[item.assetKey] || '').trim() || null;
      if (st || note) {
        outItems.push({
          assetKey: item.assetKey,
          relativePath: item.relativePath,
          contentHash: item.contentHash || null,
          baseOpId: item.baseOpId || null,
          status: st,
          comment: note
        });
      }
    });
    var result = {
      format: payload.format,
      schemaVersion: payload.schemaVersion,
      workspaceId: payload.workspaceId,
      reviewerName: reviewer,
      exportedAt: new Date().toISOString(),
      items: outItems
    };
    var blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'client-feedback.imh-feedback.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
</script>
</body>
</html>`;
}

export function parseClientFeedbackFile(
  rawText: string,
  expectedWorkspaceId: string,
): ParsedClientFeedback {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Client feedback file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Client feedback payload is invalid.');
  }

  const record = parsed as Record<string, unknown>;
  if (record.format !== CLIENT_FEEDBACK_FORMAT) {
    throw new Error('Unsupported client feedback file format.');
  }
  if (record.schemaVersion !== CLIENT_FEEDBACK_SCHEMA_VERSION) {
    throw new Error(`Unsupported client feedback schema version: ${String(record.schemaVersion)}`);
  }
  if (typeof record.workspaceId !== 'string' || record.workspaceId !== expectedWorkspaceId) {
    throw new Error('This client feedback file belongs to a different Team Workspace.');
  }
  if (!Array.isArray(record.items)) {
    throw new Error('Client feedback items list is missing.');
  }

  const reviewerName = typeof record.reviewerName === 'string' && record.reviewerName.trim()
    ? record.reviewerName.trim().slice(0, 64)
    : 'Client';

  const items: ClientFeedbackItem[] = [];
  for (const rawItem of record.items) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const entry = rawItem as Record<string, unknown>;
    if (typeof entry.assetKey !== 'string' || !entry.assetKey.trim()) continue;
    if (typeof entry.relativePath !== 'string' || !entry.relativePath.trim()) continue;

    const status = typeof entry.status === 'string' && ALLOWED_CLIENT_STATUSES.has(entry.status as TeamReviewStatus)
      ? (entry.status as TeamReviewStatus)
      : null;
    const comment = typeof entry.comment === 'string' && entry.comment.trim()
      ? entry.comment.trim().slice(0, 2000)
      : null;
    if (!status && !comment) continue;

    items.push({
      assetKey: entry.assetKey.trim(),
      relativePath: entry.relativePath.trim(),
      contentHash: typeof entry.contentHash === 'string' && entry.contentHash.trim() ? entry.contentHash.trim() : null,
      baseOpId: typeof entry.baseOpId === 'string' && entry.baseOpId.trim() ? entry.baseOpId.trim() : null,
      status,
      comment,
    });
  }

  return {
    format: CLIENT_FEEDBACK_FORMAT,
    schemaVersion: CLIENT_FEEDBACK_SCHEMA_VERSION,
    workspaceId: record.workspaceId,
    reviewerName,
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : new Date().toISOString(),
    items,
  };
}

/**
 * Translate parsed client feedback into immutable Team Workspace operations.
 * Preserves `baseOpId` from the review sheet so any concurrent studio review
 * made after sending the HTML is flagged as an explicit conflict instead of silently overwritten.
 */
export function buildOpsFromClientFeedback(feedback: ParsedClientFeedback): TeamOpInput[] {
  const authorName = `Client: ${feedback.reviewerName}`;
  const ops: TeamOpInput[] = [];

  for (const item of feedback.items) {
    if (item.status) {
      ops.push({
        type: 'set_review_status',
        assetKey: item.assetKey,
        relativePath: item.relativePath,
        contentHash: item.contentHash,
        status: item.status,
        baseOpId: item.baseOpId,
        authorName,
      });
    }
    if (item.comment) {
      const commentId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `cf-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      ops.push({
        type: 'add_comment',
        assetKey: item.assetKey,
        relativePath: item.relativePath,
        contentHash: item.contentHash,
        commentId,
        text: item.comment,
        authorName,
      });
    }
  }

  return ops;
}
