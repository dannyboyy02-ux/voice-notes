import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders, supabaseOrigin } from "./security-headers";

describe("security headers", () => {
  it("allows only this site and the Supabase project to be contacted", () => {
    const csp = contentSecurityPolicy("https://abc.supabase.co");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co");
    expect(csp).toContain("media-src 'self' blob: https://abc.supabase.co");
    expect(csp).toContain("default-src 'self'");
  });
  it("forbids framing, plugins and a changed base address", () => {
    const csp = contentSecurityPolicy("https://abc.supabase.co");
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    expect(csp).not.toContain("unsafe-eval");
  });
  it("uses only the origin of SUPABASE_URL, and falls back to any Supabase project when it is missing or odd", () => {
    expect(supabaseOrigin("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(supabaseOrigin(undefined)).toBe("https://*.supabase.co");
    expect(supabaseOrigin("not a url")).toBe("https://*.supabase.co");
    expect(supabaseOrigin("http://abc.supabase.co")).toBe("https://*.supabase.co");
  });
  it("sends the four headers", () => {
    expect(securityHeaders("https://abc.supabase.co").map((h) => h.key)).toEqual(["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]);
  });
});
