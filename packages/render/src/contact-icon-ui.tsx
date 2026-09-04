// React bindings for the contact icon vocabulary. Brand keys render with
// react-icons (si primary, fa6 fallback for missing brands), generic keys stay
// on lucide. Shared by the admin picker/preview and the public renderer so the
// two surfaces cannot drift apart.

import {
  SiApple,
  SiAnthropic,
  SiBaidu,
  SiBehance,
  SiBilibili,
  SiBluesky,
  SiBlogger,
  SiBuymeacoffee,
  SiCodesandbox,
  SiDevdotto,
  SiDiscord,
  SiDocker,
  SiDouban,
  SiDribbble,
  SiEvernote,
  SiFacebook,
  SiFlickr,
  SiGhost,
  SiGithub,
  SiGitlab,
  SiGo,
  SiGoogle,
  SiHashnode,
  SiHonor,
  SiHuawei,
  SiHuggingface,
  SiInstagram,
  SiJuejin,
  SiKakaotalk,
  SiKeybase,
  SiKofi,
  SiKubernetes,
  SiLine,
  SiMastodon,
  SiMatrix,
  SiMedium,
  SiNeteasecloudmusic,
  SiNotion,
  SiNpm,
  SiOppo,
  SiPatreon,
  SiPerplexity,
  SiPinterest,
  SiPnpm,
  SiProton,
  SiPython,
  SiQq,
  SiReddit,
  SiSignal,
  SiSnapchat,
  SiSpotify,
  SiStackoverflow,
  SiSteam,
  SiSubstack,
  SiTelegram,
  SiThreads,
  SiTiktok,
  SiTistory,
  SiTumblr,
  SiTwitch,
  SiViber,
  SiVivo,
  SiVk,
  SiWechat,
  SiWhatsapp,
  SiWordpress,
  SiX,
  SiXiaohongshu,
  SiXiaomi,
  SiYoutube,
  SiZhihu,
  SiZalo,
  SiRiotgames,
  SiRoblox,
  SiWarp,
  SiGooglechat,
} from "react-icons/si";
import { FaAmazon, FaCodepen, FaLinkedin, FaSlack, FaWeibo } from "react-icons/fa6";
import type { IconBaseProps } from "react-icons/lib";
import type { ReactElement } from "react";
import { AtSign, Globe2, Mail, MessageCircle, Podcast, Radio, Rss, Send, Tv, Flame } from "lucide-react";

export type IconProps = IconBaseProps;

interface BrandIcon {
  render: (props: IconProps) => ReactElement;
}

// Simple Icons render with their native monochrome fill. Keep this map in sync
// with CONTACT_ICONS in contact-icon.ts — unknown keys fall back to the globe.
const BRAND_ICONS: Record<string, BrandIcon> = {
  github: { render: (props) => <SiGithub {...props} /> },
  x: { render: (props) => <SiX {...props} /> },
  telegram: { render: (props) => <SiTelegram {...props} /> },
  whatsapp: { render: (props) => <SiWhatsapp {...props} /> },
  wechat: { render: (props) => <SiWechat {...props} /> },
  qq: { render: (props) => <SiQq {...props} /> },
  bilibili: { render: (props) => <SiBilibili {...props} /> },
  youtube: { render: (props) => <SiYoutube {...props} /> },
  linkedin: { render: (props) => <FaLinkedin {...props} /> },
  instagram: { render: (props) => <SiInstagram {...props} /> },
  discord: { render: (props) => <SiDiscord {...props} /> },
  facebook: { render: (props) => <SiFacebook {...props} /> },
  weibo: { render: (props) => <FaWeibo {...props} /> },
  reddit: { render: (props) => <SiReddit {...props} /> },
  stackoverflow: { render: (props) => <SiStackoverflow {...props} /> },
  medium: { render: (props) => <SiMedium {...props} /> },
  juejin: { render: (props) => <SiJuejin {...props} /> },
  zhihu: { render: (props) => <SiZhihu {...props} /> },
  douban: { render: (props) => <SiDouban {...props} /> },
  netease: { render: (props) => <SiNeteasecloudmusic {...props} /> },
  bluesky: { render: (props) => <SiBluesky {...props} /> },
  threads: { render: (props) => <SiThreads {...props} /> },
  tiktok: { render: (props) => <SiTiktok {...props} /> },
  twitch: { render: (props) => <SiTwitch {...props} /> },
  signal: { render: (props) => <SiSignal {...props} /> },
  mastodon: { render: (props) => <SiMastodon {...props} /> },
  gitlab: { render: (props) => <SiGitlab {...props} /> },
  devto: { render: (props) => <SiDevdotto {...props} /> },
  codepen: { render: (props) => <FaCodepen {...props} /> },
  codesandbox: { render: (props) => <SiCodesandbox {...props} /> },
  dribbble: { render: (props) => <SiDribbble {...props} /> },
  behance: { render: (props) => <SiBehance {...props} /> },
  pinterest: { render: (props) => <SiPinterest {...props} /> },
  snapchat: { render: (props) => <SiSnapchat {...props} /> },
  line: { render: (props) => <SiLine {...props} /> },
  kakaotalk: { render: (props) => <SiKakaotalk {...props} /> },
  viber: { render: (props) => <SiViber {...props} /> },
  xiaohongshu: { render: (props) => <SiXiaohongshu {...props} /> },
  spotify: { render: (props) => <SiSpotify {...props} /> },
  apple: { render: (props) => <SiApple {...props} /> },
  google: { render: (props) => <SiGoogle {...props} /> },
  amazon: { render: (props) => <FaAmazon {...props} /> },
  slack: { render: (props) => <FaSlack {...props} /> },
  steam: { render: (props) => <SiSteam {...props} /> },
  go: { render: (props) => <SiGo {...props} /> },
  python: { render: (props) => <SiPython {...props} /> },
  npm: { render: (props) => <SiNpm {...props} /> },
  pnpm: { render: (props) => <SiPnpm {...props} /> },
  docker: { render: (props) => <SiDocker {...props} /> },
  kubernetes: { render: (props) => <SiKubernetes {...props} /> },
  huggingface: { render: (props) => <SiHuggingface {...props} /> },
  notion: { render: (props) => <SiNotion {...props} /> },
  evernote: { render: (props) => <SiEvernote {...props} /> },
  wordpress: { render: (props) => <SiWordpress {...props} /> },
  blogger: { render: (props) => <SiBlogger {...props} /> },
  tumblr: { render: (props) => <SiTumblr {...props} /> },
  flickr: { render: (props) => <SiFlickr {...props} /> },
  vk: { render: (props) => <SiVk {...props} /> },
  tistory: { render: (props) => <SiTistory {...props} /> },
  kofi: { render: (props) => <SiKofi {...props} /> },
  buymeacoffee: { render: (props) => <SiBuymeacoffee {...props} /> },
  patreon: { render: (props) => <SiPatreon {...props} /> },
  ghost: { render: (props) => <SiGhost {...props} /> },
  substack: { render: (props) => <SiSubstack {...props} /> },
  hashnode: { render: (props) => <SiHashnode {...props} /> },
  keybase: { render: (props) => <SiKeybase {...props} /> },
  matrix: { render: (props) => <SiMatrix {...props} /> },
  proton: { render: (props) => <SiProton {...props} /> },
  zalo: { render: (props) => <SiZalo {...props} /> },
  riotgames: { render: (props) => <SiRiotgames {...props} /> },
  roblox: { render: (props) => <SiRoblox {...props} /> },
  warp: { render: (props) => <SiWarp {...props} /> },
  googlechat: { render: (props) => <SiGooglechat {...props} /> },
  xiaomi: { render: (props) => <SiXiaomi {...props} /> },
  huawei: { render: (props) => <SiHuawei {...props} /> },
  oppo: { render: (props) => <SiOppo {...props} /> },
  vivo: { render: (props) => <SiVivo {...props} /> },
  honor: { render: (props) => <SiHonor {...props} /> },
  baidu: { render: (props) => <SiBaidu {...props} /> },
  anthropic: { render: (props) => <SiAnthropic {...props} /> },
  perplexity: { render: (props) => <SiPerplexity {...props} /> },
};

/** Render a contact icon by stored key, falling back to the globe. */
export function contactIconNode(key: string, size = 16, strokeWidth?: number) {
  const brand = BRAND_ICONS[key]
  if (brand) {
    return brand.render({ size, fill: "currentColor" })
  }
  switch (key) {
    case 'mail': return <Mail size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'rss': return <Rss size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'telegram': return <Send size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'podcast': return <Podcast size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'tv': return <Tv size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'flame': return <Flame size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'message': return <MessageCircle size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'at': return <AtSign size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'radio': return <Radio size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    case 'globe': return <Globe2 size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    default: return <Globe2 size={size} strokeWidth={strokeWidth} aria-hidden="true" />
  }
}
