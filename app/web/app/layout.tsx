import type { Metadata } from "next";
import "@radix-ui/themes/styles.css";
import { Providers } from "../components/providers";
import { SiteNav } from "../components/site-nav";
import { BackgroundCanvas } from "../components/background-canvas";
import { SiteFooter } from "../components/site-footer";
import { FloatingRepl } from "../components/floating-repl";
import { RouteRefresh } from "../components/route-refresh";
import { loadPapers, loadSiteData, fallbackSiteDescription, fallbackSiteFooter, fallbackSiteTitle } from "../lib/api";
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [papers, site] = await Promise.all([loadPapers(), loadSiteData()]);
  return (
    <html lang="en">
      <body>
        <Providers>
          <BackgroundCanvas />
          <SiteNav navigation={site?.navigation} />
          <RouteRefresh />
          <div className="siteContent">{children}</div>
          <FloatingRepl displayName={site?.title || fallbackSiteTitle} handle="@manifold" focus="Open focus" papers={papers} />
          <SiteFooter footer={site?.footer || fallbackSiteFooter} social={site?.social} />
        </Providers>
      </body>
    </html>
  );
}
