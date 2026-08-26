import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Alert, Button, Select, Textarea, TextInput } from '@mantine/core'
import { Eye, Heart, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useForm } from 'react-hook-form'
import type { ArticleMetadata, Content, ContentInput, ThoughtMetadata } from '@manifold/contracts'
import { z } from 'zod'
import { createAdminClient } from '../api'

const schema = z.object({ kind: z.enum(['THOUGHT', 'ARTICLE']), slug: z.string(), title: z.string(), summary: z.string().max(4000), body: z.string().min(1, 'Content is required.'), tags: z.string(), mood: z.string(), question: z.string(), context: z.string(), source: z.string(), readingMinutes: z.number().int().min(0).optional(), frontmatter: z.string(), technologies: z.string(), language: z.string(), difficulty: z.enum(['', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']) }).superRefine((value, context) => {
  if (value.kind === 'ARTICLE') {
    if (!value.slug.trim()) context.addIssue({ code: 'custom', path: ['slug'], message: 'Articles require a slug.' })
    if (!value.title.trim()) context.addIssue({ code: 'custom', path: ['title'], message: 'Articles require a title.' })
    if (value.frontmatter.trim()) {
      try {
        const parsed: unknown = JSON.parse(value.frontmatter)
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some((item) => typeof item !== 'string')) context.addIssue({ code: 'custom', path: ['frontmatter'], message: 'Use a JSON object with string values.' })
      } catch {
        context.addIssue({ code: 'custom', path: ['frontmatter'], message: 'Frontmatter must be valid JSON.' })
      }
    }
  }
})
type Form = z.infer<typeof schema>
const empty: Form = { kind: 'THOUGHT', slug: '', title: '', summary: '', body: '', tags: '', mood: '', question: '', context: '', source: '', readingMinutes: undefined, frontmatter: '', technologies: '', language: '', difficulty: '' }
const languageOptions = ['Go', 'TypeScript', 'JavaScript', 'Python', 'Rust', 'C', 'C++', 'Java', 'Kotlin', 'Swift', 'SQL', 'Bash', 'Markdown', 'Other'].map((value) => ({ value, label: value }))

function fromContent(content: Content): Form {
  const metadata = content.metadata
  return { ...empty, kind: content.kind, slug: content.slug ?? '', title: content.title ?? '', summary: content.summary, body: content.body ?? '', tags: content.tags.join(', '), mood: 'mood' in metadata ? metadata.mood ?? '' : '', question: 'question' in metadata ? metadata.question ?? '' : '', context: 'context' in metadata ? metadata.context ?? '' : '', source: 'source' in metadata ? metadata.source ?? '' : '', readingMinutes: 'readingMinutes' in metadata ? metadata.readingMinutes : undefined, frontmatter: 'frontmatter' in metadata ? JSON.stringify(metadata.frontmatter, null, 2) : '', technologies: 'technologies' in metadata ? metadata.technologies?.join(', ') ?? '' : '', language: 'language' in metadata ? metadata.language ?? '' : '', difficulty: 'difficulty' in metadata ? metadata.difficulty ?? '' : '' }
}

function metadataFrom(form: Form): ContentInput['metadata'] {
  if (form.kind === 'THOUGHT') {
    const metadata: ThoughtMetadata = {}
    if (form.mood.trim()) metadata.mood = form.mood.trim()
    if (form.question.trim()) metadata.question = form.question.trim()
    if (form.context.trim()) metadata.context = form.context.trim()
    if (form.source.trim()) metadata.source = form.source.trim()
    return metadata
  }
  const metadata: ArticleMetadata = {}
  if (form.frontmatter.trim()) metadata.frontmatter = JSON.parse(form.frontmatter) as Record<string, string>
  if (form.technologies.trim()) metadata.technologies = form.technologies.split(',').map((item) => item.trim()).filter(Boolean)
  if (form.language.trim()) metadata.language = form.language.trim()
  if (form.difficulty) metadata.difficulty = form.difficulty
  return metadata
}

export function ContentWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Content | null>(null)
  const [filter, setFilter] = useState<'ALL' | Content['kind']>('ALL')
  const contents = useQuery({ queryKey: ['admin-content', filter], queryFn: () => client.adminContent({ kind: filter === 'ALL' ? undefined : filter }) })
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: empty })
  const reset = (content?: Content) => { setSelected(content ?? null); form.reset(content ? fromContent(content) : empty) }
  const save = useMutation({ mutationFn: (input: Form) => selected ? client.updateContent(selected.id, { kind: input.kind, slug: input.slug || null, title: input.title || undefined, summary: input.summary, body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFrom(input), expectedVersion: selected.version }) : client.createContent({ kind: input.kind, slug: input.slug || null, title: input.title || null, summary: input.summary, body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFrom(input) } as ContentInput), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-content'] }); reset() } })
  const transition = useMutation<Content | void, Error, { id: string; action: 'publish' | 'unpublish' | 'delete' }>({ mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : client.deleteContent(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-content'] }) })
  const kind = form.watch('kind')
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Content studio</p><h1>Publish the useful parts.</h1><p className="subheading">Thoughts stay light. Writings get the full reading surface.</p></div><Button className="button button-primary" onClick={() => reset()} leftSection={<Plus size={16} />}>New piece</Button></div><div className="content-layout"><section className="panel content-list"><div className="panel-heading"><div><h2>All pieces</h2><span className="count-badge">{contents.data?.data.length ?? 0}</span></div><Select aria-label="Filter by type" value={filter} onChange={(value) => setFilter((value ?? 'ALL') as typeof filter)} data={[{ value: 'ALL', label: 'All pieces' }, { value: 'THOUGHT', label: 'Thoughts' }, { value: 'ARTICLE', label: 'Writings' }]} /></div>{contents.data?.data.map((content) => <article className={`content-row ${selected?.id === content.id ? 'selected' : ''}`} key={content.id} onClick={() => reset(content)}><div><div className="row-title"><span className={`status-dot ${content.status.toLowerCase()}`} />{content.title || 'Untitled thought'}</div><p>{content.kind} · {content.slug || content.id}</p><small className="content-stats"><Eye size={12} /> {content.viewCount} views <Heart size={12} /> {content.likeCount} likes</small></div><div className="row-actions"><span className="status-label">{content.status}</span>{content.status === 'DRAFT' && <ActionIcon title="Publish" aria-label={`Publish ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'publish' }) }}><Send size={14} /></ActionIcon>}{content.status === 'PUBLISHED' && <ActionIcon title="Unpublish" aria-label={`Unpublish ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'unpublish' }) }}><X size={14} /></ActionIcon>}{content.status !== 'DELETED' && <ActionIcon title="Delete" aria-label={`Delete ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'delete' }) }}><Trash2 size={14} /></ActionIcon>}</div></article>)}</section><section className="panel editor-panel"><div className="panel-heading"><div><p className="kicker">{selected ? 'Edit piece' : 'Quick capture'}</p><h2>{kind === 'THOUGHT' ? 'A thought, before it fades.' : 'A writing worth returning to.'}</h2></div>{selected && <ActionIcon aria-label="Clear editor" onClick={() => reset()}><X size={18} /></ActionIcon>}</div><form className="form-stack" onSubmit={form.handleSubmit((input) => save.mutate(input))}><div className="form-grid"><Select label="Mode" value={kind} onChange={(value) => form.setValue('kind', (value ?? 'THOUGHT') as Form['kind'])} data={[{ value: 'THOUGHT', label: 'Thought · quick post' }, { value: 'ARTICLE', label: 'Writing · full editor' }]} /><TextInput label="Slug" {...form.register('slug')} placeholder={kind === 'THOUGHT' ? 'Optional; ID is used by default' : 'a-readable-url'} disabled={false} error={form.formState.errors.slug?.message} /></div><TextInput label="Title" {...form.register('title')} placeholder={kind === 'THOUGHT' ? 'Optional' : 'A title with a clear promise'} error={form.formState.errors.title?.message} />{kind === 'ARTICLE' && <Textarea label="Summary" {...form.register('summary')} minRows={3} placeholder="A short promise for archive cards and search." error={form.formState.errors.summary?.message} />}{kind === 'ARTICLE' ? <div className="form-grid article-editor-grid"><div><Textarea label="Markdown content" {...form.register('body')} minRows={18} error={form.formState.errors.body?.message} /><p className="field-hint">Headings at level 2 and 3 become the reading outline automatically.</p></div><div><p className="kicker">Live preview</p><div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeSanitize, rehypeKatex, rehypeHighlight]}>{form.watch('body')}</ReactMarkdown></div></div></div> : <Textarea label="Thought" {...form.register('body')} minRows={7} error={form.formState.errors.body?.message} />}<TextInput label="Tags" {...form.register('tags')} placeholder="systems, reading" />{kind === 'THOUGHT' ? <div className="form-stack"><TextInput label="Mood" {...form.register('mood')} /><TextInput label="Question" {...form.register('question')} /><Textarea label="Context" {...form.register('context')} minRows={3} /><TextInput label="Source" {...form.register('source')} placeholder="Optional book, paper, or conversation" /></div> : <div className="form-stack article-metadata-stack"><div className="form-grid"><TextInput label="Estimated reading time" value={form.watch('readingMinutes') ? `${form.watch('readingMinutes')} min` : 'Calculated on save'} readOnly /><Select label="Language" value={form.watch('language') || null} onChange={(value) => form.setValue('language', value ?? '')} data={languageOptions} clearable /></div><Textarea label="Frontmatter JSON" {...form.register('frontmatter')} minRows={4} placeholder='{"series":"systems"}' error={form.formState.errors.frontmatter?.message} /><TextInput label="Technology tags" {...form.register('technologies')} placeholder="Go, SQLite, Next.js" /><Select label="Difficulty" value={form.watch('difficulty')} onChange={(value) => form.setValue('difficulty', (value ?? '') as Form['difficulty'])} data={[{ value: '', label: 'Not specified' }, { value: 'BEGINNER', label: 'Beginner' }, { value: 'INTERMEDIATE', label: 'Intermediate' }, { value: 'ADVANCED', label: 'Advanced' }]} /></div>}{save.isError && <Alert color="red">Could not save this piece. Check the fields and Core status.</Alert>}<Button className="button button-primary" type="submit" loading={save.isPending} leftSection={<Save size={16} />}>{selected ? 'Save changes' : 'Save draft'}</Button></form></section></div></section>
}

export default ContentWorkspace
