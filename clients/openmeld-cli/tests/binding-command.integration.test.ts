import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runBindingAuthorize,
  runBindingList,
  runBindingRevoke,
} from "../src/binding/command";
import { setAuthSession } from "../src/config/auth-session";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

type FetchCall = {
  pathname: string;
  method: string;
  body: unknown;
};

const AUTHORIZATION_CREATED_AT = "2026-07-05T01:02:03.000Z";

describe("binding organization authorization commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    process.exitCode = undefined;
  });

  it("authorizes an Agent Profile primary Binding for the active organization", async () => {
    const calls = mockBindingFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runBindingAuthorize({
          agentProfileId: "agent-profile-1",
          view: "agent",
        })
      );

      expect(result.exitCode).toBeUndefined();
      const envelope = parseJsonLine(result.stdout, "binding.authorize");
      expect(envelope?.payload).toMatchObject({
        status: "ok",
        organization: {
          active: {
            id: "org-1",
            slug: "acme",
            name: "Acme",
            role: "owner",
          },
        },
        authorization: {
          agentProfileId: "agent-profile-1",
          bindingId: "binding-1",
          organizationId: "org-1",
          status: "authorized",
        },
      });
    });

    expect(calls).toContainEqual({
      pathname:
        "/v1/agent-profiles/agent-profile-1/primary-binding/organization-authorization",
      method: "PUT",
      body: null,
    });
  });

  it("lists Binding authorizations in agent view with organization context", async () => {
    mockBindingFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runBindingList({ view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      const envelope = parseJsonLine(result.stdout, "binding.list");
      expect(envelope?.payload).toMatchObject({
        status: "ok",
        organization: {
          active: {
            id: "org-1",
            slug: "acme",
            name: "Acme",
          },
        },
        organizationId: "org-1",
        authorizations: [
          {
            agentProfileId: "agent-profile-1",
            bindingId: "binding-1",
            authorizedBy: "user-1",
            createdAt: AUTHORIZATION_CREATED_AT,
          },
        ],
      });
    });
  });

  it("renders revoke results in human view", async () => {
    mockBindingFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runBindingRevoke({
          agentProfileId: "agent-profile-1",
          view: "human",
        })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Binding Authorization Revoked");
      expect(result.plainStdout).toContain("Organization: Acme (acme), owner");
      expect(result.plainStdout).toContain("Agent Profile ID: agent-profile-1");
      expect(result.plainStdout).toContain("Status: revoked");
      expect(result.plainStdout).toContain("Revoked: yes");
    });
  });

  it("fails closed when no active organization is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: { id: "session-1" },
            user: { id: "user-1" },
          }),
          { status: 200 }
        )
      )
    );

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-valid",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const result = await runCommandAndCapture(() =>
        runBindingList({ view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      const envelope = parseJsonLine(
        result.stdout,
        "binding.organization_required"
      );
      expect(envelope?.payload).toMatchObject({
        status: "error",
        organization: {
          active: null,
        },
        error: {
          code: "binding.organization_required",
        },
      });
    });
  });

  it("classifies organization access denial without exposing raw gateway errors", async () => {
    mockBindingFetch({
      authorizeResponse: new Response("forbidden internal detail", {
        status: 403,
      }),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runBindingAuthorize({
          agentProfileId: "agent-profile-1",
          view: "agent",
        })
      );

      expect(result.exitCode).toBe(1);
      const envelope = parseJsonLine(
        result.stdout,
        "binding.organization_access_denied"
      );
      expect(envelope?.payload).toMatchObject({
        status: "error",
        organization: {
          active: {
            id: "org-1",
            slug: "acme",
          },
        },
        error: {
          code: "binding.organization_access_denied",
        },
        agentProfileId: "agent-profile-1",
      });
      expect(result.stdout).not.toContain("forbidden internal detail");
    });
  });
});

async function writeSignedInSession(): Promise<void> {
  vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.openmeld.invalid");
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-valid",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    activeOrganization: {
      id: "org-1",
      slug: "acme",
      name: "Acme",
      role: "owner",
    },
  });
}

function mockBindingFetch(input?: {
  authorizeResponse?: Response;
  listResponse?: Response;
  revokeResponse?: Response;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((request: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof request === "string" || request instanceof URL
          ? String(request)
          : request.url;
      const pathname = new URL(url).pathname;
      const method = String(
        init?.method ?? (request instanceof Request ? request.method : "GET")
      ).toUpperCase();
      calls.push({
        pathname,
        method,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : null,
      });

      if (pathname === "/api/auth/get-session") {
        return new Response(
          JSON.stringify({
            session: {
              id: "session-1",
              activeOrganizationId: "org-1",
            },
            user: { id: "user-1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (
        pathname ===
          "/v1/agent-profiles/agent-profile-1/primary-binding/organization-authorization" &&
        method === "PUT"
      ) {
        return (
          input?.authorizeResponse ??
          jsonResponse({
            agentProfileId: "agent-profile-1",
            authorizedBy: "user-1",
            bindingId: "binding-1",
            createdAt: AUTHORIZATION_CREATED_AT,
            organizationId: "org-1",
            status: "authorized",
          })
        );
      }

      if (
        pathname ===
          "/v1/agent-profiles/agent-profile-1/primary-binding/organization-authorization" &&
        method === "DELETE"
      ) {
        return (
          input?.revokeResponse ??
          jsonResponse({
            agentProfileId: "agent-profile-1",
            bindingId: "binding-1",
            organizationId: "org-1",
            revoked: true,
            status: "revoked",
          })
        );
      }

      if (
        pathname ===
          "/v1/agent-profiles/primary-bindings/organization-authorizations" &&
        method === "GET"
      ) {
        return (
          input?.listResponse ??
          jsonResponse({
            organizationId: "org-1",
            authorizations: [
              {
                agentProfileId: "agent-profile-1",
                authorizedBy: "user-1",
                bindingId: "binding-1",
                createdAt: AUTHORIZATION_CREATED_AT,
              },
            ],
          })
        );
      }

      return new Response("not found", { status: 404 });
    })
  );
  return calls;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function runCommandAndCapture(command: () => Promise<void>) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await withCapturedStdio(command);
    return {
      ...result,
      exitCode: process.exitCode,
    };
  } finally {
    process.exitCode = previousExitCode;
  }
}

function parseJsonLine(
  stdout: string,
  code: string
): {
  code?: string;
  payload?: Record<string, unknown>;
} | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const parsed = JSON.parse(trimmed) as {
      code?: string;
      payload?: Record<string, unknown>;
    };
    if (parsed.code === code) {
      return parsed;
    }
  }
  return null;
}
