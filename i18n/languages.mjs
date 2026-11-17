export const languageNames = Object.freeze({
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  ja: '日本語',
  de: 'Deutsch',
  fr: 'Français',
  ko: '한국어',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
});

export const languages = Object.freeze(/** @type {(keyof typeof languageNames)[]} */ (Object.keys(languageNames)));
export const targetLanguages = Object.freeze(languages.filter((language) => language !== 'en'));

/** @param {unknown} language */
export function normalizeLanguage(language) {
  return typeof language === 'string' && Object.hasOwn(languageNames, language)
    ? /** @type {keyof typeof languageNames} */ (language)
    : 'en';
}
