import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Switch, TextInput } from '@mantine/core'
import { ArrowDown, ArrowUp, Check, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { HomepageSection, SiteConfig } from '@manifold/contracts'
import { createAdminClient } from '../../lib/api'
import { LinkRowsField } from '../../components/forms/LinkRowsField'
import { SecuritySection } from './SecuritySection'
import { setDirtyGuard } from '../../lib/dirty-guard'
import { createSettingsSchema, type SiteSettingsForm } from './siteSettingsSchema'
import { AgentSettingsSection } from './AgentSettingsSection'

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

export function SettingsWorkspace({ token, onLoggedOut }: { token: string; onLoggedOut: () => void }) {
  const { t } = useTranslation()
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const site = useQuery({ queryKey: ['admin-site'], queryFn: () => client.adminSite() })
  const schema = useMemo(() => createSettingsSchema(t), [t])
  const form = useForm<SiteSettingsForm>({ resolver: zodResolver(schema), defaultValues: { title: '', description: '', footer: '', social: [], commentsEnabled: true, navigation: [], sections: [] } })
  useEffect(() => { if (site.data) form.reset(settingsValues(site.data)) }, [site.data, form])
  const dirtyRef = useRef(false)
  const [agentDirty, setAgentDirty] = useState(false)
  dirtyRef.current = form.formState.isDirty || agentDirty
  const handleAgentDirty = useCallback((dirty: boolean) => setAgentDirty(dirty), [])
  useEffect(() => {
    setDirtyGuard(() => dirtyRef.current)
    return () => setDirtyGuard(null)
  }, [])
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
  const sectionLabels: Record<HomepageSection, string> = {
    PROFILE: t('settings.section.profile'), BACKGROUND: t('settings.section.background'), RECENT_CONTENT: t('settings.section.recentContent'), UPDATES: t('settings.section.updates'), SERIES: t('settings.section.series'), CONTACT: t('settings.section.contact'),
  }
  const sections = form.watch('sections')
  const setSections = (next: HomepageSection[]) => form.setValue('sections', next, { shouldDirty: true })
  const toggleSection = (section: HomepageSection, enabled: boolean) => {
    if (enabled) setSections([...sectionOrder.filter((item) => sections.includes(item) || item === section)])
    else {
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
    <div className="page-heading"><div><p className="kicker">{t('settings.kicker')}</p><h1>{t('settings.title')}</h1><p className="subheading">{t('settings.copy')}</p></div></div>
    {site.isError && <Alert color="red" variant="light">{t('settings.loadError')}</Alert>}
    {saveSite.isError && <Alert color="red" variant="light">{t('settings.saveError')}</Alert>}
    <form id="site-settings-form" noValidate onSubmit={form.handleSubmit((input) => saveSite.mutate(input))}>
      <section className="panel" id="site-identity">
        <div className="panel-heading"><div><p className="kicker">{t('settings.identity')}</p><h2>{t('settings.identityTitle')}</h2></div></div>
        <div className="form-stack">
          <TextInput label={t('settings.siteTitle')} description={t('settings.siteTitleDescription')} {...form.register('title')} error={errors.title?.message} />
          <TextInput label={t('settings.description')} description={t('settings.descriptionHelp', { count: form.watch('description').length })} {...form.register('description')} error={errors.description?.message} />
          <TextInput label={t('settings.footer')} description={t('settings.footerHelp', { count: form.watch('footer').length })} {...form.register('footer')} error={errors.footer?.message} />
          <div><label>{t('settings.socialLinks')}</label><LinkRowsField form={form} name="social" addLabel={t('settings.addSocial')} maxRows={6} /></div>
        </div>
      </section>
      <section className="panel" id="site-navigation">
        <div className="panel-heading"><div><p className="kicker">{t('settings.navigation')}</p><h2>{t('settings.primaryNavigation')}</h2></div><span className="count-badge">{t('common.count.links', { count: form.watch('navigation').length })}</span></div>
        <div className="form-stack">
          <LinkRowsField form={form} name="navigation" addLabel={t('settings.addNavigation')} maxRows={10} />
          <p className="icon-hint">{t('settings.navigationHint')}</p>
        </div>
      </section>
      <section className="panel" id="site-comments">
        <div className="panel-heading"><div><p className="kicker">{t('settings.comments')}</p><h2>{t('settings.publicDiscussions')}</h2></div></div>
        <div className="form-stack">
          <Controller control={form.control} name="commentsEnabled" render={({ field }) => <Switch label={t('settings.allowComments')} description={t('settings.commentsDescription')} checked={field.value} onChange={(event) => field.onChange(event.currentTarget.checked)} />} />
          {errors.commentsEnabled && <Alert color="red" variant="light">{errors.commentsEnabled.message}</Alert>}
        </div>
      </section>
      <section className="panel" id="site-homepage">
        <div className="panel-heading"><div><p className="kicker">{t('settings.homepage')}</p><h2>{t('settings.sections')}</h2></div></div>
        <div className="form-stack"><div>
          <label>{t('settings.homepageSections')}</label>
          <div className="section-picker">
            {sectionOrder.map((section) => {
              const index = sections.indexOf(section)
              return <div className={`section-option ${index >= 0 ? 'active' : ''}`} key={section} data-active={index >= 0 ? 'true' : 'false'}>
                <button type="button" className="section-option-toggle" aria-pressed={index >= 0} onClick={() => toggleSection(section, index < 0)}><span className="section-option-index">{index >= 0 ? String(index + 1).padStart(2, '0') : '··'}</span><span>{sectionLabels[section]}</span></button>
                {index >= 0 && <div className="list-row-actions">
                  <button type="button" className="mini-button" aria-label={t('settings.moveUp', { section: sectionLabels[section] })} disabled={index === 0} onClick={() => moveSection(index, -1)}><ArrowUp size={14} /></button>
                  <button type="button" className="mini-button" aria-label={t('settings.moveDown', { section: sectionLabels[section] })} disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)}><ArrowDown size={14} /></button>
                </div>}
              </div>
            })}
          </div>
          {errors.sections && <Alert color="red" variant="light">{errors.sections.message}</Alert>}
        </div></div>
      </section>
    </form>
    <AgentSettingsSection token={token} onDirtyChange={handleAgentDirty} />
    <SecuritySection token={token} onLoggedOut={onLoggedOut} />
    {form.formState.isDirty && <div className="save-bar"><span>{t('common.unsavedChanges')}</span><div className="save-bar-actions"><Button variant="default" onClick={discard}>{t('common.discard')}</Button><Button className="button button-primary" type="submit" form="site-settings-form" loading={saveSite.isPending} leftSection={savedFlash ? <Check size={16} /> : <Save size={16} />}>{savedFlash ? t('common.saved') : t('settings.save')}</Button></div></div>}
  </section>
}

export default SettingsWorkspace
