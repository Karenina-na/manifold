import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Textarea, TextInput } from '@mantine/core'
import { Save } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { Profile, SiteConfig } from '@manifold/contracts'
import { createAdminClient } from './api'

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  handle: z.string().max(80),
  headline: z.string().max(240),
  bio: z.string().max(4000),
  avatarUrl: z.string().url().or(z.literal('')),
  location: z.string().max(160),
  organization: z.string().max(160),
  websiteUrl: z.string().url().or(z.literal('')),
})
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

type ProfileForm = z.infer<typeof profileSchema>
type SiteForm = z.infer<typeof siteSchema>

function profileValues(profile: Profile): ProfileForm {
  return { displayName: profile.displayName, handle: profile.handle, headline: profile.headline, bio: profile.bio, avatarUrl: profile.avatarUrl, location: profile.location, organization: profile.organization, websiteUrl: profile.websiteUrl }
}

export function SettingsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['admin-profile'], queryFn: () => client.adminProfile() })
  const site = useQuery({ queryKey: ['admin-site'], queryFn: () => client.adminSite() })
  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: profileValues({ displayName: '', handle: '', headline: '', bio: '', avatarUrl: '', location: '', organization: '', websiteUrl: '', id: 'profile_1', updatedAt: '' }) })
  const siteForm = useForm<SiteForm>({ resolver: zodResolver(siteSchema), defaultValues: { navigation: '[]', sections: '' } })

  useEffect(() => { if (profile.data) profileForm.reset(profileValues(profile.data)) }, [profile.data, profileForm])
  useEffect(() => { if (site.data) siteForm.reset({ navigation: JSON.stringify(site.data.navigation, null, 2), sections: site.data.sections.join(', ') }) }, [site.data, siteForm])

  const saveProfile = useMutation({ mutationFn: (input: ProfileForm) => client.updateProfile(input), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-profile'] }) })
  const saveSite = useMutation({ mutationFn: (input: SiteForm): Promise<SiteConfig> => client.updateSite({ featuredContent: site.data?.featuredContent ?? [], navigation: JSON.parse(input.navigation), sections: input.sections.split(',').map((section) => section.trim()).filter(Boolean) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-site'] }) })

  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Configuration</p><h1>Shape the garden.</h1><p className="subheading">Keep identity and the home composition focused on technology, thoughts, and manuscripts.</p></div></div>
    <div className="settings-grid">
      <section className="panel"><div className="panel-heading"><div><p className="kicker">Identity</p><h2>Profile</h2></div></div><form className="form-stack" onSubmit={profileForm.handleSubmit((input) => saveProfile.mutate(input))}><TextInput label="Display name" {...profileForm.register('displayName')} error={profileForm.formState.errors.displayName?.message} /><div className="form-grid"><TextInput label="Handle" {...profileForm.register('handle')} error={profileForm.formState.errors.handle?.message} /><TextInput label="Location" {...profileForm.register('location')} /></div><TextInput label="Headline" {...profileForm.register('headline')} /><Textarea label="Bio" {...profileForm.register('bio')} minRows={4} /><div className="form-grid"><TextInput label="Avatar URL" {...profileForm.register('avatarUrl')} error={profileForm.formState.errors.avatarUrl?.message} /><TextInput label="Website URL" {...profileForm.register('websiteUrl')} error={profileForm.formState.errors.websiteUrl?.message} /></div><TextInput label="Organization" {...profileForm.register('organization')} /><Button className="button button-primary" type="submit" loading={saveProfile.isPending} leftSection={<Save size={16} />}>Save profile</Button>{saveProfile.isError && <Alert color="red" variant="light">Profile could not be saved.</Alert>}</form></section>
      <section className="panel"><div className="panel-heading"><div><p className="kicker">Home composition</p><h2>Navigation and sections</h2></div></div><form className="form-stack" onSubmit={siteForm.handleSubmit((input) => saveSite.mutate(input))}><Textarea label="Navigation JSON" {...siteForm.register('navigation')} minRows={8} error={siteForm.formState.errors.navigation?.message} /><TextInput label="Sections" {...siteForm.register('sections')} placeholder="PROFILE, NOW, TECH, THOUGHT, MANUSCRIPT" error={siteForm.formState.errors.sections?.message} /><Button className="button button-primary" type="submit" loading={saveSite.isPending} leftSection={<Save size={16} />}>Save composition</Button>{saveSite.isError && <Alert color="red" variant="light">Site configuration could not be saved.</Alert>}</form></section>
    </div>
  </section>
}
