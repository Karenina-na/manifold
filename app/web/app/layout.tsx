import type { Metadata } from "next";
import "@radix-ui/themes/styles.css";
import { Providers } from "../components/providers";
import { SiteNav } from "../components/site-nav";
import { BackgroundCanvas } from "../components/background-canvas";
import { SiteFooter } from "../components/site-footer";
import { FloatingRepl } from "../components/floating-repl";
import { RouteRefresh } from "../components/route-refresh";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Manifold | Profile, writings, and thoughts",
    template: "%s | Manifold",
  },
  description: "Profile, technical writings, short thoughts, and personal projects.",
  alternates: { canonical: "/" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <BackgroundCanvas />
          <SiteNav />
          <RouteRefresh />
          <div className="siteContent">{children}</div>
          <FloatingRepl displayName="Manifold" handle="@manifold" focus="Open focus" papers={[]} />
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
