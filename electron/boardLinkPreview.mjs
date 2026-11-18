import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function isPublicPreviewAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Restrict IPv6 to global unicast; mapped IPv4 and local/link-local ranges are excluded.
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
}
function previewUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Preview requires a public HTTP/HTTPS URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicPreviewAddress(host)) throw new Error('Local and private addresses cannot be previewed.');
  return url;
}
/** DNS is checked in the connection's lookup callback, avoiding a second unvalidated lookup. */
export function readPreviewResource(value, limit, redirects = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = previewUrl(value); } catch (error) { reject(error); return; }
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      headers: { 'User-Agent': 'ImageMetaHub-LinkPreview', Accept: 'text/html,image/png,image/jpeg,image/webp,image/gif', 'Accept-Encoding': 'identity' },
      lookup(hostname, options, callback) {
        dns.lookup(hostname, { all: true }, (error, addresses) => {
          if (error) { callback(error); return; }
          if (!addresses.length || addresses.some(item => !isPublicPreviewAddress(item.address))) { callback(new Error('Local and private addresses cannot be previewed.')); return; }
          if (options.all) callback(null, addresses); else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 3) { reject(new Error('Too many preview redirects.')); return; }
        readPreviewResource(new URL(response.headers.location, url).href, limit, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Preview request failed (${response.statusCode}).`)); return; }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > limit) response.destroy(new Error('Preview response is too large.')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), type: String(response.headers['content-type'] || ''), url: url.href }));
    });
    const timeout = setTimeout(() => request.destroy(new Error('Preview request timed out.')), 8000);
    request.on('close', () => clearTimeout(timeout)); request.on('error', reject);
  });
}
const decode = text => text.replace(/&(?:amp|quot|apos|lt|gt|#39);/g, match => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'" })[match]);
export function previewMetadata(html, base) {
  const meta = new Map();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map([...tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4])]));
    meta.set((attributes.get('property') || attributes.get('name') || '').toLowerCase(), attributes.get('content') || '');
  }
  const title = (meta.get('og:title') || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '') || new URL(base).hostname).trim().slice(0, 1000);
  const image = meta.get('og:image');
  return { title, image: image ? new URL(image, base).href : undefined };
}
export async function getBoardLinkPreview({ url, cacheDirectory, nativeImage }) {
  const normalized = previewUrl(url).href;
  const file = path.join(cacheDirectory, `${createHash('sha256').update(normalized).digest('hex')}.json`);
  try { const cache = JSON.parse(await fs.readFile(file, 'utf8')); if (Date.now() - cache.created < 86400000) return cache.preview; } catch { /* Cache is reconstructible. */ }
  const page = await readPreviewResource(normalized, 1024 * 1024);
  if (!/text\/html|application\/xhtml\+xml/i.test(page.type)) throw new Error('This URL does not provide an HTML preview.');
  const metadata = previewMetadata(page.bytes.toString('utf8'), page.url);
  const preview = { title: metadata.title };
  if (metadata.image) {
    try {
      const resource = await readPreviewResource(metadata.image, 2 * 1024 * 1024);
      if (/^image\/(png|jpeg|webp|gif)(?:;|$)/i.test(resource.type)) {
        const image = nativeImage.createFromBuffer(resource.bytes);
        if (!image.isEmpty()) preview.imageData = image.resize({ width: Math.min(640, image.getSize().width) }).toDataURL();
      }
    } catch { /* A usable title-only card survives missing/blocked images. */ }
  }
  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ created: Date.now(), preview }));
  return preview;
}
