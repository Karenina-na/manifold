import type { Metadata } from "next";
import { Providers } from "../components/providers";
import { SiteNav } from "../components/site-nav";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Manifold | A living space for ideas in motion",
    template: "%s | Manifold",
  },
  description: "A quiet digital garden for experiences, writing, thoughts, and research.",
  alternates: { canonical: "/" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
