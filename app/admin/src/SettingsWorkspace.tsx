import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Switch, TextInput } from '@mantine/core'
import { ArrowDown, ArrowUp, Check, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { HomepageSection, SiteConfig } from '@manifold/contracts'
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

function settingsValues(site: SiteConfig): SiteSettingsForm {
  return {
    title: site.title,
    description: site.description,
    footer: site.footer,
    social: (site.social ?? []).map((item) => ({ label: item.label, href: item.href, external: Boolean(item.external) })),
    commentsEnabled: site.commentsEnabled,
    navigation: (site.navigation ?? []).map((item) => ({ label: item.label, href: item.href, external: Boolean(item.external) })),
    sections: site.sections ?? [],
  }
}

export function SettingsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const site = useQuery({ queryKey: ['admin-site'], queryFn: () => client.adminSite() })
  const form = useForm<SiteSettingsForm>({ resolver: zodResolver(settingsSchema), defaultValues: { title: '', description: '', footer: '', social: [], commentsEnabled: true, navigation: [], sections: [] } })
  useEffect(() => { if (site.data) form.reset(settingsValues(site.data)) }, [site.data, form])
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
  const sections = form.watch('sections')
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
        <div className="panel-heading"><div><p className="kicker">Homepage</p><h2>Sections</h2></div></div>
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
        </div>
      </section>
    </form>
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
