import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Select, Switch, TextInput } from '@mantine/core'
import { ArrowDown, ArrowUp, Check, Save, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import type { AdminContent, HomepageSection, SiteConfig } from '@manifold/contracts'
import { createAdminClient } from './api'
import { LinkRowsField } from './components/LinkRowsField'
import { settingsSchema, type SiteSettingsForm } from './lib/siteSettingsSchema'

const sectionLabels: Record<HomepageSection, string> = {
  PROFILE: 'Profile',
  BACKGROUND: 'Background',
  RECENT_CONTENT: 'Recent content',
  UPDATES: 'Updates',
  SERIES: 'My Series',
  CONTACT: 'Contact',
}

const sectionOrder: HomepageSection[] = ['PROFILE', 'BACKGROUND', 'RECENT_CONTENT', 'UPDATES', 'SERIES', 'CONTACT']

const thoughtSchema = z.object({ featuredThoughtId: z.string() })

type ThoughtForm = z.infer<typeof thoughtSchema>

function settingsValues(site: SiteConfig): SiteSettingsForm {
  return {
    title: site.title,
    description: site.description,
    footer: site.footer,
    social: (site.social ?? []).map((item) => ({ label: item.label, href: item.href, external: Boolean(item.external) })),
    commentsEnabled: site.commentsEnabled,
    featuredContent: (site.featuredContent ?? []).map((item) => ({ id: item.id, kind: item.kind })),
    navigation: (site.navigation ?? []).map((item) => ({ label: item.label, href: item.href, external: Boolean(item.external) })),
    sections: site.sections ?? [],
  }
}

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
  const publishedWritings = useQuery({ queryKey: ['admin-content', 'ARTICLE', 'PUBLISHED'], queryFn: async () => {
    const items: AdminContent[] = []
    let cursor: string | undefined
    do {
      const page = await client.adminContent({ kind: 'ARTICLE', status: 'PUBLISHED', limit: 50, cursor })
      items.push(...page.data)
      cursor = page.pagination.nextCursor ?? undefined
    } while (cursor)
    return items
  } })
  const form = useForm<SiteSettingsForm>({ resolver: zodResolver(settingsSchema), defaultValues: { title: '', description: '', footer: '', social: [], commentsEnabled: true, featuredContent: [], navigation: [], sections: [] } })
  const thoughtForm = useForm<ThoughtForm>({ resolver: zodResolver(thoughtSchema), defaultValues: { featuredThoughtId: '' } })
  useEffect(() => { if (site.data) form.reset(settingsValues(site.data)) }, [site.data, form])
  useEffect(() => { if (thoughtConfig.data) thoughtForm.reset({ featuredThoughtId: thoughtConfig.data.featuredThoughtId ?? '' }) }, [thoughtConfig.data, thoughtForm])
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current) }, [])
  const saveSite = useMutation({
    mutationFn: (input: SiteSettingsForm) => client.updateSite(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-site'] })
      setSavedFlash(true)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2400)
    },
  })
  const saveThought = useMutation({ mutationFn: (input: ThoughtForm) => client.updateThoughtConfig({ featuredThoughtId: input.featuredThoughtId || null }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-thought-config'] }) })
  const sections = form.watch('sections')
  const featured = form.watch('featuredContent')
  const setSections = (next: HomepageSection[]) => form.setValue('sections', next, { shouldDirty: true })
  const toggleSection = (section: HomepageSection, enabled: boolean) => {
    if (enabled) {
      const next = [...sectionOrder.filter((item) => sections.includes(item) || item === section)]
      setSections(next)
    } else {
      const next = sections.filter((item) => item !== section)
      if (next.length) setSections(next)
    }
  }
  const moveSection = (index: number, offset: -1 | 1) => {
    const next = [...sections]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setSections(next)
  }
  const featuredOptions = [
    ...(publishedWritings.data ?? []).map((item) => ({ value: `ARTICLE:${item.id}`, label: `Writing · ${item.title || 'Untitled writing'}` })),
    ...(publishedThoughts.data ?? []).map((item) => ({ value: `THOUGHT:${item.id}`, label: `Thought · ${item.title || 'Untitled thought'}` })),
  ]
  const addFeatured = (key: string | null) => {
    if (!key) return
    const [kind, id] = key.split(':') as ['THOUGHT' | 'ARTICLE', string]
    if (featured.some((item) => item.id === id)) return
    form.setValue('featuredContent', [...featured, { id, kind }], { shouldDirty: true })
  }
  const moveFeatured = (index: number, offset: -1 | 1) => {
    const next = [...featured]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    form.setValue('featuredContent', next, { shouldDirty: true })
  }
  const removeFeatured = (id: string) => form.setValue('featuredContent', featured.filter((item) => item.id !== id), { shouldDirty: true })
  const discard = () => { if (site.data) form.reset(settingsValues(site.data)) }
  const errors = form.formState.errors
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Configuration</p><h1>Site settings.</h1><p className="subheading">Identity, navigation, comments, and homepage composition for the public site.</p></div></div>
    {site.isError && <Alert color="red" variant="light">Site configuration could not be loaded.</Alert>}
    {saveSite.isError && <Alert color="red" variant="light">Site configuration could not be saved. Fix the highlighted fields and try again.</Alert>}
    <form id="site-settings-form" noValidate onSubmit={form.handleSubmit((input) => saveSite.mutate(input))}>
      <section className="panel" id="site-identity">
        <div className="panel-heading"><div><p className="kicker">Identity</p><h2>Title, description, and footer</h2></div></div>
        <div className="form-stack">
          <TextInput label="Site title" description="Drives the browser title, SEO metadata, and RSS channel name." {...form.register('title')} error={errors.title?.message} />
          <TextInput label="Description" description={`${form.watch('description').length}/200 · Used as the default SEO and RSS description.`} {...form.register('description')} error={errors.description?.message} />
          <TextInput label="Footer text" description={`${form.watch('footer').length}/200 · Shown on the bottom line of every page.`} {...form.register('footer')} error={errors.footer?.message} />
          <div><label>Social links</label><LinkRowsField form={form} name="social" addLabel="Add social link" maxRows={6} /></div>
        </div>
      </section>
      <section className="panel" id="site-navigation">
        <div className="panel-heading"><div><p className="kicker">Navigation</p><h2>Primary navigation</h2></div><span className="count-badge">{form.watch('navigation').length} links</span></div>
        <div className="form-stack">
          <LinkRowsField form={form} name="navigation" addLabel="Add navigation link" maxRows={10} />
          <p className="icon-hint">Internal links look like /writing or /thoughts; external links use full URLs.</p>
        </div>
      </section>
      <section className="panel" id="site-comments">
        <div className="panel-heading"><div><p className="kicker">Comments</p><h2>Public discussions</h2></div></div>
        <div className="form-stack">
          <Controller control={form.control} name="commentsEnabled" render={({ field }) => <Switch
            label="Allow public comments"
            description="When off, comment forms disappear from the site and the public API rejects new comments with 403."
            checked={field.value}
            onChange={(event) => field.onChange(event.currentTarget.checked)}
          />} />
          {errors.commentsEnabled && <Alert color="red" variant="light">{errors.commentsEnabled.message}</Alert>}
        </div>
      </section>
      <section className="panel" id="site-homepage">
        <div className="panel-heading"><div><p className="kicker">Homepage</p><h2>Sections and featured content</h2></div></div>
        <div className="form-stack">
          <div>
            <label>Homepage sections</label>
            <div className="section-picker">
              {sectionOrder.map((section) => {
                const index = sections.indexOf(section)
                return <div className={`section-option ${index >= 0 ? 'active' : ''}`} key={section} data-active={index >= 0 ? 'true' : 'false'}>
                  <button type="button" className="section-option-toggle" aria-pressed={index >= 0} onClick={() => toggleSection(section, index < 0)}>
                    <span className="section-option-index">{index >= 0 ? String(index + 1).padStart(2, '0') : '··'}</span>
                    <span>{sectionLabels[section]}</span>
                  </button>
                  {index >= 0 && <div className="list-row-actions">
                    <button type="button" className="mini-button" aria-label={`Move ${sectionLabels[section]} up`} disabled={index === 0} onClick={() => moveSection(index, -1)}><ArrowUp size={14} /></button>
                    <button type="button" className="mini-button" aria-label={`Move ${sectionLabels[section]} down`} disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)}><ArrowDown size={14} /></button>
                  </div>}
                </div>
              })}
            </div>
            {errors.sections && <Alert color="red" variant="light">{errors.sections.message}</Alert>}
          </div>
          <div>
            <label>Featured content</label>
            <Select
              placeholder="Pin a writing or thought to the top of its homepage column"
              searchable
              clearable
              data={featuredOptions.filter((option) => !featured.some((item) => option.value.endsWith(`:${item.id}`)))}
              onChange={addFeatured}
              value={null}
            />
            <div className="list-stack">
              {featured.map((item, index) => {
                const option = featuredOptions.find((entry) => entry.value === `${item.kind}:${item.id}`)
                return <div className="list-row" key={item.id}>
                  <div className="list-row-top link-row">
                    <span className="list-index"><Star size={13} /></span>
                    <div className="featured-row-label">{option?.label ?? `${item.kind} · ${item.id}`}</div>
                    <div className="list-row-actions">
                      <button type="button" className="mini-button" aria-label="Move up" disabled={index === 0} onClick={() => moveFeatured(index, -1)}><ArrowUp size={14} /></button>
                      <button type="button" className="mini-button" aria-label="Move down" disabled={index === featured.length - 1} onClick={() => moveFeatured(index, 1)}><ArrowDown size={14} /></button>
                      <button type="button" className="mini-button danger" aria-label="Remove" onClick={() => removeFeatured(item.id)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              })}
              {!featured.length && <p className="icon-hint">Nothing pinned yet — homepage columns show the latest content.</p>}
            </div>
          </div>
        </div>
      </section>
    </form>
    <section className="panel narrow-panel" id="site-pinned-thought">
      <div className="panel-heading"><div><p className="kicker">Thoughts</p><h2>Pinned thought</h2></div></div>
      <form className="form-stack" onSubmit={thoughtForm.handleSubmit((input) => saveThought.mutate(input))}>
        <Controller control={thoughtForm.control} name="featuredThoughtId" render={({ field }) => <Select label="Pinned thought" description="Shown at the top of the public Thoughts page." placeholder="Use the latest published thought" clearable searchable data={(publishedThoughts.data ?? []).map((item) => ({ value: item.id, label: item.title || `Untitled thought · ${item.id}` }))} value={field.value} onBlur={field.onBlur} onChange={(value) => field.onChange(value ?? '')} />} />
        <Button className="button button-primary" type="submit" loading={saveThought.isPending} leftSection={<Save size={16} />}>Save pinned thought</Button>
        {saveThought.isError && <Alert color="red" variant="light">Pinned thought could not be saved.</Alert>}
      </form>
    </section>
    {form.formState.isDirty && <div className="save-bar">
      <span>Unsaved changes</span>
      <div className="save-bar-actions">
        <Button variant="default" onClick={discard}>Discard</Button>
        <Button className="button button-primary" type="submit" form="site-settings-form" loading={saveSite.isPending} leftSection={savedFlash ? <Check size={16} /> : <Save size={16} />}>{savedFlash ? 'Saved' : 'Save site settings'}</Button>
      </div>
    </div>}
  </section>
}

export default SettingsWorkspace
