import { useState } from 'react'

export function ChipsInput({ value, onChange, placeholder = 'Add and press Enter' }: { value: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (!value.includes(trimmed)) onChange([...value, trimmed])
    setDraft('')
  }
  return <div className="chips-row">
    {value.map((chip) => <span className="chip" key={chip}>{chip}<button type="button" aria-label={`Remove ${chip}`} onClick={() => onChange(value.filter((item) => item !== chip))}>×</button></span>)}
    <input
      className="chip-input"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => {
        if (event.target.value.endsWith(',')) {
          setDraft(event.target.value.slice(0, -1))
          commit()
          return
        }
        setDraft(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Backspace' && !draft && value.length) {
          onChange(value.slice(0, -1))
        }
      }}
      onBlur={commit}
    />
  </div>
}
