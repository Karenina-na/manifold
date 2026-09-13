import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Autocomplete, Button, Switch, Textarea, TextInput } from '@mantine/core'
import { CalendarDays, Clock3, Eye, Heart, Languages, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { AdminContent, ArticleMetadataInput } from '@manifold/contracts'
import { ArticleSurface, deriveToc, estimateReadingMinutes } from '@manifold/render'
import { ApiError } from '@manifold/sdk'
import { z } from 'zod'
import { createAdminClient, webBaseUrl } from '../lib/api'
import { activeLocale, formatDate } from '../i18n/format'
import { setDirtyGuard } from '../lib/dirty-guard'
import { navigate, requestNavigate, replaceRoute } from '../lib/useHashRoute'
import { ChipsInput } from '../components/forms/ChipsInput'
import { ContentListPanel, type TransitionAction } from '../components/content/ContentListPanel'
import { ContentEditorShell, type EditorMode } from '../components/content/ContentEditorShell'
import { ContentCommentsPanel } from '../components/content/ContentCommentsPanel'
import { MarkdownEditor } from '../components/content/MarkdownEditor'

function createSchema(t: TFunction) {
  return z.object({
    slug: z.string().trim().min(1, t('validation.slugRequired')),
    title: z.string(),
    summary: z.string().max(4000, t('validation.maxCharacters', { count: 4000 })),
    body: z.string().min(1, t('validation.contentRequired')),
    tags: z.array(z.string().trim().min(1, t('validation.valueRequired')).max(60, t('validation.maxCharacters', { count: 60 }))),
    language: z.string(),
    aiAssisted: z.boolean(),
  })
}
type Form = z.infer<ReturnType<typeof createSchema>>
const empty: Form = { slug: '', title: '', summary: '', body: '', tags: [], language: '', aiAssisted: false }

// The language field records the language the piece is written in, not a
// programming language. Presets cover common garden languages; the searchable
// select lets any free-text value be stored instead.
const languagePresets = ['English', '简体中文', '繁體中文', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Português', 'Italiano', 'Русский', 'Nederlands']

function metadataFrom(form: Form): ArticleMetadataInput {
  return {
    language: form.language.trim() || null,
    aiAssisted: form.aiAssisted,
  }
}

function fromContent(content: AdminContent): Form {
  const metadata = content.kind === 'ARTICLE' ? content.metadata : null
  return {
    slug: content.slug,
    title: content.title ?? '',
    summary: content.summary,
    body: content.body ?? '',
    tags: content.tags,
    language: metadata?.language ?? '',
    aiAssisted: metadata?.aiAssisted ?? false,
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function WritingsWorkspace({ token, segments, query }: { token: string; segments: string[]; query: URLSearchParams }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const editingId = segments[0]
  if (!editingId) return <WritingsListPage client={client} />
  return <WritingEditorPage client={client} editingId={editingId} commentsRequested={segments[1] === 'comments'} routeQuery={query} />
}

function useWritingPin(client: ReturnType<typeof createAdminClient>) {
  const queryClient = useQueryClient()
  const config = useQuery({ queryKey: ['admin-writings-config'], queryFn: () => client.adminWritingConfig() })
  const setPin = useMutation({
    mutationFn: (ids: string[]) => client.updateWritingConfig({ pinnedIds: ids }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-writings-config'] }),
  })
  const pinnedIds = config.data?.pinnedIds ?? []
  const onToggle = (content: AdminContent) => setPin.mutate(pinnedIds.includes(content.id) ? pinnedIds.filter((id) => id !== content.id) : [...pinnedIds, content.id])
  return {
    config,
    setPin,
    control: {
      pinnedIds,
      onToggle,
      pending: setPin.isPending,
    },
  }
}

function WritingsListPage({ client }: { client: ReturnType<typeof createAdminClient> }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const pin = useWritingPin(client)
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
  }
  const transition = useMutation<AdminContent | void, Error, { id: string; action: TransitionAction }>({
    mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : action === 'restore' ? client.restoreContent(id) : client.deleteContent(id),
    onSuccess: () => invalidate(),
  })
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">{t('writings.kicker')}</p><h1>{t('writings.title')}</h1><p className="subheading">{t('writings.copy')}</p></div><Button className="button button-primary" onClick={() => navigate('#/writings/new')} leftSection={<Plus size={16} />}>{t('writings.new')}</Button></div>
    <ContentListPanel
      client={client}
      kind="ARTICLE"
      singular={t('common.writing')}
      onEdit={(content) => navigate(`#/writings/${content.id}`)}
      onTransition={(content, action) => transition.mutate({ id: content.id, action })}
      hrefFor={(content) => `${webBaseUrl}/writing/${content.slug}`}
      pin={pin.control}
    />
  </section>
}

function WritingEditorPage({ client, editingId, commentsRequested, routeQuery }: { client: ReturnType<typeof createAdminClient>; editingId: string; commentsRequested: boolean; routeQuery: URLSearchParams }) {
  const { t, i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  const schema = useMemo(() => createSchema(t), [t])
  const queryClient = useQueryClient()
  const isNew = editingId === 'new'
  const pin = useWritingPin(client)
  const [draft, setDraft] = useState<AdminContent | null>(null)
  const [mode, setMode] = useState<EditorMode>(isNew ? 'create' : 'view')
  const [activeTab, setActiveTab] = useState(commentsRequested && !isNew ? 'comments' : 'meta')
  const [savedFlash, setSavedFlash] = useState(false)
  const [conflict, setConflict] = useState(false)
  const flashTimer = useRef<number | null>(null)
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: empty })
  const dirtyRef = useRef(false)
  dirtyRef.current = form.formState.isDirty
  const watched = form.watch()
  const item = useQuery({
    queryKey: ['admin-content-item', 'ARTICLE', editingId],
    queryFn: () => client.adminContentItem(editingId),
    enabled: !isNew,
  })
  useEffect(() => {
    if (item.data) {
      setDraft(item.data)
      form.reset(fromContent(item.data))
      setConflict(false)
    }
  }, [item.data, form])
  useEffect(() => {
    setDirtyGuard(() => dirtyRef.current)
    return () => setDirtyGuard(null)
  }, [])
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current) }, [])
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
  }
  const save = useMutation({
    mutationFn: (input: Form) => draft
      ? client.updateContent(draft.id, { kind: 'ARTICLE', slug: input.slug, title: input.title, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input), expectedVersion: draft.version })
      : client.createContent({ kind: 'ARTICLE', slug: input.slug, title: input.title, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input) }),
    onSuccess: (saved) => {
      invalidate()
      setConflict(false)
      setDraft(saved)
      setMode('edit')
      form.reset(fromContent(saved))
      if (isNew) replaceRoute(`#/writings/${saved.id}`)
      setSavedFlash(true)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2400)
    },
    onError: (error) => setConflict(error instanceof ApiError && error.status === 409),
  })
  const transition = useMutation<AdminContent, Error, TransitionAction>({
    mutationFn: (action) => draft ? (action === 'publish' ? client.publishContent(draft.id) : client.unpublishContent(draft.id)) : Promise.reject(new Error('nothing to transition')),
    onSuccess: (result) => { invalidate(); setDraft(result); setSavedFlash(true) },
  })
  const remove = useMutation<void, Error>({
    mutationFn: () => draft ? client.deleteContent(draft.id) : Promise.reject(new Error('nothing to delete')),
    onSuccess: () => { invalidate(); navigate('#/writings') },
  })
  const bodyText = watched.body ?? ''
  const minutes = estimateReadingMinutes(bodyText)
  const toc = deriveToc(bodyText)

  const submitForm = form.handleSubmit(() => {
    // vditor still may hold the last keystrokes in its input debounce; a
    // short yield lets it land in the form before the request is built.
    window.setTimeout(() => save.mutate(form.getValues()), 350)
  })
  const pinSection = isNew ? null : <div className="pin-section">
    <Switch
      label={t('writings.pin')}
      description={t('writings.pinDescription')}
      checked={pin.config.data?.pinnedIds.includes(editingId) ?? false}
      disabled={pin.setPin.isPending}
      onChange={(event) => pin.setPin.mutate(
        event.currentTarget.checked
          ? [...(pin.config.data?.pinnedIds ?? []), editingId]
          : (pin.config.data?.pinnedIds ?? []).filter((id) => id !== editingId)
      )}
    />
    {pin.setPin.isError && <Alert color="red" variant="light">{t('writings.pinError')}</Alert>}
  </div>
  const metaTab = <form className="form-stack" id="writing-form" noValidate onSubmit={submitForm}>
    {!isNew && item.isError && <Alert color="red" variant="light">{t('writings.loadError')}</Alert>}
    <TextInput label={t('writings.titleLabel')} {...form.register('title')} placeholder={t('writings.titlePlaceholder')} error={form.formState.errors.title?.message} onBlur={(event) => { if (!draft && !form.getValues('slug').trim()) form.setValue('slug', slugify(event.currentTarget.value), { shouldDirty: true }) }} />
    <TextInput label={t('writings.slug')} description={`${webBaseUrl}/writing/${watched.slug || '…'}`} {...form.register('slug')} placeholder={t('writings.slugPlaceholder')} error={form.formState.errors.slug?.message} />
    <Textarea label={t('writings.summary')} description={t('writings.summaryDescription', { count: watched.summary.trim().length })} {...form.register('summary')} minRows={2} error={form.formState.errors.summary?.message} />
    <div><label>{t('writings.tags')}</label><ChipsInput value={watched.tags} onChange={(next) => form.setValue('tags', next, { shouldDirty: true })} placeholder={t('writings.addTag')} /></div>
    <div className="form-grid form-grid-even">
      <Autocomplete
        label={t('writings.language')}
        description={t('writings.languageDescription')}
        value={watched.language === 'Other' ? t('writings.languagePresetOther') : watched.language}
        onChange={(value) => form.setValue('language', value === t('writings.languagePresetOther') ? 'Other' : value, { shouldDirty: true })}
        data={[...languagePresets, t('writings.languagePresetOther')]}
        placeholder={t('writings.languagePlaceholder')}
        clearable
      />
      <TextInput label={t('writings.readingTime')} value={t('writings.minutes', { count: minutes })} readOnly description={t('writings.recalculated')} />
    </div>
    <Switch label={t('writings.aiAssisted')} description={t('writings.aiDescription')} checked={watched.aiAssisted} onChange={(event) => form.setValue('aiAssisted', event.currentTarget.checked, { shouldDirty: true })} />
    {save.isError && !conflict && <Alert color="red" variant="light">{t('writings.saveError')}</Alert>}
  </form>

  const contextTab = <div className="context-editor">
    <p className="field-hint">{t('writings.editorHint')}</p>
    <MarkdownEditor value={bodyText} disabled={mode === 'view'} onChange={(next) => form.setValue('body', next, { shouldDirty: true })} onUploadImage={async (file) => (await client.uploadMedia(file, file.name)).url} />
    {form.formState.errors.body?.message && <Alert color="red" variant="light">{form.formState.errors.body.message}</Alert>}
  </div>

  const meta = <div className="articleMeta">
    <span><CalendarDays size={14} aria-hidden="true" /> <time>{formatDate(draft?.publishedAt ?? new Date().toISOString(), locale)}</time></span>
    <span><Clock3 size={14} aria-hidden="true" /> {t('writings.minRead', { count: minutes })}</span>
    {watched.language && <span><Languages size={14} aria-hidden="true" /> {watched.language}</span>}
    {draft && <span><Eye size={14} aria-hidden="true" /> {draft.viewCount}</span>}
    {draft && <span><Heart size={14} aria-hidden="true" /> {draft.likeCount}</span>}
    {watched.tags.map((tag) => <span className="articleMetaTag" key={tag}>#{tag}</span>)}
  </div>

  const renderTab = <div className="articleSurface"><div className="articleSurfaceInner">
    <ArticleSurface title={watched.title} summary={watched.summary} meta={meta} body={bodyText} toc={toc} />
  </div></div>

  const commentsTab = isNew ? null : <ContentCommentsPanel
    client={client}
    contentId={editingId}
    page={Number(routeQuery.get('page') ?? 1) || 1}
    q={routeQuery.get('q') ?? ''}
    focus={routeQuery.get('focus') ?? ''}
    onParamsChange={(next) => {
      const params = new URLSearchParams(routeQuery)
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '') params.delete(key)
        else params.set(key, String(value))
      }
      const encoded = params.toString()
      replaceRoute(`#/writings/${editingId}/comments${encoded ? `?${encoded}` : ''}`)
    }}
  />

  return <ContentEditorShell
    kindLabel={t('common.writing')}
    hrefFor={(content) => `${webBaseUrl}/writing/${content.slug}`}
    selected={draft}
    mode={mode}
    isDirty={form.formState.isDirty}
    isPending={save.isPending}
    savedFlash={savedFlash}
    conflict={conflict}
    formId="writing-form"
    onBack={() => requestNavigate('#/writings')}
    onDiscard={() => form.reset(draft ? fromContent(draft) : empty)}
    onEnterEdit={() => setMode('edit')}
    onConfirmLock={() => { form.reset(draft ? fromContent(draft) : empty); setMode('view') }}
    onTransition={(action) => transition.mutate(action)}
    onDeleteConfirmed={() => remove.mutate()}
    conflictReload={() => { void queryClient.invalidateQueries({ queryKey: ['admin-content-item', 'ARTICLE', editingId] }) }}
    metaTab={metaTab}
    contextTab={contextTab}
    renderTab={renderTab}
    commentsTab={commentsTab}
    pinSection={pinSection}
    activeTab={activeTab}
    onTabChange={setActiveTab}
    onSubmitRequest={submitForm}
  />
}

export default WritingsWorkspace
