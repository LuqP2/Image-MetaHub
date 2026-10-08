/** Validate identifiers before constructing a fixed-host Hub API request. */
const hasControl = (value) => [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
export function validateHuggingFaceTarget(repoId, revision = 'main', filePath = '') {
  if (typeof repoId !== 'string' || !/^[\w-]+\/[\w.-]+$/.test(repoId) || repoId.length > 200 || repoId.includes('..')) throw new Error('Use a Hugging Face model repository in owner/repository format.');
  if (typeof revision !== 'string' || !revision || revision.length > 256 || /[\s\\?#]/.test(revision) || hasControl(revision) || revision.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Enter a valid revision (branch, tag or commit).');
  if (typeof filePath !== 'string' || filePath.length > 2048 || filePath.includes('\\') || hasControl(filePath) || (filePath && filePath.split('/').some((part) => !part || part === '.' || part === '..'))) throw new Error('Enter a relative file path inside the repository.');
  if (filePath && !/\.safetensors$/i.test(filePath)) throw new Error('Choose a .safetensors file.');
  return { repoId, revision, filePath };
}

/** Slash-containing revisions in URLs must be encoded; editable fields resolve ambiguity. */
export function parseHuggingFaceLink(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Paste an HTTPS huggingface.co repository or file link.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'huggingface.co' || url.port || url.username || url.password || [...url.searchParams.keys()].some((key) => key !== 'download')) throw new Error('Use a public HTTPS huggingface.co link without credentials.');
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map((part) => decodeURIComponent(part));
  const repoId = parts.slice(0, 2).join('/');
  if (parts.length === 2) return validateHuggingFaceTarget(repoId);
  if (!['blob', 'resolve'].includes(parts[2]) || parts.length < 5) throw new Error('Use a repository link or a blob/resolve file link.');
  return validateHuggingFaceTarget(repoId, parts[3], parts.slice(4).join('/'));
}

export function huggingFaceFileUrl({ repoId, linkedRevision, filePath }) {
  validateHuggingFaceTarget(repoId, linkedRevision, filePath);
  return `https://huggingface.co/${repoId}/blob/${encodeURIComponent(linkedRevision)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
}
