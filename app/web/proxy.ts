import { NextRequest, NextResponse } from "next/server";

// Content-Security-Policy with a per-request nonce.
//
// Why a nonce and not 'unsafe-inline': the visitor session is a 90-day,
// non-revocable JWT that JavaScript must be able to read (the browser SDK
// forwards it as a Bearer credential), so any XSS is a durable identity
// takeover. 'unsafe-inline' would allow exactly the injected inline script that
// scenario needs, which is why script-src pins a nonce instead.
//
// Every page in this app already opts into dynamic rendering
// (`export const dynamic = "force-dynamic"`), so the nonce does not cost any
// static optimisation. Routes under /api are excluded by the matcher: they
// serve JSON, and the one HTML route there (the OAuth callback) pins its own
// inline script by sha256 hash.
function contentSecurityPolicy(nonce: string) {
  const isDevelopment = process.env.NODE_ENV === "development";
  // React uses eval in development to rebuild server-side error stacks in the
  // browser; production needs neither React nor Next.js to evaluate strings.
  const scriptSrc = `'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`;
  const coreOrigin = resolveOrigin(process.env.NEXT_PUBLIC_CORE_URL);
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Radix Themes and KaTeX both inject <style> elements at runtime, and KaTeX
    // emits inline style attributes; inline styles are not a script-execution
    // vector, so they stay allowed rather than breaking the reading surface.
    "style-src 'self' 'unsafe-inline'",
    // Markdown bodies may embed any remote image, and GitHub supplies the
    // comment avatars; restricting the scheme to https keeps the risk to
    // third-party image requests rather than allowing arbitrary origins.
    // The site's own Core origin is listed explicitly for the same reason
    // `connect-src` needs it: uploaded media is served from there, and a
    // self-hosted Core is not necessarily https, so an https-only rule
    // silently breaks every uploaded image.
    `img-src 'self' data: blob: https:${coreOrigin ? ` ${coreOrigin}` : ""}`,
    "font-src 'self' data:",
    // The browser SDK calls Core on its own origin, which is not 'self'.
    `connect-src 'self'${coreOrigin ? ` ${coreOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ");
}

function resolveOrigin(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  // Next.js reads the nonce back out of the request's CSP header and applies it
  // to its own script tags, so this header must be set on the request too.
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
