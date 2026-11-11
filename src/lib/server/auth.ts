import "server-only";
import { adminDb } from "./db";
import { missingEnv } from "./env";

export type Owner = { userId: string };

/** Server routes accept only the owner's account. Returns the owner, or the response to send back. */
export async function requireOwner(req: Request): Promise<Owner | Response> {
  const missing = missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  if (missing.length) return Response.json({ error: "server_not_configured", missing }, { status: 503 });
  const token = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return Response.json({ error: "not_signed_in" }, { status: 401 });
  const { data, error } = await adminDb().auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "not_signed_in" }, { status: 401 });
  const owner = process.env.OWNER_USER_ID?.trim();
  if (!owner || data.user.id !== owner) {
    // The caller proved who they are, so telling them their own id is safe. It is what OWNER_USER_ID must hold.
    return Response.json({ error: owner ? "not_owner" : "owner_not_configured", yourUserId: data.user.id }, { status: 403 });
  }
  return { userId: data.user.id };
}
