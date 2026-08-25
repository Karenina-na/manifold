import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Textarea, TextInput } from '@mantine/core'
import { Save } from 'lucide-react'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import type { NowStatus } from '@manifold/contracts'
import { z } from 'zod'
import { createAdminClient } from '../api'

const nowSchema = z.object({ title: z.string().trim().min(1, 'Title is required.'), detail: z.string(), mood: z.string().min(1, 'Mood is required.') })
type NowForm = z.infer<typeof nowSchema>

export function NowWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const current = useQuery({ queryKey: ['now'], queryFn: () => client.now() })
  const form = useForm<NowForm>({ resolver: zodResolver(nowSchema), values: current.data ? { title: current.data.title, detail: current.data.detail, mood: current.data.mood } : undefined })
  const mutation = useMutation({ mutationFn: (input: NowForm) => client.updateNow({ ...input, updatedAt: current.data?.updatedAt ?? new Date().toISOString() } as NowStatus), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['now'] }) })
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Presence</p><h1>Current status</h1><p className="subheading">Set the title, detail, and mood shown on the homepage.</p></div></div><section className="panel narrow-panel"><div className="panel-heading"><div><p className="kicker">Public status</p><h2>Now status</h2></div><Badge color="teal" variant="light" leftSection={<span className="status-dot published" />}>Live</Badge></div><form className="form-stack" onSubmit={form.handleSubmit((input) => mutation.mutate(input))}><TextInput label="Title" {...form.register('title')} placeholder="Current project" error={form.formState.errors.title?.message} /><Textarea label="Detail" {...form.register('detail')} minRows={6} placeholder="Describe what you are working on" /><TextInput label="Mood" {...form.register('mood')} placeholder="FOCUSED" error={form.formState.errors.mood?.message} /><Button className="button button-primary" type="submit" loading={mutation.isPending} leftSection={<Save size={16} />}>{mutation.isPending ? 'Updating...' : 'Update now'}</Button>{mutation.isSuccess && <p className="success-text">Now status updated.</p>}</form></section></section>
}

export default NowWorkspace
