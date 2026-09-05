import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Autocomplete, Button, Switch, Textarea, TextInput } from '@mantine/core'
import { CalendarDays, Clock3, Eye, Heart, Languages, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { AdminContent, ArticleMetadataInput } from '@manifold/contracts'
import { ArticleSurface, deriveToc, estimateReadingMinutes, formatDate } from '@manifold/render'
import { ApiError } from '@manifold/sdk'
import { z } from 'zod'
import { createAdminClient, webBaseUrl } from '../api'
import { setDirtyGuard } from '../lib/dirty-guard'
import { navigate, requestNavigate, replaceRoute } from '../lib/useHashRoute'
import { ChipsInput } from '../components/ChipsInput'
import { ContentListPanel, type TransitionAction } from '../components/ContentListPanel'
import { ContentEditorShell, type EditorMode } from '../components/ContentEditorShell'
import { ContentCommentsPanel } from '../components/ContentCommentsPanel'
import { MarkdownEditor } from '../components/MarkdownEditor'

const schema = z.object({
  slug: z.string().trim().min(1, 'Slug is required.'),
  title: z.string(),
  summary: z.string().max(4000),
  body: z.string().min(1, 'Content is required.'),
  tags: z.array(z.string().trim().min(1).max(60)),
  language: z.string(),
  aiAssisted: z.boolean(),
})
type Form = z.infer<typeof schema>
const empty: Form = { slug: '', title: '', summary: '', body: '', tags: [], language: '', aiAssisted: false }

// The language field records the language the piece is written in, not a
// programming language. Presets cover common garden languages; the searchable
// select lets any free-text value be stored instead.
const languagePresets = ['English', '简体中文', '繁體中文', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Português', 'Italiano', 'Русский', 'Nederlands', 'Other']

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
    <div className="page-heading"><div><p className="kicker">Writings</p><h1>Writings worth returning to.</h1><p className="subheading">Deep technical pieces with the full reading surface.</p></div><Button className="button button-primary" onClick={() => navigate('#/writings/new')} leftSection={<Plus size={16} />}>New writing</Button></div>
    <ContentListPanel
      client={client}
      kind="ARTICLE"
      singular="writing"
      onEdit={(content) => navigate(`#/writings/${content.id}`)}
      onTransition={(content, action) => transition.mutate({ id: content.id, action })}
      hrefFor={(content) => `${webBaseUrl}/writing/${content.slug}`}
      pin={pin.control}
    />
  </section>
}

function WritingEditorPage({ client, editingId, commentsRequested, routeQuery }: { client: ReturnType<typeof createAdminClient>; editingId: string; commentsRequested: boolean; routeQuery: URLSearchParams }) {
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
      label="Pin to the writings archive"
      description="Pins this piece in the Featured row at the top of the public Writings page. Multiple pieces can be pinned."
      checked={pin.config.data?.pinnedIds.includes(editingId) ?? false}
      disabled={pin.setPin.isPending}
      onChange={(event) => pin.setPin.mutate(
        event.currentTarget.checked
          ? [...(pin.config.data?.pinnedIds ?? []), editingId]
          : (pin.config.data?.pinnedIds ?? []).filter((id) => id !== editingId)
      )}
    />
    {pin.setPin.isError && <Alert color="red" variant="light">The pin could not be updated.</Alert>}
  </div>
  const metaTab = <form className="form-stack" id="writing-form" noValidate onSubmit={submitForm}>
    {!isNew && item.isError && <Alert color="red" variant="light">This writing could not be loaded. Go back and try again.</Alert>}
    <TextInput label="Title" {...form.register('title')} placeholder="A title with a clear promise" error={form.formState.errors.title?.message} onBlur={(event) => { if (!draft && !form.getValues('slug').trim()) form.setValue('slug', slugify(event.currentTarget.value), { shouldDirty: true }) }} />
    <TextInput label="Slug" description={`${webBaseUrl}/writing/${watched.slug || '…'}`} {...form.register('slug')} placeholder="a-readable-url" error={form.formState.errors.slug?.message} />
    <Textarea label="Summary" description={`✦ ${watched.summary.trim().length}/4000 — shown on archive cards`} {...form.register('summary')} minRows={2} error={form.formState.errors.summary?.message} />
    <div><label>Tags</label><ChipsInput value={watched.tags} onChange={(next) => form.setValue('tags', next, { shouldDirty: true })} placeholder="Add tag and press Enter" /></div>
    <div className="form-grid">
      <Autocomplete
        label="Language"
        description="The language the piece is written in, shown in the article meta line"
        value={watched.language}
        onChange={(value) => form.setValue('language', value, { shouldDirty: true })}
        data={languagePresets}
        placeholder="e.g. English"
        clearable
      />
      <TextInput label="Estimated reading time" value={`${minutes} min`} readOnly description="Core recalculates this on save" />
    </div>
    <Switch label="AI-assisted writing" description="Lets readers filter this piece out with “No AI writing”" checked={watched.aiAssisted} onChange={(event) => form.setValue('aiAssisted', event.currentTarget.checked, { shouldDirty: true })} />
    {save.isError && !conflict && <Alert color="red" variant="light">Could not save this writing. Check the fields and Core status.</Alert>}
  </form>

  const contextTab = <div className="context-editor">
    <p className="field-hint">Write in the instant-rendering editor — headings, lists, code and math format as you type; images paste, drop or upload from the toolbar and are stored in Core. The stored value is plain Markdown.</p>
    <MarkdownEditor value={bodyText} disabled={mode === 'view'} onChange={(next) => form.setValue('body', next, { shouldDirty: true })} onUploadImage={async (file) => (await client.uploadMedia(file, file.name)).url} />
    {form.formState.errors.body?.message && <Alert color="red" variant="light">{form.formState.errors.body.message}</Alert>}
  </div>

  const meta = <div className="articleMeta">
    <span><CalendarDays size={14} aria-hidden="true" /> <time>{formatDate(draft?.publishedAt ?? new Date().toISOString())}</time></span>
    <span><Clock3 size={14} aria-hidden="true" /> {minutes} min read</span>
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
    kindLabel="Writing"
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
