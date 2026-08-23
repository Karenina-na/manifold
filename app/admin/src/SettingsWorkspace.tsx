import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  return <section className="workspace"><div className="page-heading"><div><p className="kicker">Configuration</p><h1>Shape the garden.</h1><p className="subheading">Keep identity, navigation, and project records in Core.</p></div></div><div className="settings-grid"><section className="panel"><div className="panel-heading"><div><p className="kicker">Identity</p><h2>Profile</h2></div></div><form className="form-stack" onSubmit={profileForm.handleSubmit((input) => saveProfile.mutate(input))}><label>Display name<input {...profileForm.register('displayName')} />{profileForm.formState.errors.displayName && <small>{profileForm.formState.errors.displayName.message}</small>}</label><div className="form-grid"><label>Handle<input {...profileForm.register('handle')} /><small>{profileForm.formState.errors.handle?.message}</small></label><label>Location<input {...profileForm.register('location')} /></label></div><label>Headline<input {...profileForm.register('headline')} /></label><label>Bio<textarea {...profileForm.register('bio')} rows={4} /></label><div className="form-grid"><label>Avatar URL<input {...profileForm.register('avatarUrl')} />{profileForm.formState.errors.avatarUrl && <small>{profileForm.formState.errors.avatarUrl.message}</small>}</label><label>Website URL<input {...profileForm.register('websiteUrl')} />{profileForm.formState.errors.websiteUrl && <small>{profileForm.formState.errors.websiteUrl.message}</small>}</label></div><label>Organization<input {...profileForm.register('organization')} /></label><button className="button button-primary" type="submit" disabled={saveProfile.isPending}><Save size={16} /> Save profile</button>{saveProfile.isError && <p className="form-error">Profile could not be saved.</p>}</form></section><section className="panel"><div className="panel-heading"><div><p className="kicker">Home composition</p><h2>Site navigation</h2></div></div><form className="form-stack" onSubmit={siteForm.handleSubmit((input) => saveSite.mutate(input))}><label>Navigation JSON<textarea {...siteForm.register('navigation')} rows={8} />{siteForm.formState.errors.navigation && <small>{siteForm.formState.errors.navigation.message}</small>}</label><label>Sections<input {...siteForm.register('sections')} placeholder="PROFILE, NOW, FEED, PROJECTS" />{siteForm.formState.errors.sections && <small>{siteForm.formState.errors.sections.message}</small>}</label><button className="button button-primary" type="submit" disabled={saveSite.isPending}><Save size={16} /> Save composition</button>{saveSite.isError && <p className="form-error">Site configuration could not be saved.</p>}</form></section></div><section className="panel projects-settings"><div className="panel-heading"><div><p className="kicker">Portfolio</p><h2>Projects</h2></div><button className="button button-ghost" type="button" onClick={newProject}><Plus size={16} /> New project</button></div><div className="settings-project-list">{projects.data?.data.map((project) => <article className="content-row" key={project.id}><div><div className="row-title">{project.name}</div><p>{project.slug} · {project.status}</p></div><div className="row-actions"><button className="mini-button" type="button" onClick={() => editProject(project)} aria-label={`Edit ${project.name}`} title={`Edit ${project.name}`}><Save size={14} /></button><button className="mini-button danger" type="button" onClick={() => deleteProject.mutate(project.id)} aria-label={`Delete ${project.name}`} title={`Delete ${project.name}`}><Trash2 size={14} /></button></div></article>)}</div><form className="form-stack" onSubmit={projectForm.handleSubmit((input) => saveProject.mutate(input))}><div className="form-grid"><label>Slug<input {...projectForm.register('slug')} disabled={Boolean(selectedProject)} />{projectForm.formState.errors.slug && <small>{projectForm.formState.errors.slug.message}</small>}</label><label>Name<input {...projectForm.register('name')} />{projectForm.formState.errors.name && <small>{projectForm.formState.errors.name.message}</small>}</label></div><div className="form-grid"><label>Status<select {...projectForm.register('status')}><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="ARCHIVED">Archived</option></select></label><label>Started<input {...projectForm.register('startedAt')} placeholder="2026-08" /></label></div><label>Summary<textarea {...projectForm.register('summary')} rows={2} /></label><label>Description<textarea {...projectForm.register('description')} rows={4} /></label><div className="form-grid"><label>Homepage URL<input {...projectForm.register('homepageUrl')} />{projectForm.formState.errors.homepageUrl && <small>{projectForm.formState.errors.homepageUrl.message}</small>}</label><label>Repository URL<input {...projectForm.register('repositoryUrl')} />{projectForm.formState.errors.repositoryUrl && <small>{projectForm.formState.errors.repositoryUrl.message}</small>}</label></div><label>Tech stack<input {...projectForm.register('techStack')} placeholder="Go, Next.js" /></label><label className="checkbox-label"><input type="checkbox" {...projectForm.register('featured')} /> Featured project</label><button className="button button-primary" type="submit" disabled={saveProject.isPending}><Save size={16} /> {selectedProject ? 'Save project' : 'Create project'}</button>{saveProject.isError && <p className="form-error">Project could not be saved.</p>}</form></section></section>
}
