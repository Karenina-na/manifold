import type { Metadata } from "next";
import { headers } from "next/headers";
import "@radix-ui/themes/styles.css";
import { Providers } from "../components/layout/providers";
import { SiteNav } from "../components/layout/site-nav";
import { BackgroundCanvas } from "../components/layout/background-canvas";
import { SiteFooter } from "../components/layout/site-footer";
import { FloatingRepl } from "../features/home/floating-repl";
import { RouteRefresh } from "../components/layout/route-refresh";
import { loadSiteData, fallbackSiteDescription, fallbackSiteFooter, fallbackSiteTitle } from "../lib/api";
import { themeInitScript } from "../lib/theme";
import { getServerI18n } from "../i18n/i18n-server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const [site, { t }] = await Promise.all([loadSiteData(), getServerI18n()]);
  const title = site?.title || fallbackSiteTitle;
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: {
      default: t("metadata.defaultTitle", { title }),
      template: `%s | ${title}`,
    },
    description: site?.description || t("metadata.fallbackDescription") || fallbackSiteDescription,
    alternates: { canonical: "/" },
  };
}

// The theme script has to be inline to run before the first paint, and the CSP
// sets `script-src 'nonce-…' 'strict-dynamic'` with no 'unsafe-inline', so the
// tag needs the per-request nonce. Next.js puts the policy on the request
// headers for exactly this purpose; read it back rather than recomputing.
async function contentSecurityPolicyNonce() {
  const policy = (await headers()).get("content-security-policy");
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [site, nonce, { locale, t }] = await Promise.all([loadSiteData(), contentSecurityPolicyNonce(), getServerI18n()]);
  return (
    // `themeInitScript` below writes `data-theme` on this element before React
    // hydrates, and the server cannot know a reader's stored preference, so the
    // attribute is always "unexpected" to the client render. Suppressing it here
    // is the supported way to keep the pre-paint script: it covers this element's
    // own attributes only, not the subtree.
    <html lang={locale} suppressHydrationWarning>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Providers locale={locale}>
          <BackgroundCanvas />
          <SiteNav navigation={site?.navigation} />
          <RouteRefresh />
          <div className="siteContent">{children}</div>
          <FloatingRepl
            displayName={site?.title || fallbackSiteTitle}
            handle="@manifold"
            description={site?.description || fallbackSiteDescription}
            focus={t("repl.focus")}
            links={site?.social?.map((item) => ({ label: item.label, href: item.href })) ?? []}
          />
          <SiteFooter footer={site?.footer || fallbackSiteFooter} social={site?.social} />
        </Providers>
      </body>
    </html>
  );
}
