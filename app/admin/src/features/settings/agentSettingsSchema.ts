import { z } from 'zod'

export function createAgentSettingsSchema(t: (key: string) => string) {
  return z.object({
    provider: z.literal('openai'),
    model: z.string().trim().min(1, t('agentSettings.validation.model')).max(200, t('agentSettings.validation.model')),
    maxToolRounds: z.number().int().min(1, t('agentSettings.validation.toolRounds')).max(12, t('agentSettings.validation.toolRounds')),
    historyLimit: z.number().int().min(1, t('agentSettings.validation.history')).max(200, t('agentSettings.validation.history')),
    maxOutputTokens: z.number().int().min(1, t('agentSettings.validation.outputTokens')).max(128000, t('agentSettings.validation.outputTokens')),
    openAIBaseURL: z.url(t('agentSettings.validation.baseURL')).refine((value) => value.startsWith('http://') || value.startsWith('https://'), t('agentSettings.validation.baseURL')),
    apiKey: z.string().max(8192),
    clearAPIKey: z.boolean(),
  })
}

export type AgentSettingsForm = z.infer<ReturnType<typeof createAgentSettingsSchema>>
