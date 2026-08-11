import type { Context } from "hono";
import type { AppContext } from "../context";
import type { createAuth } from ".";

type AuthInstance = ReturnType<typeof createAuth>;

export async function refreshAuthSessionCookie(
  c: Context<AppContext>
): Promise<void> {
  const cookies = await readRefreshedAuthSessionCookies({
    auth: c.var.betterAuth,
    headers: c.req.raw.headers,
  });
  for (const cookie of cookies) {
    c.header("set-cookie", cookie, { append: true });
  }
}

export async function readRefreshedAuthSessionCookies(input: {
  auth: AuthInstance;
  headers: Headers;
}): Promise<string[]> {
  const response = await input.auth.api.getSession({
    asResponse: true,
    headers: input.headers,
    query: {
      disableCookieCache: true,
    },
  });

  return readSetCookieHeaders(response.headers);
}

function readSetCookieHeaders(headers: Headers): string[] {
  const headersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headersWithSetCookie.getSetCookie?.();
  if (setCookies && setCookies.length > 0) {
    return setCookies;
  }

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}
