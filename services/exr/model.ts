import type { ExrColorProfile, ExrPart } from './contracts';

export const EXR_CONFIGS = [
  { name: 'ACES 1.3', id: 'ocio://cg-config-v2.2.0_aces-v1.3_ocio-v2.4' },
  { name: 'ACES 2.0', id: 'ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5' },
];
export const DEFAULT_EXR_PROFILE: ExrColorProfile = {
  config: EXR_CONFIGS[0].id, input: 'auto', display: '', view: '',
};
// Match native select(): beauty/combined RGB, unprefixed RGB, layered RGB,
// then the first raw channel. Strictly greater scores preserve native tie order.
export function exrDefaultSelection(parts: ExrPart[]): { part: ExrPart; channels: string[] } | undefined {
  let selected: { part: ExrPart; channels: string[] } | undefined;
  let best = -1;
  for (const part of parts) {
    if (part.deep) continue;
    const names = [...new Set(part.channels.map(c => c.name))].sort();
    const available = new Set(names);
    for (const name of names) {
      const prefix = name.slice(0, name.lastIndexOf('.') + 1);
      if (name.slice(prefix.length) !== 'R' || !available.has(`${prefix}G`) || !available.has(`${prefix}B`)) continue;
      const score = /beauty|combined/i.test(prefix + part.name) ? 3 : prefix === '' ? 2 : 1;
      if (score > best) {
        best = score;
        selected = { part, channels: ['R', 'G', 'B', ...(available.has(`${prefix}A`) ? ['A'] : [])].map(c => prefix + c) };
      }
    }
    if (best < 0 && names.length) { selected = { part, channels: [names[0]] }; best = 0; }
  }
  return selected;
}
export function exrChannelGroups(part: ExrPart): Array<{ name: string; channels: string[] }> {
  const groups = new Map<string, string[]>();
  for (const { name } of part.channels) {
    const prefix = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '';
    const suffix = name.slice(name.lastIndexOf('.') + 1).toUpperCase();
    if (['R', 'G', 'B', 'A', 'X', 'Y', 'Z'].includes(suffix)) {
      groups.set(prefix, [...(groups.get(prefix) ?? []), name]);
    }
  }
  const names = new Set(part.channels.map(c => c.name));
  const result: Array<{ name: string; channels: string[] }> = [];
  for (const [prefix, channels] of groups) {
    const key = (suffix: string) => channels.find(c => c.slice(c.lastIndexOf('.') + 1).toUpperCase() === suffix);
    const rgb = ['R', 'G', 'B'].map(key);
    const xyz = ['X', 'Y', 'Z'].map(key);
    const selected = rgb.every(Boolean) ? [...rgb, key('A')].filter(Boolean) : xyz.every(Boolean) ? xyz : [];
    if (selected.length) result.push({ name: prefix || 'RGB', channels: selected as string[] });
  }
  result.sort((a, b) => Number(/^(beauty|rgba?|combined)$/i.test(b.name)) - Number(/^(beauty|rgba?|combined)$/i.test(a.name)));
  for (const name of names) result.push({ name, channels: [name] });
  return result;
}
