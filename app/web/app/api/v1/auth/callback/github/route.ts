import { NextRequest, NextResponse } from "next/server";
import { inlineScriptHash, inlineScriptJSON, requestIsSecure } from "../../../../../../lib/security";

export const runtime = "nodejs";

const VISITOR_COOKIE = "manifold-visitor";
const VISITOR_TTL_SECONDS = 90 * 24 * 60 * 60;

// GitHub OAuth callback: verifies the state round trip, asks Core to exchange
// the code (Core holds the client secret and mints the visitor session), then
// stores the session as a readable cookie — the browser SDK forwards it as a
// Bearer credential when calling Core directly, since cookie domains are
// isolated between the web app and the API server.
//
// The happy path is a popup leg: the composer opens this route in a popup and
// expects a postMessage back. The callback therefore renders a tiny page that
// notifies the opener and closes itself. When the popup was blocked and the
// composer fell back to a full-page navigation there is no opener, so the same
// page redirects via location.replace — replace keeps the history stack clean
// and the back button never lands on GitHub.
//
// Every value interpolated into the inline script goes through
// inlineScriptJSON: `fallback` derives from the manifold_oauth_return cookie,
// which an attacker can seed through the login query string, so a raw
// "</script>" in it would otherwise end the script block and inject markup.
function authHtml(origin: string, payload: { ok: boolean; fallback: string }) {
  const script = `
    var origin = ${inlineScriptJSON(origin)};
    var fallback = ${inlineScriptJSON(payload.fallback)};
    if (window.opener) {
      window.opener.postMessage({ type: "manifold:github-auth", ok: ${payload.ok ? "true" : "false"} }, origin);
      window.close();
    } else {
      window.location.replace(fallback);
    }
  `;
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Signing in…</title></head><body><script>${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // This route lives under /api, which the proxy matcher skips, so it
        // pins its own inline script by hash rather than a per-request nonce.
        "Content-Security-Policy": `default-src 'none'; script-src ${inlineScriptHash(script)}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expected = request.cookies.get("manifold_oauth_state")?.value;
  const returnTo = request.cookies.get("manifold_oauth_return")?.value ?? "/";
  if (!state || state !== expected || !code) {
    return authHtml(origin, { ok: false, fallback: "/?oauth=state" });
  }
  const coreUrl = process.env.NEXT_PUBLIC_CORE_URL ?? "http://localhost:8080";
  let exchange: Response;
  try {
    exchange = await fetch(`${coreUrl}/api/v1/auth/github/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
  } catch {
    return authHtml(origin, { ok: false, fallback: "/?oauth=failed" });
  }
  if (!exchange.ok) {
    return authHtml(origin, { ok: false, fallback: "/?oauth=failed" });
  }
  const payload = (await exchange.json()) as { token?: string };
  if (!payload.token) {
    return authHtml(origin, { ok: false, fallback: "/?oauth=failed" });
  }
  const target = new URL(returnTo, origin);
  const response = authHtml(origin, { ok: true, fallback: target.toString() });
  response.cookies.set(VISITOR_COOKIE, payload.token, {
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_TTL_SECONDS,
    // The token is a 90-day, non-revocable HS256 JWT that JavaScript must be
    // able to read (the SDK forwards it as a Bearer credential), so httpOnly is
    // not available. Secure is: without it the credential travels in cleartext
    // on any http hop.
    secure: requestIsSecure(request.nextUrl.protocol, request.headers.get("x-forwarded-proto")),
  });
  return response;
}
