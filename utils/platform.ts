export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/mac/i.test(navigator.platform || '') || /Mac OS X/i.test(navigator.userAgent || ''));
