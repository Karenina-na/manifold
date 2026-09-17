import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Checkbox, NumberInput, PasswordInput, Select, TextInput } from '@mantine/core'
import { Check, Save } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { AgentSettings, AgentSettingsInput } from '@manifold/contracts'
import { createAdminClient } from '../../lib/api'
import { createAgentSettingsSchema, type AgentSettingsForm } from './agentSettingsSchema'

const defaults: AgentSettingsForm = {
  provider: 'openai', model: 'gpt-5-mini', maxToolRounds: 6, historyLimit: 40,
  maxOutputTokens: 2048, openAIBaseURL: 'https://api.openai.com/v1', apiKey: '', clearAPIKey: false,
}

function values(settings: AgentSettings): AgentSettingsForm {
  return { ...settings, apiKey: '', clearAPIKey: false }
}

export function AgentSettingsSection({ token, onDirtyChange }: { token: string; onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useTranslation()
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['admin-agent-settings'], queryFn: () => client.adminAgentSettings() })
  const schema = useMemo(() => createAgentSettingsSchema(t), [t])
  const form = useForm<AgentSettingsForm>({ resolver: zodResolver(schema), defaultValues: defaults })
  useEffect(() => { if (settings.data) form.reset(values(settings.data)) }, [settings.data, form])
  useEffect(() => {
    onDirtyChange(form.formState.isDirty)
    return () => onDirtyChange(false)
  }, [form.formState.isDirty, onDirtyChange])

  const save = useMutation({
    mutationFn: (input: AgentSettingsForm) => {
      const payload: AgentSettingsInput = {
        provider: input.provider, model: input.model.trim(), maxToolRounds: input.maxToolRounds,
        historyLimit: input.historyLimit, maxOutputTokens: input.maxOutputTokens,
        openAIBaseURL: input.openAIBaseURL.trim(),
      }
      if (input.clearAPIKey) payload.apiKey = null
      else if (input.apiKey.trim()) payload.apiKey = input.apiKey.trim()
      return client.updateAgentSettings(payload)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-agent-settings'], updated)
      form.reset(values(updated))
    },
  })
  const errors = form.formState.errors
  const configured = settings.data?.apiKeyConfigured ?? false

  return <section className="panel" id="agent-settings">
    <div className="panel-heading"><div><p className="kicker">{t('agentSettings.kicker')}</p><h2>{t('agentSettings.title')}</h2></div><span className={`security-badge ${configured ? 'active' : 'revoked'}`}>{configured ? t('agentSettings.configured') : t('agentSettings.notConfigured')}</span></div>
    {settings.isError && <Alert color="red" variant="light">{t('agentSettings.loadError')}</Alert>}
    {save.isError && <Alert color="red" variant="light">{t('agentSettings.saveError')}</Alert>}
    <form className="form-stack" noValidate onSubmit={form.handleSubmit((input) => save.mutate(input))}>
      <Controller control={form.control} name="provider" render={({ field }) => <Select label={t('agentSettings.provider')} data={[{ value: 'openai', label: 'OpenAI' }]} {...field} error={errors.provider?.message} />} />
      <TextInput label={t('agentSettings.model')} description={t('agentSettings.modelHelp')} {...form.register('model')} error={errors.model?.message} />
      <div className="agent-settings-grid">
        <Controller control={form.control} name="maxToolRounds" render={({ field }) => <NumberInput label={t('agentSettings.maxToolRounds')} min={1} max={12} value={field.value} onChange={(value) => field.onChange(Number(value))} error={errors.maxToolRounds?.message} />} />
        <Controller control={form.control} name="historyLimit" render={({ field }) => <NumberInput label={t('agentSettings.historyLimit')} min={1} max={200} value={field.value} onChange={(value) => field.onChange(Number(value))} error={errors.historyLimit?.message} />} />
        <Controller control={form.control} name="maxOutputTokens" render={({ field }) => <NumberInput label={t('agentSettings.maxOutputTokens')} min={1} max={128000} value={field.value} onChange={(value) => field.onChange(Number(value))} error={errors.maxOutputTokens?.message} />} />
      </div>
      <TextInput label={t('agentSettings.baseURL')} description={t('agentSettings.baseURLHelp')} {...form.register('openAIBaseURL')} error={errors.openAIBaseURL?.message} />
      <PasswordInput label={t('agentSettings.apiKey')} description={configured ? t('agentSettings.apiKeyKeep') : t('agentSettings.apiKeyMissing')} placeholder={configured ? '••••••••••••' : undefined} disabled={form.watch('clearAPIKey')} {...form.register('apiKey')} error={errors.apiKey?.message} />
      <Controller control={form.control} name="clearAPIKey" render={({ field }) => <Checkbox label={t('agentSettings.clearAPIKey')} checked={field.value} onChange={(event) => field.onChange(event.currentTarget.checked)} disabled={!configured && !form.watch('apiKey')} />} />
      <div className="agent-settings-actions"><Button variant="default" type="button" disabled={!form.formState.isDirty} onClick={() => settings.data && form.reset(values(settings.data))}>{t('common.discard')}</Button><Button className="button button-primary" type="submit" loading={save.isPending} disabled={!form.formState.isDirty} leftSection={save.isSuccess && !form.formState.isDirty ? <Check size={16} /> : <Save size={16} />}>{t('agentSettings.save')}</Button></div>
    </form>
  </section>
}
