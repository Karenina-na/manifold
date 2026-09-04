import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, PasswordInput } from '@mantine/core'
import { Check, LogOut, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { createAdminClient } from '../api'

const securitySchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' })

type SecurityForm = z.infer<typeof securitySchema>

function formatSessionTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function shortSessionID(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 9)}…`
}

export function SecuritySection({ token, onLoggedOut }: { token: string; onLoggedOut: () => void }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const queryClient = useQueryClient()
  const [savedFlash, setSavedFlash] = useState(false)
  const [revokedFlash, setRevokedFlash] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const form = useForm<SecurityForm>({ resolver: zodResolver(securitySchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } })
  const sessions = useQuery({ queryKey: ['admin-sessions'], queryFn: () => client.adminSessions() })
  const activeCount = sessions.data?.sessions.filter((session) => session.active).length ?? 0
  const changePassword = useMutation({
    mutationFn: (input: SecurityForm) => client.changePassword({ currentPassword: input.currentPassword, newPassword: input.newPassword }),
    onSuccess: () => {
      form.reset()
      setSavedFlash(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSavedFlash(false), 2400)
      void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })
    },
  })
  const logoutAll = useMutation({ mutationFn: () => client.logoutAllSessions(), onSuccess: () => { setRevokedFlash(true); onLoggedOut() } })
  return <section className="panel security-panel" id="site-security" aria-labelledby="site-security-title">
    <div className="panel-heading">
      <div>
        <p className="kicker">Security</p>
        <h2 id="site-security-title">Credentials and sessions</h2>
      </div>
    </div>
    <div className="security-subblock">
      <div className="security-subhead">
        <ShieldCheck size={15} strokeWidth={2.2} aria-hidden />
        <span>Change password</span>
      </div>
      {changePassword.isError && <Alert color="red" variant="light">Password could not be updated. Check the current password and try again.</Alert>}
      <form id="security-password-form" noValidate onSubmit={form.handleSubmit((input) => changePassword.mutate(input))}>
        <PasswordInput label="Current password" {...form.register('currentPassword')} error={form.formState.errors.currentPassword?.message} />
        <div className="password-field">
          <PasswordInput label="New password" placeholder="At least 8 characters" {...form.register('newPassword')} error={form.formState.errors.newPassword?.message} />
          <PasswordInput label="Confirm new password" {...form.register('confirmPassword')} error={form.formState.errors.confirmPassword?.message} />
        </div>
        <div className="password-actions">
          <Button type="submit" className="button button-primary" loading={changePassword.isPending} leftSection={savedFlash ? <Check size={16} /> : <ShieldCheck size={16} />}>{savedFlash ? 'Password updated' : 'Change password'}</Button>
        </div>
      </form>
    </div>
    <hr className="panel-divider" />
    <div className="security-subblock">
      <div className="security-subhead">
        <LogOut size={15} strokeWidth={2.2} aria-hidden />
        <span>Active sessions</span>
        {sessions.data && <em className="security-session-count">{activeCount} active</em>}
      </div>
      {sessions.isError && <Alert color="red" variant="light">Sessions could not be loaded.</Alert>}
      <ul className="security-sessions">
        {sessions.data?.sessions.map((session) => (
          <li className={`security-session-row ${session.active ? '' : 'revoked'}`} key={session.id}>
            <span className="security-session-dot" aria-hidden />
            <span className="security-session-id" title={session.id}>
              {session.current ? 'This device' : shortSessionID(session.id)}
              <small>signed in {formatSessionTime(session.createdAt)}</small>
            </span>
            <span className="security-session-meta">
              {session.current && <span className="security-badge current">Current</span>}
              {session.active ? <span className="security-badge active">Active</span> : <span className="security-badge revoked">Revoked</span>}
              <small>expires {formatSessionTime(session.expiresAt)}</small>
            </span>
          </li>
        ))}
      </ul>
      {sessions.data && sessions.data.sessions.length === 0 && <p className="muted">No active sessions found.</p>}
      <div className="form-stack-actions">
        <Button variant="default" type="button" onClick={() => logoutAll.mutate()} loading={logoutAll.isPending} leftSection={revokedFlash ? <Check size={16} /> : <LogOut size={16} />}>{revokedFlash ? 'Sessions revoked' : 'Sign out everywhere'}</Button>
      </div>
    </div>
  </section>
}
