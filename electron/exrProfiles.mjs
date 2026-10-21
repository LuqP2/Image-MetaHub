import path from 'node:path';
export const EXR_DEFAULT_PROFILE = Object.freeze({ config: 'ocio://cg-config-v2.2.0_aces-v1.3_ocio-v2.4', input: 'auto', display: '', view: '' });
export const EXR_DEFAULT_SETTINGS = Object.freeze({ enabled: false, global: EXR_DEFAULT_PROFILE, folders: {}, revision: 0 });
export const EXR_BUILTINS = new Set([EXR_DEFAULT_PROFILE.config, 'ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5']);
export function validateExrProfile(profile) {
  if (!profile || ['config', 'input', 'display', 'view'].some(k => typeof profile[k] !== 'string' || profile[k].length > 4096 || profile[k].includes('\0'))) throw new Error('Invalid EXR color profile');
  return Object.fromEntries(['config', 'input', 'display', 'view'].map(k => [k, profile[k]]));
}
export function resolveExrProfile(filePath, settings, pathAPI = path) {
  const normalize = value => {
    const result = pathAPI.resolve(value);
    return pathAPI === path.win32 || process.platform === 'win32' ? result.toLowerCase() : result;
  };
  const target = normalize(filePath);
  const folder = Object.keys(settings.folders).filter(root => {
    const relative = pathAPI.relative(normalize(root), target);
    return relative !== '..' && !relative.startsWith(`..${pathAPI.sep}`) && !pathAPI.isAbsolute(relative);
  }).sort((a, b) => b.length - a.length)[0];
  return folder ? settings.folders[folder] : settings.global;
}
