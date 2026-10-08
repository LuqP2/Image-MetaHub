import { validateHuggingFaceTarget } from '../services/modelLibrary/huggingFaceLink.mjs';

const ORIGIN = 'https://huggingface.co';
const MAX_BYTES = 10 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_OID = /^[a-f0-9]{40}$/i;

function normalizeFile(value) {
  if (value?.type !== 'file') return null;
  validateHuggingFaceTarget('synthetic/repository', 'main', value.path);
  if (!Number.isSafeInteger(value.size) || value.size < 0) throw new Error('Invalid Hugging Face file size.');
  const lfsSha256 = value.lfs && SHA256.test(value.lfs.oid) ? value.lfs.oid.toLowerCase() : undefined;
  if (value.lfs && (!lfsSha256 || !Number.isSafeInteger(value.lfs.size) || value.lfs.size !== value.size)) throw new Error('Invalid Hugging Face LFS metadata.');
  const gitOid = GIT_OID.test(value.oid) ? value.oid.toLowerCase() : undefined;
  const xetHash = SHA256.test(value.xetHash) ? value.xetHash.toLowerCase() : undefined;
  const fingerprint = lfsSha256 ? `lfs:sha256:${lfsSha256}` : gitOid ? `git:oid:${gitOid}` : xetHash ? `xet:${xetHash}` : undefined;
  if (!fingerprint) throw new Error('Hugging Face file has no supported identity.');
  return { path: value.path, size: value.size, lfsSha256, gitOid, xetHash, fingerprint };
}

/** Metadata only: never follow a resolve URL or send cookies/tokens. */
export async function lookupHuggingFaceModel(target, { signal, fetchImpl = fetch } = {}) {
  const { repoId, revision, filePath } = validateHuggingFaceTarget(target?.repoId, target?.revision, target?.filePath);
  let totalBytes = 0;
  async function json(url, options = {}) {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
    const response = await fetchImpl(url, { ...options, headers: { Accept: 'application/json', ...options.headers }, credentials: 'omit', redirect: 'error', signal: requestSignal });
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterMs = response.status === 429 ? Math.max(1000, Math.min(86400_000, Number(retryAfter) * 1000 || Date.parse(retryAfter) - Date.now() || 60_000)) : undefined;
      throw Object.assign(new Error(response.status === 429 ? 'Hugging Face rate limit. Try again later.' : [401, 403, 404].includes(response.status) ? 'Public repository, revision or file unavailable (missing or restricted).' : `Hugging Face request failed (${response.status}).`), { retryAfterMs });
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Hugging Face response exceeds 10 MiB.'); }
    if (!response.body) throw new Error('Empty Hugging Face response.');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        requestSignal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength; totalBytes += value.byteLength;
        if (size > MAX_BYTES || totalBytes > MAX_BYTES) throw new Error('Hugging Face response exceeds 10 MiB.');
        chunks.push(value);
      }
      requestSignal.throwIfAborted();
      return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), link: response.headers.get('link') };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const api = `${ORIGIN}/api/models/${repoId}`;
  const infoUrl = `${api}/revision/${encodeURIComponent(revision)}?expand=sha&expand=private&expand=gated&expand=disabled`;
  const { data: info } = await json(infoUrl);
  if (info.id !== repoId || !GIT_OID.test(info.sha)) throw new Error('Invalid Hugging Face repository response.');
  if (info.private || info.gated || info.disabled) throw new Error('Public repository unavailable (private, gated or disabled).');
  const commit = info.sha.toLowerCase();
  let files;
  if (filePath) {
    const { data } = await json(`${api}/paths-info/${commit}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ paths: filePath, expand: 'false' }).toString() });
    if (!Array.isArray(data)) throw new Error('Invalid Hugging Face file response.');
    files = data.filter((value) => value.path === filePath).map(normalizeFile).filter(Boolean);
    if (files.length !== 1) throw new Error('Public .safetensors file unavailable at this revision.');
  } else {
    files = [];
    const treePath = `/api/models/${repoId}/tree/${commit}`;
    let next = `${ORIGIN}${treePath}?recursive=true&expand=false`;
    const visited = new Set();
    while (next) {
      signal?.throwIfAborted();
      if (visited.has(next) || visited.size >= 1000) throw new Error('Incomplete Hugging Face pagination.');
      visited.add(next);
      const { data, link } = await json(next);
      if (!Array.isArray(data)) throw new Error('Invalid Hugging Face tree response.');
      for (const entry of data) if (entry?.type === 'file' && typeof entry.path === 'string' && /\.safetensors$/i.test(entry.path)) files.push(normalizeFile(entry));
      const nextLinks = (link ? link.split(',') : []).filter((entry) => {
        const relation = entry.match(/;\s*rel=(?:"([^"]+)"|([^;\s]+))/i);
        if (!relation || !/^\s*<[^>]+>/.test(entry)) throw new Error('Invalid Hugging Face pagination.');
        return (relation[1] ?? relation[2]).split(/\s+/).includes('next');
      });
      if (nextLinks.length > 1) throw new Error('Invalid Hugging Face pagination.');
      const match = nextLinks[0]?.match(/^\s*<([^>]+)>/);
      if (nextLinks.length && !match) throw new Error('Invalid Hugging Face pagination.');
      next = '';
      if (match) {
        const page = new URL(match[1], ORIGIN);
        if (page.origin !== ORIGIN || page.username || page.password || page.hash || page.pathname !== treePath || page.searchParams.get('recursive') !== 'true' || page.searchParams.get('expand') !== 'false' || [...page.searchParams.keys()].some((key) => !['recursive', 'expand', 'cursor', 'limit'].includes(key))) throw new Error('Unsafe Hugging Face pagination link.');
        next = page.href;
      }
    }
    if (!files.length) throw new Error('No public .safetensors files at this revision.');
    const paths = new Set(files.map((file) => file.path));
    if (paths.size !== files.length) throw new Error('Incomplete Hugging Face pagination: duplicate files.');
  }
  return { repoId, revision, resolvedCommit: commit, files, fetchedAt: Date.now() };
}
