import "server-only";
import { cookies, headers } from "next/headers";
import { translator } from "./i18n";
import { LOCALE_COOKIE_KEY, resolveLocale } from "./locale";

export async function getRequestLocale() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE_KEY)?.value, headerStore.get("accept-language"));
}

export async function getServerI18n() {
  const locale = await getRequestLocale();
  return { locale, t: translator(locale) };
}
