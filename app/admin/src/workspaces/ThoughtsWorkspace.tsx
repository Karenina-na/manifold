import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Switch, Textarea, TextInput } from '@mantine/core'
import { BookOpen, Compass, Plus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { AdminContent, ThoughtMetadataInput } from '@manifold/contracts'
import { ThoughtSurface } from '@manifold/render'
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
  mood: z.string().max(120),
  question: z.string().max(500),
  context: z.string().max(400),
  source: z.string().max(200),
})
type Form = z.infer<typeof schema>
const empty: Form = { slug: '', title: '', summary: '', body: '', tags: [], mood: '', question: '', context: '', source: '' }

function metadataFrom(form: Form): ThoughtMetadataInput {
  return {
    mood: form.mood.trim() || null,
    question: form.question.trim() || null,
    context: form.context.trim() || null,
    source: form.source.trim() || null,
  }
}

function fromContent(content: AdminContent): Form {
  const metadata = content.kind === 'THOUGHT' ? content.metadata : null
  return {
    slug: content.slug,
    title: content.title ?? '',
    summary: content.summary,
    body: content.body ?? '',
    tags: content.tags,
    mood: metadata?.mood ?? '',
    question: metadata?.question ?? '',
    context: metadata?.context ?? '',
    source: metadata?.source ?? '',
  }
}

export function ThoughtsWorkspace({ token, segments, query }: { token: string; segments: string[]; query: URLSearchParams }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const editingId = segments[0]
  if (!editingId) return <ThoughtsListPage client={client} />
  return <ThoughtEditorPage client={client} editingId={editingId} commentsRequested={segments[1] === 'comments'} routeQuery={query} />
}

function useThoughtPin(client: ReturnType<typeof createAdminClient>) {
  const queryClient = useQueryClient()
  const config = useQuery({ queryKey: ['admin-thought-config'], queryFn: () => client.adminThoughtConfig() })
  const setPin = useMutation({
    mutationFn: (ids: string[]) => client.updateThoughtConfig({ pinnedIds: ids }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-thought-config'] }),
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

function ThoughtsListPage({ client }: { client: ReturnType<typeof createAdminClient> }) {
  const queryClient = useQueryClient()
  const pin = useThoughtPin(client)
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-thought-config'] })
  }
  const transition = useMutation<AdminContent | void, Error, { id: string; action: TransitionAction }>({
    mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : action === 'restore' ? client.restoreContent(id) : client.deleteContent(id),
    onSuccess: () => invalidate(),
  })
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Thoughts</p><h1>Capture as you go.</h1><p className="subheading">Fragments, methods, and reading notes that stay light.</p></div><Button className="button button-primary" onClick={() => navigate('#/thoughts/new')} leftSection={<Plus size={16} />}>New thought</Button></div>
    <ContentListPanel
      client={client}
      kind="THOUGHT"
      singular="thought"
      onEdit={(content) => navigate(`#/thoughts/${content.id}`)}
      onTransition={(content, action) => transition.mutate({ id: content.id, action })}
      hrefFor={(content) => `${webBaseUrl}/thoughts/${content.slug}`}
      pin={pin.control}
    />
  </section>
}

function ThoughtEditorPage({ client, editingId, commentsRequested, routeQuery }: { client: ReturnType<typeof createAdminClient>; editingId: string; commentsRequested: boolean; routeQuery: URLSearchParams }) {
  const queryClient = useQueryClient()
  const isNew = editingId === 'new'
  const pin = useThoughtPin(client)
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
    queryKey: ['admin-content-item', 'THOUGHT', editingId],
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
    void queryClient.invalidateQueries({ queryKey: ['admin-thought-config'] })
  }
  const save = useMutation({
    mutationFn: (input: Form) => draft
      ? client.updateContent(draft.id, { kind: 'THOUGHT', slug: input.slug, title: input.title || null, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input), expectedVersion: draft.version })
      : client.createContent({ kind: 'THOUGHT', slug: input.slug, title: input.title || null, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input) }),
    onSuccess: (saved) => {
      invalidate()
      setConflict(false)
      setDraft(saved)
      setMode('edit')
      form.reset(fromContent(saved))
      if (isNew) replaceRoute(`#/thoughts/${saved.id}`)
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
    onSuccess: () => { invalidate(); navigate('#/thoughts') },
  })
  const bodyText = watched.body ?? ''

  const submitForm = form.handleSubmit(() => {
    // vditor still may hold the last keystrokes in its input debounce; a
    // short yield lets it land in the form before the request is built.
    window.setTimeout(() => save.mutate(form.getValues()), 350)
  })
  const pinSection = isNew ? null : <div className="pin-section">
    <Switch
      label="Pin to the thoughts archive"
      description="Pins this thought in the Featured row at the top of the public Thoughts page. Multiple thoughts can be pinned."
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
  const metaTab = <form className="form-stack" id="thought-form" noValidate onSubmit={submitForm}>
    {!isNew && item.isError && <Alert color="red" variant="light">This thought could not be loaded. Go back and try again.</Alert>}
    <TextInput label="Title" {...form.register('title')} placeholder="Optional" />
    <TextInput label="Slug" description={`${webBaseUrl}/thoughts/${watched.slug || '…'}`} {...form.register('slug')} placeholder="a-readable-url" error={form.formState.errors.slug?.message} />
    <Textarea label="Summary" description={`✦ ${watched.summary.trim().length}/4000 — shown with the ✦ mark on cards`} {...form.register('summary')} minRows={2} error={form.formState.errors.summary?.message} />
    <div><label>Tags</label><ChipsInput value={watched.tags} onChange={(next) => form.setValue('tags', next, { shouldDirty: true })} placeholder="Add tag and press Enter" /></div>
    <div className="form-stack provenance-stack">
      <p className="kicker">Provenance</p>
      <TextInput label="Mood" description="Sparkles — a short state of mind" leftSection={<Sparkles size={14} />} {...form.register('mood')} />
      <Textarea label="Question" description="Rendered as the reflection blockquote" {...form.register('question')} minRows={2} />
      <div className="form-grid">
        <TextInput label="Context" description="Compass — where it came from" leftSection={<Compass size={14} />} {...form.register('context')} />
        <TextInput label="Source" description="Book — book, paper, or conversation" leftSection={<BookOpen size={14} />} {...form.register('source')} />
      </div>
    </div>
    {save.isError && !conflict && <Alert color="red" variant="light">Could not save this thought. Check the fields and Core status.</Alert>}
  </form>

  const contextTab = <div className="context-editor">
    <p className="field-hint">Write in the instant-rendering editor — images paste, drop or upload from the toolbar and are stored in Core. The stored value is plain Markdown.</p>
    <MarkdownEditor value={bodyText} disabled={mode === 'view'} onChange={(next) => form.setValue('body', next, { shouldDirty: true })} onUploadImage={async (file) => (await client.uploadMedia(file, file.name)).url} />
    {form.formState.errors.body?.message && <Alert color="red" variant="light">{form.formState.errors.body.message}</Alert>}
  </div>

  const renderTab = <div className="articleSurface"><div className="articleSurfaceInner">
    <ThoughtSurface
      title={watched.title}
      summary={watched.summary}
      date={draft?.publishedAt ?? new Date().toISOString()}
      mood={watched.mood}
      tags={watched.tags}
      question={watched.question}
      context={watched.context}
      source={watched.source}
      body={bodyText}
    />
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
      replaceRoute(`#/thoughts/${editingId}/comments${encoded ? `?${encoded}` : ''}`)
    }}
  />

  return <ContentEditorShell
    kindLabel="Thought"
    hrefFor={(content) => `${webBaseUrl}/thoughts/${content.slug}`}
    selected={draft}
    mode={mode}
    isDirty={form.formState.isDirty}
    isPending={save.isPending}
    savedFlash={savedFlash}
    conflict={conflict}
    formId="thought-form"
    onBack={() => requestNavigate('#/thoughts')}
    onDiscard={() => form.reset(draft ? fromContent(draft) : empty)}
    onEnterEdit={() => setMode('edit')}
    onConfirmLock={() => { form.reset(draft ? fromContent(draft) : empty); setMode('view') }}
    onTransition={(action) => transition.mutate(action)}
    onDeleteConfirmed={() => remove.mutate()}
    conflictReload={() => { void queryClient.invalidateQueries({ queryKey: ['admin-content-item', 'THOUGHT', editingId] }) }}
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

export default ThoughtsWorkspace
