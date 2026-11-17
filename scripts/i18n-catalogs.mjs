import { readFileSync } from 'node:fs';
import { argumentSignature } from '../i18n/compatibility.mjs';
import { reviewHash } from '../i18n/reviewHash.mjs';

export { reviewHash };

export const targetLanguages = ['es', 'pt-BR'];
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function diffCatalog(base, current) {
  return {
    added: Object.keys(current).filter((key) => !Object.hasOwn(base, key)),
    changed: Object.keys(current).filter((key) => Object.hasOwn(base, key) && current[key] !== base[key]),
    removed: Object.keys(base).filter((key) => !Object.hasOwn(current, key)),
  };
}

export function pendingTranslations(source, catalogs, reviewed, coverage) {
  return Object.keys(source)
    .filter((key) => typeof source[key] === 'string' && Object.hasOwn(coverage, key.split('.')[0]))
    .flatMap((key) => {
      const hash = reviewHash(source[key]);
      return targetLanguages
        .filter((locale) => !catalogs[locale]?.[key] || reviewed[locale]?.[key] !== hash)
        .map((locale) => ({ key, locale, hash, english: source[key] }));
    });
}

export function validateCatalogs(source, catalogs, reviewed, coverage, baseCoverage) {
  const errors = [];
  const signatures = new Map();
  for (const [key, message] of Object.entries(source)) {
    try {
      if (typeof message !== 'string' || !message.trim()) throw new Error('Expected a nonempty message');
      if (!Object.hasOwn(coverage, key.split('.')[0])) throw new Error('Missing coverage entry for module');
      signatures.set(key, argumentSignature(message));
    } catch (error) {
      errors.push(`en ${key}: ${error.message}`);
    }
  }

  for (const locale of targetLanguages) {
    const translations = catalogs[locale];
    const approvals = reviewed[locale];
    for (const [key, translation] of Object.entries(translations)) {
      try {
        if (!Object.hasOwn(source, key)) throw new Error('Orphaned translation');
        if (typeof translation !== 'string' || !translation.trim()) throw new Error('Expected a nonempty message');
        if (!/^[a-f0-9]{64}$/.test(approvals[key] ?? '')) throw new Error('Missing review hash');
        if (argumentSignature(translation) !== signatures.get(key) && approvals[key] === reviewHash(source[key])) {
          throw new Error('ICU arguments differ from the approved English message');
        }
      } catch (error) {
        errors.push(`${locale} ${key}: ${error.message}`);
      }
    }
    for (const key of Object.keys(approvals)) {
      if (!Object.hasOwn(translations, key)) errors.push(`${locale} ${key}: Orphaned review hash`);
    }
  }

  for (const entry of pendingTranslations(source, catalogs, reviewed, coverage)) {
    if (!Object.hasOwn(baseCoverage, entry.key.split('.')[0])) {
      errors.push(`${entry.locale} ${entry.key}: Initial migration requires an approved translation`);
    }
  }
  return errors;
}
