import type { TFunction } from 'i18next'
import { z } from 'zod'

export function createSettingsSchema(t: TFunction) {
  return z.object({
    title: z.string().trim().min(1, t('validation.requiredTitle')).max(80, t('validation.titleMax')),
    description: z.string().trim().max(200, t('validation.descriptionMax')),
    footer: z.string().trim().max(200, t('validation.footerMax')),
    social: z.array(z.object({
      label: z.string().trim().min(1, t('validation.requiredLabel')).max(80, t('validation.labelMax')),
      href: z.string().trim().min(1, t('validation.requiredUrl')).max(200, t('validation.urlMax')),
      external: z.boolean(),
    })).max(6, t('validation.socialMax')),
    commentsEnabled: z.boolean(),
    navigation: z.array(z.object({
      label: z.string().trim().min(1, t('validation.requiredLabel')).max(80, t('validation.labelMax')),
      href: z.string().trim().min(1, t('validation.requiredUrl')).max(200, t('validation.urlMax')),
      external: z.boolean(),
    })).min(1, t('validation.navigationMin')).max(10, t('validation.navigationMax')),
    sections: z.array(z.enum(['PROFILE', 'BACKGROUND', 'RECENT_CONTENT', 'UPDATES', 'SERIES', 'CONTACT'])).min(1, t('validation.sectionsMin')).max(10),
  })
}

export type SiteSettingsForm = z.infer<ReturnType<typeof createSettingsSchema>>
