const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function normalizeComfyUIViewUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase();
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(normalizeHostname(hostname));
}

export function isComfyUIViewUrlAllowed(targetUrl, configuredUrl) {
  const target = normalizeComfyUIViewUrl(targetUrl);
  const configured = normalizeComfyUIViewUrl(configuredUrl);

  if (!target || !configured) {
    return false;
  }

  if (target.protocol !== configured.protocol) {
    return false;
  }

  if (target.port !== configured.port) {
    return false;
  }

  const targetHost = normalizeHostname(target.hostname);
  const configuredHost = normalizeHostname(configured.hostname);

  if (targetHost === configuredHost) {
    return true;
  }

  return isLoopbackHost(targetHost) && isLoopbackHost(configuredHost);
}

export function getComfyUIViewAllowedOrigin(configuredUrl) {
  const configured = normalizeComfyUIViewUrl(configuredUrl);
  return configured ? configured.origin : null;
}
