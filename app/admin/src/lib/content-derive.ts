// Mirrors Core's Markdown derivation rules. Keep in sync with
// app/core/internal/store/store.go and article_metadata.go.

const EXCERPT_MAX_RUNES = 360

export function deriveExcerpt(body: string): string {
  const parts: string[] = []
  let inFence = false
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    let text = line.trim()
    if (text.startsWith('```') || text.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || !text || /^\[[^\]]+\]:\s*\S+/.test(text)) continue
    text = text
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^(?:[-+*]|\d+[.)])\s+/, '')
      .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^]]*\])/g, '')
      .replace(/\[([^\]]+)\](?:\([^)]*\)|\[[^]]*\])/g, '$1')
      .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1')
      .replace(/<!--.*?-->/g, '')
      .replace(/<\/?[A-Za-z][^>]*>/g, '')
      .replace(/(?:\*\*|__)(\S(?:.*?\S)?)(?:\*\*|__)/g, '$1')
      .replace(/~~(\S(?:.*?\S)?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\\([\\`*_[\]{}()#+.!<>~-])/g, '$1')
      .trim()
      .replace(/\s+/g, ' ')
    if (text) parts.push(text)
  }
  const excerpt = parts.join(' ').trim()
  const runes = Array.from(excerpt)
  return runes.length > EXCERPT_MAX_RUNES ? runes.slice(0, EXCERPT_MAX_RUNES).join('').trim() : excerpt
}

export function estimateReadingMinutes(body: string): number {
  let latinWords = 0
  let cjkCharacters = 0
  let inWord = false
  for (const character of body) {
    if (isCJK(character)) {
      cjkCharacters++
      inWord = false
      continue
    }
    if (/[\p{L}\p{N}]/u.test(character)) {
      if (!inWord) {
        latinWords++
        inWord = true
      }
      continue
    }
    inWord = false
  }
  const units = latinWords + Math.floor((cjkCharacters + 1) / 2)
  return Math.max(1, Math.floor((units + 199) / 200))
}

function isCJK(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7af)
}

export function deriveToc(body: string): Array<{ id: string; label: string; level: 2 | 3 }> {
  const heading = /^ {0,3}(#{2,3})\s+(.+?)\s*$/
  const entries: Array<{ id: string; label: string; level: 2 | 3 }> = []
  const usedIDs = new Map<string, number>()
  let inFence = false
  for (const line of body.split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = heading.exec(line)
    if (!match) continue
    const label = match[2].replace(/[*_`~]/g, '').trim()
    if (!label) continue
    let id = slugifyHeading(label)
    if (!id) continue
    const baseID = id
    for (let count = usedIDs.get(baseID) ?? 0; ; count++) {
      const candidate = count > 0 ? `${baseID}-${count + 1}` : baseID
      if (!usedIDs.has(candidate)) {
        id = candidate
        usedIDs.set(baseID, count + 1)
        usedIDs.set(candidate, 1)
        break
      }
    }
    entries.push({ id, label, level: match[1].length as 2 | 3 })
  }
  return entries
}

function slugifyHeading(value: string): string {
  let slug = ''
  let separator = false
  for (const character of value.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(character)) {
      if (separator && slug.length > 0) slug += '-'
      slug += character
      separator = false
      continue
    }
    separator = true
  }
  return slug.replace(/^-+|-+$/g, '')
}

