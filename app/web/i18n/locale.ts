export const locales = ["en", "zh-CN"] as const;
export type Locale = (typeof locales)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "manifold.locale";
export const LOCALE_COOKIE_KEY = "manifold.locale";

export function parseLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.trim().replace("_", "-").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

export function parseAcceptLanguage(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const candidates = value
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return { locale: parseLocale(tag), quality: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter((candidate): candidate is { locale: Locale; quality: number } => candidate.locale !== null && Number.isFinite(candidate.quality) && candidate.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  return candidates[0]?.locale ?? null;
}

export function resolveLocale(cookieLocale: string | null | undefined, browserLanguage: string | null | undefined): Locale {
  return parseLocale(cookieLocale) ?? parseAcceptLanguage(browserLanguage) ?? DEFAULT_LOCALE;
}

export function parseLocaleCookie(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const encoded = value
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === LOCALE_COOKIE_KEY)
    ?.slice(1)
    .join("=");
  if (!encoded) return null;
  try {
    return parseLocale(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

export function localeCookie(locale: Locale, secure = false) {
  return `${LOCALE_COOKIE_KEY}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax${secure ? "; secure" : ""}`;
}
