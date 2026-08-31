import { Button, Popover, Text } from '@mantine/core'
import { useEffect, useRef, useState, type ReactNode } from 'react'

// Inline two-step confirmation: first click opens a small popover, the second
// (explicit) click fires the action. Clicking outside or re-clicking closes.
export function ConfirmButton({ label, confirmLabel, confirmBody, danger, icon, size = 'compact-sm', variant, leftSection, onConfirm, stopPropagation = false }: { label: string; confirmLabel?: string; confirmBody: string; danger?: boolean; icon?: ReactNode; size?: 'compact-sm' | 'sm'; variant?: 'default' | 'light' | 'subtle'; leftSection?: ReactNode; onConfirm: () => void; stopPropagation?: boolean }) {
  const [opened, setOpened] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  return <Popover width={260} position="top" withArrow shadow="md" opened={opened} onChange={setOpened} withinPortal>
    <Popover.Target>
      <Button
        size={size}
        variant={icon ? 'default' : variant ?? 'default'}
        color={danger ? 'red' : undefined}
        leftSection={icon ? undefined : leftSection}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation()
          setOpened((open) => !open)
        }}
        aria-label={label}
        title={label}
      >{icon ?? label}</Button>
    </Popover.Target>
    <Popover.Dropdown>
      <Text size="sm" mb="xs">{confirmBody}</Text>
      <div className="confirm-actions">
        <Button size="compact-xs" variant="default" onClick={(event) => { event.stopPropagation(); setOpened(false) }}>Cancel</Button>
        <Button
          size="compact-xs"
          color={danger ? 'red' : 'teal'}
          onClick={(event) => {
            event.stopPropagation()
            setOpened(false)
            onConfirm()
          }}
        >{confirmLabel ?? label}</Button>
      </div>
    </Popover.Dropdown>
  </Popover>
}
