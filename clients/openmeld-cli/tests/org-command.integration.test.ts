import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthSession, setAuthSession } from "../src/config/auth-session";
import {
  runOrgCurrent,
  runOrgDirectory,
  runOrgInviteLink,
  runOrgList,
  runOrgSwitch,
} from "../src/org/command";
import { buildOrganizationDirectoryFixture } from "./fixtures/organization-directory";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

type FetchCall = {
  pathname: string;
  search?: string;
  method: string;
  body: unknown;
};

describe("org commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    process.exitCode = undefined;
  });

  it("lists organizations with the active marker in agent view", async () => {
    const calls = mockOrganizationFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgList({ view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      const envelope = parseJsonLine(result.stdout, "organization.list");
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
        organizations: [
          {
            id: "org-1",
            slug: "acme",
            name: "Acme",
            role: "owner",
            active: true,
          },
          {
            id: "org-2",
            slug: "launch",
            name: "Launch Team",
            role: "admin",
            active: false,
          },
        ],
      });
    });

    expect(calls.map((call) => call.pathname)).toContain(
      "/api/auth/organization/list"
    );
  });

  it("shows the current active organization in human view", async () => {
    mockOrganizationFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgCurrent({ view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Current Organization");
      expect(result.plainStdout).toContain("Name: Acme");
      expect(result.plainStdout).toContain("Slug: acme");
      expect(result.plainStdout).toContain("Organization ID: org-1");
      expect(result.plainStdout).toContain("Role: owner");
    });
  });

  it("switches active organization remotely and updates the local session cache", async () => {
    const calls = mockOrganizationFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgSwitch({ slug: "launch", view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      const envelope = parseJsonLine(result.stdout, "organization.switch");
      expect(envelope?.payload).toMatchObject({
        status: "ok",
        organization: {
          active: {
            id: "org-2",
            slug: "launch",
            name: "Launch Team",
            role: "admin",
          },
        },
      });
      await expect(getAuthSession()).resolves.toMatchObject({
        activeOrganization: {
          id: "org-2",
          slug: "launch",
          name: "Launch Team",
          role: "admin",
        },
      });
    });

    expect(calls).toContainEqual({
      pathname: "/api/auth/organization/set-active",
      method: "POST",
      body: {
        organizationSlug: "launch",
      },
    });
  });

  it("fails closed when there is no active organization for current", async () => {
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
        runOrgCurrent({ view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      const envelope = parseJsonLine(
        result.stdout,
        "organization.active_missing"
      );
      expect(envelope?.payload).toMatchObject({
        status: "error",
        organization: {
          active: null,
        },
        error: {
          code: "organization.active_missing",
        },
      });
    });
  });

  it("returns the exact Organization Directory contract in JSON output", async () => {
    const directory = buildOrganizationDirectoryFixture();
    const calls = mockOrganizationFetch({ directory });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgDirectory({ json: true, view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(JSON.parse(result.stdout.trim())).toEqual({
        schemaVersion: 1,
        type: "organization.directory",
        ...directory,
      });
    });

    expect(calls).toContainEqual({
      body: null,
      method: "GET",
      pathname: "/v1/organizations/current/directory",
      search: "?includeMemberLastActiveAt=true",
    });
  });

  it("keeps unauthenticated directory failures machine-readable in JSON output", async () => {
    await withTempHome(async () => {
      const result = await runCommandAndCapture(() =>
        runOrgDirectory({ json: true, view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "organization.auth_required",
          message: "Sign in to OpenMeld before managing organizations.",
        },
      });
    });
  });

  it("preserves structured Organization Directory HTTP failure evidence", async () => {
    mockOrganizationFetch({
      directoryResponse: new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "organization.membership_required",
            message: "Organization membership is required.",
            requestId: "req-directory-forbidden",
            upstreamCode: "auth.organization_member_missing",
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      ),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgDirectory({ json: false, view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      const envelope = parseJsonLine(
        result.stdout,
        "organization.membership_required"
      );
      expect(envelope?.payload).toMatchObject({
        failure: {
          code: "organization.membership_required",
          message: "Organization membership is required.",
          requestId: "req-directory-forbidden",
          status: 403,
          upstreamCode: "auth.organization_member_missing",
        },
      });
    });
  });

  it("keeps invalid Organization Directory responses structured in JSON output", async () => {
    mockOrganizationFetch({
      directoryResponse: new Response(
        JSON.stringify({ organizationId: "org-1" }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-openmeld-request-id": "req-directory-invalid",
          },
        }
      ),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgDirectory({ json: true, view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "gateway.invalid_response",
          requestId: "req-directory-invalid",
        },
      });
    });
  });

  it("returns the exact invite-link create contract in JSON output", async () => {
    const joinLink = {
      id: "join-link-1",
      organizationId: "org-1",
      token: `joinlink_${"a".repeat(64)}`,
      url: `https://app.openmeld.invalid/join-organization?token=joinlink_${"a".repeat(64)}`,
      role: "member" as const,
      createdBy: "user-1",
      createdAt: "2026-07-19T12:00:00.000Z",
    };
    const calls = mockOrganizationFetch({
      inviteLinkResponse: new Response(JSON.stringify({ joinLink, ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgInviteLink({ action: "create", json: true, view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(JSON.parse(result.stdout.trim())).toEqual({
        schemaVersion: 1,
        type: "organization.invite_link.create",
        joinLink,
        ok: true,
      });
    });

    expect(calls).toContainEqual({
      pathname: "/api/auth/organization/join-link",
      search: "?organizationId=org-1",
      method: "POST",
      body: null,
    });
  });

  it.each([
    {
      action: "get" as const,
      response: { joinLink: null, ok: true } as const,
      type: "organization.invite_link.get",
      method: "GET",
    },
    {
      action: "revoke" as const,
      response: { ok: true, revoked: true } as const,
      type: "organization.invite_link.revoke",
      method: "DELETE",
    },
  ])("returns the exact invite-link $action contract", async (item) => {
    const calls = mockOrganizationFetch({
      inviteLinkResponse: new Response(JSON.stringify(item.response), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgInviteLink({ action: item.action, json: true, view: "agent" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(JSON.parse(result.stdout.trim())).toEqual({
        schemaVersion: 1,
        type: item.type,
        ...item.response,
      });
    });

    expect(calls).toContainEqual({
      pathname: "/api/auth/organization/join-link",
      search: "?organizationId=org-1",
      method: item.method,
      body: null,
    });
  });

  it("preserves the service permission refusal when a member creates an invite link", async () => {
    mockOrganizationFetch({
      inviteLinkResponse: new Response(
        JSON.stringify({
          ok: false,
          code: "organization.join_link.forbidden",
          message:
            "You do not have permission to manage this organization join link.",
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      ),
    });

    await withTempHome(async () => {
      await writeSignedInSession({ role: "member" });

      const result = await runCommandAndCapture(() =>
        runOrgInviteLink({ action: "create", json: true, view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "organization.join_link.forbidden",
          message:
            "You do not have permission to manage this organization join link.",
        },
      });
    });
  });

  it("distinguishes invite-link transport failures from invalid responses", async () => {
    mockOrganizationFetch({
      inviteLinkError: new Error("socket closed"),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runOrgInviteLink({ action: "get", json: true, view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "organization.invite_link_failed",
          message: "OpenMeld auth service is temporarily unavailable.",
        },
      });
    });
  });

  it("guides members to an owner or admin after invite-link refusal", async () => {
    mockOrganizationFetch({
      inviteLinkResponse: new Response(
        JSON.stringify({
          ok: false,
          code: "organization.join_link.forbidden",
          message:
            "You do not have permission to manage this organization join link.",
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      ),
    });

    await withTempHome(async () => {
      await writeSignedInSession({ role: "member" });

      const result = await runCommandAndCapture(() =>
        runOrgInviteLink({ action: "create", json: false, view: "human" })
      );

      expect(result.exitCode).toBe(1);
      expect(result.plainStdout).toContain(
        "Ask an Organization owner or admin to manage the invite link."
      );
    });
  });
});

async function writeSignedInSession(input?: {
  role?: "owner" | "admin" | "member";
}): Promise<void> {
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
      role: input?.role ?? "owner",
    },
  });
}

function mockOrganizationFetch(options?: {
  directory?: ReturnType<typeof buildOrganizationDirectoryFixture>;
  directoryResponse?: Response;
  inviteLinkError?: Error;
  inviteLinkResponse?: Response;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
      const pathname = new URL(url).pathname;
      const method = String(
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const parsedUrl = new URL(url);
      calls.push({
        pathname,
        ...(parsedUrl.search ? { search: parsedUrl.search } : {}),
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
          { status: 200 }
        );
      }

      if (pathname === "/api/auth/organization/list") {
        return new Response(
          JSON.stringify([
            {
              id: "org-1",
              slug: "acme",
              name: "Acme",
              role: "owner",
            },
            {
              id: "org-2",
              slug: "launch",
              name: "Launch Team",
              role: "admin",
            },
          ]),
          { status: 200 }
        );
      }

      if (pathname === "/api/auth/organization/set-active") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (pathname === "/v1/organizations/current/directory") {
        return (
          options?.directoryResponse ??
          new Response(JSON.stringify(options?.directory), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }

      if (pathname === "/api/auth/organization/join-link") {
        if (options?.inviteLinkError) {
          throw options.inviteLinkError;
        }
        return (
          options?.inviteLinkResponse ??
          new Response("not found", { status: 404 })
        );
      }

      return new Response("not found", { status: 404 });
    })
  );
  return calls;
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
