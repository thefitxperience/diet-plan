// System-UI i18n (plan §8): EN/AR dictionaries, dir switching, {var} interpolation.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import en from '../i18n/en.json'
import ar from '../i18n/ar.json'

const DICTS = { en, ar }
const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('nutrifit.lang') || 'en')

  useEffect(() => {
    localStorage.setItem('nutrifit.lang', lang)
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const value = useMemo(() => {
    const dict = DICTS[lang] || en
    const t = (key, vars) => {
      let s = dict[key] ?? en[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
      return s
    }
    return { lang, setLang, t, dir: lang === 'ar' ? 'rtl' : 'ltr' }
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
