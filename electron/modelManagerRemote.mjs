// Only fixed Civitai endpoints and allowlisted image hosts reach the network.
export function normalizeRemoteVersion(data, modelId) {
  if (!Number.isSafeInteger(data?.id) || data.id <= 0) throw new Error('Invalid Civitai version.');
  return {
    id: data.id, name: typeof data.name === 'string' ? data.name : String(data.id),
    baseModel: typeof data.baseModel === 'string' ? data.baseModel : undefined,
    publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    description: typeof data.description === 'string' ? data.description.replace(/<[^>]*>/g, '') : '',
    url: `https://civitai.com/models/${modelId}?modelVersionId=${data.id}`,
  };
}

export function retryAfterMs(value, now = Date.now()) {
  const seconds = Number(value);
  if (value && Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value || '');
  return Number.isFinite(date) ? Math.max(0, date - now) : 60000;
}

export async function fetchCivitaiJson(endpoint, signal, fetcher = fetch) {
  let response;
  try { response = await fetcher(`https://civitai.com/api/v1/${endpoint}`, { signal, headers: { Accept: 'application/json' } }); }
  catch (error) { throw new Error(`Unable to query Civitai: ${error.cause?.code || error.message}`); }
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'Model or version is no longer available.' : response.status === 401 || response.status === 403 ? 'Civitai access is restricted.' : `Civitai request failed (${response.status}).`);
    error.status = response.status;
    if (response.status === 429) error.retryAfterMs = retryAfterMs(response.headers.get('retry-after'));
    throw error;
  }
  return response.json();
}

export function allowedCivitaiImage(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'civitai.com' || url.hostname.endsWith('.civitai.com'));
  } catch { return false; }
}

export async function fetchCivitaiImage(input, signal, fetcher = fetch) {
  if (!allowedCivitaiImage(input)) throw new Error('Untrusted Civitai image URL.');
  let current = input;
  let response;
  for (let redirects = 0; ; redirects++) {
    try { response = await fetcher(current, { signal, redirect: 'manual' }); }
    catch (error) { throw new Error(`Unable to fetch Civitai image: ${error.cause?.code || error.message}`); }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (redirects >= 3 || !location) throw new Error('Invalid Civitai image redirect.');
    const next = new URL(location, current).href;
    if (!allowedCivitaiImage(next)) throw new Error('Untrusted Civitai image redirect.');
    current = next;
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0];
  if (!response.ok || !/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error('Unsupported example image.');
  const limit = 8 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Example image is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty example image.');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error('Example image is too large.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
