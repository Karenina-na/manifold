import { useTranslation } from 'react-i18next'
import { changeLocale } from '../../i18n'
import { activeLocale } from '../../i18n/format'
import type { Locale } from '../../i18n/locale'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  return <label className={`language-switcher ${className}`.trim()}>
    <span className="sr-only">{t('language.label')}</span>
    <select aria-label={t('language.label')} value={locale} onChange={(event) => { void changeLocale(event.currentTarget.value as Locale) }}>
      <option value="en">{t('language.english')}</option>
      <option value="zh-CN">{t('language.chinese')}</option>
    </select>
  </label>
}
