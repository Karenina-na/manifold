import { z } from 'zod'

export function createAgentSettingsSchema(t: (key: string) => string) {
  return z.object({
    provider: z.literal('openai'),
    model: z.string().trim().min(1, t('agentSettings.validation.model')).max(200, t('agentSettings.validation.model')),
    maxToolRounds: z.number().int().min(1, t('agentSettings.validation.toolRounds')).max(12, t('agentSettings.validation.toolRounds')),
    historyLimit: z.number().int().min(1, t('agentSettings.validation.history')).max(200, t('agentSettings.validation.history')),
    compactionRecentTurns: z.number().int().min(1, t('agentSettings.validation.recentTurns')).max(99, t('agentSettings.validation.recentTurns')),
    compactionMaxOutputTokens: z.number().int().min(128, t('agentSettings.validation.compactionTokens')).max(8192, t('agentSettings.validation.compactionTokens')),
    maxOutputTokens: z.number().int().min(1, t('agentSettings.validation.outputTokens')).max(128000, t('agentSettings.validation.outputTokens')),
    openAIBaseURL: z.url(t('agentSettings.validation.baseURL')).refine((value) => value.startsWith('http://') || value.startsWith('https://'), t('agentSettings.validation.baseURL')),
    apiKey: z.string().max(8192),
    clearAPIKey: z.boolean(),
  }).refine((value) => value.compactionRecentTurns <= Math.max(1, Math.floor((value.historyLimit - 2) / 2)), {
    message: t('agentSettings.validation.compactionWindow'),
    path: ['compactionRecentTurns'],
  })
}

export type AgentSettingsForm = z.infer<ReturnType<typeof createAgentSettingsSchema>>
