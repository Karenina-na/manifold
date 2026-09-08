import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

// Starts the GitHub OAuth dance for the public comment identity. The client id
// is public; the secret lives only in Core, which performs the token exchange
// on the callback leg. state and the return target are pinned in short-lived
// HttpOnly cookies so the callback can verify the round trip and never trusts
// an open redirect target.
export async function GET(request: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: { code: "GITHUB_AUTH_DISABLED", message: "GitHub sign-in is not configured." } },
      { status: 503 },
    );
  }
  const returnTo = request.nextUrl.searchParams.get("return_to") ?? "/";
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  const state = randomBytes(18).toString("hex");
  const redirectUri = `${request.nextUrl.origin}/api/v1/auth/callback/github`;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "read:user");
  const response = NextResponse.redirect(authorize.toString());
  response.cookies.set("manifold_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  response.cookies.set("manifold_oauth_return", safeReturnTo, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
