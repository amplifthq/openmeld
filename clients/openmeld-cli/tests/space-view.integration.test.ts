import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import {
  runSpaceAddMembers,
  runSpaceJoin,
  runSpaceLeave,
  runSpaceRemoveMembers,
} from "../src/space/command";
import { runSpaceMenu } from "../src/space/menu";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) =>
    ({
      openMeldProfileId,
      profileName: "Codex",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    }) as const;
  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: getAuthSessionStateMock,
  };
});

const createValidAuthState = () => ({
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
  },
});

describe("space command view behavior", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prints a shared human/agent guide for space menu in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        thrown = await runSpaceMenu({ view: "agent" }).catch((error) => {
          return error;
        });
      });
      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld space menu is interactive in human view only."
      );
      expect(message).toContain(
        "openmeld space [--gateway-url <url>] list [--profile <profile-id>] [--limit <n>] [--json]"
      );
      expect(message).toContain(
        "openmeld space [--gateway-url <url>] add-members [--profile <profile-id>] <space-id> (--member <profile-id...>|--all) [--password <value>]"
      );
      expect(message).toContain(
        "openmeld space [--gateway-url <url>] remove-members [--profile <profile-id>] <space-id> (--member <profile-id...>|--all) [--password <value>]"
      );
      expect(message).toContain("[FOR HUMAN OPERATORS]");
      expect(message).toContain("[FOR AGENTS]");

      const codes = parseAgentEnvelopeCodes(stdout);
      expect(codes[0]).toBe("space.menu.agent_overview");
    });
  });

  it("requires explicit space target in agent view for join", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--aaaaaaaa",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runSpaceJoin({
            profile: "codex--aaaaaaaa",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld space join requires explicit space target in agent view."
      );
      const codes = parseAgentEnvelopeCodes(stdout);
      expect(codes[0]).toBe("space.join.agent_overview");
      expect(codes).not.toContain("space.join.preflight");
    });
  });

  it("requires explicit space and members in agent view for add-members", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--aaaaaaaa",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await expect(
        runSpaceAddMembers({
          profile: "codex--aaaaaaaa",
          view: "agent",
        })
      ).rejects.toThrow(
        "openmeld space add-members in agent/non-interactive mode requires explicit space and member arguments."
      );
    });
  });

  it("renders openmeld-dev add-members guidance when the dev shortcut is active", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--aaaaaaaa",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await expect(
        runSpaceAddMembers({
          profile: "codex--aaaaaaaa",
          view: "human",
        })
      ).rejects.toThrow(
        "`openmeld-dev space add-members` requires explicit <space-id> in non-interactive mode"
      );
    });
  });

  it("requires explicit space and members in agent view for remove-members", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--aaaaaaaa",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await expect(
        runSpaceRemoveMembers({
          profile: "codex--aaaaaaaa",
          view: "agent",
        })
      ).rejects.toThrow(
        "openmeld space remove-members in agent/non-interactive mode requires explicit space and member arguments."
      );
    });
  });

  it("requires explicit space target in agent view for leave", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--aaaaaaaa",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await expect(
        runSpaceLeave({
          profile: "codex--aaaaaaaa",
          view: "agent",
        })
      ).rejects.toThrow(
        "openmeld space leave in agent/non-interactive mode requires explicit space argument."
      );
    });
  });
});

function parseAgentEnvelopeCodes(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as { code?: unknown };
      } catch {
        return {};
      }
    })
    .map((envelope) => String(envelope.code ?? "").trim())
    .filter((code) => code.length > 0);
}
