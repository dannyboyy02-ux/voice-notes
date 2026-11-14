import "server-only";
import { timingSafeEqual } from "node:crypto";

export const SELFTEST_HEADER = "x-selftest-secret";

/**
 * The self-test runs real, paid calls, so it needs SELFTEST_SECRET. The secret is read only from a header:
 * a web address is kept in logs and browser history, so a secret there would leak. Without the variable
 * set, the self-test is switched off.
 */
export function selftestAllowed(req: Request, expected = process.env.SELFTEST_SECRET?.trim()): boolean {
  if (!expected) return false;
  const a = Buffer.from(req.headers.get(SELFTEST_HEADER) ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the request tried the old way, with the secret in the address, so the refusal can say why. */
export const secretInAddress = (req: Request) => new URL(req.url).searchParams.has("key");
