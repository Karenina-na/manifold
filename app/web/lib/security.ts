import { createHash } from "node:crypto";

// Web security-boundary helpers. Route handlers import this module; client
// components must not, because of the node:crypto dependency.

// JSON.stringify leaves "<" untouched, so a value such as "</script><script>…"
// closes the surrounding inline <script> element and injects markup. The OAuth
// callback embeds the manifold_oauth_return cookie that way, and that value is
// attacker-controllable through the login query string. Escaping "<", ">", "&"
// and the two line separators as \uXXXX keeps the resulting string literal
// byte-for-byte identical while removing every way out of the script element.
export function inlineScriptJSON(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// CSP source expression pinning one inline script by the sha256 of its exact
// source text. The OAuth callback is served from /api, which the proxy matcher
// excludes, so it pins its own script by hash instead of a per-request nonce.
export function inlineScriptHash(source: string): string {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

// A cookie may only carry Secure when the browser actually reached us over TLS:
// browsers drop Secure cookies delivered over plain http, which would silently
// break sign-in on a self-hosted http deployment. x-forwarded-proto wins when a
// proxy terminates TLS in front of the app.
export function requestIsSecure(protocol: string, forwardedProto: string | null | undefined): boolean {
  const forwarded = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return protocol.toLowerCase() === "https:";
}
