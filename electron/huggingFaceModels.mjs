import { validateHuggingFaceScope, validateHuggingFaceTarget } from '../services/modelLibrary/huggingFaceLink.mjs';

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
async function queryHuggingFaceModel(target, { signal, fetchImpl = fetch } = {}, watch = false) {
  const { repoId, revision, filePath } = validateHuggingFaceTarget(target?.repoId, target?.revision, target?.filePath);
  if (watch) {
    validateHuggingFaceScope(repoId, revision, target.watchedDirectory, target.recursive);
    if (!Array.isArray(target.linkedPaths) || !target.linkedPaths.length || target.linkedPaths.length > 1000) throw new Error('Invalid monitored Hugging Face files.');
    for (const path of target.linkedPaths) { validateHuggingFaceTarget(repoId, revision, path); if (!path) throw new Error('Missing monitored file.'); }
  }
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
  const linkedFiles = {};
  let folderExists = true;
  if (watch) {
    const paths = new Set(target.linkedPaths);
    for (const path of paths) { validateHuggingFaceTarget(repoId, revision, path); if (!path) throw new Error('Missing monitored file.'); linkedFiles[path] = null; }
    if (target.watchedDirectory) paths.add(target.watchedDirectory);
    const body = new URLSearchParams({ expand: 'false' });
    for (const path of paths) body.append('paths', path);
    const { data } = await json(`${api}/paths-info/${commit}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!Array.isArray(data)) throw new Error('Invalid Hugging Face paths response.');
    const returned = new Set();
    for (const entry of data) {
      if (!entry || !paths.has(entry.path) || returned.has(entry.path) || !['file', 'directory'].includes(entry.type)) throw new Error('Invalid Hugging Face paths response.');
      returned.add(entry.path);
      if (Object.hasOwn(linkedFiles, entry.path)) linkedFiles[entry.path] = normalizeFile(entry);
      if (entry.path === target.watchedDirectory && entry.type !== 'directory') throw new Error('The watched Hugging Face path is not a folder.');
    }
    // paths-info explicitly omits missing entries. A missing folder is a complete empty scope.
    folderExists = !target.watchedDirectory || returned.has(target.watchedDirectory);
    if (!folderExists && Object.values(linkedFiles).some((file) => file?.path.startsWith(`${target.watchedDirectory}/`))) throw new Error('Inconsistent Hugging Face folder response.');
  }
  let files;
  if (filePath && !watch) {
    const { data } = await json(`${api}/paths-info/${commit}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ paths: filePath, expand: 'false' }).toString() });
    if (!Array.isArray(data)) throw new Error('Invalid Hugging Face file response.');
    files = data.filter((value) => value.path === filePath).map(normalizeFile).filter(Boolean);
    if (files.length !== 1) throw new Error('Public .safetensors file unavailable at this revision.');
  } else {
    files = [];
    const directory = watch ? target.watchedDirectory : '';
    const recursive = watch ? target.recursive : true;
    const treePath = `/api/models/${repoId}/tree/${commit}${directory ? `/${encodeURIComponent(directory)}` : ''}`;
    let next = folderExists ? `${ORIGIN}${treePath}?recursive=${recursive}&expand=false` : '';
    const visited = new Set();
    while (next) {
      signal?.throwIfAborted();
      if (visited.has(next) || visited.size >= 1000) throw new Error('Incomplete Hugging Face pagination.');
      visited.add(next);
      const { data, link } = await json(next);
      if (!Array.isArray(data)) throw new Error('Invalid Hugging Face tree response.');
      for (const entry of data) {
        if (!entry || !['file', 'directory'].includes(entry.type) || typeof entry.path !== 'string' || !entry.path) throw new Error('Invalid Hugging Face tree entry.');
        if (entry.type !== 'file' || !/\.safetensors$/i.test(entry.path)) continue;
        const prefix = directory ? `${directory}/` : '';
        if (!entry.path.startsWith(prefix) || (!recursive && entry.path.slice(prefix.length).includes('/'))) throw new Error('Hugging Face tree returned a file outside the watched scope.');
        files.push(normalizeFile(entry));
      }
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
        if (page.origin !== ORIGIN || page.username || page.password || page.hash || page.pathname !== treePath || page.searchParams.get('recursive') !== String(recursive) || page.searchParams.get('expand') !== 'false' || [...page.searchParams.keys()].some((key) => !['recursive', 'expand', 'cursor', 'limit'].includes(key))) throw new Error('Unsafe Hugging Face pagination link.');
        next = page.href;
      }
    }
    if (!watch && !files.length) throw new Error('No public .safetensors files at this revision.');
    const paths = new Set(files.map((file) => file.path));
    if (paths.size !== files.length) throw new Error('Incomplete Hugging Face pagination: duplicate files.');
  }
  if (watch) {
    for (const file of files) if (Object.hasOwn(linkedFiles, file.path) && linkedFiles[file.path]?.fingerprint !== file.fingerprint) throw new Error('Inconsistent Hugging Face snapshot.');
    const prefix = target.watchedDirectory ? `${target.watchedDirectory}/` : '';
    const listed = new Set(files.map((file) => file.path));
    for (const file of Object.values(linkedFiles)) if (file && file.path.startsWith(prefix) && (target.recursive || !file.path.slice(prefix.length).includes('/')) && !listed.has(file.path)) throw new Error('Incomplete Hugging Face tree: linked file omitted.');
    return { repoId, revision, resolvedCommit: commit, files, linkedFiles, watchedDirectory: target.watchedDirectory, recursive: target.recursive, fetchedAt: Date.now() };
  }
  return { repoId, revision, resolvedCommit: commit, files, fetchedAt: Date.now() };
}

export function lookupHuggingFaceModel(target, options) { return queryHuggingFaceModel(target, options); }
export function snapshotHuggingFaceModels(target, options) { return queryHuggingFaceModel(target, options, true); }
