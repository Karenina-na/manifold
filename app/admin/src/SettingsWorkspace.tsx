import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Alert, Button, Checkbox, Select, Textarea, TextInput } from '@mantine/core'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { Profile, Project, SiteConfig } from '@manifold/contracts'
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
const projectSchema = z.object({
  slug: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  summary: z.string().max(4000),
  description: z.string().max(10000),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']),
  featured: z.boolean(),
  homepageUrl: z.string().url().or(z.literal('')),
  repositoryUrl: z.string().url().or(z.literal('')),
  techStack: z.string(),
  startedAt: z.string().max(40),
})

type ProfileForm = z.infer<typeof profileSchema>
type SiteForm = z.infer<typeof siteSchema>
type ProjectForm = z.infer<typeof projectSchema>

const emptyProject: ProjectForm = { slug: '', name: '', summary: '', description: '', status: 'ACTIVE', featured: false, homepageUrl: '', repositoryUrl: '', techStack: '', startedAt: '' }

function profileValues(profile: Profile): ProfileForm {
  return { displayName: profile.displayName, handle: profile.handle, headline: profile.headline, bio: profile.bio, avatarUrl: profile.avatarUrl, location: profile.location, organization: profile.organization, websiteUrl: profile.websiteUrl }
}

function projectValues(project: Project): ProjectForm {
  return { slug: project.slug, name: project.name, summary: project.summary, description: project.description, status: project.status as ProjectForm['status'], featured: project.featured, homepageUrl: project.homepageUrl, repositoryUrl: project.repositoryUrl, techStack: project.techStack.join(', '), startedAt: project.startedAt }
}

export function SettingsWorkspace({ token }: { token: string }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['admin-profile'], queryFn: () => client.adminProfile() })
  const site = useQuery({ queryKey: ['admin-site'], queryFn: () => client.adminSite() })
  const projects = useQuery({ queryKey: ['admin-projects'], queryFn: () => client.adminProjects() })
  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: profileValues({ displayName: '', handle: '', headline: '', bio: '', avatarUrl: '', location: '', organization: '', websiteUrl: '', id: 'profile_1', updatedAt: '' }) })
  const siteForm = useForm<SiteForm>({ resolver: zodResolver(siteSchema), defaultValues: { navigation: '[]', sections: '' } })
  const projectForm = useForm<ProjectForm>({ resolver: zodResolver(projectSchema), defaultValues: emptyProject })
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const selectedProject = projects.data?.data.find((project) => project.id === selectedProjectId)

  useEffect(() => { if (profile.data) profileForm.reset(profileValues(profile.data)) }, [profile.data, profileForm])
  useEffect(() => { if (site.data) siteForm.reset({ navigation: JSON.stringify(site.data.navigation, null, 2), sections: site.data.sections.join(', ') }) }, [site.data, siteForm])

  const saveProfile = useMutation({ mutationFn: (input: ProfileForm) => client.updateProfile(input), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-profile'] }) })
  const saveSite = useMutation({ mutationFn: (input: SiteForm): Promise<SiteConfig> => client.updateSite({ featuredContent: site.data?.featuredContent ?? [], featuredProjects: site.data?.featuredProjects ?? [], navigation: JSON.parse(input.navigation), sections: input.sections.split(',').map((section) => section.trim()).filter(Boolean) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-site'] }) })
  const saveProject = useMutation({ mutationFn: (input: ProjectForm) => selectedProject ? client.updateProject(selectedProject.id, { name: input.name, summary: input.summary, description: input.description, status: input.status, featured: input.featured, homepageUrl: input.homepageUrl, repositoryUrl: input.repositoryUrl, techStack: input.techStack.split(',').map((item) => item.trim()).filter(Boolean), startedAt: input.startedAt }) : client.createProject({ slug: input.slug, name: input.name, summary: input.summary, description: input.description, status: input.status, featured: input.featured, homepageUrl: input.homepageUrl, repositoryUrl: input.repositoryUrl, techStack: input.techStack.split(',').map((item) => item.trim()).filter(Boolean), startedAt: input.startedAt }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-projects'] }); setSelectedProjectId(null); projectForm.reset(emptyProject) } })
  const deleteProject = useMutation({ mutationFn: (id: string) => client.deleteProject(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-projects'] }) })

  const editProject = (project: Project) => { setSelectedProjectId(project.id); projectForm.reset(projectValues(project)) }
  const newProject = () => { setSelectedProjectId(null); projectForm.reset(emptyProject) }
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">Configuration</p><h1>Shape the garden.</h1><p className="subheading">Keep identity, navigation, and project records in Core.</p></div></div>
    <div className="settings-grid">
      <section className="panel"><div className="panel-heading"><div><p className="kicker">Identity</p><h2>Profile</h2></div></div><form className="form-stack" onSubmit={profileForm.handleSubmit((input) => saveProfile.mutate(input))}><TextInput label="Display name" {...profileForm.register('displayName')} error={profileForm.formState.errors.displayName?.message} /><div className="form-grid"><TextInput label="Handle" {...profileForm.register('handle')} error={profileForm.formState.errors.handle?.message} /><TextInput label="Location" {...profileForm.register('location')} /></div><TextInput label="Headline" {...profileForm.register('headline')} /><Textarea label="Bio" {...profileForm.register('bio')} minRows={4} /><div className="form-grid"><TextInput label="Avatar URL" {...profileForm.register('avatarUrl')} error={profileForm.formState.errors.avatarUrl?.message} /><TextInput label="Website URL" {...profileForm.register('websiteUrl')} error={profileForm.formState.errors.websiteUrl?.message} /></div><TextInput label="Organization" {...profileForm.register('organization')} /><Button className="button button-primary" type="submit" loading={saveProfile.isPending} leftSection={<Save size={16} />}>Save profile</Button>{saveProfile.isError && <Alert color="red" variant="light">Profile could not be saved.</Alert>}</form></section>
      <section className="panel"><div className="panel-heading"><div><p className="kicker">Home composition</p><h2>Site navigation</h2></div></div><form className="form-stack" onSubmit={siteForm.handleSubmit((input) => saveSite.mutate(input))}><Textarea label="Navigation JSON" {...siteForm.register('navigation')} minRows={8} error={siteForm.formState.errors.navigation?.message} /><TextInput label="Sections" {...siteForm.register('sections')} placeholder="PROFILE, NOW, FEED, PROJECTS" error={siteForm.formState.errors.sections?.message} /><Button className="button button-primary" type="submit" loading={saveSite.isPending} leftSection={<Save size={16} />}>Save composition</Button>{saveSite.isError && <Alert color="red" variant="light">Site configuration could not be saved.</Alert>}</form></section>
    </div>
    <section className="panel projects-settings"><div className="panel-heading"><div><p className="kicker">Portfolio</p><h2>Projects</h2></div><Button className="button button-ghost" type="button" onClick={newProject} leftSection={<Plus size={16} />}>New project</Button></div><div className="settings-project-list">{projects.data?.data.map((project) => <article className="content-row" key={project.id}><div><div className="row-title">{project.name}</div><p>{project.slug} · {project.status}</p></div><div className="row-actions"><ActionIcon variant="light" type="button" onClick={() => editProject(project)} aria-label={`Edit ${project.name}`} title={`Edit ${project.name}`}><Save size={14} /></ActionIcon><ActionIcon color="red" variant="light" type="button" onClick={() => deleteProject.mutate(project.id)} aria-label={`Delete ${project.name}`} title={`Delete ${project.name}`}><Trash2 size={14} /></ActionIcon></div></article>)}</div><form className="form-stack" onSubmit={projectForm.handleSubmit((input) => saveProject.mutate(input))}><div className="form-grid"><TextInput label="Slug" {...projectForm.register('slug')} disabled={Boolean(selectedProject)} error={projectForm.formState.errors.slug?.message} /><TextInput label="Name" {...projectForm.register('name')} error={projectForm.formState.errors.name?.message} /></div><div className="form-grid"><Select label="Status" value={projectForm.watch('status')} onChange={(value) => projectForm.setValue('status', (value ?? 'ACTIVE') as ProjectForm['status'])} data={[{ value: 'ACTIVE', label: 'Active' }, { value: 'PAUSED', label: 'Paused' }, { value: 'ARCHIVED', label: 'Archived' }]} /><TextInput label="Started" {...projectForm.register('startedAt')} placeholder="2026-08" /></div><Textarea label="Summary" {...projectForm.register('summary')} minRows={2} /><Textarea label="Description" {...projectForm.register('description')} minRows={4} /><div className="form-grid"><TextInput label="Homepage URL" {...projectForm.register('homepageUrl')} error={projectForm.formState.errors.homepageUrl?.message} /><TextInput label="Repository URL" {...projectForm.register('repositoryUrl')} error={projectForm.formState.errors.repositoryUrl?.message} /></div><TextInput label="Tech stack" {...projectForm.register('techStack')} placeholder="Go, Next.js" /><Checkbox label="Featured project" {...projectForm.register('featured')} /><Button className="button button-primary" type="submit" loading={saveProject.isPending} leftSection={<Save size={16} />}>{selectedProject ? 'Save project' : 'Create project'}</Button>{saveProject.isError && <Alert color="red" variant="light">Project could not be saved.</Alert>}</form></section>
  </section>
}
