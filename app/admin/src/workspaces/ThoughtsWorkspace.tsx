import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Textarea, TextInput } from '@mantine/core'
import { BookOpen, Compass, Plus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { AdminContent, ThoughtMetadata } from '@manifold/contracts'
import { ThoughtSurface } from '@manifold/render'
import { ApiError } from '@manifold/sdk'
import { z } from 'zod'
import { createAdminClient, webBaseUrl } from '../api'
import { setDirtyGuard } from '../lib/dirty-guard'
import { navigate, requestNavigate, replaceRoute } from '../lib/useHashRoute'
import { ChipsInput } from '../components/ChipsInput'
import { ContentListPanel, type TransitionAction } from '../components/ContentListPanel'
import { ContentEditorShell, type EditorMode } from '../components/ContentEditorShell'
import { MarkdownEditor } from '../components/MarkdownEditor'

const schema = z.object({
  slug: z.string(),
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

// PATCH metadata replaces the whole object in Core, so untouched fields must
// ride along from the loaded item.
function metadataFrom(form: Form, previous: AdminContent | null): ThoughtMetadata {
  const metadata = { ...(previous?.metadata ?? {}) } as ThoughtMetadata
  if (form.mood.trim()) metadata.mood = form.mood.trim()
  else delete metadata.mood
  if (form.question.trim()) metadata.question = form.question.trim()
  else delete metadata.question
  if (form.context.trim()) metadata.context = form.context.trim()
  else delete metadata.context
  if (form.source.trim()) metadata.source = form.source.trim()
  else delete metadata.source
  return metadata
}

function fromContent(content: AdminContent): Form {
  const metadata = content.metadata as ThoughtMetadata
  return {
    slug: content.slug ?? '',
    title: content.title ?? '',
    summary: content.summary,
    body: content.body ?? '',
    tags: content.tags,
    mood: metadata.mood ?? '',
    question: metadata.question ?? '',
    context: metadata.context ?? '',
    source: metadata.source ?? '',
  }
}

export function ThoughtsWorkspace({ token, segments }: { token: string; segments: string[] }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const editingId = segments[0]
  if (!editingId) return <ThoughtsListPage client={client} />
  return <ThoughtEditorPage client={client} editingId={editingId} />
}

function ThoughtsListPage({ client }: { client: ReturnType<typeof createAdminClient> }) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-thought-config'] })
  }
  const transition = useMutation<AdminContent | void, Error, { id: string; action: TransitionAction }>({
    mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : client.deleteContent(id),
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
      hrefFor={(content) => `${webBaseUrl}/thoughts/${content.slug || content.id}`}
    />
  </section>
}

function ThoughtEditorPage({ client, editingId }: { client: ReturnType<typeof createAdminClient>; editingId: string }) {
  const queryClient = useQueryClient()
  const isNew = editingId === 'new'
  const [draft, setDraft] = useState<AdminContent | null>(null)
  const [mode, setMode] = useState<EditorMode>(isNew ? 'create' : 'view')
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
      ? client.updateContent(draft.id, { kind: 'THOUGHT', slug: input.slug || null, title: input.title, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input, draft), expectedVersion: draft.version })
      : client.createContent({ kind: 'THOUGHT', slug: input.slug || null, title: input.title || null, summary: input.summary, body: input.body, tags: input.tags, metadata: metadataFrom(input, null) }),
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
  const metaTab = <form className="form-stack" id="thought-form" noValidate onSubmit={submitForm}>
    {!isNew && item.isError && <Alert color="red" variant="light">This thought could not be loaded. Go back and try again.</Alert>}
    <div className="form-grid">
      <TextInput label="Title" {...form.register('title')} placeholder="Optional" />
      <TextInput label="Slug" description={`${webBaseUrl}/thoughts/${watched.slug || '…'}`} {...form.register('slug')} placeholder="Optional; ID is used by default" />
    </div>
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
    <p className="field-hint">Write in the instant-rendering editor — the stored value is plain Markdown.</p>
    <MarkdownEditor value={bodyText} disabled={mode === 'view'} onChange={(next) => form.setValue('body', next, { shouldDirty: true })} />
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

  return <ContentEditorShell
    kindLabel="Thought"
    hrefFor={(content) => `${webBaseUrl}/thoughts/${content.slug || content.id}`}
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
    onSubmitRequest={submitForm}
  />
}

export default ThoughtsWorkspace
