import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Alert, Button, Select, Textarea, TextInput } from '@mantine/core'
import { Plus, Save, Send, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { Content, ContentInput, ManuscriptMetadata, TechMetadata, ThoughtMetadata } from '@manifold/contracts'
import { z } from 'zod'
import { createAdminClient } from '../api'

const contentSchema = z.object({ kind: z.enum(['TECH', 'THOUGHT', 'MANUSCRIPT']), slug: z.string().trim().min(1, 'Slug is required.'), title: z.string().trim().min(1, 'Title is required.'), summary: z.string().max(4000), body: z.string().min(1, 'Body is required.'), tags: z.string(), technologies: z.string(), language: z.string(), difficulty: z.enum(['', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']), repositoryUrl: z.string().url('Use a valid URL.').or(z.literal('')), mood: z.string(), question: z.string(), context: z.string(), form: z.enum(['ESSAY', 'STORY', 'BOOK', 'OTHER']), stage: z.enum(['IDEA', 'DRAFT', 'REVISION', 'FINAL']), wordCount: z.union([z.number().int().min(0), z.nan()]).optional() }).superRefine((value, ctx) => {
  if (value.kind === 'TECH' && value.technologies.split(',').map((item) => item.trim()).filter(Boolean).length === 0) ctx.addIssue({ code: 'custom', path: ['technologies'], message: 'Add at least one technology.' })
})
type ContentForm = z.infer<typeof contentSchema>
const emptyForm: ContentForm = { kind: 'TECH', slug: '', title: '', summary: '', body: '', tags: '', technologies: '', language: '', difficulty: '', repositoryUrl: '', mood: '', question: '', context: '', form: 'ESSAY', stage: 'IDEA', wordCount: undefined }

function formFromContent(content: Content): ContentForm {
  const metadata = content.metadata ?? {}
  return { ...emptyForm, kind: content.kind, slug: content.slug, title: content.title, summary: content.summary, body: content.body ?? '', tags: content.tags.join(', '), technologies: 'technologies' in metadata ? metadata.technologies.join(', ') : '', language: 'language' in metadata ? metadata.language ?? '' : '', difficulty: 'difficulty' in metadata ? metadata.difficulty ?? '' : '', repositoryUrl: 'repositoryUrl' in metadata ? metadata.repositoryUrl ?? '' : '', mood: 'mood' in metadata ? metadata.mood ?? '' : '', question: 'question' in metadata ? metadata.question ?? '' : '', context: 'context' in metadata ? metadata.context ?? '' : '', form: 'form' in metadata ? metadata.form : 'ESSAY', stage: 'stage' in metadata ? metadata.stage : 'IDEA', wordCount: 'wordCount' in metadata ? metadata.wordCount : undefined }
}

function metadataFromForm(input: ContentForm): ContentInput['metadata'] {
  if (input.kind === 'TECH') {
    const metadata: TechMetadata = { technologies: input.technologies.split(',').map((item) => item.trim()).filter(Boolean) }
    if (input.language.trim()) metadata.language = input.language.trim()
    if (input.difficulty) metadata.difficulty = input.difficulty
    if (input.repositoryUrl.trim()) metadata.repositoryUrl = input.repositoryUrl.trim()
    return metadata
  }
  if (input.kind === 'THOUGHT') {
    const metadata: ThoughtMetadata = {}
    if (input.mood.trim()) metadata.mood = input.mood.trim()
    if (input.question.trim()) metadata.question = input.question.trim()
    if (input.context.trim()) metadata.context = input.context.trim()
    return metadata
  }
  const metadata: ManuscriptMetadata = { form: input.form, stage: input.stage }
  if (input.wordCount !== undefined && !Number.isNaN(input.wordCount)) metadata.wordCount = input.wordCount
  return metadata
}

export function ContentWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Content | null>(null)
  const [kindFilter, setKindFilter] = useState<'ALL' | Content['kind']>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | Content['status']>('ALL')
  const contents = useQuery({ queryKey: ['admin-content', kindFilter, statusFilter], queryFn: () => client.adminContent({ kind: kindFilter === 'ALL' ? undefined : kindFilter, status: statusFilter === 'ALL' ? undefined : statusFilter }) })
  const form = useForm<ContentForm>({ resolver: zodResolver(contentSchema), defaultValues: emptyForm })
  const resetForm = (content?: Content) => { setSelected(content ?? null); form.reset(content ? formFromContent(content) : emptyForm) }
  const save = useMutation({ mutationFn: (input: ContentForm) => selected ? client.updateContent(selected.id, { title: input.title, summary: input.summary, body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFromForm(input), expectedVersion: selected.version }) : client.createContent({ kind: input.kind, slug: input.slug, title: input.title, summary: input.summary, body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFromForm(input) } as ContentInput), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-content'] }); resetForm() } })
  const transition = useMutation<Content | void, Error, { id: string; action: 'publish' | 'unpublish' | 'delete' }>({ mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : client.deleteContent(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-content'] }) })

  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Records</p><h1>Keep the important things.</h1><p className="subheading">Capture technology, thoughts, and manuscripts without adding unrelated sections.</p></div><Button className="button button-primary" type="button" onClick={() => resetForm()} leftSection={<Plus size={16} />}>New record</Button></div>
    <div className="content-layout">
      <section className="panel content-list"><div className="panel-heading"><div><h2>All records</h2><span className="count-badge">{contents.data?.data.length ?? 0}</span></div><div className="filter-row"><Select id="kind-filter" aria-label="Filter by kind" value={kindFilter} onChange={(value) => setKindFilter((value ?? 'ALL') as typeof kindFilter)} data={[{ value: 'ALL', label: 'All records' }, { value: 'TECH', label: 'Technology' }, { value: 'THOUGHT', label: 'Thoughts' }, { value: 'MANUSCRIPT', label: 'Manuscripts' }]} /><Select id="status-filter" aria-label="Filter by status" value={statusFilter} onChange={(value) => setStatusFilter((value ?? 'ALL') as typeof statusFilter)} data={[{ value: 'ALL', label: 'All states' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'PUBLISHED', label: 'Published' }, { value: 'DELETED', label: 'Deleted' }]} /></div></div>{contents.isLoading && <p className="muted">Loading records...</p>}{contents.data?.data.map((content) => <article className={
        `content-row ${selected?.id === content.id ? 'selected' : ''}`
      } key={content.id} onClick={() => content.status === 'DELETED' ? undefined : resetForm(content)}><div><div className="row-title"><span className={`status-dot ${content.status.toLowerCase()}`} />{content.title}</div><p>{content.kind} · {content.slug}</p></div><div className="row-actions"><span className="status-label">{content.status}</span>{content.status === 'DRAFT' && <ActionIcon color="teal" variant="light" type="button" title="Publish" aria-label={`Publish ${content.title}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'publish' }) }}><Send size={14} /></ActionIcon>}{content.status === 'PUBLISHED' && <ActionIcon variant="light" type="button" title="Unpublish" aria-label={`Unpublish ${content.title}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'unpublish' }) }}><X size={14} /></ActionIcon>}{content.status !== 'DELETED' && <ActionIcon color="red" variant="light" type="button" title="Delete" aria-label={`Delete ${content.title}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'delete' }) }}><Trash2 size={14} /></ActionIcon>}</div></article>)}</section>
      <section className="panel editor-panel"><div className="panel-heading"><div><p className="kicker">{selected ? 'Edit record' : 'New record'}</p><h2>{selected ? selected.title : 'Start a draft'}</h2></div>{selected && <ActionIcon variant="subtle" type="button" aria-label="Clear editor" onClick={() => resetForm()}><X size={18} /></ActionIcon>}</div><form className="form-stack" onSubmit={form.handleSubmit((input) => save.mutate(input))}><div className="form-grid"><Select label="Kind" value={form.watch('kind')} onChange={(value) => form.setValue('kind', (value ?? 'TECH') as ContentForm['kind'])} disabled={Boolean(selected)} data={[{ value: 'TECH', label: 'Technology' }, { value: 'THOUGHT', label: 'Thought' }, { value: 'MANUSCRIPT', label: 'Manuscript' }]} /><TextInput label="Slug" {...form.register('slug')} placeholder="a-stable-slug" disabled={Boolean(selected)} error={form.formState.errors.slug?.message} /></div><TextInput label="Title" {...form.register('title')} placeholder="A title that earns its space" error={form.formState.errors.title?.message} /><Textarea label="Summary" {...form.register('summary')} minRows={2} placeholder="A compact description for the record" /><Textarea label="Body" {...form.register('body')} minRows={12} placeholder="Markdown is welcome" error={form.formState.errors.body?.message} /><TextInput label="Tags" {...form.register('tags')} placeholder="systems, design" />{form.watch('kind') === 'TECH' && <div className="form-stack"><TextInput label="Technology stack" {...form.register('technologies')} placeholder="Go, SQLite, Next.js" error={form.formState.errors.technologies?.message} /><div className="form-grid"><TextInput label="Language" {...form.register('language')} placeholder="中文 / English" /><Select label="Difficulty" value={form.watch('difficulty')} onChange={(value) => form.setValue('difficulty', (value ?? '') as ContentForm['difficulty'])} data={[{ value: '', label: 'Not specified' }, { value: 'BEGINNER', label: 'Beginner' }, { value: 'INTERMEDIATE', label: 'Intermediate' }, { value: 'ADVANCED', label: 'Advanced' }]} /></div><TextInput label="Repository URL" {...form.register('repositoryUrl')} placeholder="https://github.com/..." /></div>}{form.watch('kind') === 'THOUGHT' && <div className="form-stack"><TextInput label="Mood" {...form.register('mood')} placeholder="Curious, unsettled, hopeful" /><TextInput label="Question" {...form.register('question')} placeholder="What question is this thought carrying?" /><Textarea label="Context" {...form.register('context')} minRows={3} placeholder="What prompted this thought?" /></div>}{form.watch('kind') === 'MANUSCRIPT' && <div className="form-stack"><div className="form-grid"><Select label="Form" value={form.watch('form')} onChange={(value) => form.setValue('form', (value ?? 'ESSAY') as ContentForm['form'])} data={[{ value: 'ESSAY', label: 'Essay' }, { value: 'STORY', label: 'Story' }, { value: 'BOOK', label: 'Book' }, { value: 'OTHER', label: 'Other' }]} /><Select label="Stage" value={form.watch('stage')} onChange={(value) => form.setValue('stage', (value ?? 'IDEA') as ContentForm['stage'])} data={[{ value: 'IDEA', label: 'Idea' }, { value: 'DRAFT', label: 'Draft' }, { value: 'REVISION', label: 'Revision' }, { value: 'FINAL', label: 'Final' }]} /></div><TextInput type="number" label="Word count" min={0} {...form.register('wordCount', { valueAsNumber: true })} /></div>}{save.isError && <Alert color="red" variant="light">Could not save this record. Check the fields and try again.</Alert>}<Button className="button button-primary" type="submit" loading={save.isPending} leftSection={<Save size={16} />}>{save.isPending ? 'Saving...' : selected ? 'Save changes' : 'Create draft'}</Button></form></section>
    </div>
  </section>
}

export default ContentWorkspace
