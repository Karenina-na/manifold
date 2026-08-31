import { z } from 'zod'

export const settingsSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(80, 'Keep the title under 80 characters.'),
  description: z.string().trim().max(200, 'Keep the description under 200 characters.'),
  footer: z.string().trim().max(200, 'Keep the footer text under 200 characters.'),
  social: z.array(z.object({
    label: z.string().trim().min(1, 'Label is required.').max(80, 'Keep labels under 80 characters.'),
    href: z.string().trim().min(1, 'URL is required.').max(200, 'Keep URLs under 200 characters.'),
    external: z.boolean(),
  })).max(6, 'At most 6 social links.'),
  commentsEnabled: z.boolean(),
  navigation: z.array(z.object({
    label: z.string().trim().min(1, 'Label is required.').max(80, 'Keep labels under 80 characters.'),
    href: z.string().trim().min(1, 'URL is required.').max(200, 'Keep URLs under 200 characters.'),
    external: z.boolean(),
  })).min(1, 'Add at least one navigation link.').max(10, 'At most 10 navigation links.'),
  sections: z.array(z.enum(['PROFILE', 'BACKGROUND', 'RECENT_CONTENT', 'UPDATES', 'SERIES', 'CONTACT'])).min(1, 'Keep at least one homepage section.').max(10),
})

export type SiteSettingsForm = z.infer<typeof settingsSchema>
