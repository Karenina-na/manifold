import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { useEffect, useRef } from 'react'

const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
const uploadIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'

// Instant-rendering (MarkText-like) markdown editor. The editor is a writing
// aid only — it produces plain Markdown source; sanitization happens at the
// render boundary in @manifold/render.
export function MarkdownEditor({ value, onChange, disabled, placeholder, onUploadImage }: { value: string; onChange: (next: string) => void; disabled?: boolean; placeholder?: string; onUploadImage?: (file: File) => Promise<string> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const readyRef = useRef(false)
  const emittedRef = useRef(value)
  const initialValueRef = useRef(value)
  const initialPlaceholderRef = useRef(placeholder)
  const valueRef = useRef(value)
  const disabledRef = useRef(Boolean(disabled))
  const onChangeRef = useRef(onChange)
  const onUploadRef = useRef(onUploadImage)

  useEffect(() => { onUploadRef.current = onUploadImage }, [onUploadImage])

  // vditor's handler return value is only a tip string, never content —
  // uploads insert their markdown through insertValue ourselves.
  const uploadFiles = async (files: File[]) => {
    const onUpload = onUploadRef.current
    const editor = vditorRef.current
    if (!onUpload || !editor) return
    const snippets: string[] = []
    for (const file of files) {
      if (!allowedImageTypes.has(file.type)) {
        editor.tip(`Unsupported image type: ${file.name || file.type}`)
        continue
      }
      try {
        const url = await onUpload(file)
        const alt = file.name.replace(/[[\]()]/g, '').trim() || 'image'
        snippets.push(`![${alt}](${url})`)
      } catch (error) {
        editor.tip(error instanceof Error ? error.message : 'Image upload failed.')
      }
    }
    if (snippets.length) editor.insertValue(snippets.join('\n') + '\n')
  }

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
        ...(onUploadRef.current ? [{ name: 'upload-image', icon: uploadIcon, tip: 'Upload image', click: () => inputRef.current?.click() }] : []),
      ],
      upload: onUploadRef.current ? {
        accept: UPLOAD_ACCEPT,
        multiple: true,
        handler: (files) => { void uploadFiles(files); return null },
      } : undefined,
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

  return <>
    <input
      ref={inputRef}
      type="file"
      accept={UPLOAD_ACCEPT}
      multiple
      hidden
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        void uploadFiles(files)
      }}
    />
    <div className={disabled ? 'vditor-host editor-locked' : 'vditor-host'} ref={hostRef} />
  </>
}
