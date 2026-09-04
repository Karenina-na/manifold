// Contact icon vocabulary shared by the admin picker, admin preview, and the
// public renderer. `icon` keys are stable string identifiers stored on the
// profile contact row; rendering lives in contact-icon-ui.tsx so this module
// stays importable from Node tests.
//
// Brand keys render with react-icons (si/fa6); generic keys keep lucide.
// Keep `CONTACT_ICONS` and `resolveContactKey` in sync with the admin picker —
// see docs/admin.md.

export interface ContactIconDef {
  key: string;
  label: string;
  brand?: boolean;
}

export const CONTACT_ICONS: ContactIconDef[] = [
  { key: 'github', label: 'GitHub', brand: true },
  { key: 'x', label: 'X / Twitter', brand: true },
  { key: 'mail', label: 'Email' },
  { key: 'rss', label: 'RSS' },
  { key: 'telegram', label: 'Telegram', brand: true },
  { key: 'whatsapp', label: 'WhatsApp', brand: true },
  { key: 'wechat', label: 'WeChat', brand: true },
  { key: 'qq', label: 'QQ', brand: true },
  { key: 'bilibili', label: 'Bilibili', brand: true },
  { key: 'youtube', label: 'YouTube', brand: true },
  { key: 'linkedin', label: 'LinkedIn', brand: true },
  { key: 'instagram', label: 'Instagram', brand: true },
  { key: 'discord', label: 'Discord', brand: true },
  { key: 'facebook', label: 'Facebook', brand: true },
  { key: 'weibo', label: 'Weibo', brand: true },
  { key: 'reddit', label: 'Reddit', brand: true },
  { key: 'stackoverflow', label: 'Stack Overflow', brand: true },
  { key: 'medium', label: 'Medium', brand: true },
  { key: 'juejin', label: '掘金', brand: true },
  { key: 'zhihu', label: '知乎', brand: true },
  { key: 'douban', label: '豆瓣', brand: true },
  { key: 'netease', label: '网易云音乐', brand: true },
  { key: 'bluesky', label: 'Bluesky', brand: true },
  { key: 'threads', label: 'Threads', brand: true },
  { key: 'tiktok', label: 'TikTok', brand: true },
  { key: 'twitch', label: 'Twitch', brand: true },
  { key: 'signal', label: 'Signal', brand: true },
  { key: 'mastodon', label: 'Mastodon', brand: true },
  { key: 'gitlab', label: 'GitLab', brand: true },
  { key: 'devto', label: 'DEV', brand: true },
  { key: 'codepen', label: 'CodePen', brand: true },
  { key: 'codesandbox', label: 'CodeSandbox', brand: true },
  { key: 'dribbble', label: 'Dribbble', brand: true },
  { key: 'behance', label: 'Behance', brand: true },
  { key: 'pinterest', label: 'Pinterest', brand: true },
  { key: 'snapchat', label: 'Snapchat', brand: true },
  { key: 'line', label: 'LINE', brand: true },
  { key: 'kakaotalk', label: 'KakaoTalk', brand: true },
  { key: 'viber', label: 'Viber', brand: true },
  { key: 'xiaohongshu', label: '小红书', brand: true },
  { key: 'spotify', label: 'Spotify', brand: true },
  { key: 'apple', label: 'Apple', brand: true },
  { key: 'google', label: 'Google', brand: true },
  { key: 'amazon', label: 'Amazon', brand: true },
  { key: 'slack', label: 'Slack', brand: true },
  { key: 'steam', label: 'Steam', brand: true },
  { key: 'go', label: 'Go', brand: true },
  { key: 'python', label: 'Python', brand: true },
  { key: 'npm', label: 'npm', brand: true },
  { key: 'pnpm', label: 'pnpm', brand: true },
  { key: 'docker', label: 'Docker', brand: true },
  { key: 'kubernetes', label: 'Kubernetes', brand: true },
  { key: 'huggingface', label: 'Hugging Face', brand: true },
  { key: 'notion', label: 'Notion', brand: true },
  { key: 'evernote', label: 'Evernote', brand: true },
  { key: 'wordpress', label: 'WordPress', brand: true },
  { key: 'blogger', label: 'Blogger', brand: true },
  { key: 'tumblr', label: 'Tumblr', brand: true },
  { key: 'flickr', label: 'Flickr', brand: true },
  { key: 'vk', label: 'VK', brand: true },
  { key: 'tistory', label: 'Tistory', brand: true },
  { key: 'kofi', label: 'Ko-fi', brand: true },
  { key: 'buymeacoffee', label: 'Buy Me a Coffee', brand: true },
  { key: 'patreon', label: 'Patreon', brand: true },
  { key: 'ghost', label: 'Ghost', brand: true },
  { key: 'substack', label: 'Substack', brand: true },
  { key: 'hashnode', label: 'Hashnode', brand: true },
  { key: 'keybase', label: 'Keybase', brand: true },
  { key: 'matrix', label: 'Matrix', brand: true },
  { key: 'proton', label: 'Proton', brand: true },
  { key: 'zalo', label: 'Zalo', brand: true },
  { key: 'riotgames', label: 'Riot Games', brand: true },
  { key: 'roblox', label: 'Roblox', brand: true },
  { key: 'warp', label: 'Warp', brand: true },
  { key: 'googlechat', label: 'Google Chat', brand: true },
  { key: 'xiaomi', label: '小米', brand: true },
  { key: 'huawei', label: '华为', brand: true },
  { key: 'oppo', label: 'OPPO', brand: true },
  { key: 'vivo', label: 'vivo', brand: true },
  { key: 'honor', label: 'Honor', brand: true },
  { key: 'baidu', label: '百度', brand: true },
  { key: 'anthropic', label: 'Anthropic', brand: true },
  { key: 'perplexity', label: 'Perplexity', brand: true },
  // Generic keys kept from the original picker so existing stored icons
  // keep rendering without an edit.
  { key: 'podcast', label: 'Podcast' },
  { key: 'message', label: 'Messaging' },
  { key: 'at', label: 'Handle' },
  { key: 'radio', label: 'Radio' },
  { key: '', label: 'Globe (fallback)' },
]

export const CONTACT_ICON_LABELS: Record<string, string> = Object.fromEntries(CONTACT_ICONS.map((def) => [def.key, def.label]))

const CONTACT_KEYS = new Set(CONTACT_ICONS.map((def) => def.key))

/** True when `key` is a known icon key (or the globe fallback). */
export function isContactIconKey(key: string): boolean {
  return CONTACT_KEYS.has(key) || key === 'globe'
}

// Mirrors the public renderer heuristics — keep both in sync.
export function resolveContactKey(contact: { icon?: string | null; label: string; url: string }): string {
  const icon = contact.icon?.toLowerCase().trim() ?? ''
  const label = contact.label.toLowerCase()
  const url = contact.url.toLowerCase()
  const has = (...needles: string[]) => needles.some((needle) => label.includes(needle))
  const urlHas = (...needles: string[]) => needles.some((needle) => url.includes(needle))
  if (icon === 'x' || icon === 'twitter' || label === 'x' || has('twitter')) return 'x'
  if (icon === 'rss' || has('rss') || url.endsWith('/feed.xml')) return 'rss'
  if (icon === 'mail' || has('mail', 'email')) return 'mail'
  if (icon === 'github' || has('github') || urlHas('github')) return 'github'
  if (icon === 'flame' || has('flame', 'bilibili')) return 'bilibili'
  if (icon === 'tv' || has('youtube', 'tv')) return 'youtube'
  if (icon === 'telegram' || has('telegram')) return 'telegram'
  if (icon === 'whatsapp' || has('whatsapp', 'whats')) return 'whatsapp'
  if (icon === 'message' || has('message')) return 'message'
  if (icon === 'wechat' || icon === 'weixin' || has('wechat', 'weixin', '微信')) return 'wechat'
  if (icon === 'qq' || has('qq') || urlHas('qq.com') || urlHas('mail.qq')) return 'qq'
  if (icon === 'linkedin' || has('linkedin')) return 'linkedin'
  if (icon === 'instagram' || has('instagram')) return 'instagram'
  if (icon === 'discord' || has('discord')) return 'discord'
  if (icon === 'facebook' || has('facebook')) return 'facebook'
  if (icon === 'weibo' || has('weibo', '微博')) return 'weibo'
  if (icon === 'reddit' || has('reddit')) return 'reddit'
  if (icon === 'stackoverflow' || has('stack overflow', 'stackoverflow')) return 'stackoverflow'
  if (icon === 'medium' || has('medium')) return 'medium'
  if (icon === 'juejin' || has('juejin', '掘金')) return 'juejin'
  if (icon === 'zhihu' || has('zhihu', '知乎')) return 'zhihu'
  if (icon === 'douban' || has('douban', '豆瓣')) return 'douban'
  if (icon === 'netease' || has('netease', '网易云')) return 'netease'
  if (icon === 'bluesky' || has('bluesky')) return 'bluesky'
  if (icon === 'threads' || has('threads')) return 'threads'
  if (icon === 'tiktok' || has('tiktok')) return 'tiktok'
  if (icon === 'twitch' || has('twitch')) return 'twitch'
  if (icon === 'signal' || has('signal')) return 'signal'
  if (icon === 'mastodon' || has('mastodon')) return 'mastodon'
  if (icon === 'gitlab' || has('gitlab')) return 'gitlab'
  if (icon === 'devto' || has('dev.to', 'devto')) return 'devto'
  if (icon === 'codepen' || has('codepen')) return 'codepen'
  if (icon === 'codesandbox' || has('codesandbox')) return 'codesandbox'
  if (icon === 'dribbble' || has('dribbble')) return 'dribbble'
  if (icon === 'behance' || has('behance')) return 'behance'
  if (icon === 'pinterest' || has('pinterest')) return 'pinterest'
  if (icon === 'snapchat' || has('snapchat')) return 'snapchat'
  if (icon === 'line' || has('line')) return 'line'
  if (icon === 'kakaotalk' || has('kakaotalk', 'kakao')) return 'kakaotalk'
  if (icon === 'viber' || has('viber')) return 'viber'
  if (icon === 'xiaohongshu' || has('xiaohongshu', '小红书')) return 'xiaohongshu'
  if (icon === 'spotify' || has('spotify')) return 'spotify'
  if (icon === 'apple' || has('apple')) return 'apple'
  if (icon === 'googlechat' || has('google chat', 'googlechat')) return 'googlechat'
  if (icon === 'google' || has('google')) return 'google'
  if (icon === 'amazon' || has('amazon')) return 'amazon'
  if (icon === 'slack' || has('slack')) return 'slack'
  if (icon === 'steam' || has('steam')) return 'steam'
  if (icon === 'go' || has('golang', ' go')) return 'go'
  if (icon === 'python' || has('python')) return 'python'
  if (icon === 'npm' || (has('npm') && !has('pnpm'))) return 'npm'
  if (icon === 'pnpm' || has('pnpm')) return 'pnpm'
  if (icon === 'docker' || has('docker')) return 'docker'
  if (icon === 'kubernetes' || has('kubernetes', 'k8s')) return 'kubernetes'
  if (icon === 'huggingface' || has('hugging face', 'huggingface')) return 'huggingface'
  if (icon === 'notion' || has('notion')) return 'notion'
  if (icon === 'evernote' || has('evernote')) return 'evernote'
  if (icon === 'wordpress' || has('wordpress')) return 'wordpress'
  if (icon === 'blogger' || has('blogger')) return 'blogger'
  if (icon === 'tumblr' || has('tumblr')) return 'tumblr'
  if (icon === 'flickr' || has('flickr')) return 'flickr'
  if (icon === 'vk' || has('vk')) return 'vk'
  if (icon === 'tistory' || has('tistory')) return 'tistory'
  if (icon === 'kofi' || has('ko-fi', 'kofi')) return 'kofi'
  if (icon === 'buymeacoffee' || has('buy me a coffee', 'buymeacoffee')) return 'buymeacoffee'
  if (icon === 'patreon' || has('patreon')) return 'patreon'
  if (icon === 'ghost' || has('ghost')) return 'ghost'
  if (icon === 'substack' || has('substack')) return 'substack'
  if (icon === 'hashnode' || has('hashnode')) return 'hashnode'
  if (icon === 'keybase' || has('keybase')) return 'keybase'
  if (icon === 'matrix' || has('matrix')) return 'matrix'
  if (icon === 'proton' || has('proton')) return 'proton'
  if (icon === 'zalo' || has('zalo')) return 'zalo'
  if (icon === 'riotgames' || has('riot games', 'riot')) return 'riotgames'
  if (icon === 'roblox' || has('roblox')) return 'roblox'
  if (icon === 'warp' || has('warp')) return 'warp'
  if (icon === 'googlechat' || has('google chat', 'googlechat')) return 'googlechat'
  if (icon === 'xiaomi' || has('xiaomi', '小米')) return 'xiaomi'
  if (icon === 'huawei' || has('huawei', '华为')) return 'huawei'
  if (icon === 'oppo' || has('oppo')) return 'oppo'
  if (icon === 'vivo' || has('vivo')) return 'vivo'
  if (icon === 'honor' || has('honor')) return 'honor'
  if (icon === 'baidu' || has('baidu', '百度')) return 'baidu'
  if (icon === 'anthropic' || has('anthropic')) return 'anthropic'
  if (icon === 'perplexity' || has('perplexity')) return 'perplexity'
  if (icon === 'podcast' || has('podcast')) return 'podcast'
  if (icon === 'at' || has('handle')) return 'at'
  if (icon === 'radio') return 'radio'
  return 'globe'
}

/** Resolve a key to its human label for hint text ("Renders as …"). */
export function contactIconLabel(key: string): string {
  const label = CONTACT_ICON_LABELS[key]
  if (label) return label
  return key === 'globe' || key === '' ? 'the globe fallback icon' : key
}
