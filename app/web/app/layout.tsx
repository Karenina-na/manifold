import type { Metadata } from "next";
import { headers } from "next/headers";
import "@radix-ui/themes/styles.css";
import { Providers } from "../components/providers";
import { SiteNav } from "../components/site-nav";
import { BackgroundCanvas } from "../components/background-canvas";
import { SiteFooter } from "../components/site-footer";
import { FloatingRepl } from "../components/floating-repl";
import { RouteRefresh } from "../components/route-refresh";
import { loadSiteData, fallbackSiteDescription, fallbackSiteFooter, fallbackSiteTitle } from "../lib/api";
import { themeInitScript } from "../lib/theme";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const site = await loadSiteData();
  const title = site?.title || fallbackSiteTitle;
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: {
      default: `${title} | Profile, writings, and thoughts`,
      template: `%s | ${title}`,
    },
    description: site?.description || fallbackSiteDescription,
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
  const [site, nonce] = await Promise.all([loadSiteData(), contentSecurityPolicyNonce()]);
  return (
    // `themeInitScript` below writes `data-theme` on this element before React
    // hydrates, and the server cannot know a reader's stored preference, so the
    // attribute is always "unexpected" to the client render. Suppressing it here
    // is the supported way to keep the pre-paint script: it covers this element's
    // own attributes only, not the subtree.
    <html lang="en" suppressHydrationWarning>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Providers>
          <BackgroundCanvas />
          <SiteNav navigation={site?.navigation} />
          <RouteRefresh />
          <div className="siteContent">{children}</div>
          <FloatingRepl displayName={site?.title || fallbackSiteTitle} handle="@manifold" focus="Open focus" />
          <SiteFooter footer={site?.footer || fallbackSiteFooter} social={site?.social} />
        </Providers>
      </body>
    </html>
  );
}
