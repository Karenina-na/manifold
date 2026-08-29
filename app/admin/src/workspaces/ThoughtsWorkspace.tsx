import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Alert, Button, Textarea, TextInput } from '@mantine/core'
import { Eye, Heart, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { AdminContent, ContentInput, ThoughtMetadata } from '@manifold/contracts'
import { z } from 'zod'
import { createAdminClient } from '../api'

const schema = z.object({ slug: z.string(), title: z.string(), body: z.string().min(1, 'Content is required.'), tags: z.string(), mood: z.string(), question: z.string(), context: z.string(), source: z.string() })
type Form = z.infer<typeof schema>
const empty: Form = { slug: '', title: '', body: '', tags: '', mood: '', question: '', context: '', source: '' }

function fromContent(content: AdminContent): Form {
  const metadata = content.metadata
  return { slug: content.slug ?? '', title: content.title ?? '', body: content.body ?? '', tags: content.tags.join(', '), mood: 'mood' in metadata ? metadata.mood ?? '' : '', question: 'question' in metadata ? metadata.question ?? '' : '', context: 'context' in metadata ? metadata.context ?? '' : '', source: 'source' in metadata ? metadata.source ?? '' : '' }
}

function metadataFrom(form: Form): ThoughtMetadata {
  const metadata: ThoughtMetadata = {}
  if (form.mood.trim()) metadata.mood = form.mood.trim()
  if (form.question.trim()) metadata.question = form.question.trim()
  if (form.context.trim()) metadata.context = form.context.trim()
  if (form.source.trim()) metadata.source = form.source.trim()
  return metadata
}

export function ThoughtsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<AdminContent | null>(null)
  const thoughts = useQuery({ queryKey: ['admin-content', 'THOUGHT'], queryFn: () => client.adminContent({ kind: 'THOUGHT' }) })
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: empty })
  const reset = (content?: AdminContent) => { setSelected(content ?? null); form.reset(content ? fromContent(content) : empty) }
  const save = useMutation({ mutationFn: (input: Form) => selected ? client.updateContent(selected.id, { kind: 'THOUGHT', slug: input.slug || null, title: input.title || undefined, summary: '', body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFrom(input), expectedVersion: selected.version }) : client.createContent({ kind: 'THOUGHT', slug: input.slug || null, title: input.title || null, summary: '', body: input.body, tags: input.tags.split(',').map((tag) => tag.trim()).filter(Boolean), metadata: metadataFrom(input) } as ContentInput), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-content'] }); void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }); reset() } })
  const transition = useMutation<AdminContent | void, Error, { id: string; action: 'publish' | 'unpublish' | 'delete' }>({ mutationFn: ({ id, action }) => action === 'publish' ? client.publishContent(id) : action === 'unpublish' ? client.unpublishContent(id) : client.deleteContent(id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-content'] }); void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }) } })
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Thoughts</p><h1>Capture as you go.</h1><p className="subheading">Fragments, methods, and reading notes that stay light.</p></div><Button className="button button-primary" onClick={() => reset()} leftSection={<Plus size={16} />}>New thought</Button></div><div className="content-layout"><section className="panel content-list"><div className="panel-heading"><div><h2>All thoughts</h2><span className="count-badge">{thoughts.data?.data.length ?? 0}</span></div></div>{thoughts.data?.data.map((content) => <article className={`content-row ${selected?.id === content.id ? 'selected' : ''}`} key={content.id} onClick={() => reset(content)}><div><div className="row-title"><span className={`status-dot ${content.status.toLowerCase()}`} />{content.title || 'Untitled thought'}</div><p>{content.slug || content.id}</p><small className="content-stats"><Eye size={12} /> {content.viewCount} views <Heart size={12} /> {content.likeCount} likes</small></div><div className="row-actions"><span className="status-label">{content.status}</span>{content.status === 'DRAFT' && <ActionIcon title="Publish" aria-label={`Publish ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'publish' }) }}><Send size={14} /></ActionIcon>}{content.status === 'PUBLISHED' && <ActionIcon title="Unpublish" aria-label={`Unpublish ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'unpublish' }) }}><X size={14} /></ActionIcon>}{content.status !== 'DELETED' && <ActionIcon title="Delete" aria-label={`Delete ${content.title || content.id}`} onClick={(event) => { event.stopPropagation(); transition.mutate({ id: content.id, action: 'delete' }) }}><Trash2 size={14} /></ActionIcon>}</div></article>)}</section><section className="panel editor-panel"><div className="panel-heading"><div><p className="kicker">{selected ? 'Edit thought' : 'Quick capture'}</p><h2>A thought, before it fades.</h2></div>{selected && <ActionIcon aria-label="Clear editor" onClick={() => reset()}><X size={18} /></ActionIcon>}</div><form className="form-stack" onSubmit={form.handleSubmit((input) => save.mutate(input))}><div className="form-grid"><TextInput label="Slug" {...form.register('slug')} placeholder="Optional; ID is used by default" /><TextInput label="Title" {...form.register('title')} placeholder="Optional" /></div><Textarea label="Thought" {...form.register('body')} minRows={7} error={form.formState.errors.body?.message} /><TextInput label="Tags" {...form.register('tags')} placeholder="systems, reading" /><div className="form-stack"><TextInput label="Mood" {...form.register('mood')} /><TextInput label="Question" {...form.register('question')} /><Textarea label="Context" {...form.register('context')} minRows={3} /><TextInput label="Source" {...form.register('source')} placeholder="Optional book, paper, or conversation" /></div>{save.isError && <Alert color="red">Could not save this thought. Check the fields and Core status.</Alert>}<Button className="button button-primary" type="submit" loading={save.isPending} leftSection={<Save size={16} />}>{selected ? 'Save changes' : 'Save draft'}</Button></form></section></div></section>
}

export default ThoughtsWorkspace
