import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
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

export function SecuritySection({ token, onLoggedOut }: { token: string; onLoggedOut: () => void }) {
  const client = useMemo(() => createAdminClient(token), [token])
  const [savedFlash, setSavedFlash] = useState(false)
  const [revokedFlash, setRevokedFlash] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const form = useForm<SecurityForm>({ resolver: zodResolver(securitySchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } })
  const changePassword = useMutation({
    mutationFn: (input: SecurityForm) => client.changePassword({ currentPassword: input.currentPassword, newPassword: input.newPassword }),
    onSuccess: () => {
      form.reset()
      setSavedFlash(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSavedFlash(false), 2400)
    },
  })
  const logoutAll = useMutation({ mutationFn: () => client.logoutAllSessions(), onSuccess: () => { setRevokedFlash(true); onLoggedOut() } })
  return <section className="panel" id="site-security">
    <div className="panel-heading"><div><p className="kicker">Security</p><h2>Credentials and sessions</h2></div></div>
    <div className="form-stack">
      {changePassword.isError && <Alert color="red" variant="light">Password could not be updated. Check the current password and try again.</Alert>}
      <form id="security-password-form" noValidate onSubmit={form.handleSubmit((input) => changePassword.mutate(input))}>
        <PasswordInput label="Current password" {...form.register('currentPassword')} error={form.formState.errors.currentPassword?.message} />
        <PasswordInput label="New password" description="Must be at least 8 characters." {...form.register('newPassword')} error={form.formState.errors.newPassword?.message} />
        <PasswordInput label="Confirm new password" {...form.register('confirmPassword')} error={form.formState.errors.confirmPassword?.message} />
        <div className="form-stack-actions">
          <Button type="submit" className="button button-primary" loading={changePassword.isPending} leftSection={savedFlash ? <Check size={16} /> : <ShieldCheck size={16} />}>{savedFlash ? 'Password updated' : 'Change password'}</Button>
        </div>
      </form>
      <hr className="panel-divider" />
      <div className="form-stack-actions">
        <Button variant="default" type="button" onClick={() => logoutAll.mutate()} loading={logoutAll.isPending} leftSection={<LogOut size={16} />}>{revokedFlash ? 'Sessions revoked' : 'Sign out everywhere'}</Button>
        <p className="icon-hint">Revokes every other active admin session. You will be signed out on this device too.</p>
      </div>
    </div>
  </section>
}
