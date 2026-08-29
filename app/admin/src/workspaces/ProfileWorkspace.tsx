import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Textarea, TextInput } from '@mantine/core'
import { AtSign, Check, ChevronDown, ChevronUp, Flame, GitBranch, Globe2, Mail, MessageCircle, Plus, Podcast, Radio, Rss, Save, Send, Trash2, Tv, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import type { Profile } from '@manifold/contracts'
import { createAdminClient } from '../api'

const optionalUrl = z.string().trim().max(500).refine((value) => value === '' || /^https?:\/\//i.test(value), 'Use an http(s) URL')
const contactUrl = z.string().trim().min(1, 'URL is required').max(500).refine((value) => /^https?:\/\//i.test(value) || value.startsWith('mailto:'), 'Use an http(s) or mailto URL')
const periodField = z.string().trim().min(1, 'Period is required').max(80)

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  handle: z.string().max(80),
  headline: z.string().max(240),
  bio: z.string().max(4000),
  avatarUrl: optionalUrl,
  location: z.string().max(160),
  organization: z.string().max(160),
  websiteUrl: optionalUrl,
  resumeUrl: optionalUrl,
  interests: z.array(z.string().trim().min(1).max(60)),
  education: z.array(z.object({
    institution: z.string().trim().min(1, 'Institution is required').max(160),
    program: z.string().trim().min(1, 'Program is required').max(160),
    period: periodField,
  })),
  experience: z.array(z.object({
    organization: z.string().trim().min(1, 'Organization is required').max(160),
    role: z.string().trim().min(1, 'Role is required').max(160),
    period: periodField,
  })),
  series: z.array(z.object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    url: contactUrl,
    description: z.string().max(400),
    category: z.string().max(80),
  })),
  contacts: z.array(z.object({
    label: z.string().trim().min(1, 'Label is required').max(80),
    url: contactUrl,
    handle: z.string().max(120),
    icon: z.string().max(40),
  })),
})

type ProfileForm = z.infer<typeof profileSchema>

const NAV_ITEMS = [
  { id: 'profile-identity', label: 'Identity' },
  { id: 'profile-links', label: 'Links' },
  { id: 'profile-interests', label: 'Interests' },
  { id: 'profile-cv', label: 'CV' },
  { id: 'profile-series', label: 'Series' },
  { id: 'profile-contact', label: 'Contact' },
]

const CONTACT_ICON_OPTIONS = [
  { key: 'github', label: 'GitHub' },
  { key: 'x', label: 'X / Twitter' },
  { key: 'mail', label: 'Email' },
  { key: 'rss', label: 'RSS' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'podcast', label: 'Podcast' },
  { key: 'tv', label: 'YouTube / TV' },
  { key: 'flame', label: 'Bilibili' },
  { key: 'message', label: 'Messaging' },
  { key: 'at', label: 'Handle' },
  { key: 'radio', label: 'Radio' },
  { key: '', label: 'Globe (fallback)' },
]

const CONTACT_ICON_LABELS: Record<string, string> = {
  github: 'GitHub', x: 'X', mail: 'Email', rss: 'RSS', telegram: 'Telegram', podcast: 'Podcast',
  tv: 'YouTube', flame: 'Bilibili', message: 'Message', at: 'Handle', radio: 'Radio',
}

function contactIconNode(key: string) {
  switch (key) {
    case 'github': return <GitBranch size={16} />
    case 'x': return <X size={16} />
    case 'mail': return <Mail size={16} />
    case 'rss': return <Rss size={16} />
    case 'telegram': return <Send size={16} />
    case 'podcast': return <Podcast size={16} />
    case 'tv': return <Tv size={16} />
    case 'flame': return <Flame size={16} />
    case 'message': return <MessageCircle size={16} />
    case 'at': return <AtSign size={16} />
    case 'radio': return <Radio size={16} />
    default: return <Globe2 size={16} />
  }
}

// Mirrors the public renderer in app/web/components/profile-surfaces.tsx —
// keep both heuristics in sync (see docs/admin.md).
function resolveContactKey(contact: { icon?: string; label: string; url: string }): string {
  const icon = contact.icon?.toLowerCase().trim() ?? ''
  const label = contact.label.toLowerCase()
  const url = contact.url.toLowerCase()
  if (icon === 'x' || icon === 'twitter' || label === 'x' || label.includes('twitter')) return 'x'
  if (icon === 'rss' || label.includes('rss') || url.endsWith('/feed.xml')) return 'rss'
  if (icon === 'mail' || label.includes('mail') || label.includes('email')) return 'mail'
  if (icon === 'github' || label.includes('github') || url.includes('github')) return 'github'
  if (icon === 'flame' || label.includes('flame') || label.includes('bilibili')) return 'flame'
  if (icon === 'tv' || label.includes('youtube') || label.includes('tv')) return 'tv'
  if (icon === 'telegram' || label.includes('telegram')) return 'telegram'
  if (icon === 'podcast' || label.includes('podcast')) return 'podcast'
  if (icon === 'message' || label.includes('whats') || label.includes('message')) return 'message'
  if (icon === 'at' || label.includes('handle')) return 'at'
  if (icon === 'radio') return 'radio'
  return 'globe'
}

function contactHint(contact: { icon?: string; label: string; url: string }) {
  const key = resolveContactKey(contact)
  if (key === 'globe') return 'Falls back to the globe icon — pick an icon or adjust the label.'
  return `Renders as ${CONTACT_ICON_LABELS[key]} on the homepage.`
}

function emptyProfileForm(): ProfileForm {
  return {
    displayName: '', handle: '', headline: '', bio: '', avatarUrl: '', location: '', organization: '',
    websiteUrl: '', resumeUrl: '', interests: [], education: [], experience: [], series: [], contacts: [],
  }
}

function profileValues(profile: Profile): ProfileForm {
  return {
    displayName: profile.displayName, handle: profile.handle, headline: profile.headline, bio: profile.bio,
    avatarUrl: profile.avatarUrl, location: profile.location, organization: profile.organization,
    websiteUrl: profile.websiteUrl, resumeUrl: profile.resumeUrl ?? '',
    interests: profile.interests ?? [],
    education: (profile.education ?? []).map((item) => ({ institution: item.institution ?? '', program: item.program ?? '', period: item.period ?? '' })),
    experience: (profile.experience ?? []).map((item) => ({ organization: item.organization ?? '', role: item.role ?? '', period: item.period ?? '' })),
    series: (profile.series ?? []).map((item) => ({ name: item.name ?? '', url: item.url ?? '', description: item.description ?? '', category: item.category ?? '' })),
    contacts: (profile.contacts ?? []).map((item) => ({ label: item.label ?? '', url: item.url ?? '', handle: item.handle ?? '', icon: item.icon ?? '' })),
  }
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function ListRowActions({ index, count, move, remove }: { index: number; count: number; move: (from: number, to: number) => void; remove: (index: number) => void }) {
  return <div className="list-row-actions">
    <button type="button" className="mini-button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}><ChevronUp size={14} /></button>
    <button type="button" className="mini-button" aria-label="Move down" disabled={index === count - 1} onClick={() => move(index, index + 1)}><ChevronDown size={14} /></button>
    <button type="button" className="mini-button danger" aria-label="Remove" onClick={() => remove(index)}><Trash2 size={14} /></button>
  </div>
}

function ChipsInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (!value.includes(trimmed)) onChange([...value, trimmed])
    setDraft('')
  }
  return <div className="chips-row">
    {value.map((chip) => <span className="chip" key={chip}>{chip}<button type="button" aria-label={`Remove ${chip}`} onClick={() => onChange(value.filter((item) => item !== chip))}>×</button></span>)}
    <input
      className="chip-input"
      value={draft}
      placeholder="Add interest and press Enter"
      onChange={(event) => {
        if (event.target.value.endsWith(',')) {
          setDraft(event.target.value.slice(0, -1))
          commit()
          return
        }
        setDraft(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Backspace' && !draft && value.length) {
          onChange(value.slice(0, -1))
        }
      }}
      onBlur={commit}
    />
  </div>
}

function ContactsEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'contacts' })
  const contacts = form.watch('contacts')
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  return <div className="list-stack">
    {fields.map((field, index) => {
      const contact = contacts[index] ?? { label: '', url: '', handle: '', icon: '' }
      return <div className="list-row" key={field.id}>
        <div className="list-row-top contact-row">
          <button type="button" className="icon-cell" aria-label="Choose icon" onClick={() => setPickerFor(pickerFor === field.id ? null : field.id)}>{contactIconNode(resolveContactKey(contact))}</button>
          <div className="list-row-fields">
            <TextInput placeholder="Label" {...form.register(`contacts.${index}.label`)} error={form.formState.errors.contacts?.[index]?.label?.message} />
            <TextInput placeholder="URL" {...form.register(`contacts.${index}.url`)} error={form.formState.errors.contacts?.[index]?.url?.message} />
            <TextInput placeholder="Handle" {...form.register(`contacts.${index}.handle`)} />
          </div>
          <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
        </div>
        {pickerFor === field.id && <div className="icon-picker">
          {CONTACT_ICON_OPTIONS.map((option) => <button
            key={option.key || 'globe'}
            type="button"
            className={contact.icon === option.key ? 'icon-option active' : 'icon-option'}
            title={option.label}
            aria-label={option.label}
            onClick={() => { form.setValue(`contacts.${index}.icon`, option.key, { shouldDirty: true }); setPickerFor(null) }}
          >{contactIconNode(option.key)}</button>)}
        </div>}
        <p className="icon-hint">{contactHint(contact)}</p>
      </div>
    })}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => { append({ label: '', url: '', handle: '', icon: '' }); setPickerFor(null) }}>Add link</Button>
  </div>
}

function SeriesEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'series' })
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top series-row">
        <span className="list-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="list-row-fields">
          <TextInput placeholder="Name" {...form.register(`series.${index}.name`)} error={form.formState.errors.series?.[index]?.name?.message} />
          <TextInput placeholder="URL" {...form.register(`series.${index}.url`)} error={form.formState.errors.series?.[index]?.url?.message} />
          <TextInput placeholder="Category" {...form.register(`series.${index}.category`)} />
          <Textarea placeholder="Description" minRows={2} className="field-full" {...form.register(`series.${index}.description`)} />
        </div>
        <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => append({ name: '', url: '', description: '', category: '' })}>Add series</Button>
  </div>
}

function EducationEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'education' })
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top">
        <div className="list-row-fields">
          <TextInput placeholder="Institution" {...form.register(`education.${index}.institution`)} error={form.formState.errors.education?.[index]?.institution?.message} />
          <TextInput placeholder="Program" {...form.register(`education.${index}.program`)} error={form.formState.errors.education?.[index]?.program?.message} />
          <TextInput placeholder="Period" {...form.register(`education.${index}.period`)} error={form.formState.errors.education?.[index]?.period?.message} />
        </div>
        <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => append({ institution: '', program: '', period: '' })}>Add education</Button>
  </div>
}

function ExperienceEditor({ form }: { form: UseFormReturn<ProfileForm> }) {
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'experience' })
  return <div className="list-stack">
    {fields.map((field, index) => <div className="list-row" key={field.id}>
      <div className="list-row-top">
        <div className="list-row-fields">
          <TextInput placeholder="Organization" {...form.register(`experience.${index}.organization`)} error={form.formState.errors.experience?.[index]?.organization?.message} />
          <TextInput placeholder="Role" {...form.register(`experience.${index}.role`)} error={form.formState.errors.experience?.[index]?.role?.message} />
          <TextInput placeholder="Period" {...form.register(`experience.${index}.period`)} error={form.formState.errors.experience?.[index]?.period?.message} />
        </div>
        <ListRowActions index={index} count={fields.length} move={move} remove={remove} />
      </div>
    </div>)}
    <Button variant="light" color="teal" leftSection={<Plus size={14} />} onClick={() => append({ organization: '', role: '', period: '' })}>Add experience</Button>
  </div>
}

function ProfilePreview({ values }: { values: ProfileForm }) {
  const initials = (values.displayName || 'M').slice(0, 1).toUpperCase()
  const contactLinks = [
    ...(values.websiteUrl ? [{ label: 'Website', url: values.websiteUrl, icon: 'globe' }] : []),
    ...values.contacts,
  ]
  return <aside className="profile-preview">
    <div className="panel">
      <div className="panel-heading"><div><p className="kicker">Preview</p><h2>Public home</h2></div></div>
      <div className="preview-card">
        <div className="preview-id">
          {values.avatarUrl
            ? <img key={values.avatarUrl} className="preview-avatar" src={values.avatarUrl} alt="Avatar preview" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />
            : <span className="preview-avatar preview-initials">{initials}</span>}
          <div><strong>{values.displayName || 'Your name'}</strong><p>{values.headline || 'Headline'}</p></div>
        </div>
        {values.organization && <p className="preview-org">{values.organization}</p>}
        {values.bio && <p className="preview-bio">{values.bio}</p>}
        {!!values.interests.length && <div className="preview-interests">{values.interests.map((interest) => <span key={interest}>#{interest}</span>)}</div>}
        {(values.education.length > 0 || values.experience.length > 0) && <div className="preview-block">
          <p className="preview-block-title">Background</p>
          {values.education.map((item, index) => <p className="preview-line" key={`education-${index}`}><span>{item.period}</span><strong>{item.program}</strong><em>{item.institution}</em></p>)}
          {values.experience.map((item, index) => <p className="preview-line" key={`experience-${index}`}><span>{item.period}</span><strong>{item.role}</strong><em>{item.organization}</em></p>)}
        </div>}
        <div className="preview-block">
          <p className="preview-block-title">Contact</p>
          <div className="preview-icons">
            {contactLinks.map((contact, index) => <span key={`${contact.url}-${index}`} title={contact.label}>{contactIconNode(resolveContactKey(contact))}</span>)}
          </div>
          {!contactLinks.length && <p className="preview-muted">No public links yet.</p>}
          {values.location && <p className="preview-muted">Location shows as “{values.location.split(',')[0].trim()} · UTC+8”.</p>}
        </div>
        {!!values.series.length && <div className="preview-block">
          <p className="preview-block-title">My Series</p>
          {values.series.map((item, index) => <p className="preview-line" key={`series-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.name}</strong><em>{item.category}</em></p>)}
        </div>}
      </div>
    </div>
  </aside>
}

export function ProfileWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['admin-profile'], queryFn: () => client.adminProfile() })
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)
  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: emptyProfileForm() })
  useEffect(() => { if (profile.data) profileForm.reset(profileValues(profile.data)) }, [profile.data, profileForm])
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current) }, [])
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
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Identity</p><h1>Profile.</h1><p className="subheading">The identity, background, and links shown on the public homepage.</p></div></div>
    {profile.isError && <Alert color="red" variant="light">Profile could not be loaded.</Alert>}
    {saveProfile.isError && <Alert color="red" variant="light">Profile could not be saved. Fix the highlighted fields and try again.</Alert>}
    <div className="profile-layout">
      <nav className="profile-nav" aria-label="Profile sections">
        {NAV_ITEMS.map((item) => <button key={item.id} type="button" className="profile-nav-link" onClick={() => scrollToSection(item.id)}>{item.label}</button>)}
      </nav>
      <div className="profile-forms">
        <form id="profile-form" noValidate onSubmit={profileForm.handleSubmit((input) => saveProfile.mutate(input))}>
          <section className="panel" id="profile-identity">
            <div className="panel-heading"><div><p className="kicker">Identity</p><h2>Introduction</h2></div></div>
            <div className="form-stack">
              <TextInput label="Display name" {...profileForm.register('displayName')} error={profileForm.formState.errors.displayName?.message} />
              <div className="form-grid">
                <TextInput label="Handle" {...profileForm.register('handle')} />
                <TextInput label="Location" description="Telemetry shows the first comma segment." {...profileForm.register('location')} />
              </div>
              <TextInput label="Headline" description={`${watched.headline.length}/240`} {...profileForm.register('headline')} error={profileForm.formState.errors.headline?.message} />
              <Textarea label="Bio" description={`${watched.bio.length}/4000`} minRows={4} {...profileForm.register('bio')} error={profileForm.formState.errors.bio?.message} />
              <TextInput label="Organization" description="Shown above the bio on the homepage." {...profileForm.register('organization')} />
              <div className="avatar-field">
                <div className="avatar-field-input">
                  <TextInput label="Avatar URL" {...profileForm.register('avatarUrl')} error={profileForm.formState.errors.avatarUrl?.message} />
                </div>
                {watched.avatarUrl
                  ? <img key={watched.avatarUrl} className="avatar-thumb" src={watched.avatarUrl} alt="Avatar preview" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />
                  : <span className="avatar-thumb avatar-thumb-empty">{(watched.displayName || 'M').slice(0, 1).toUpperCase()}</span>}
              </div>
            </div>
          </section>
          <section className="panel" id="profile-links">
            <div className="panel-heading"><div><p className="kicker">Links</p><h2>Website and resume</h2></div></div>
            <div className="form-stack">
              <div className="form-grid">
                <TextInput label="Website URL" description="Rendered as the first Contact entry." {...profileForm.register('websiteUrl')} error={profileForm.formState.errors.websiteUrl?.message} />
                <TextInput label="Resume PDF URL" description="CV badge next to the portrait." {...profileForm.register('resumeUrl')} error={profileForm.formState.errors.resumeUrl?.message} />
              </div>
            </div>
          </section>
          <section className="panel" id="profile-interests">
            <div className="panel-heading"><div><p className="kicker">Interests</p><h2>Interests</h2></div></div>
            <div className="form-stack">
              <div><label>Tags</label><ChipsInput value={watched.interests} onChange={(next) => profileForm.setValue('interests', next, { shouldDirty: true })} /></div>
              <p className="icon-hint">Rendered as #tags under the introduction.</p>
            </div>
          </section>
          <section className="panel" id="profile-cv">
            <div className="panel-heading"><div><p className="kicker">CV</p><h2>Education and experience</h2></div><span className="count-badge">Background section</span></div>
            <div className="form-stack">
              <div><label>Education</label><EducationEditor form={profileForm} /></div>
              <div><label>Experience</label><ExperienceEditor form={profileForm} /></div>
            </div>
          </section>
          <section className="panel" id="profile-series">
            <div className="panel-heading"><div><p className="kicker">Series</p><h2>My Series</h2></div><span className="count-badge">{watched.series.length} cards</span></div>
            <div className="form-stack"><SeriesEditor form={profileForm} /></div>
          </section>
          <section className="panel" id="profile-contact">
            <div className="panel-heading"><div><p className="kicker">Contact</p><h2>Contact links</h2></div><span className="count-badge">{watched.contacts.length} links</span></div>
            <div className="form-stack"><ContactsEditor form={profileForm} /></div>
          </section>
        </form>
      </div>
      <ProfilePreview values={watched} />
    </div>
    {profileForm.formState.isDirty && <div className="save-bar">
      <span>Unsaved changes</span>
      <div className="save-bar-actions">
        <Button variant="default" onClick={discard}>Discard</Button>
        <Button className="button button-primary" type="submit" form="profile-form" loading={saveProfile.isPending} leftSection={savedFlash ? <Check size={16} /> : <Save size={16} />}>{savedFlash ? 'Saved' : 'Save profile'}</Button>
      </div>
    </div>}
  </section>
}

export default ProfileWorkspace
