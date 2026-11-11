import "server-only";

/** Every value the server needs. Names only are ever reported, never values. */
export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ASSEMBLYAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OWNER_USER_ID",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
] as const;
export type EnvName = (typeof REQUIRED_ENV)[number];

export function missingEnv(names: readonly string[] = REQUIRED_ENV): string[] {
  return names.filter((n) => !process.env[n]?.trim());
}

export function need(name: EnvName | "SELFTEST_SECRET"): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** The public address of the app, used by the scheduler and in notifications. */
export function appUrl(req?: Request): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;
  if (req) return new URL(req.url).origin;
  throw new Error("Cannot work out the app URL");
}
