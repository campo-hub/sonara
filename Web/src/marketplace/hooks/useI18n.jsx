import { createContext, useContext, useMemo, useState } from 'react';
import { getLanguage, setLanguage, translate } from '../lib/i18n.js';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [language, setCurrentLanguage] = useState(getLanguage);
  const value = useMemo(() => ({
    language,
    t: (key) => translate(language, key),
    changeLanguage: (next) => setCurrentLanguage(setLanguage(next))
  }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider.');
  return value;
}
