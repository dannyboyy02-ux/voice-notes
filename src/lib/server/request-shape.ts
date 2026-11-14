/**
 * Cheap checks that run before anything costs money or touches the database: a request that does not even
 * carry a well-formed credential is refused at once, without a Supabase call and without saying anything
 * about how the server is configured. The real check still happens afterwards.
 */

/** A Supabase access token is a JWT: three base64url parts joined by dots. */
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;

/** The bearer token, if the request carries one shaped like a Supabase access token. */
export function bearerToken(req: Request): string | null {
  const token = /^Bearer (\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  return token && token.length <= 8192 && JWT.test(token) ? token : null;
}

/**
 * The scheduler's secret, if the request carries one shaped like it. supabase/setup.sql makes it from two
 * UUIDs with the dashes removed (64 hex characters); any 32 to 128 hex characters are let through to the
 * database, so a secret made another way could never silently stop the scheduler.
 */
export function tickSecret(req: Request): string | null {
  const secret = req.headers.get("x-tick-secret") ?? "";
  return /^[0-9a-f]{32,128}$/i.test(secret) ? secret : null;
}
