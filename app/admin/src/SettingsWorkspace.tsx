import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Select, Textarea, TextInput } from '@mantine/core'
import { Save } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import type { AdminContent } from '@manifold/contracts'
import { createAdminClient } from './api'

const navigationSchema = z.object({ label: z.string().trim().min(1).max(80), href: z.string().trim().min(1).max(200), external: z.boolean() })
const siteSchema = z.object({ navigation: z.string().min(1), sections: z.string().min(1) }).superRefine((value, context) => {
  try {
    const navigation = JSON.parse(value.navigation)
    const parsed = z.array(navigationSchema).min(1).max(10).safeParse(navigation)
    if (!parsed.success) context.addIssue({ code: 'custom', path: ['navigation'], message: 'Use a JSON array of navigation items.' })
  } catch {
    context.addIssue({ code: 'custom', path: ['navigation'], message: 'Navigation must be valid JSON.' })
  }
  if (value.sections.split(',').map((item) => item.trim()).filter(Boolean).length === 0) context.addIssue({ code: 'custom', path: ['sections'], message: 'Add at least one section.' })
})
const thoughtSchema = z.object({ featuredThoughtId: z.string() })

type SiteForm = z.infer<typeof siteSchema>
type ThoughtForm = z.infer<typeof thoughtSchema>

export function SettingsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const site = useQuery({ queryKey: ['admin-site'], queryFn: () => client.adminSite() })
  const thoughtConfig = useQuery({ queryKey: ['admin-thought-config'], queryFn: () => client.adminThoughtConfig() })
  const publishedThoughts = useQuery({ queryKey: ['admin-content', 'THOUGHT', 'PUBLISHED'], queryFn: async () => {
    const items: AdminContent[] = []
    let cursor: string | undefined
    do {
      const page = await client.adminContent({ kind: 'THOUGHT', status: 'PUBLISHED', limit: 50, cursor })
      items.push(...page.data)
      cursor = page.pagination.nextCursor ?? undefined
    } while (cursor)
    return items
  } })
  const siteForm = useForm<SiteForm>({ resolver: zodResolver(siteSchema), defaultValues: { navigation: '[]', sections: '' } })
  const thoughtForm = useForm<ThoughtForm>({ resolver: zodResolver(thoughtSchema), defaultValues: { featuredThoughtId: '' } })
  useEffect(() => { if (site.data) siteForm.reset({ navigation: JSON.stringify(site.data.navigation, null, 2), sections: site.data.sections.join(', ') }) }, [site.data, siteForm])
  useEffect(() => { if (thoughtConfig.data) thoughtForm.reset({ featuredThoughtId: thoughtConfig.data.featuredThoughtId ?? '' }) }, [thoughtConfig.data, thoughtForm])
  const saveSite = useMutation({ mutationFn: (input: SiteForm) => client.updateSite({ featuredContent: site.data?.featuredContent ?? [], navigation: JSON.parse(input.navigation), sections: input.sections.split(',').map((section) => section.trim()).filter(Boolean) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-site'] }) })
  const saveThought = useMutation({ mutationFn: (input: ThoughtForm) => client.updateThoughtConfig({ featuredThoughtId: input.featuredThoughtId || null }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-thought-config'] }) })
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Configuration</p><h1>Site settings.</h1><p className="subheading">Compose the public homepage: pinned thought, navigation, and sections.</p></div></div>
    <section className="panel narrow-panel">
      <div className="panel-heading"><div><p className="kicker">Public composition</p><h2>Featured content and navigation</h2></div></div>
      <form className="form-stack" onSubmit={thoughtForm.handleSubmit((input) => saveThought.mutate(input))}>
        <Controller control={thoughtForm.control} name="featuredThoughtId" render={({ field }) => <Select label="Pinned thought" description="Shown at the top of the public Thoughts page." placeholder="Use the latest published thought" clearable searchable data={(publishedThoughts.data ?? []).map((item) => ({ value: item.id, label: item.title || `Untitled thought · ${item.id}` }))} value={field.value} onBlur={field.onBlur} onChange={(value) => field.onChange(value ?? '')} />} />
        <Button className="button button-primary" type="submit" loading={saveThought.isPending} leftSection={<Save size={16} />}>Save pinned thought</Button>
        {saveThought.isError && <Alert color="red" variant="light">Pinned thought could not be saved.</Alert>}
      </form>
      <form className="form-stack" onSubmit={siteForm.handleSubmit((input) => saveSite.mutate(input))}>
        <Textarea label="Navigation JSON" {...siteForm.register('navigation')} minRows={8} error={siteForm.formState.errors.navigation?.message} />
        <TextInput label="Sections" {...siteForm.register('sections')} placeholder="PROFILE, CV, RECENT_ACTIVITY" error={siteForm.formState.errors.sections?.message} />
        <Button className="button button-primary" type="submit" loading={saveSite.isPending} leftSection={<Save size={16} />}>Save composition</Button>
        {saveSite.isError && <Alert color="red" variant="light">Site configuration could not be saved.</Alert>}
      </form>
    </section>
  </section>
}

export default SettingsWorkspace
