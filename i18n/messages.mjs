import { IntlMessageFormat } from 'intl-messageformat';
import en from './en.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };
import ptBR from './pt-BR.json' with { type: 'json' };
import reviewed from './reviewed.json' with { type: 'json' };
import { argumentSignature } from './compatibility.mjs';
import { reviewHash } from './reviewHash.mjs';

export const languages = Object.freeze(['en', 'es', 'pt-BR']);
export const languageNames = Object.freeze({ en: 'English', es: 'Español', 'pt-BR': 'Português (Brasil)' });

/** @param {unknown} language */
export function normalizeLanguage(language) {
  return language === 'es' || language === 'pt-BR' ? language : 'en';
}

export function createMessageFormatter(catalogs, approvals) {
  const formatters = new Map();

  function getFormatter(locale, key, source) {
    const cacheKey = locale + ':' + key;
    if (formatters.has(cacheKey)) return formatters.get(cacheKey);
    const message = catalogs[locale]?.[key];
    let formatter;
    if (typeof message === 'string' && message.trim()) {
      try {
        if (locale === 'en' || (approvals[locale]?.[key] === reviewHash(source)
          && argumentSignature(source) === argumentSignature(message))) {
          formatter = new IntlMessageFormat(message, locale, undefined, { ignoreTag: true });
        }
      } catch (error) {
        if (locale === 'en') throw error;
      }
    }
    formatters.set(cacheKey, formatter);
    return formatter;
  }

  return (language, key, values) => {
    if (!Object.hasOwn(catalogs.en, key)) return key;
    const source = catalogs.en[key];
    const locale = normalizeLanguage(language);
    if (locale !== 'en') {
      const formatter = getFormatter(locale, key, source);
      if (formatter) return formatter.format(values);
    }
    return getFormatter('en', key, source).format(values);
  };
}

export const formatMessage = createMessageFormatter({ en, es, 'pt-BR': ptBR }, reviewed);
