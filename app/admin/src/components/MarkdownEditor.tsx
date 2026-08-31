import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { useEffect, useRef } from 'react'

// Instant-rendering (MarkText-like) markdown editor. The editor is a writing
// aid only — it produces plain Markdown source; sanitization happens at the
// render boundary in @manifold/render.
export function MarkdownEditor({ value, onChange, disabled, placeholder }: { value: string; onChange: (next: string) => void; disabled?: boolean; placeholder?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const readyRef = useRef(false)
  const emittedRef = useRef(value)
  const initialValueRef = useRef(value)
  const initialPlaceholderRef = useRef(placeholder)
  const valueRef = useRef(value)
  const disabledRef = useRef(Boolean(disabled))
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
    valueRef.current = value
    if (readyRef.current && vditorRef.current && value !== emittedRef.current) {
      emittedRef.current = value
      vditorRef.current.setValue(value ?? '')
    }
  }, [onChange, value])

  useEffect(() => {
    disabledRef.current = Boolean(disabled)
    if (readyRef.current && vditorRef.current) {
      if (disabled) vditorRef.current.disabled()
      else vditorRef.current.enable()
    }
  }, [disabled])

  useEffect(() => {
    const host = hostRef.current
    if (!host || vditorRef.current) return
    // Vditor initializes asynchronously; enable/setValue/destroy throw until
    // its after() callback fires, so every interaction is gated on readiness.
    const destroyed = { current: false }
    const editor = new Vditor(host, {
      mode: 'ir',
      // Assets (lute, icons, i18n) are served from public/vditor — see
      // scripts/sync-vditor.mjs. No third-party origin at runtime.
      cdn: '/vditor',
      value: initialValueRef.current,
      placeholder: initialPlaceholderRef.current,
      cache: { enable: false },
      counter: { enable: true },
      // vditor debounces its input callback by undoDelay (default 800ms);
      // a short delay keeps form state close behind the keystrokes so a
      // fast save never captures a stale body.
      undoDelay: 60,
      toolbar: [
        'headings', 'bold', 'italic', 'strike', '|',
        'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
        'quote', 'line', 'code', 'inline-code', 'link', 'table', '|',
        'undo', 'redo', '|',
        'fullscreen', 'edit-mode', 'export', 'help',
      ],
      after: () => {
        if (destroyed.current) return
        readyRef.current = true
        const latest = valueRef.current ?? ''
        if (latest !== emittedRef.current) {
          emittedRef.current = latest
          editor.setValue(latest)
        }
        if (disabledRef.current) editor.disabled()
        else editor.enable()
      },
      input: (next) => {
        emittedRef.current = next ?? ''
        onChangeRef.current(emittedRef.current)
      },
    })
    vditorRef.current = editor
    return () => {
      destroyed.current = true
      readyRef.current = false
      vditorRef.current = null
      try {
        editor.destroy()
      } catch {
        host.replaceChildren()
      }
    }
  }, [])
  // The editor mounts once per editor page; value changes flow through setValue.

  return <div className={disabled ? 'vditor-host editor-locked' : 'vditor-host'} ref={hostRef} />
}
