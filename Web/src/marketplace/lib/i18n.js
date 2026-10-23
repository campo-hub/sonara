import en from '../i18n/en.json' with { type: 'json' };
import sw from '../i18n/sw.json' with { type: 'json' };

export const translations = Object.freeze({ en, sw });

export function getLanguage(storage = globalThis.localStorage) {
  try {
    return storage?.getItem('agristore.language') === 'sw' ? 'sw' : 'en';
  } catch {
    return 'en';
  }
}

export function translate(language, key) {
  return translations[language]?.[key] || translations.en[key] || key;
}

export function setLanguage(language, storage = globalThis.localStorage) {
  if (!Object.hasOwn(translations, language)) throw new TypeError('Unsupported language.');
  try {
    storage?.setItem('agristore.language', language);
  } catch {
    return language;
  }
  return language;
}
