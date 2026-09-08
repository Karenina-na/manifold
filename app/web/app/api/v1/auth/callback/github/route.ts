import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const VISITOR_COOKIE = "manifold-visitor";
const VISITOR_TTL_SECONDS = 90 * 24 * 60 * 60;

// GitHub OAuth callback: verifies the state round trip, asks Core to exchange
// the code (Core holds the client secret and mints the visitor session), then
// stores the session as a readable cookie — the browser SDK forwards it as a
// Bearer credential when calling Core directly, since cookie domains are
// isolated between the web app and the API server.
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expected = request.cookies.get("manifold_oauth_state")?.value;
  const returnTo = request.cookies.get("manifold_oauth_return")?.value ?? "/";
  if (!state || state !== expected || !code) {
    return NextResponse.redirect(new URL("/?oauth=state", request.nextUrl.origin));
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
    return NextResponse.redirect(new URL("/?oauth=failed", request.nextUrl.origin));
  }
  if (!exchange.ok) {
    return NextResponse.redirect(new URL("/?oauth=failed", request.nextUrl.origin));
  }
  const payload = (await exchange.json()) as { token?: string };
  if (!payload.token) {
    return NextResponse.redirect(new URL("/?oauth=failed", request.nextUrl.origin));
  }
  const target = new URL(returnTo, request.nextUrl.origin);
  const response = NextResponse.redirect(target.toString());
  response.cookies.set(VISITOR_COOKIE, payload.token, { sameSite: "lax", path: "/", maxAge: VISITOR_TTL_SECONDS });
  return response;
}
