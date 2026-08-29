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
import type { AdminContent, ArticleMetadata } from '@manifold/contracts'
import { z } from 'zod'
import { createAdminClient } from '../api'

const schema = z.object({ slug: z.string(), title: z.string(), summary: z.string().max(4000), body: z.string().min(1, 'Content is required.'), tags: z.string(), frontmatter: z.string(), technologies: z.string(), language: z.string(), difficulty: z.enum(['', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']), readingMinutes: z.number().int().min(0).optional() }).superRefine((value, context) => {
  if (!value.slug.trim()) context.addIssue({ code: 'custom', path: ['slug'], message: 'Writings require a slug.' })
  if (!value.title.trim()) context.addIssue({ code: 'custom', path: ['title'], message: 'Writings require a title.' })
  if (value.frontmatter.trim()) {
    try {
      const parsed: unknown = JSON.parse(value.frontmatter)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some((item) => typeof item !== 'string')) context.addIssue({ code: 'custom', path: ['frontmatter'], message: 'Use a JSON object with string values.' })
    } catch {
      context.addIssue({ code: 'custom', path: ['frontmatter'], message: 'Frontmatter must be valid JSON.' })
    }
  }
})
type Form = z.infer<typeof schema>
const empty: Form = { slug: '', title: '', summary: '', body: '', tags: '', frontmatter: '', technologies: '', language: '', difficulty: '', readingMinutes: undefined }
const languageOptions = ['Go', 'TypeScript', 'JavaScript', 'Python', 'Rust', 'C', 'C++', 'Java', 'Kotlin', 'Swift', 'SQL', 'Bash', 'Markdown', 'Other'].map((value) => ({ value, label: value }))

function fromContent(content: AdminContent): Form {
  const metadata = content.metadata
  return { slug: content.slug ?? '', title: content.title ?? '', summary: content.summary, body: content.body ?? '', tags: content.tags.join(', '), frontmatter: 'frontmatter' in metadata ? JSON.stringify(metadata.frontmatter, null, 2) : '', technologies: 'technologies' in metadata ? metadata.technologies?.join(', ') ?? '' : '', language: 'language' in metadata ? metadata.language ?? '' : '', difficulty: 'difficulty' in metadata ? metadata.difficulty ?? '' : '', readingMinutes: 'readingMinutes' in metadata ? metadata.readingMinutes : undefined }
}

function metadataFrom(form: Form): ArticleMetadata {
  const metadata: ArticleMetadata = {}
  if (form.frontmatter.trim()) metadata.frontmatter = JSON.parse(form.frontmatter) as Record<string, string>
  if (form.technologies.trim()) metadata.technologies = form.technologies.split(',').map((item) => item.trim()).filter(Boolean)
  if (form.language.trim()) metadata.language = form.language.trim()
  if (form.difficulty) metadata.difficulty = form.difficulty
  return metadata
}

export function WritingsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<AdminContent | null>(null)
  const writings = useQuery({ queryKey: ['admin-content', 'ARTICLE'], queryFn: () => client.adminContent({ kind: 'ARTICLE' }) })
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: empty })
  const reset = (content?: AdminContent) => { setSelected(content ?? null); form.reset(content ? fromContent(content) : empty) }
  const save = useMutation({ mutationFn: (input: Form) => selected ? client.updateContent(selected.id, { kind: 'ARTICLE', slug: input.slug, title: input.title, summary: input.summary, body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFrom(input), expectedVersion: selected.version }) : client.createContent({ kind: 'ARTICLE', slug: input.slug, title: input.title, summary: input.summary, body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFrom(input) }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-content'] }); void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }); reset() } })
  const transition = useMutation<AdminContent | void, Error, { id: string; action: 'publish' | 'unpublish' | 'delete' }>({ mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : client.deleteContent(id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-content'] }); void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }) } })
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Writings</p><h1>Writings worth returning to.</h1><p className="subheading">Deep technical pieces with the full reading surface.</p></div><Button className="button button-primary" onClick={() => reset()} leftSection={<Plus size={16} />}>New writing</Button></div><div className="content-layout"><section className="panel content-list"><div className="panel-heading"><div><h2>All writings</h2><span className="count-badge">{writings.data?.data.length ?? 0}</span></div></div>{writings.data?.data.map((content) => <article className={`content-row ${selected?.id === content.id ? 'selected' : ''}`} key={content.id} onClick={() => reset(content)}><div><div className="row-title"><span className={`status-dot ${content.status.toLowerCase()}`} />{content.title || 'Untitled writing'}</div><p>{content.slug || content.id}</p><small className="content-stats"><Eye size={12} /> {content.viewCount} views <Heart size={12} /> {content.likeCount} likes</small></div><div className="row-actions"><span className="status-label">{content.status}</span>{content.status === 'DRAFT' && <ActionIcon title="Publish" aria-label={`Publish ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'publish' }) }}><Send size={14} /></ActionIcon>}{content.status === 'PUBLISHED' && <ActionIcon title="Unpublish" aria-label={`Unpublish ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'unpublish' }) }}><X size={14} /></ActionIcon>}{content.status !== 'DELETED' && <ActionIcon title="Delete" aria-label={`Delete ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'delete' }) }}><Trash2 size={14} /></ActionIcon>}</div></article>)}</section><section className="panel editor-panel"><div className="panel-heading"><div><p className="kicker">{selected ? 'Edit writing' : 'New writing'}</p><h2>A writing worth returning to.</h2></div>{selected && <ActionIcon aria-label="Clear editor" onClick={() => reset()}><X size={18} /></ActionIcon>}</div><form className="form-stack" onSubmit={form.handleSubmit((input) => save.mutate(input))}><TextInput label="Slug" {...form.register('slug')} placeholder="a-readable-url" error={form.formState.errors.slug?.message} /><TextInput label="Title" {...form.register('title')} placeholder="A title with a clear promise" error={form.formState.errors.title?.message} /><Textarea label="Summary" {...form.register('summary')} minRows={3} placeholder="A short promise for archive cards and search." error={form.formState.errors.summary?.message} /><div className="form-grid article-editor-grid"><div><Textarea label="Markdown content" {...form.register('body')} minRows={18} error={form.formState.errors.body?.message} /><p className="field-hint">Headings at level 2 and 3 become the reading outline automatically.</p></div><div><p className="kicker">Live preview</p><div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeSanitize, rehypeKatex, rehypeHighlight]}>{form.watch('body')}</ReactMarkdown></div></div></div><TextInput label="Tags" {...form.register('tags')} placeholder="systems, reading" /><div className="form-stack article-metadata-stack"><div className="form-grid"><TextInput label="Estimated reading time" value={form.watch('readingMinutes') ? `${form.watch('readingMinutes')} min` : 'Calculated on save'} readOnly /><Select label="Language" value={form.watch('language') || null} onChange={(value) => form.setValue('language', value ?? '')} data={languageOptions} clearable /></div><Textarea label="Frontmatter JSON" {...form.register('frontmatter')} minRows={4} placeholder='{"series":"systems"}' error={form.formState.errors.frontmatter?.message} /><TextInput label="Technology tags" {...form.register('technologies')} placeholder="Go, SQLite, Next.js" /><Select label="Difficulty" value={form.watch('difficulty')} onChange={(value) => form.setValue('difficulty', (value ?? '') as Form['difficulty'])} data={[{ value: '', label: 'Not specified' }, { value: 'BEGINNER', label: 'Beginner' }, { value: 'INTERMEDIATE', label: 'Intermediate' }, { value: 'ADVANCED', label: 'Advanced' }]} /></div>{save.isError && <Alert color="red">Could not save this writing. Check the fields and Core status.</Alert>}<Button className="button button-primary" type="submit" loading={save.isPending} leftSection={<Save size={16} />}>{selected ? 'Save changes' : 'Save draft'}</Button></form></section></div></section>
}

export default WritingsWorkspace
