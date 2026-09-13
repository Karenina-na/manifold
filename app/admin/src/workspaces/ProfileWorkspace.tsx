import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Textarea, TextInput } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { Check, ChevronDown, ChevronUp, Eye, Plus, Save, Trash2, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { z } from 'zod'
import type { Profile } from '@manifold/contracts'
import {
  contactIconLabel,
  contactIconNode,
  getContactIcons,
  formatPeriod,
  parsePeriod,
  resolveContactKey,
} from '@manifold/render'
import { ApiError } from '@manifold/sdk'
import { createAdminClient } from '../lib/api'
import { ChipsInput } from '../components/forms/ChipsInput'
import { activeLocale } from '../i18n/format'
import { setDirtyGuard } from '../lib/dirty-guard'

function createProfileSchema(t: TFunction) {
  const max = (count: number) => t('validation.maxCharacters', { count })
  const optionalUrl = z.string().trim().max(500, max(500)).refine((value) => value === '' || /^https?:\/\//i.test(value), t('validation.httpUrl'))
  const contactUrl = z.string().trim().min(1, t('validation.requiredUrl')).max(500, max(500)).refine((value) => /^https?:\/\//i.test(value) || value.startsWith('mailto:'), t('validation.contactUrl'))
  const periodField = z.string().trim().min(1, t('validation.periodRequired')).max(80, max(80))

  return z.object({
    displayName: z.string().trim().min(1, t('validation.nameRequired')).max(160, max(160)),
    handle: z.string().max(80, max(80)),
    headline: z.string().max(240, max(240)),
    bio: z.string().max(4000, max(4000)),
    avatarUrl: optionalUrl,
    location: z.string().max(160, max(160)),
    organization: z.string().max(160, max(160)),
    websiteUrl: optionalUrl,
    resumeUrl: optionalUrl,
    interests: z.array(z.string().trim().min(1, t('validation.valueRequired')).max(60, max(60))),
    education: z.array(z.object({
      institution: z.string().trim().min(1, t('validation.institutionRequired')).max(160, max(160)),
      program: z.string().trim().min(1, t('validation.programRequired')).max(160, max(160)),
      period: periodField,
    })),
    experience: z.array(z.object({
      organization: z.string().trim().min(1, t('validation.organizationRequired')).max(160, max(160)),
      role: z.string().trim().min(1, t('validation.roleRequired')).max(160, max(160)),
      period: periodField,
    })),
    series: z.array(z.object({
      name: z.string().trim().min(1, t('validation.nameRequired')).max(160, max(160)),
      url: contactUrl,
      description: z.string().max(400, max(400)),
      category: z.string().max(80, max(80)),
    })),
    contacts: z.array(z.object({
      label: z.string().trim().min(1, t('validation.requiredLabel')).max(80, max(80)),
      url: contactUrl,
      handle: z.string().max(120, max(120)),
      icon: z.string().max(40, max(40)),
    })),
  })
}

type ProfileForm = z.infer<ReturnType<typeof createProfileSchema>>

const NAV_ITEMS = [
  { id: 'profile-identity', labelKey: 'profile.identity' },
  { id: 'profile-links', labelKey: 'profile.links' },
  { id: 'profile-interests', labelKey: 'profile.interests' },
  { id: 'profile-cv', labelKey: 'profile.cv' },
  { id: 'profile-series', labelKey: 'profile.series' },
  { id: 'profile-contact', labelKey: 'profile.contact' },
] as const

// Contact icons, resolveContactKey, and the picker vocabulary now live in
// @manifold/render (contact-icon.ts / contact-icon-ui.tsx) and are shared with
// the public renderer — keep the two surfaces in sync via that single source.

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
const PDF_ACCEPT = 'application/pdf'

function contactHint(contact: { icon?: string; label: string; url: string }, t: TFunction, locale: ReturnType<typeof activeLocale>) {
  const key = resolveContactKey(contact)
  if (key === 'globe') return t('profile.iconFallback')
  return t('profile.iconRenders', { icon: contactIconLabel(key, locale) })
}

function emptyProfileForm(): ProfileForm {
  return {
    displayName: '', handle: '', headline: '', bio: '', avatarUrl: '', location: '', organization: '',
    websiteUrl: '', resumeUrl: '', interests: [], education: [], experience: [], series: [], contacts: [],
  }
}

function canonicalPeriod(value: string): string {
  const parsed = parsePeriod(value)
  return parsed.legacy ? value : formatPeriod(parsed.start, parsed.end)
}

function profileValues(profile: Profile): ProfileForm {
  return {
    displayName: profile.displayName, handle: profile.handle, headline: profile.headline, bio: profile.bio,
    avatarUrl: profile.avatarUrl, location: profile.location, organization: profile.organization,
    websiteUrl: profile.websiteUrl, resumeUrl: profile.resumeUrl ?? '',
    interests: profile.interests ?? [],
    education: (profile.education ?? []).map((item) => ({ institution: item.institution ?? '', program: item.program ?? '', period: canonicalPeriod(item.period ?? '') })),
    experience: (profile.experience ?? []).map((item) => ({ organization: item.organization ?? '', role: item.role ?? '', period: canonicalPeriod(item.period ?? '') })),
    series: (profile.series ?? []).map((item) => ({ name: item.name ?? '', url: item.url ?? '', description: item.description ?? '', category: item.category ?? '' })),
    contacts: (profile.contacts ?? []).map((item) => ({ label: item.label ?? '', url: item.url ?? '', handle: item.handle ?? '', icon: item.icon ?? '' })),
  }
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function ListRowActions({ index, count, move, remove }: { index: number; count: number; move: (from: number, to: number) => void; remove: (index: number) => void }) {
  const { t } = useTranslation()
  return <div className="list-row-actions">
    <button type="button" className="mini-button" aria-label={t('common.moveUp')} disabled={index === 0} onClick={() => move(index, index - 1)}><ChevronUp size={14} /></button>
    <button type="button" className="mini-button" aria-label={t('common.moveDown')} disabled={index === count - 1} onClick={() => move(index, index + 1)}><ChevronDown size={14} /></button>
    <button type="button" className="mini-button danger" aria-label={t('common.remove')} onClick={() => remove(index)}><Trash2 size={14} /></button>
  </div>
}

function ContactsEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const contactIcons = getContactIcons(locale)
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'contacts' })
  const contacts = form.watch('contacts')
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  return <div className="list-stack">
    {fields.map((field, index) => {
      const contact = contacts[index] ?? { label: '', url: '', handle: '', icon: '' }
      return <div className="list-row" key={field.id}>
        <div className="list-row-top contact-row">
          <button type="button" className="icon-cell" aria-label={t('profile.chooseIcon')} onClick={() => setPickerFor(pickerFor === field.id ? null : field.id)}>{contactIconNode(resolveContactKey(contact))}</button>
          <div className="list-row-fields">
            <TextInput placeholder={t('profile.label')} {...form.register(`contacts.${index}.label`)} error={form.formState.errors.contacts?.[index]?.label?.message} />
            <TextInput placeholder={t('profile.url')} {...form.register(`contacts.${index}.url`)} error={form.formState.errors.contacts?.[index]?.url?.message} />
            <TextInput placeholder={t('profile.handle')} {...form.register(`contacts.${index}.handle`)} />
          </div>
          <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
        </div>
        {pickerFor === field.id && <div className="icon-picker">
          {contactIcons.map((option) => <button
            key={option.key || 'globe'}
            type="button"
            className={contact.icon === option.key ? 'icon-option active' : 'icon-option'}
            title={option.label}
            aria-label={option.label}
            onClick={() => { form.setValue(`contacts.${index}.icon`, option.key, { shouldDirty: true }); setPickerFor(null) }}
          >{contactIconNode(option.key)}</button>)}
        </div>}
        <p className="icon-hint">{contactHint(contact, t, locale)}</p>
      </div>
    })}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => { append({ label: '', url: '', handle: '', icon: '' }); setPickerFor(null) }}>{t('profile.addLink')}</Button>
  </div>
}

function SeriesEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { t } = useTranslation()
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'series' })
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top series-row">
        <span className="list-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="list-row-fields">
          <TextInput placeholder={t('profile.name')} {...form.register(`series.${index}.name`)} error={form.formState.errors.series?.[index]?.name?.message} />
          <TextInput placeholder={t('profile.url')} {...form.register(`series.${index}.url`)} error={form.formState.errors.series?.[index]?.url?.message} />
          <TextInput placeholder={t('profile.category')} {...form.register(`series.${index}.category`)} />
          <Textarea placeholder={t('profile.description')} minRows={2} className="field-full" {...form.register(`series.${index}.description`)} />
        </div>
        <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => append({ name: '', url: '', description: '', category: '' })}>{t('profile.addSeries')}</Button>
  </div>
}

type PeriodPath = `education.${number}.period` | `experience.${number}.period`

// MonthPickerInput needs Date values; the existing model stores a plain text
// range. Keep its open-ended token canonical via formatPeriod's default locale,
// then localize only the preview label so changing the UI locale never mutates
// the value sent to Core.

function monthDate(value: string): Date | null {
  if (!value) return null
  const [year, month] = value.split('-')
  if (!year) return null
  return new Date(Number(year), (month ? Number(month) : 1) - 1, 1)
}

function toMonth(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 7)
}

function periodLabel(value: string, locale: ReturnType<typeof activeLocale>): string {
  const parsed = parsePeriod(value)
  return parsed.legacy ? value : formatPeriod(parsed.start, parsed.end, locale)
}

function PeriodEditor({ form, path }: { form: UseFormReturn<ProfileForm>; path: PeriodPath }) {
  const { t } = useTranslation()
  const raw = (form.watch(path) ?? '') as string
  const parsed = parsePeriod(raw)
  const [manual, setManual] = useState(false)
  const error = form.getFieldState(path).error?.message
  const now = new Date()
  const startDate = monthDate(parsed.start)
  const endDate = parsed.end ? monthDate(parsed.end) : null
  // Empty end while a start is set means an open-ended "… - Now" period.
  const isNow = Boolean(parsed.start) && !parsed.end
  const setFrom = (value: string | null) => {
    if (!value) { form.setValue(path, '', { shouldDirty: true, shouldValidate: true }); return }
    form.setValue(path, formatPeriod(toMonth(value), parsed.end), { shouldDirty: true, shouldValidate: true })
  }
  const setTo = (value: string | null) => {
    form.setValue(path, formatPeriod(parsed.start, toMonth(value)), { shouldDirty: true, shouldValidate: true })
  }
  if (parsed.legacy && !manual) {
    return <div className="period-editor" data-period-editor>
      <div className="period-static">
        <span className="period-static-text">{raw || t('profile.period')}</span>
        <button type="button" className="mini-button" aria-label={t('profile.editPeriod')} onClick={() => { setManual(true); form.setValue(path, '', { shouldDirty: true }) }}>{t('profile.edit')}</button>
      </div>
      <p className="icon-hint">{t('profile.legacyPeriod')}</p>
    </div>
  }
  return <div className="period-editor" data-period-editor>
    <div className="period-inputs">
      <MonthPickerInput
        aria-label={t('profile.from')}
        placeholder={t('profile.startMonth')}
        value={startDate}
        onChange={setFrom}
        maxDate={now}
        valueFormat="YYYY-MM"
        clearable
        popoverProps={{ withinPortal: true, position: 'bottom-start' }}
      />
      <span className="period-sep">–</span>
      <MonthPickerInput
        aria-label={t('profile.to')}
        placeholder={isNow ? t('profile.now') : t('profile.endMonth')}
        value={endDate}
        onChange={setTo}
        maxDate={now}
        valueFormat="YYYY-MM"
        clearable
        popoverProps={{ withinPortal: true, position: 'bottom-start' }}
      />
    </div>
    <p className="icon-hint">{isNow ? t('profile.openEnded') : t('profile.leaveEmpty')}</p>
    {parsed.legacy && <button type="button" className="mini-button period-clear" aria-label={t('profile.clearPeriod')} onClick={() => { setManual(false); form.setValue(path, '', { shouldDirty: true }) }}>{t('common.remove')}</button>}
    {error && <p className="icon-hint">{error}</p>}
  </div>
}

function EducationEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { t } = useTranslation()
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'education' })
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top">
        <div className="list-row-fields">
          <TextInput placeholder={t('profile.institution')} {...form.register(`education.${index}.institution`)} error={form.formState.errors.education?.[index]?.institution?.message} />
          <TextInput placeholder={t('profile.program')} {...form.register(`education.${index}.program`)} error={form.formState.errors.education?.[index]?.program?.message} />
          <PeriodEditor form={form} path={`education.${index}.period`} />
        </div>
        <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => append({ institution: '', program: '', period: '' })}>{t('profile.addEducation')}</Button>
  </div>
}

function ExperienceEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { t } = useTranslation()
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'experience' })
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top">
        <div className="list-row-fields">
          <TextInput placeholder={t('profile.organization')} {...form.register(`experience.${index}.organization`)} error={form.formState.errors.experience?.[index]?.organization?.message} />
          <TextInput placeholder={t('profile.role')} {...form.register(`experience.${index}.role`)} error={form.formState.errors.experience?.[index]?.role?.message} />
          <PeriodEditor form={form} path={`experience.${index}.period`} />
        </div>
        <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => append({ organization: '', role: '', period: '' })}>{t('profile.addExperience')}</Button>
  </div>
}

function AvatarField({ form, client }: { form: UseFormReturn<ProfileForm>; client: ReturnType<typeof createAdminClient> }) {
  const { t } = useTranslation()
  const value = form.watch('avatarUrl') ?? ''
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadTimer = useRef<number | null>(null)
  useEffect(() => () => { if (uploadTimer.current) window.clearTimeout(uploadTimer.current) }, [])
  const upload = async (file: File) => {
    const media = await client.uploadMedia(file, `avatar.${file.name.split('.').pop() ?? 'png'}`)
    form.setValue('avatarUrl', media.url, { shouldDirty: true, shouldValidate: true })
    setUploaded(true)
    if (uploadTimer.current) window.clearTimeout(uploadTimer.current)
    uploadTimer.current = window.setTimeout(() => setUploaded(false), 2400)
  }
  return <div className="avatar-field">
    <div className="avatar-field-input">
      <TextInput label={t('profile.avatarUrl')} value={value} onChange={(event) => form.setValue('avatarUrl', event.currentTarget.value, { shouldDirty: true })} error={form.formState.errors.avatarUrl?.message ?? uploadError ?? undefined} />
      <div className="upload-actions">
        <Button variant="default" size="compact-sm" loading={uploading} disabled={uploading} leftSection={<UploadCloud size={14} />} onClick={() => inputRef.current?.click()}>{t('common.upload')}</Button>
        {value && <Button variant="subtle" size="compact-sm" aria-label={t('profile.previewAvatar')} onClick={() => window.open(value, '_blank', 'noopener')} leftSection={<Eye size={14} />}>{t('common.preview')}</Button>}
        {uploaded && <span className="upload-hint ok">{t('common.uploaded')}</span>}
      </div>
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return; if (!IMAGE_TYPES.has(file.type)) { setUploadError(t('profile.imageTypes')); return } setUploading(true); setUploadError(null); upload(file).catch((err) => setUploadError(err instanceof ApiError ? err.message : t('profile.avatarUploadError'))).finally(() => setUploading(false)) }} />
    </div>
    {value
      ? <img key={value} className="avatar-thumb" src={value} alt={t('profile.avatarPreview')} onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />
      : <span className="avatar-thumb avatar-thumb-empty">{(form.watch('displayName') || 'M').slice(0, 1).toUpperCase()}</span>}
  </div>
}

function ResumeField({ form, client }: { form: UseFormReturn<ProfileForm>; client: ReturnType<typeof createAdminClient> }) {
  const { t } = useTranslation()
  const value = form.watch('resumeUrl') ?? ''
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadTimer = useRef<number | null>(null)
  useEffect(() => () => { if (uploadTimer.current) window.clearTimeout(uploadTimer.current) }, [])
  const upload = async (file: File) => {
    const media = await client.uploadMedia(file, `resume.${file.name.split('.').pop() ?? 'pdf'}`)
    form.setValue('resumeUrl', media.url, { shouldDirty: true, shouldValidate: true })
    setUploaded(true)
    if (uploadTimer.current) window.clearTimeout(uploadTimer.current)
    uploadTimer.current = window.setTimeout(() => setUploaded(false), 2400)
  }
  return <div>
    <TextInput label={t('profile.resumeUrl')} description={t('profile.resumeDescription')} value={value} onChange={(event) => form.setValue('resumeUrl', event.currentTarget.value, { shouldDirty: true })} error={form.formState.errors.resumeUrl?.message ?? uploadError ?? undefined} />
    <div className="upload-actions">
      <Button variant="default" size="compact-sm" loading={uploading} disabled={uploading} leftSection={<UploadCloud size={14} />} onClick={() => inputRef.current?.click()}>{t('common.upload')}</Button>
      {value && <Button variant="subtle" size="compact-sm" aria-label={t('profile.previewResume')} onClick={() => window.open(value, '_blank', 'noopener')} leftSection={<Eye size={14} />}>{t('common.preview')}</Button>}
      {uploaded && <span className="upload-hint ok">{t('common.uploaded')}</span>}
    </div>
    <input ref={inputRef} type="file" accept={PDF_ACCEPT} hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return; if (file.type !== 'application/pdf') { setUploadError(t('profile.pdfOnly')); return } setUploading(true); setUploadError(null); upload(file).catch((err) => setUploadError(err instanceof ApiError ? err.message : t('profile.resumeUploadError'))).finally(() => setUploading(false)) }} />
  </div>
}

type PreviewSectionId = 'profile-identity' | 'profile-links' | 'profile-interests' | 'profile-cv' | 'profile-series' | 'profile-contact'

const PREVIEW_TITLE_KEYS: Record<PreviewSectionId, string> = {
  'profile-identity': 'profile.introduction',
  'profile-links': 'profile.websiteResume',
  'profile-interests': 'profile.interests',
  'profile-cv': 'profile.background',
  'profile-series': 'profile.mySeries',
  'profile-contact': 'profile.contact',
}

function PreviewBlock({ section, values }: { section: PreviewSectionId; values: ProfileForm }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const initials = (values.displayName || 'M').slice(0, 1).toUpperCase()
  const contactLinks = [
    ...(values.websiteUrl ? [{ label: t('profile.website'), url: values.websiteUrl, icon: 'globe' }] : []),
    ...values.contacts,
  ]
  switch (section) {
    case 'profile-identity':
      return <div className="preview-block first">
        <div className="preview-id">
          {values.avatarUrl
            ? <img key={values.avatarUrl} className="preview-avatar" src={values.avatarUrl} alt={t('profile.avatarPreview')} onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />
            : <span className="preview-avatar preview-initials">{initials}</span>}
          <div><strong>{values.displayName || t('profile.yourName')}</strong><p>{values.headline || t('profile.headline')}</p></div>
        </div>
        {values.organization && <p className="preview-org">{values.organization}</p>}
        {values.bio && <p className="preview-bio">{values.bio}</p>}
        {!!values.interests.length && <div className="preview-interests">{values.interests.map((interest) => <span key={interest}>#{interest}</span>)}</div>}
      </div>
    case 'profile-links':
      return <div className="preview-block first">
        {values.websiteUrl
          ? <p className="preview-line"><span>WEB</span><strong>{t('profile.website')}</strong><em>{values.websiteUrl.replace(/^https?:\/\//, '')}</em></p>
          : <p className="preview-muted">{t('profile.noWebsite')}</p>}
        {values.resumeUrl
          ? <p className="preview-line"><span>CV</span><strong>{t('profile.resume')}</strong><em>{t('profile.pdfDownload')}</em></p>
          : <p className="preview-muted">{t('profile.noResume')}</p>}
      </div>
    case 'profile-interests':
      return <div className="preview-block first">
        {values.interests.length
          ? <div className="preview-interests">{values.interests.map((interest) => <span key={interest}>#{interest}</span>)}</div>
          : <p className="preview-muted">{t('profile.noInterests')}</p>}
      </div>
    case 'profile-cv':
      return <div className="preview-block first">
        {values.education.length > 0 || values.experience.length > 0
          ? <div className="preview-block">
            {values.education.map((item, index) => <p className="preview-line" key={`education-${index}`}><span>{periodLabel(item.period, locale)}</span><strong>{item.program}</strong><em>{item.institution}</em></p>)}
            {values.experience.map((item, index) => <p className="preview-line" key={`experience-${index}`}><span>{periodLabel(item.period, locale)}</span><strong>{item.role}</strong><em>{item.organization}</em></p>)}
          </div>
          : <p className="preview-muted">{t('profile.noBackground')}</p>}
      </div>
    case 'profile-series':
      return <div className="preview-block first">
        {values.series.length
          ? <div className="preview-block">
            {values.series.map((item, index) => <p className="preview-line" key={`series-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.name}</strong><em>{item.category}</em></p>)}
          </div>
          : <p className="preview-muted">{t('profile.noSeries')}</p>}
      </div>
    case 'profile-contact':
      return <div className="preview-block first">
        <div className="preview-icons">
          {contactLinks.map((contact, index) => <span key={`${contact.url}-${index}`} title={contact.label}>{contactIconNode(resolveContactKey(contact))}</span>)}
        </div>
        {!contactLinks.length && <p className="preview-muted">{t('profile.noPublicLinks')}</p>}
        {values.location && <p className="preview-muted">{t('profile.locationPreview', { location: values.location.split(',')[0].trim() })}</p>}
      </div>
  }
}

function ProfilePreview({ values, section }: { values: ProfileForm; section: PreviewSectionId }) {
  const { t } = useTranslation()
  return <aside className="profile-preview">
    <div className="panel">
      <div className="panel-heading"><div><p className="kicker">{t('profile.preview')}</p><h2>{t(PREVIEW_TITLE_KEYS[section])}</h2></div></div>
      <div className="preview-card" data-preview-card data-preview-section={section}>
        <PreviewBlock section={section} values={values} />
      </div>
    </div>
  </aside>
}

export function ProfileWorkspace({ token }: { token: string }) {
  const { t } = useTranslation()
  const profileSchema = useMemo(() => createProfileSchema(t), [t])
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['admin-profile'], queryFn: () => client.adminProfile() })
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)
  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: emptyProfileForm() })
  useEffect(() => { if (profile.data) profileForm.reset(profileValues(profile.data)) }, [profile.data, profileForm])
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current) }, [])
  const dirtyRef = useRef(false)
  dirtyRef.current = profileForm.formState.isDirty
  useEffect(() => {
    setDirtyGuard(() => dirtyRef.current)
    return () => setDirtyGuard(null)
  }, [])
  const saveProfile = useMutation({
    mutationFn: (input: ProfileForm) => client.updateProfile(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-profile'] })
      setSavedFlash(true)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2400)
    },
  })
  const watched = profileForm.watch()
  const discard = () => { if (profile.data) profileForm.reset(profileValues(profile.data)) }
  // Track which form section is in view so the sticky preview shows only the
  // matching slice (the full preview grows too tall once Background fills up).
  const [activeSection, setActiveSection] = useState<PreviewSectionId>('profile-identity')
  useEffect(() => {
    const sections: PreviewSectionId[] = ['profile-identity', 'profile-links', 'profile-interests', 'profile-cv', 'profile-series', 'profile-contact']
    const visible = new Set<PreviewSectionId>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id as PreviewSectionId)
        else visible.delete(entry.target.id as PreviewSectionId)
      }
      // Prefer the first visible section from the top of the list so the
      // preview tracks the current edit context as the page scrolls.
      setActiveSection((previous) => sections.find((id) => visible.has(id)) ?? previous)
    }, { rootMargin: '-10% 0px -55% 0px', threshold: 0 })
    for (const id of sections) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">{t('profile.pageKicker')}</p><h1>{t('profile.pageTitle')}</h1><p className="subheading">{t('profile.pageCopy')}</p></div></div>
    {profile.isError && <Alert color="red" variant="light">{t('profile.loadError')}</Alert>}
    {saveProfile.isError && <Alert color="red" variant="light">{t('profile.saveError')}</Alert>}
    <div className="profile-layout">
      <nav className="profile-nav" aria-label={t('profile.sectionsAria')}>
        {NAV_ITEMS.map((item) => <button key={item.id} type="button" className="profile-nav-link" onClick={() => scrollToSection(item.id)}>{t(item.labelKey)}</button>)}
      </nav>
      <div className="profile-forms">
        <form id="profile-form" noValidate onSubmit={profileForm.handleSubmit((input) => saveProfile.mutate(input))}>
          <section className="panel" id="profile-identity">
            <div className="panel-heading"><div><p className="kicker">{t('profile.identity')}</p><h2>{t('profile.introduction')}</h2></div></div>
            <div className="form-stack">
              <TextInput label={t('profile.displayName')} {...profileForm.register('displayName')} error={profileForm.formState.errors.displayName?.message} />
              <div className="form-grid">
                <TextInput label={t('profile.handle')} {...profileForm.register('handle')} />
                <TextInput label={t('profile.location')} {...profileForm.register('location')} />
              </div>
              <TextInput label={t('profile.headline')} description={`${watched.headline.length}/240`} {...profileForm.register('headline')} error={profileForm.formState.errors.headline?.message} />
              <Textarea label={t('profile.bio')} description={`${watched.bio.length}/4000`} minRows={4} {...profileForm.register('bio')} error={profileForm.formState.errors.bio?.message} />
              <TextInput label={t('profile.organization')} description={t('profile.organizationDescription')} {...profileForm.register('organization')} />
              <AvatarField form={profileForm} client={client} />
            </div>
          </section>
          <section className="panel" id="profile-links">
            <div className="panel-heading"><div><p className="kicker">{t('profile.links')}</p><h2>{t('profile.websiteResume')}</h2></div></div>
            <div className="form-stack">
              <div className="form-grid">
                <TextInput label={t('profile.websiteUrl')} {...profileForm.register('websiteUrl')} error={profileForm.formState.errors.websiteUrl?.message} />
                <ResumeField form={profileForm} client={client} />
              </div>
            </div>
          </section>
          <section className="panel" id="profile-interests">
            <div className="panel-heading"><div><p className="kicker">{t('profile.interests')}</p><h2>{t('profile.interests')}</h2></div></div>
            <div className="form-stack">
              <div><label>{t('profile.tags')}</label><ChipsInput value={watched.interests} onChange={(next) => profileForm.setValue('interests', next, { shouldDirty: true })} placeholder={t('profile.addInterest')} /></div>
              <p className="icon-hint">{t('profile.tagsHint')}</p>
            </div>
          </section>
          <section className="panel" id="profile-cv">
            <div className="panel-heading"><div><p className="kicker">{t('profile.cv')}</p><h2>{t('profile.educationExperience')}</h2></div><span className="count-badge">{t('profile.backgroundSection')}</span></div>
            <div className="form-stack">
              <div><label>{t('profile.education')}</label><EducationEditor form={profileForm} /></div>
              <div><label>{t('profile.experience')}</label><ExperienceEditor form={profileForm} /></div>
            </div>
          </section>
          <section className="panel" id="profile-series">
            <div className="panel-heading"><div><p className="kicker">{t('profile.series')}</p><h2>{t('profile.mySeries')}</h2></div><span className="count-badge">{t('common.count.cards', { count: watched.series.length })}</span></div>
            <div className="form-stack"><SeriesEditor form={profileForm} /></div>
          </section>
          <section className="panel" id="profile-contact">
            <div className="panel-heading"><div><p className="kicker">{t('profile.contact')}</p><h2>{t('profile.contactLinks')}</h2></div><span className="count-badge">{t('common.count.links', { count: watched.contacts.length })}</span></div>
            <div className="form-stack"><ContactsEditor form={profileForm} /></div>
          </section>
        </form>
      </div>
      <ProfilePreview values={watched} section={activeSection} />
    </div>
    {profileForm.formState.isDirty && <div className="save-bar">
      <span>{t('common.unsavedChanges')}</span>
      <div className="save-bar-actions">
        <Button variant="default" onClick={discard}>{t('common.discard')}</Button>
        <Button className="button button-primary" type="submit" form="profile-form" loading={saveProfile.isPending} leftSection={savedFlash ? <Check size={16} /> : <Save size={16} />}>{savedFlash ? t('common.saved') : t('profile.saveProfile')}</Button>
      </div>
    </div>}
  </section>
}

export default ProfileWorkspace
