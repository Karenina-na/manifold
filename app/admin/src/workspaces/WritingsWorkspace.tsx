import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Select, Switch, Textarea, TextInput } from '@mantine/core'
import { CalendarDays, Clock3, Eye, Heart, Languages, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { AdminContent, ArticleMetadata } from '@manifold/contracts'
import { ArticleSurface, formatDate } from '@manifold/render'
import { ApiError } from '@manifold/sdk'
import { z } from 'zod'
import { createAdminClient, webBaseUrl } from '../api'
import { setDirtyGuard } from '../lib/dirty-guard'
import { navigate, requestNavigate, replaceRoute } from '../lib/useHashRoute'
import { deriveToc, estimateReadingMinutes } from '../lib/content-derive'
import { ChipsInput } from '../components/ChipsInput'
import { ContentListPanel, type TransitionAction } from '../components/ContentListPanel'
import { ContentEditorShell, type EditorMode } from '../components/ContentEditorShell'
import { ContentCommentsPanel } from '../components/ContentCommentsPanel'
import { MarkdownEditor } from '../components/MarkdownEditor'

const schema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string().max(4000),
  body: z.string().min(1, 'Content is required.'),
  tags: z.array(z.string().trim().min(1).max(60)),
  language: z.string(),
  aiAssisted: z.boolean(),
})
type Form = z.infer<typeof schema>
const empty: Form = { slug: '', title: '', summary: '', body: '', tags: [], language: '', aiAssisted: false }
const languageOptions = ['Go', 'TypeScript', 'JavaScript', 'Python', 'Rust', 'C', 'C++', 'Java', 'Kotlin', 'Swift', 'SQL', 'Bash', 'Markdown', 'Other'].map((value) => ({ value, label: value }))

// PATCH metadata replaces the whole object in Core, so untouched editorial
// fields (frontmatter, technologies, …) must ride along from the loaded item.
function metadataFrom(form: Form, previous: AdminContent | null): ArticleMetadata {
  const metadata = { ...(previous?.metadata ?? {}) } as ArticleMetadata
  if (form.language.trim()) metadata.language = form.language.trim()
  else delete metadata.language
  if (form.aiAssisted) metadata.aiAssisted = true
  else delete metadata.aiAssisted
  return metadata
}

function fromContent(content: AdminContent): Form {
  const metadata = content.metadata as ArticleMetadata
  return {
    slug: content.slug ?? '',
    title: content.title ?? '',
    summary: content.summary,
    body: content.body ?? '',
    tags: content.tags,
    language: metadata.language ?? '',
    aiAssisted: metadata.aiAssisted ?? false,
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

function WritingsListPage({ client }: { client: ReturnType<typeof createAdminClient> }) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
  }
  const transition = useMutation<AdminContent | void, Error, { id: string; action: TransitionAction }>({
    mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : client.deleteContent(id),
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
      hrefFor={(content) => `${webBaseUrl}/writing/${content.slug || content.id}`}
    />
  </section>
}

function WritingEditorPage({ client, editingId, commentsRequested, routeQuery }: { client: ReturnType<typeof createAdminClient>; editingId: string; commentsRequested: boolean; routeQuery: URLSearchParams }) {
  const queryClient = useQueryClient()
  const isNew = editingId === 'new'
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
      ? client.updateContent(draft.id, { kind: 'ARTICLE', slug: input.slug, title: input.title, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input, draft), expectedVersion: draft.version })
      : client.createContent({ kind: 'ARTICLE', slug: input.slug, title: input.title, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input, null) }),
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
  const metaTab = <form className="form-stack" id="writing-form" noValidate onSubmit={submitForm}>
    {!isNew && item.isError && <Alert color="red" variant="light">This writing could not be loaded. Go back and try again.</Alert>}
    <TextInput label="Title" {...form.register('title')} placeholder="A title with a clear promise" error={form.formState.errors.title?.message} onBlur={(event) => { if (!draft && !form.getValues('slug').trim()) form.setValue('slug', slugify(event.currentTarget.value), { shouldDirty: true }) }} />
    <TextInput label="Slug" description={`${webBaseUrl}/writing/${watched.slug || '…'}`} {...form.register('slug')} placeholder="a-readable-url" error={form.formState.errors.slug?.message} />
    <Textarea label="Summary" description={`✦ ${watched.summary.trim().length}/4000 — shown on archive cards`} {...form.register('summary')} minRows={2} error={form.formState.errors.summary?.message} />
    <div><label>Tags</label><ChipsInput value={watched.tags} onChange={(next) => form.setValue('tags', next, { shouldDirty: true })} placeholder="Add tag and press Enter" /></div>
    <div className="form-grid">
      <Select label="Language" description="Shown in the article meta line" value={watched.language || null} onChange={(value) => form.setValue('language', value ?? '', { shouldDirty: true })} data={languageOptions} clearable />
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
    hrefFor={(content) => `${webBaseUrl}/writing/${content.slug || content.id}`}
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
    activeTab={activeTab}
    onTabChange={setActiveTab}
    onSubmitRequest={submitForm}
  />
}

export default WritingsWorkspace
