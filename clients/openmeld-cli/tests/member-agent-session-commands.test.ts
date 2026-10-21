import {
  gatewayErrorEnvelopeSchema,
  listAgentDirectMessageSessionsResponseSchema,
  listMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import { resetOpenMeldProfilesSessionCacheForTests } from "../src/config/openmeld-profiles-api";
import {
  runSessionArchive,
  runSessionDelete,
  runSessionList,
  runSessionRename,
  runSessionRestore,
} from "../src/member-agents/session-command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestProfileHandle } from "./helpers/openmeld-profile-fixture";

const memberAgentsFlag = vi.hoisted(() => ({ enabled: true }));
const canUseInteractivePromptsMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@openmeld/schemas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/schemas")>();
  return {
    ...actual,
    get MEMBER_AGENTS_ENABLED() {
      return memberAgentsFlag.enabled;
    },
  };
});

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: (...args: unknown[]) =>
    canUseInteractivePromptsMock(...args),
}));

vi.mock("@clack/prompts", () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: (value: unknown) => typeof value === "symbol",
}));

const AUTH_BASE_URL = "https://auth.openmeld.invalid";
const GATEWAY_BASE_URL = "https://gateway.openmeld.invalid";
const SESSIONS_PATH = "/v1/organizations/current/direct-message-sessions";

const PROFILES = [
  profilePayload({ id: "hum-felix", name: "Felix Lu", kind: "human" }),
  profilePayload({
    id: "agt_11111111-1111-4111-8111-111111111111",
    name: "Codex",
    kind: "agent",
  }),
  profilePayload({
    id: "agt_22222222-2222-4222-8222-222222222222",
    name: "PR Reviewer",
    kind: "agent",
  }),
];

const LISTING = listMemberAgentsResponseSchema.parse({
  ok: true,
  organizationId: "org-1",
  memberAgents: [
    {
      id: "ma-codex",
      organizationId: "org-1",
      ownerUserId: "user-1",
      harnessKind: "codex",
      defaultProfileId: "agt_11111111-1111-4111-8111-111111111111",
      source: "detected",
      archivedAt: null,
      profiles: [
        {
          openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "Codex",
          isDefault: true,
        },
        {
          openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
          profileName: "PR Reviewer",
          isDefault: false,
        },
      ],
    },
  ],
  unassignedProfiles: [],
});

const SESSIONS: Record<string, { active: unknown[]; archived: unknown[] }> = {
  "agt_11111111-1111-4111-8111-111111111111": {
    active: [
      session({
        spaceId: "dm-1",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        name: "Fix the login flow",
        previewAt: Date.parse("2026-10-18T09:30:00.000Z"),
      }),
      session({
        spaceId: "dm-2",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        name: null,
      }),
    ],
    archived: [
      session({
        spaceId: "dm-3",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        name: "Old release notes",
        archivedAt: "2026-10-10T00:00:00.000Z",
      }),
    ],
  },
  "agt_22222222-2222-4222-8222-222222222222": { active: [], archived: [] },
};

type FetchCall = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
  organizationHeader: string | null;
};

type GatewayFailure = { code: string; message: string; status: number };

describe("openmeld session commands", () => {
  beforeEach(() => {
    memberAgentsFlag.enabled = true;
    canUseInteractivePromptsMock.mockReset().mockReturnValue(false);
    confirmMock.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    resetOpenMeldProfilesSessionCacheForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    process.exitCode = undefined;
  });

  it("lists Sessions grouped by Agent Profile in Human View", async () => {
    const calls = stubFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runSessionList({ memberAgent: "codex", view: "human" })
      );
      expect(stdout).toContain("Felix Lu's Codex · Codex (default) (3)");
      expect(stdout).toContain("Fix the login flow");
      expect(stdout).toContain(
        "Active · last activity: 2026-10-18 09:30 UTC · id: dm-1"
      );
      expect(stdout).toContain("Untitled Session");
      expect(stdout).toContain("Old release notes");
      expect(stdout).toContain("Archived · last activity:");
      expect(stdout).toContain("Felix Lu's Codex · PR Reviewer (0)");
      expect(stdout).toContain("No Sessions with this Agent Profile yet.");
    });
    expect(process.exitCode).toBeUndefined();
    const sessionCalls = calls.filter(
      (call) => call.pathname === SESSIONS_PATH
    );
    expect(sessionCalls).toHaveLength(4);
    expect(sessionCalls.map((call) => call.organizationHeader)).toEqual(
      Array.from({ length: 4 }, () => "org-1")
    );
  });

  it("returns one Agent View result with stable ids and states", async () => {
    stubFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runSessionList({
          memberAgent: "ma-codex",
          profile: "agt_11111111-1111-4111-8111-111111111111",
          view: "agent",
        })
      );
      expect(parseSingleFrame(stdout)).toEqual({
        type: "result",
        code: "member_agents.sessions.list",
        payload: {
          organizationId: "org-1",
          memberAgent: {
            id: "ma-codex",
            displayName: "Felix Lu's Codex",
            harnessKind: "codex",
          },
          profiles: [
            {
              openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
              profileName: "Codex",
              isDefault: true,
              hasMore: false,
              sessions: [
                {
                  spaceId: "dm-1",
                  title: "Fix the login flow",
                  state: "active",
                  createdAt: "2026-10-01T00:00:00.000Z",
                  archivedAt: null,
                  lastActivityAt: "2026-10-18T09:30:00.000Z",
                },
                {
                  spaceId: "dm-2",
                  title: null,
                  state: "active",
                  createdAt: "2026-10-01T00:00:00.000Z",
                  archivedAt: null,
                  lastActivityAt: "2026-10-01T00:00:00.000Z",
                },
                {
                  spaceId: "dm-3",
                  title: "Old release notes",
                  state: "archived",
                  createdAt: "2026-10-01T00:00:00.000Z",
                  archivedAt: "2026-10-10T00:00:00.000Z",
                  lastActivityAt: "2026-10-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      });
    });
  });

  it("refuses a Profile that is not under the Agent before listing Sessions", async () => {
    const calls = stubFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runSessionList({
          memberAgent: "codex",
          profile: "agt-other",
          view: "agent",
        })
      );
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "member_agents.sessions.profile_not_found",
      });
    });
    expect(process.exitCode).toBe(1);
    expect(calls.some((call) => call.pathname === SESSIONS_PATH)).toBe(false);
  });

  it("renames, archives and restores through the Session operations", async () => {
    const calls = stubFetch();
    await withTempHome(async () => {
      await signIn();
      const renamed = await withCapturedStdio(() =>
        runSessionRename({
          spaceId: "dm-1",
          title: "  Login flow  ",
          view: "agent",
        })
      );
      expect(parseSingleFrame(renamed.stdout)).toEqual({
        type: "result",
        code: "member_agents.sessions.rename",
        payload: {
          spaceId: "dm-1",
          organizationId: "org-1",
          name: "Login flow",
          archivedAt: null,
          state: "active",
        },
      });
      const archived = await withCapturedStdio(() =>
        runSessionArchive({ spaceId: "dm-1", view: "human" })
      );
      expect(archived.stdout).toContain("Session Archived");
      expect(archived.stdout).toContain("Archived");
      const restored = await withCapturedStdio(() =>
        runSessionRestore({ spaceId: "dm-1", view: "agent" })
      );
      expect(parseSingleFrame(restored.stdout)).toMatchObject({
        code: "member_agents.sessions.restore",
        payload: { spaceId: "dm-1", state: "active" },
      });
    });
    expect(process.exitCode).toBeUndefined();
    expect(
      calls
        .filter((call) => call.method === "PATCH")
        .map((call) => ({ pathname: call.pathname, body: call.body }))
    ).toEqual([
      {
        pathname: `${SESSIONS_PATH}/dm-1`,
        body: { operation: "rename", name: "Login flow" },
      },
      { pathname: `${SESSIONS_PATH}/dm-1`, body: { operation: "archive" } },
      { pathname: `${SESSIONS_PATH}/dm-1`, body: { operation: "unarchive" } },
    ]);
  });

  it("requires --yes to delete in Agent View and never calls the route without it", async () => {
    const calls = stubFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runSessionDelete({ spaceId: "dm-1", view: "agent" })
      );
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "member_agents.sessions.delete_confirmation_required",
        data: {
          error: { nextStep: "Run `openmeld session delete dm-1 --yes`." },
        },
      });
    });
    expect(process.exitCode).toBe(1);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("deletes with --yes in Agent View", async () => {
    const calls = stubFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runSessionDelete({ spaceId: "dm-1", yes: true, view: "agent" })
      );
      expect(parseSingleFrame(stdout)).toEqual({
        type: "result",
        code: "member_agents.sessions.delete",
        payload: { spaceId: "dm-1", organizationId: "org-1", deleted: true },
      });
    });
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("asks before deleting in Human View and keeps the Session when declined", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const calls = stubFetch();
    await withTempHome(async () => {
      await signIn();
      const declined = await withCapturedStdio(() =>
        runSessionDelete({ spaceId: "dm-1", view: "human" })
      );
      expect(declined.stdout).toContain(
        "Deletion canceled. The Session was not changed."
      );
      expect(calls.some((call) => call.method === "DELETE")).toBe(false);

      const accepted = await withCapturedStdio(() =>
        runSessionDelete({ spaceId: "dm-1", view: "human" })
      );
      expect(accepted.stdout).toContain("Session Deleted");
    });
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("maps a non-participant refusal to the shared error frame with a next step", async () => {
    stubFetch({
      failure: {
        code: "direct_message_session.forbidden",
        message: "Only the person in this chat can change it.",
        status: 403,
      },
    });
    await withTempHome(async () => {
      await signIn();
      const agent = await withCapturedStdio(() =>
        runSessionArchive({ spaceId: "dm-colleague", view: "agent" })
      );
      expect(parseSingleFrame(agent.stdout)).toEqual({
        type: "error",
        code: "direct_message_session.forbidden",
        message: "Only the person in this chat can change it.",
        data: {
          error: {
            code: "direct_message_session.forbidden",
            message: "Only the person in this chat can change it.",
            nextStep:
              "Only the person in a Direct Message can change its Sessions. Run `openmeld session list --agent <agent>` and copy a Session ID.",
          },
          message: "Only the person in this chat can change it.",
          status: "error",
        },
      });
      process.exitCode = undefined;
      const human = await withCapturedStdio(() =>
        runSessionDelete({ spaceId: "dm-colleague", yes: true, view: "human" })
      );
      expect(human.stdout).toContain("Not Your Session");
      expect(human.stdout).toContain(
        "Only the person in this chat can change it."
      );
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints the not-enabled message and calls no route while the flag is off", async () => {
    memberAgentsFlag.enabled = false;
    const calls = stubFetch();
    await withTempHome(async () => {
      await signIn();
      const runs = [
        () => runSessionList({ memberAgent: "codex", view: "agent" }),
        () => runSessionRename({ spaceId: "dm-1", title: "x", view: "agent" }),
        () => runSessionArchive({ spaceId: "dm-1", view: "agent" }),
        () => runSessionRestore({ spaceId: "dm-1", view: "agent" }),
        () => runSessionDelete({ spaceId: "dm-1", yes: true, view: "agent" }),
      ];
      for (const run of runs) {
        const { stdout } = await withCapturedStdio(run);
        expect(parseSingleFrame(stdout)).toMatchObject({
          type: "error",
          code: "member_agents.disabled",
        });
      }
      const human = await withCapturedStdio(() =>
        runSessionList({ memberAgent: "codex", view: "human" })
      );
      expect(human.stdout).toContain("Agents Not Enabled");
    });
    expect(calls).toEqual([]);
  });
});

function stubFetch(options: { failure?: GatewayFailure } = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof request === "string" || request instanceof URL
          ? String(request)
          : request.url
      );
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({
        method,
        pathname: url.pathname,
        search: url.search,
        body,
        organizationHeader: new Headers(init?.headers).get(
          "x-openmeld-requested-organization-id"
        ),
      });
      if (url.pathname === "/api/auth/get-session") {
        return Promise.resolve(
          jsonResponse({
            session: { id: "session-1" },
            user: { id: "user-1", email: "you@company.com", name: "Felix Lu" },
          })
        );
      }
      if (url.pathname === "/v1/profiles" && method === "GET") {
        return Promise.resolve(jsonResponse({ ok: true, profiles: PROFILES }));
      }
      if (url.pathname === "/v1/member-agents") {
        return Promise.resolve(jsonResponse(LISTING));
      }
      if (url.pathname.startsWith(SESSIONS_PATH) && options.failure) {
        return Promise.resolve(gatewayError(options.failure));
      }
      if (url.pathname === SESSIONS_PATH && method === "GET") {
        const agentProfileId = url.searchParams.get("agentProfileId") ?? "";
        const archived = url.searchParams.get("archived") === "true";
        const sessions = SESSIONS[agentProfileId] ?? {
          active: [],
          archived: [],
        };
        return Promise.resolve(
          jsonResponse(
            listAgentDirectMessageSessionsResponseSchema.parse({
              generatedAt: "2026-10-19T00:00:00.000Z",
              organizationId: "org-1",
              agentProfileId,
              memberProfileId: "hum-felix",
              sessions: archived ? sessions.archived : sessions.active,
              nextCursor: null,
            })
          )
        );
      }
      if (url.pathname.startsWith(`${SESSIONS_PATH}/`)) {
        const spaceId = decodeURIComponent(
          url.pathname.slice(SESSIONS_PATH.length + 1)
        );
        if (method === "DELETE") {
          return Promise.resolve(
            jsonResponse({ spaceId, organizationId: "org-1", deleted: true })
          );
        }
        const update = body as { operation: string; name?: string };
        return Promise.resolve(
          jsonResponse({
            spaceId,
            organizationId: "org-1",
            name: update.name ?? "Fix the login flow",
            archivedAt:
              update.operation === "archive"
                ? "2026-10-19T00:00:00.000Z"
                : null,
          })
        );
      }
      return Promise.resolve(
        jsonResponse({ ok: false, code: "test.unexpected_request" }, 500)
      );
    })
  );
  return calls;
}

function gatewayError(failure: GatewayFailure): Response {
  return jsonResponse(
    gatewayErrorEnvelopeSchema.parse({
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        requestId: "req-1",
      },
    }),
    failure.status
  );
}

async function signIn(): Promise<void> {
  vi.stubEnv("OPENMELD_GATEWAY_URL", GATEWAY_BASE_URL);
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-1",
    activeOrganization: { id: "org-1", name: "Acme", slug: "acme" },
    authBaseUrl: AUTH_BASE_URL,
    clientId: "openmeld-cli",
    tokenType: "Bearer",
  });
}

function session(input: {
  spaceId: string;
  agentProfileId: string;
  name: string | null;
  archivedAt?: string;
  previewAt?: number;
}) {
  return {
    spaceId: input.spaceId,
    organizationId: "org-1",
    agentProfileId: input.agentProfileId,
    memberProfileId: "hum-felix",
    name: input.name,
    createdAt: "2026-10-01T00:00:00.000Z",
    archivedAt: input.archivedAt ?? null,
    messagePreview:
      input.previewAt === undefined
        ? null
        : {
            signalId: `sig-${input.spaceId}`,
            profileId: "hum-felix",
            timestamp: input.previewAt,
            text: "Latest message",
          },
  };
}

function profilePayload(input: {
  id: string;
  name: string;
  kind: "agent" | "human";
}) {
  return {
    openMeldProfileId: input.id,
    profileName: input.name,
    profileHandle: createTestProfileHandle(input.name, input.kind),
    profileKind: input.kind,
    isDefault: input.kind === "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function parseSingleFrame(stdout: string): Record<string, unknown> {
  const frames = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  if (frames.length !== 1) {
    throw new Error(
      `Expected one Agent View frame, received ${frames.length}.`
    );
  }
  return frames[0] ?? {};
}
