import { listMemberAgentsResponseSchema } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProfileList, runProfileShow } from "../src/commands/profile";
import { setAuthSession } from "../src/config/auth-session";
import { resetOpenMeldProfilesSessionCacheForTests } from "../src/config/openmeld-profiles-api";
import {
  resolveProfileCreateMemberAgentController,
  runAgentAdd,
  runAgentList,
  runAgentShow,
} from "../src/member-agents/command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestProfileHandle } from "./helpers/openmeld-profile-fixture";

const memberAgentsFlag = vi.hoisted(() => ({ enabled: true }));
const primaryBindingMock = vi.hoisted(() => vi.fn());

vi.mock("@openmeld/schemas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/schemas")>();
  return {
    ...actual,
    get MEMBER_AGENTS_ENABLED() {
      return memberAgentsFlag.enabled;
    },
  };
});

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport: (...args: unknown[]) =>
    primaryBindingMock(...args),
}));

vi.mock("../src/runtime/agent-profile-state", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/runtime/agent-profile-state")>();
  return { ...actual, resolveAgentProfileRuntimeState: async () => null };
});

const AUTH_BASE_URL = "https://auth.openmeld.invalid";

const PROFILES = [
  profilePayload({ id: "hum-felix", name: "Felix Lu", kind: "human" }),
  profilePayload({ id: "agt-codex", name: "Codex", kind: "agent" }),
  profilePayload({ id: "agt-reviewer", name: "PR Reviewer", kind: "agent" }),
  profilePayload({ id: "agt-claude", name: "Claude Code", kind: "agent" }),
  profilePayload({ id: "agt-custom", name: "Custom reviewer", kind: "agent" }),
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
      defaultProfileId: "agt-codex",
      source: "detected",
      archivedAt: null,
      profiles: [
        {
          openMeldProfileId: "agt-codex",
          profileName: "Codex",
          isDefault: true,
        },
        {
          openMeldProfileId: "agt-reviewer",
          profileName: "PR Reviewer",
          isDefault: false,
        },
      ],
    },
    {
      id: "ma-claude",
      organizationId: "org-1",
      ownerUserId: "user-1",
      harnessKind: "claude-code",
      defaultProfileId: "agt-claude",
      source: "migrated",
      archivedAt: "2026-10-01T00:00:00.000Z",
      profiles: [
        {
          openMeldProfileId: "agt-claude",
          profileName: "Claude Code",
          isDefault: true,
        },
      ],
    },
  ],
  unassignedProfiles: [
    { openMeldProfileId: "agt-custom", profileName: "Custom reviewer" },
  ],
});

type FetchCall = { body?: unknown; method: string; pathname: string };

describe("openmeld agent commands", () => {
  beforeEach(() => {
    memberAgentsFlag.enabled = true;
    primaryBindingMock
      .mockReset()
      .mockImplementation(
        ({ profile }: { profile: { openMeldProfileId: string } }) => {
          if (profile.openMeldProfileId === "agt-reviewer") {
            return Promise.reject(new Error("Binding read timed out."));
          }
          return Promise.resolve({
            primaryBinding: {
              executionTarget: {
                agentControllerRef: "builtin:codex",
                openMeldServiceRuntimeId: {
                  source: "runtime_registry_authority",
                  value: "rt-macbook",
                },
              },
            },
          });
        }
      );
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

  it("lists one row per MemberAgent and an Unassigned section in Human View", async () => {
    const calls = stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runAgentList({ view: "human" })
      );
      expect(stdout).toContain("Agents (2)");
      expect(stdout).toContain("Felix Lu's Codex");
      expect(stdout).toContain(
        "codex · 2 Profiles · default: Codex · detected · id: ma-codex"
      );
      expect(stdout).toContain("Felix Lu's Claude Code");
      expect(stdout).toContain(
        "claude-code · 1 Profile · default: Claude Code · migrated · archived · id: ma-claude"
      );
      expect(stdout).toContain("Unassigned (1)");
      expect(stdout).toContain("Custom reviewer");
      expect(stdout).toContain("id: agt-custom");
    });
    expect(process.exitCode).toBeUndefined();
    expect(calls).toContainEqual({
      method: "GET",
      pathname: "/v1/member-agents",
    });
  });

  it("returns the list as one Agent View result with stable ids", async () => {
    stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runAgentList({ view: "agent" })
      );
      expect(parseSingleFrame(stdout)).toEqual({
        type: "result",
        code: "member_agents.list",
        payload: {
          organizationId: "org-1",
          memberAgents: [
            {
              id: "ma-codex",
              displayName: "Felix Lu's Codex",
              harnessKind: "codex",
              ownerUserId: "user-1",
              ownerName: "Felix Lu",
              source: "detected",
              archived: false,
              archivedAt: null,
              profileCount: 2,
              defaultProfile: {
                openMeldProfileId: "agt-codex",
                profileName: "Codex",
              },
            },
            {
              id: "ma-claude",
              displayName: "Felix Lu's Claude Code",
              harnessKind: "claude-code",
              ownerUserId: "user-1",
              ownerName: "Felix Lu",
              source: "migrated",
              archived: true,
              archivedAt: "2026-10-01T00:00:00.000Z",
              profileCount: 1,
              defaultProfile: {
                openMeldProfileId: "agt-claude",
                profileName: "Claude Code",
              },
            },
          ],
          unassignedProfiles: [
            { openMeldProfileId: "agt-custom", profileName: "Custom reviewer" },
          ],
        },
      });
    });
  });

  it("shows one MemberAgent with its Profiles and computers in both views", async () => {
    stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const human = await withCapturedStdio(() =>
        runAgentShow({ memberAgent: "codex", view: "human" })
      );
      expect(human.stdout).toContain("Felix Lu's Codex");
      expect(human.stdout).toContain("Codex (default)");
      expect(human.stdout).toContain("id: agt-codex · computer: rt-macbook");
      expect(human.stdout).toContain(
        "id: agt-reviewer · computer: unavailable"
      );
      expect(human.stdout).toContain(
        "1 Agent Profile is not grouped under an Agent."
      );

      const agent = await withCapturedStdio(() =>
        runAgentShow({ memberAgent: "ma-codex", view: "agent" })
      );
      expect(parseSingleFrame(agent.stdout)).toMatchObject({
        type: "result",
        code: "member_agents.show",
        payload: {
          organizationId: "org-1",
          memberAgent: { id: "ma-codex", harnessKind: "codex" },
          profiles: [
            {
              openMeldProfileId: "agt-codex",
              profileName: "Codex",
              isDefault: true,
              computer: {
                status: "bound",
                openMeldServiceRuntimeId: "rt-macbook",
              },
            },
            {
              openMeldProfileId: "agt-reviewer",
              profileName: "PR Reviewer",
              isDefault: false,
              computer: {
                status: "unreadable",
                message: "Binding read timed out.",
              },
            },
          ],
          unassignedProfileCount: 1,
        },
      });
    });
  });

  it("reports an unknown Agent with a next step", async () => {
    stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runAgentShow({ memberAgent: "cursor", view: "agent" })
      );
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "member_agents.not_found",
      });
    });
    expect(process.exitCode).toBe(1);
  });

  it("says the feature is not enabled and never calls the route while the flag is off", async () => {
    memberAgentsFlag.enabled = false;
    const calls = stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const human = await withCapturedStdio(() =>
        runAgentList({ view: "human" })
      );
      expect(human.stdout).toContain("Agents Not Enabled");
      expect(human.stdout).toContain(
        "Agents grouped by harness are not available yet."
      );
      const agent = await withCapturedStdio(() =>
        runAgentShow({ memberAgent: "codex", view: "agent" })
      );
      expect(parseSingleFrame(agent.stdout)).toMatchObject({
        type: "error",
        code: "member_agents.disabled",
      });
    });
    expect(process.exitCode).toBe(1);
    expect(calls).toEqual([]);
  });

  it("keeps an Auth failure's code and gives a next step", async () => {
    stubAuthFetch({
      memberAgentsError: {
        code: "organization.membership_required",
        message: "You do not have access to this organization.",
        status: 403,
      },
    });
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runAgentList({ view: "agent" })
      );
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "organization.membership_required",
        message: "You do not have access to this organization.",
        data: {
          error: {
            nextStep:
              "Run `openmeld org switch <slug>` to choose an organization, then try again.",
          },
        },
      });
    });
    expect(process.exitCode).toBe(1);
  });

  it("maps a flag-off Auth response to the same not-enabled message", async () => {
    stubAuthFetch({ memberAgentsDisabled: true });
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runAgentList({ view: "agent" })
      );
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "member_agents.disabled",
      });
    });
    expect(process.exitCode).toBe(1);
  });
});

describe("openmeld agent add", () => {
  beforeEach(() => {
    memberAgentsFlag.enabled = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    process.exitCode = undefined;
  });

  it("asks Core to add the harness, which turns it on if it is off", async () => {
    const calls = stubAuthFetch({
      syncResponse: {
        ok: true,
        organizationId: "org-1",
        results: [
          {
            binding: "succeeded",
            defaultProfileId: "agt-cursor",
            directMessage: "succeeded",
            directMessageSpaceId: "space-dm",
            harnessKind: "cursor",
            memberAgentId: "ma-cursor",
            outcome: "created",
            reasonCodes: [],
          },
        ],
        assignedProfileIds: [],
        addableHarnessKinds: [],
      },
    });
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.openmeld.invalid");
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runAgentAdd({ harness: "cursor", view: "agent" })
      );
      expect(parseSingleFrame(stdout)).toMatchObject({
        code: "member_agents.add",
        payload: { result: { memberAgentId: "ma-cursor", outcome: "created" } },
      });
    });
    expect(calls).toContainEqual({
      body: { createHarnessKinds: ["cursor"] },
      method: "POST",
      pathname: "/v1/organizations/current/member-agents/sync",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("explains what to do when no connected computer has the harness", async () => {
    stubAuthFetch({
      syncResponse: {
        ok: true,
        organizationId: "org-1",
        results: [
          {
            binding: "not_attempted",
            defaultProfileId: null,
            directMessage: "not_attempted",
            directMessageSpaceId: null,
            harnessKind: "cursor",
            memberAgentId: null,
            outcome: "skipped",
            reasonCodes: ["member_agent.harness_not_detected"],
          },
        ],
        assignedProfileIds: [],
        addableHarnessKinds: ["cursor"],
      },
    });
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.openmeld.invalid");
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runAgentAdd({ harness: "cursor", view: "human" })
      );
      expect(stdout).toContain("Agent Not Added");
      expect(stdout).toContain("has Cursor right now");
      expect(stdout).toContain("openmeld agents enable --agent cursor");
    });
    expect(process.exitCode).toBe(1);
  });
});

describe("profile commands with MemberAgents", () => {
  beforeEach(() => {
    memberAgentsFlag.enabled = true;
    primaryBindingMock.mockReset().mockResolvedValue(null);
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

  it("prints each Agent Profile's parent or unassigned in both views", async () => {
    stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const human = await withCapturedStdio(() =>
        runProfileList({ view: "human" })
      );
      expect(human.stdout).toContain(
        "PR Reviewer · agent · active · id: agt-reviewer · Agent: Felix Lu's Codex (id: ma-codex)"
      );
      expect(human.stdout).toContain(
        "Custom reviewer · agent · active · id: agt-custom · Agent: unassigned"
      );
      expect(human.stdout).toContain(
        "Felix Lu · human · active · id: hum-felix\n"
      );

      const agent = await withCapturedStdio(() =>
        runProfileList({ view: "agent" })
      );
      const frames = parseFrames(agent.stdout);
      const byProfile = new Map(
        frames.map((frame) => [
          (frame.data as { openMeldProfileId: string }).openMeldProfileId,
          frame.data as Record<string, unknown>,
        ])
      );
      expect(byProfile.get("agt-reviewer")?.memberAgent).toEqual({
        status: "assigned",
        memberAgentId: "ma-codex",
        displayName: "Felix Lu's Codex",
        harnessKind: "codex",
      });
      expect(byProfile.get("agt-custom")?.memberAgent).toEqual({
        status: "unassigned",
      });
      expect(byProfile.get("hum-felix")).not.toHaveProperty("memberAgent");
    });
  });

  it("prints the parent in profile show", async () => {
    stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const agent = await withCapturedStdio(() =>
        runProfileShow({ profile: "agt-custom", view: "agent" })
      );
      expect(parseSingleFrame(agent.stdout)).toMatchObject({
        code: "profile.show",
        data: { memberAgent: { status: "unassigned" } },
      });
      const human = await withCapturedStdio(() =>
        runProfileShow({ profile: "agt-reviewer", view: "human" })
      );
      expect(human.stdout).toContain("Felix Lu's Codex (id: ma-codex)");
    });
  });

  it("keeps profile list unchanged and skips the route while the flag is off", async () => {
    memberAgentsFlag.enabled = false;
    const calls = stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      const { stdout } = await withCapturedStdio(() =>
        runProfileList({ view: "agent" })
      );
      for (const frame of parseFrames(stdout)) {
        expect(frame.data).not.toHaveProperty("memberAgent");
      }
    });
    expect(calls).not.toContainEqual({
      method: "GET",
      pathname: "/v1/member-agents",
    });
  });

  it("refuses a create under a MemberAgent with a different harness", async () => {
    stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      let result: string | null = "unset";
      const { stdout } = await withCapturedStdio(async () => {
        result = await resolveProfileCreateMemberAgentController({
          agentController: "builtin:claude-code",
          memberAgent: "ma-codex",
          view: "agent",
        });
      });
      expect(result).toBeNull();
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "member_agents.harness_mismatch",
      });
    });
    expect(process.exitCode).toBe(1);
  });

  it("refuses --member-agent for an organization other than the current one", async () => {
    const calls = stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      let result: string | null = "unset";
      const { stdout } = await withCapturedStdio(async () => {
        result = await resolveProfileCreateMemberAgentController({
          memberAgent: "codex",
          organization: "other-org",
          view: "agent",
        });
      });
      expect(result).toBeNull();
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "member_agents.organization_mismatch",
      });
    });
    expect(calls).not.toContainEqual({
      method: "GET",
      pathname: "/v1/member-agents",
    });
  });

  it("lists Profiles without a parent when no organization is active", async () => {
    const calls = stubAuthFetch();
    await withTempHome(async () => {
      await signIn({ withOrganization: false });
      const { stdout } = await withCapturedStdio(() =>
        runProfileList({ view: "agent" })
      );
      const frames = parseFrames(stdout);
      expect(frames).toHaveLength(PROFILES.length);
      for (const frame of frames) {
        expect(frame.data).not.toHaveProperty("memberAgent");
      }
    });
    expect(calls).not.toContainEqual({
      method: "GET",
      pathname: "/v1/member-agents",
    });
  });

  it("refuses --member-agent without calling the route while the flag is off", async () => {
    memberAgentsFlag.enabled = false;
    const calls = stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      let result: string | null = "unset";
      const { stdout } = await withCapturedStdio(async () => {
        result = await resolveProfileCreateMemberAgentController({
          memberAgent: "codex",
          view: "agent",
        });
      });
      expect(result).toBeNull();
      expect(parseSingleFrame(stdout)).toMatchObject({
        type: "error",
        code: "member_agents.disabled",
      });
    });
    expect(calls).toEqual([]);
  });

  it("creates under a MemberAgent with its harness when none is given", async () => {
    stubAuthFetch();
    await withTempHome(async () => {
      await signIn();
      await expect(
        resolveProfileCreateMemberAgentController({
          memberAgent: "codex",
          view: "agent",
        })
      ).resolves.toBe("builtin:codex");
      await expect(
        resolveProfileCreateMemberAgentController({
          agentController: "builtin:codex",
          memberAgent: "ma-codex",
          view: "agent",
        })
      ).resolves.toBe("builtin:codex");
    });
    expect(process.exitCode).toBeUndefined();
  });
});

function stubAuthFetch(
  options: {
    memberAgentsDisabled?: boolean;
    memberAgentsError?: { code: string; message: string; status: number };
    syncResponse?: Record<string, unknown>;
  } = {}
): FetchCall[] {
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
      calls.push({ method, pathname: url.pathname });
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
      if (url.pathname === "/v1/profiles/resolve") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          openMeldProfileId?: string;
        };
        const profile = PROFILES.find(
          (candidate) => candidate.openMeldProfileId === body.openMeldProfileId
        );
        return Promise.resolve(jsonResponse({ ok: true, profile }));
      }
      if (
        url.pathname === "/v1/organizations/current/member-agents/sync" &&
        options.syncResponse
      ) {
        const call = calls.at(-1);
        if (call) {
          call.body = JSON.parse(String(init?.body ?? "{}"));
        }
        return Promise.resolve(jsonResponse(options.syncResponse));
      }
      if (url.pathname === "/v1/member-agents" && options.memberAgentsError) {
        const { status, ...body } = options.memberAgentsError;
        return Promise.resolve(jsonResponse({ ok: false, ...body }, status));
      }
      if (url.pathname === "/v1/member-agents") {
        return Promise.resolve(
          options.memberAgentsDisabled
            ? jsonResponse(
                {
                  ok: false,
                  code: "member_agents.disabled",
                  message: "Agents grouped by harness are not available yet.",
                },
                404
              )
            : jsonResponse(LISTING)
        );
      }
      return Promise.resolve(
        jsonResponse({ ok: false, code: "test.unexpected_request" }, 500)
      );
    })
  );
  return calls;
}

async function signIn(
  input: { withOrganization?: boolean } = {}
): Promise<void> {
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-1",
    ...(input.withOrganization === false
      ? {}
      : { activeOrganization: { id: "org-1", name: "Acme", slug: "acme" } }),
    authBaseUrl: AUTH_BASE_URL,
    clientId: "openmeld-cli",
    tokenType: "Bearer",
  });
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

function parseFrames(stdout: string): Record<string, unknown>[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function parseSingleFrame(stdout: string): Record<string, unknown> {
  const frames = parseFrames(stdout);
  if (frames.length !== 1) {
    throw new Error(
      `Expected one Agent View frame, received ${frames.length}.`
    );
  }
  return frames[0] ?? {};
}
