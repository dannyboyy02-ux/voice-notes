/**
 * Security headers for every response. The policy lets the app's pages load only their own scripts, styles
 * and images, talk only to this server and the Supabase project, and never be shown inside another site.
 *
 * Next.js puts its own inline scripts in every page, so scripts allow 'unsafe-inline'. The alternative, a
 * fresh nonce per request, would make every page render on the server instead of being served as a static
 * file (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md). The limit on where
 * the page may send data is what contains a script-injection bug, should one ever be added.
 */
export function supabaseOrigin(url: string | undefined): string {
  try {
    const u = new URL(url ?? "");
    if (u.protocol === "https:" || u.hostname === "localhost") return u.origin;
  } catch { /* not set at build time: fall back below */ }
  // Without SUPABASE_URL at build time, allow any Supabase project rather than break the app.
  return "https://*.supabase.co";
}

export function contentSecurityPolicy(supabase: string): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Recordings play from the phone's own storage (blob:) or from a signed Supabase link.
    `media-src 'self' blob: ${supabase}`,
    `connect-src 'self' ${supabase}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(supabaseUrl: string | undefined) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(supabaseOrigin(supabaseUrl)) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ];
}
