// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { lookupHuggingFaceModel } from '../electron/huggingFaceModels.mjs';
import { huggingFaceFileUrl, parseHuggingFaceLink } from '../services/modelLibrary/huggingFaceLink.mjs';
import { isInspectorHuggingFaceLocation } from '../electron/modelInspectorCatalog.mjs';

const sha = 'a'.repeat(64), commit = 'b'.repeat(40);
const info = { id: 'owner/repo', sha: commit, private: false, gated: false };
const file = (path = 'folder/model.safetensors') => ({ type: 'file', path, oid: 'c'.repeat(40), size: 100, lfs: { oid: sha, size: 100, pointerSize: 130 }, xetHash: 'd'.repeat(64) });
const response = (value: unknown, headers = {}) => new Response(JSON.stringify(value), { headers });
const target = { repoId: 'owner/repo', revision: 'main', filePath: 'folder/model.safetensors' };

describe('Hugging Face public link parsing', () => {
  it.each(['blob', 'resolve'])('parses %s without treating it as a binary download', (kind) => {
    expect(parseHuggingFaceLink(`https://huggingface.co/owner/repo/${kind}/release%2Fv1/folder/model.safetensors?download=true`)).toEqual({ ...target, revision: 'release/v1' });
    expect(huggingFaceFileUrl({ repoId: target.repoId, linkedRevision: 'release/v1', filePath: target.filePath })).toBe('https://huggingface.co/owner/repo/blob/release%2Fv1/folder/model.safetensors');
  });
  it('defaults repository URLs to main and allows editable resolution of ambiguous revisions', () => {
    expect(parseHuggingFaceLink('https://huggingface.co/owner/repo/')).toEqual({ repoId: 'owner/repo', revision: 'main', filePath: '' });
    expect(parseHuggingFaceLink('https://huggingface.co/owner/repo/blob/release/v1/model.safetensors')).toEqual({ repoId: 'owner/repo', revision: 'release', filePath: 'v1/model.safetensors' });
  });
  it.each(['http://huggingface.co/owner/repo', 'https://huggingface.co.evil/owner/repo', 'https://user:password@huggingface.co/owner/repo', 'https://huggingface.co/owner/repo?token=secret', 'https://huggingface.co:8080/owner/repo', 'https://huggingface.co/datasets/owner/repo', 'https://huggingface.co/owner/repo/blob/main/readme.md', 'https://huggingface.co/owner%2Fother/repo', 'https://huggingface.co/owner/repo/blob/%2E%2E/x.safetensors'])('rejects unsupported or credential-bearing link %s', (url) => {
    expect(() => parseHuggingFaceLink(url)).toThrow();
  });
});

describe('Hugging Face metadata adapter', () => {
  it('pins paths-info to the resolved commit and encodes slash revisions and paths without downloading', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([file()]));
    const result = await lookupHuggingFaceModel({ ...target, revision: 'release/v1' }, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain('/revision/release%2Fv1?');
    expect(fetchImpl.mock.calls[1][0]).toBe(`https://huggingface.co/api/models/owner/repo/paths-info/${commit}`);
    expect(new URLSearchParams(fetchImpl.mock.calls[1][1].body).get('paths')).toBe(target.filePath);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).not.toContain('/resolve/');
      expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
      expect(options.headers.Authorization).toBeUndefined();
    }
    expect(result.files[0]).toMatchObject({ lfsSha256: sha, fingerprint: `lfs:sha256:${sha}`, gitOid: 'c'.repeat(40), xetHash: 'd'.repeat(64) });
    expect(result.revision).toBe('release/v1');
  });
  it('exhausts recursive tree pagination at one pinned commit and filters non-model files', async () => {
    const tree = `https://huggingface.co/api/models/owner/repo/tree/${commit}?recursive=true&expand=false`;
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([{ type: 'file', path: 'README.md' }, file('a.safetensors')], { link: `<${tree}&cursor=next>; rel="next"` })).mockResolvedValueOnce(response([file('sub/b.safetensors')]));
    const result = await lookupHuggingFaceModel({ ...target, filePath: '' }, { fetchImpl });
    expect(result.files.map((entry) => entry.path)).toEqual(['a.safetensors', 'sub/b.safetensors']);
    expect(fetchImpl.mock.calls[2][0]).toBe(`${tree}&cursor=next`);
  });
  it.each(['https://evil.example/api/models/owner/repo/tree/COMMIT?recursive=true&expand=false', 'https://huggingface.co/owner/repo/resolve/COMMIT/model.safetensors', 'https://huggingface.co/api/models/other/repo/tree/COMMIT?recursive=true&expand=false', 'https://huggingface.co/api/models/owner/repo/tree/COMMIT?recursive=true&expand=false&token=secret'])('rejects unsafe pagination before the next fetch: %s', async (url) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([file()], { link: `<${url.replace('COMMIT', commit)}>; rel="next"` }));
    await expect(lookupHuggingFaceModel({ ...target, filePath: '' }, { fetchImpl })).rejects.toThrow('Unsafe');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('does not return a partial list when a later page fails', async () => {
    const next = `https://huggingface.co/api/models/owner/repo/tree/${commit}?recursive=true&expand=false&cursor=next`;
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([file()], { link: `<${next}>; rel="next"` })).mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(lookupHuggingFaceModel({ ...target, filePath: '' }, { fetchImpl })).rejects.toThrow('(503)');
  });
  it.each(['not-a-link; rel="next"', '<https://huggingface.co/api/models/owner/repo/tree/COMMIT?recursive=true&expand=false>; rel="next"'])('rejects malformed or cyclic pagination without returning a partial list', async (link) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([file()], { link: link.replace('COMMIT', commit) }));
    await expect(lookupHuggingFaceModel({ ...target, filePath: '' }, { fetchImpl })).rejects.toThrow(/pagination/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 404])('reports restricted/missing resources as public unavailable (%i)', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }));
    await expect(lookupHuggingFaceModel(target, { fetchImpl })).rejects.toThrow('Public');
  });
  it.each([{ private: true }, { gated: 'manual' }, { disabled: true }])('rejects inaccessible repository metadata %j', async (restriction) => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ...info, ...restriction }));
    await expect(lookupHuggingFaceModel(target, { fetchImpl })).rejects.toThrow('unavailable');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('returns rate-limit backoff separately from provider data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    await expect(lookupHuggingFaceModel(target, { fetchImpl })).rejects.toMatchObject({ retryAfterMs: 120_000 });
  });
  it('does not confuse Git OID or Xet identities with a local SHA-256', async () => {
    const value = { ...file(), lfs: undefined };
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([value]));
    const result = await lookupHuggingFaceModel(target, { fetchImpl });
    expect(result.files[0].lfsSha256).toBeUndefined();
    expect(result.files[0].fingerprint).toBe(`git:oid:${value.oid}`);
  });
  it('rejects malformed LFS metadata rather than claiming a verified identity', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([{ ...file(), lfs: { oid: 'c'.repeat(40), size: 100 } }]));
    await expect(lookupHuggingFaceModel(target, { fetchImpl })).rejects.toThrow('LFS');
  });
  it('caps streamed bytes even without a Content-Length header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(' '.repeat(10 * 1024 * 1024 + 1)));
    await expect(lookupHuggingFaceModel(target, { fetchImpl })).rejects.toThrow('10 MiB');
  });
  it('cancels a request and prevents subsequent pages', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async (_url, { signal }) => { controller.abort(); signal.throwIfAborted(); });
    await expect(lookupHuggingFaceModel(target, { signal: controller.signal, fetchImpl })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('makes a 30-second timeout signal available to fetch', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response([file()]));
    await lookupHuggingFaceModel(target, { fetchImpl });
    expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
    timeout.mockRestore();
  });
});

it('limits Inspector HF copy commands to the displayed model and known byte-identical copies', () => {
  const selected = { id: 'selected', sha256: sha }, copy = { id: 'copy', sha256: sha }, other = { id: 'other', sha256: 'e'.repeat(64) };
  const snapshot = { items: [{ location: selected }] }, catalog = { locations: [selected, copy, other] };
  expect(isInspectorHuggingFaceLocation(snapshot, catalog, 'copy')).toBe(true);
  expect(isInspectorHuggingFaceLocation(snapshot, catalog, 'other')).toBe(false);
  expect(isInspectorHuggingFaceLocation(snapshot, catalog, 'removed')).toBe(false);
  expect(isInspectorHuggingFaceLocation({ items: [{ location: { id: 'selected' } }] }, catalog, 'copy')).toBe(false);
});
