import { cookies } from "next/headers";
import { nanoid } from "nanoid";

const COOKIE_NAME = "captioncut_workspace";
const WORKSPACE_ID = /^[a-zA-Z0-9_-]{16,32}$/;
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Anonymous, browser-scoped workspace identity. It keeps public beta users'
 * project lists separated without requiring an account or exposing an id to
 * client-side JavaScript.
 */
export async function workspaceId(): Promise<string> {
  const store = await cookies();
  const current = store.get(COOKIE_NAME)?.value;
  if (current && WORKSPACE_ID.test(current)) return current;

  const created = nanoid(20);
  store.set({
    name: COOKIE_NAME,
    value: created,
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(process.env.VERCEL),
    maxAge: ONE_YEAR,
    path: "/",
    priority: "high",
  });
  return created;
}

export function safeWorkspaceId(id: string): string {
  if (!WORKSPACE_ID.test(id)) throw new Error("Invalid workspace id");
  return id;
}
