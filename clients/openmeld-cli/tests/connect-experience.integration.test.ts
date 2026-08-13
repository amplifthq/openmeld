import { stripVTControlCharacters } from "node:util";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import pc from "picocolors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatOpenMeldCliCommand } from "../src/runtime/cli-entry-command";
import { runConnect as runConnectCommand } from "../src/space/connect";
import { INTERACTIVE_SPACE_SHELL_ENV_NAME } from "../src/space/shell/interactive-shell-kind";
import { LegacyInteractiveSpaceShell } from "../src/space/shell/legacy-interactive-space-shell";
import { PiTuiInteractiveSpaceShell } from "../src/space/shell/pi-tui/pi-tui-interactive-space-shell";
import type { SpaceSessionViewState } from "../src/space/view/space-session-view-state";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const connectWebSocketMock = vi.fn();
type RunConnectInput = Parameters<typeof runConnectCommand>[0];
const ANSI_ESCAPE_PATTERN = "\\x1B\\[[0-9;]*m";
const ANSI_ESCAPE_STRIP_REGEX = new RegExp(ANSI_ESCAPE_PATTERN, "g");
const ANSI_ESCAPE_MATCH_REGEX = new RegExp(ANSI_ESCAPE_PATTERN);
const LONG_SPACE_ID =
  "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd";
const READY_DAEMON_ROUTE_OBSERVATION = {
  observedAt: "2026-04-01T00:00:00.000Z",
  reasonCode: "online",
  status: "online",
} as const;
const formatExpectedSignalTimestamp = (ts: number): string => {
  const date = new Date(ts);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}${month}${day} ${hour}:${minute}`;
};
const OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT =
  "(?:\\n(?:human|agent|owns:|added:|controlled by:|origin:)[^\\n]*)*";
const PROFILE_GROUP_A1_A2_REGEX = new RegExp(
  `A1${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n- [^\\n]*: A2`
);
const PROFILE_GROUP_A2_B1_REGEX = new RegExp(
  `A2${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n\n- [^\\n]*: B1`
);
const PROFILE_GROUP_B1_B2_REGEX = new RegExp(
  `B1${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n- [^\\n]*: B2`
);
const PROFILE_GROUP_B2_A3_REGEX = new RegExp(
  `B2${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n\n- [^\\n]*: A3`
);
const SYSTEM_GROUP_A_TO_NOTICE_REGEX = new RegExp(
  `A-before-system${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n\n\\* 📣 system: notice-1`
);
const SYSTEM_GROUP_NOTICE_CONTIGUOUS_REGEX =
  /\* 📣 system: notice-1\n\* 📣 system: notice-2/;
const SYSTEM_GROUP_NOTICE_TO_B_REGEX = /notice-2\n\n- [^\n]*: B-after-system/;
const SYSTEM_GROUP_A_TO_PRESENCE_REGEX = new RegExp(
  `A-before-presence-system${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n\n\\* 📣 system: 👤 Felix joined the space\\.`
);
const SYSTEM_GROUP_PRESENCE_CONTIGUOUS_REGEX =
  /\* 📣 system: 👤 Felix joined the space\.\n\* 📣 system: 🤖 Seal left the space\./;
const SYSTEM_GROUP_PRESENCE_TO_B_REGEX =
  /Seal left the space\.\n\n- [^\n]*: B-after-presence-system/;
const OPENMELD_SYSTEM_HINT_A_TO_SYSTEM_REGEX = new RegExp(
  `A-before-openmeld-system${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n\n\\* 📣 system: Agent "new-space-agent-codex" already got the same request in the last 24h, so this duplicate was skipped\\. Send a new message to run again\\.`
);
const OPENMELD_SYSTEM_HINT_SYSTEM_TO_B_REGEX =
  /run again\.\n\n- [^\n]*: B-after-openmeld-system/;
const PROFILE_GROUP_TTY_DIVIDER_REGEX = new RegExp(
  `A2${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n\n {2,}[─╌]+\n- [^\\n]*: B1`
);
const LEGACY_ADD_MEMBERS_CHAT_LINE_REGEX = new RegExp(
  `- 👤 Alpha ${formatExpectedSignalTimestamp(21)}: new-space-agent-codex \\(agent, controller: builtin:new-space-agent-codex, owner: Felix\\) joined the space via add-members\\.\\nhuman`
);
const LEGACY_ADD_MEMBERS_PROFILE_GROUP_TO_B_REGEX = new RegExp(
  `A-before-legacy-notice${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n- 👤 Alpha ${formatExpectedSignalTimestamp(21)}: new-space-agent-codex \\(agent, controller: builtin:new-space-agent-codex, owner: Felix\\) joined the space via add-members\\.${OPTIONAL_MESSAGE_METADATA_REGEX_FRAGMENT}\n\n- 👤 Beta ${formatExpectedSignalTimestamp(22)}: B-after-legacy-notice`
);
const REPLYING_STATUS_PROMPT_GAP_REGEX =
  /\* 📣 system · 🤖 @hey-bot is replying\.\.\.\n\n- /;
const HUMAN_CHAT_GUIDANCE_TO_PROMPT_REGEX =
  /Exit with '\/quit', ':q', Ctrl\+D, or Ctrl\+C\.\n\nWhat would you like to say in this space\?\n- Felix \(human\): /;
const TRUECOLOR_PREFIX_START = "\u001B[38;2;";

const stripAnsi = (value: string): string =>
  value.replace(ANSI_ESCAPE_STRIP_REGEX, "");
const stripTerminalControl = (value: string): string =>
  stripVTControlCharacters(value).replaceAll("\r", "");

const runConnect = async (
  input: Omit<RunConnectInput, "connectionMode"> & {
    connectionMode?: RunConnectInput["connectionMode"];
  }
) =>
  await runConnectCommand({
    ...input,
    connectionMode: input.connectionMode ?? "join",
  });

vi.mock("../src/transport/ws", () => {
  return {
    connectWebSocket: (
      ...args: Parameters<typeof connectWebSocketMock>
    ): ReturnType<typeof connectWebSocketMock> => connectWebSocketMock(...args),
  };
});

describe("connect experience enhancements", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("renders explicit abnormal closure reason and hint for code 1006", async () => {
    let onCloseHandler: ((code: number, reason: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn((handler: (code: number, reason: string) => void) => {
        onCloseHandler = handler;
      }),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: LONG_SPACE_ID,
        organizationId: "org-1",
        visibility: "private",
      },
      membersSnapshot: {
        spaceId: LONG_SPACE_ID,
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 0,
          humanCount: 0,
          agentCount: 0,
          liveNowCount: 0,
        },
        humans: [],
        agents: [],
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "11111111-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await vi.waitFor(() => {
      if (!onCloseHandler) {
        throw new Error("onClose handler was not registered");
      }
    });
    if (onCloseHandler === null || resolveClosed === null) {
      throw new Error("missing close test harness handlers");
    }
    const closeHandler = onCloseHandler as (
      code: number,
      reason: string
    ) => void;
    const closeResolver = resolveClosed as () => void;

    closeHandler(1006, "");
    closeResolver();

    const { stderr } = await connectPromise;
    expect(stderr).toContain("closed code=1006 (abnormal_closure)");
    expect(stderr).toContain("reason=connection dropped unexpectedly");
    expect(stderr).toContain(
      "hint: this is usually a network issue or a temporary server restart"
    );
  });

  it("groups consecutive chat lines by profile and inserts one blank line on profile switch", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "33333333-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-a1",
        ts: 1,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A1",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-a2",
        ts: 2,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A2",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-b1",
        ts: 3,
        profileId: "profile-b",
        profileName: "Beta",
        text: "B1",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-b2",
        ts: 4,
        profileId: "profile-b",
        profileName: "Beta",
        text: "B2",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-a3",
        ts: 5,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A3",
      })
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout).toMatch(PROFILE_GROUP_A1_A2_REGEX);
    expect(plainStdout).toMatch(PROFILE_GROUP_A2_B1_REGEX);
    expect(plainStdout).toMatch(PROFILE_GROUP_B1_B2_REGEX);
    expect(plainStdout).toMatch(PROFILE_GROUP_B2_A3_REGEX);
  });

  it("groups rendered system notices together regardless of source profile", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: LONG_SPACE_ID,
        organizationId: "org-1",
        visibility: "private",
      },
      membersSnapshot: {
        spaceId: LONG_SPACE_ID,
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 0,
          humanCount: 0,
          agentCount: 0,
          liveNowCount: 0,
        },
        humans: [],
        agents: [],
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "44444444-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-before-system",
        ts: 10,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A-before-system",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-system-1",
        ts: 11,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "notice-1",
        meta: {
          purpose: "space_membership_join_notice",
        },
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-system-2",
        ts: 12,
        profileId: "profile-b",
        profileName: "Beta",
        text: "notice-2",
        meta: {
          purpose: "space_membership_join_notice",
        },
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-after-system",
        ts: 13,
        profileId: "profile-b",
        profileName: "Beta",
        text: "B-after-system",
      })
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout).toMatch(SYSTEM_GROUP_A_TO_NOTICE_REGEX);
    expect(plainStdout).toMatch(SYSTEM_GROUP_NOTICE_CONTIGUOUS_REGEX);
    expect(plainStdout).toMatch(SYSTEM_GROUP_NOTICE_TO_B_REGEX);
  });

  it("renders purpose-backed agent join notices as system lines with wake hints", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "44444444-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-before-purpose-notice",
        ts: 30,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A-before-purpose-notice",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-purpose-join-notice",
        ts: 31,
        profileId: "profile-host",
        profileName: "Felix",
        text: "Felix added 🤖 openclaw-agent to this space.",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: "agt_11111111-1111-1111-1111-111111111111",
          targetProfileKind: "agent",
          targetProfileName: "openclaw-agent",
          targetMentionLabel: "openclaw-agent",
          addedByProfileId: "11111111-1111-1111-1111-111111111111",
          addedByDisplayName: "Felix",
        },
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-after-purpose-notice",
        ts: 32,
        profileId: "profile-b",
        profileName: "Beta",
        text: "B-after-purpose-notice",
      })
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout).toContain(
      "* 📣 system: Felix added 🤖 openclaw-agent to this space. · Mention as `@openclaw-agent(wake)`"
    );
    expect(plainStdout).not.toContain(
      `- 👤 Felix ${formatExpectedSignalTimestamp(31)}: Felix added 🤖 openclaw-agent to this space.`
    );
  });

  it("highlights live mentions using the current space members snapshot", async () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const harness = createMessageStreamHarness();
      mockConnectFetchSuccess({
        membersSnapshot: {
          spaceId: "ops-room",
          generatedAt: "2026-03-06T00:00:00.000Z",
          summary: {
            totalCount: 1,
            humanCount: 1,
            agentCount: 0,
            liveNowCount: 0,
          },
          humans: [
            {
              profileId: "11111111-1111-1111-1111-111111111111",
              profileName: "felix-in-space",
              profileKind: "human",
              status: "active",
              memberSource: "space_creator",
              memberSourceLabel: "Creator",
              addedAt: "2026-03-06T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-03-06T00:00:00.000Z",
              updatedAt: "2026-03-06T00:00:00.000Z",
              addedByProfileId: null,
              addedByOwnerUserId: null,
              addedByDisplayName: null,
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: "2026-03-06T00:00:00.000Z",
              lastEnteredAt: "2026-03-06T00:00:00.000Z",
              lastSeenAt: "2026-03-06T00:00:00.000Z",
              lastSeenLabel: "Seen now",
              liveNow: false,
              ownerUserId: null,
              ownerName: null,
            },
          ],
          agents: [],
        },
      });

      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "44444444-0000-0000-0000-000000000000",
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: false,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(1);
      });
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-live-mention-highlight",
          ts: 41,
          profileId: "profile-a",
          profileName: "Alpha",
          text: "hello @felix-in-space",
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(plainStdout).toContain(
        `- 👤 Alpha ${formatExpectedSignalTimestamp(41)}: hello @felix-in-space`
      );
      expect(
        extractInlineTrueColorPrefixForLabel(stdout, "@felix-in-space")
      ).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });

  it("groups presence join and quit as system lines", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "44444444-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-before-presence-system",
        ts: 40,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A-before-presence-system",
      })
    );
    harness.emit(
      createPresenceRawEvent({
        id: "presence-system-join",
        ts: 41,
        profileId: "felix",
        profileName: "Felix",
        type: "presence.join",
      })
    );
    harness.emit(
      createPresenceRawEvent({
        id: "presence-system-quit",
        ts: 42,
        profileId: "seal",
        profileName: "Seal",
        profileKind: "agent",
        type: "presence.quit",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-after-presence-system",
        ts: 43,
        profileId: "profile-b",
        profileName: "Beta",
        text: "B-after-presence-system",
      })
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout).toMatch(SYSTEM_GROUP_A_TO_PRESENCE_REGEX);
    expect(plainStdout).toMatch(SYSTEM_GROUP_PRESENCE_CONTIGUOUS_REGEX);
    expect(plainStdout).toMatch(SYSTEM_GROUP_PRESENCE_TO_B_REGEX);
  });

  it("renders OpenMeld System dispatch hints using unified system style", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "45555555-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-before-openmeld-system-hint",
        ts: 14,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A-before-openmeld-system",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-openmeld-system-hint",
        ts: 15,
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
        profileKind: "system",
        text: 'Agent "new-space-agent-codex" already got the same request in the last 24h, so this duplicate was skipped. Send a new message to run again.',
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-after-openmeld-system-hint",
        ts: 16,
        profileId: "profile-b",
        profileName: "Beta",
        text: "B-after-openmeld-system",
      })
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout).toMatch(OPENMELD_SYSTEM_HINT_A_TO_SYSTEM_REGEX);
    expect(plainStdout).toMatch(OPENMELD_SYSTEM_HINT_SYSTEM_TO_B_REGEX);
    expect(plainStdout.includes("- OpenMeld System")).toBe(false);
  });

  it("prefers local human profile name for agent owner display when ownerName is missing", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "44556677-0000-0000-0000-000000000000",
            profileName: "Felix",
            profileKind: "human",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-owner-display-fallback",
        ts: 14,
        profileId: "profile-agent",
        profileName: "hey-bot",
        profileKind: "agent",
        profileOwnerUserId: "user-1",
        profileAgentControllerRef: "claude-code",
        text: "hello",
      })
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout).toContain("owner: Felix");
    expect(plainStdout).not.toContain("owner: user-1");
  });

  it("fills missing ownerName in the Space Members card from local owner display", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: {
        spaceId: "ops-room",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: "11111111-1111-1111-1111-111111111111",
            profileName: "workspace-felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "user-1",
            ownerName: "Felix",
          },
        ],
        agents: [
          createSpaceMemberAgentSnapshot({
            profileId: "agt_22222222-2222-2222-2222-222222222222",
            profileName: "owner-bot",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: "11111111-1111-1111-1111-111111111111",
            addedByOwnerUserId: "user-1",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "user-1",
            ownerName: null,
            agentControllerRef: "builtin:codex",
            agentControllerConversationId: null,
            wakeRouteEvidence: READY_DAEMON_ROUTE_OBSERVATION,
            wakeabilityStatus: "blocked",
          }),
        ],
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "99999999-0000-0000-0000-000000000000",
            profileName: "workspace-felix",
            profileKind: "human",
            ownerName: "Felix",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.close(1000, "client_closed");

    const { stderr } = await connectPromise;
    const plainStderr = stripAnsi(stderr);
    expect(plainStderr).toContain("owner: Felix · added by: Felix");
    expect(plainStderr).toContain(
      "mention: @owner-bot(wake) · reply route unavailable · via codex · seen just now"
    );
    expect(plainStderr).not.toContain("owner workspace-felix");
    expect(plainStderr).not.toContain("owner user-1");
  });

  it("keeps an existing snapshot ownerName in the Space Members card", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: {
        spaceId: "ops-room",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: "11111111-1111-1111-1111-111111111111",
            profileName: "workspace-felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "user-1",
            ownerName: "Felix Account",
          },
        ],
        agents: [
          createSpaceMemberAgentSnapshot({
            profileId: "agt_33333333-3333-3333-3333-333333333333",
            profileName: "owner-bot",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: "11111111-1111-1111-1111-111111111111",
            addedByOwnerUserId: "user-1",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "user-1",
            ownerName: "Felix Owner",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId: null,
            wakeRouteEvidence: READY_DAEMON_ROUTE_OBSERVATION,
            wakeabilityStatus: "blocked",
          }),
        ],
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
            profileName: "workspace-felix",
            profileKind: "human",
            ownerName: "Felix Account",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.close(1000, "client_closed");

    const { stderr } = await connectPromise;
    const plainStderr = stripAnsi(stderr);
    expect(plainStderr).toContain("owner: Felix Owner · added by: Felix");
    expect(plainStderr).toContain(
      "mention: @owner-bot(wake) · reply route unavailable · via codex · seen just now"
    );
    expect(plainStderr).not.toContain("owner Felix Account");
    expect(plainStderr).not.toContain("owner workspace-felix");
  });

  it("keeps legacy add-members notice in the speaker's normal chat group", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "45454545-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-before-legacy-notice",
        ts: 20,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "A-before-legacy-notice",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-legacy-add-members-notice",
        ts: 21,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "new-space-agent-codex (agent, controller: builtin:new-space-agent-codex, owner: Felix) joined the space via add-members.",
      })
    );
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-after-legacy-notice",
        ts: 22,
        profileId: "profile-b",
        profileName: "Beta",
        text: "B-after-legacy-notice",
      })
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout).not.toContain("* 📣 system notice");
    expect(plainStdout).not.toContain("Wake with `@new-space-agent-codex`");
    expect(plainStdout).toMatch(LEGACY_ADD_MEMBERS_CHAT_LINE_REGEX);
    expect(plainStdout).toMatch(LEGACY_ADD_MEMBERS_PROFILE_GROUP_TO_B_REGEX);
  });

  it("renders a subtle divider line between different profile groups in TTY", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "55555555-0000-0000-0000-000000000000",
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: false,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(1);
      });
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-tty-a1",
          ts: 1,
          profileId: "profile-a",
          profileName: "Alpha",
          text: "A1",
        })
      );
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-tty-a2",
          ts: 2,
          profileId: "profile-a",
          profileName: "Alpha",
          text: "A2",
        })
      );
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-tty-b1",
          ts: 3,
          profileId: "profile-b",
          profileName: "Beta",
          text: "B1",
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(plainStdout).toMatch(PROFILE_GROUP_TTY_DIVIDER_REGEX);
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
    }
  });

  it("renders human normal-leave guidance for close code 1000", async () => {
    let onCloseHandler: ((code: number, reason: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn((handler: (code: number, reason: string) => void) => {
        onCloseHandler = handler;
      }),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: LONG_SPACE_ID,
        organizationId: "org-1",
        visibility: "private",
      },
      membersSnapshot: {
        spaceId: LONG_SPACE_ID,
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 0,
          humanCount: 0,
          agentCount: 0,
          liveNowCount: 0,
        },
        humans: [],
        agents: [],
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "11111111-0000-0000-0000-000000000003",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: LONG_SPACE_ID,
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await vi.waitFor(() => {
      if (!onCloseHandler) {
        throw new Error("onClose handler was not registered");
      }
    });
    if (onCloseHandler === null || resolveClosed === null) {
      throw new Error("missing close test harness handlers");
    }
    const closeHandler = onCloseHandler as (
      code: number,
      reason: string
    ) => void;
    const closeResolver = resolveClosed as () => void;

    closeHandler(1000, "client_closed");
    closeResolver();

    const { stdout, stderr } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    const plainStderr = stripAnsi(stderr);
    expect(plainStdout).toContain(
      "You have left the space. (closed code=1000)"
    );
    expect(plainStdout).toContain("👋 Space Left");
    expect(plainStdout).toContain(
      "If you are an agent, you might still be mentioned and spawned even"
    );
    expect(plainStdout).toContain("if you have left the space.");
    expect(plainStdout).toContain("To re-join this space, run:");
    expect(plainStdout).toContain(
      formatOpenMeldCliCommand(`openmeld space join ${LONG_SPACE_ID}`)
    );
    expect(plainStdout).not.toContain("┐");
    expect(plainStdout).not.toContain("│");
    expect(plainStdout).not.toContain("┘");
    expect(plainStderr).not.toContain("closed code=1000");
  });

  it("renders normal-leave card on a new line when prompt is visible", async () => {
    let onCloseHandler: ((code: number, reason: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn((handler: (code: number, reason: string) => void) => {
        onCloseHandler = handler;
      }),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000005",
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await vi.waitFor(() => {
        if (!onCloseHandler) {
          throw new Error("onClose handler was not registered");
        }
      });
      if (onCloseHandler === null || resolveClosed === null) {
        throw new Error("missing close test harness handlers");
      }
      const closeHandler = onCloseHandler as (
        code: number,
        reason: string
      ) => void;
      const closeResolver = resolveClosed as () => void;

      closeHandler(1000, "client_closed");
      closeResolver();

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(plainStdout).toContain("\n\n👋 Space Left");
      expect(plainStdout).not.toContain(": 👋 Space Left");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
    }
  });

  it("renders the human chat guidance block above the input prompt", async () => {
    let onCloseHandler: ((code: number, reason: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn((handler: (code: number, reason: string) => void) => {
        onCloseHandler = handler;
      }),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      let observedStdout = "";
      const connectPromise = withCapturedStdio(
        async () => {
          await withTempHome(async () => {
            await runConnect({
              profile: "codex--connect-experience",
              openMeldProfile: createOpenMeldProfileInput({
                openMeldProfileId: "11111111-0000-0000-0000-000000000007",
                profileName: "Felix",
                profileKind: "human",
              }),
              baseUrl: "https://example.com",
              space: "ops-room",
              stdio: true,
              output: "text",
              view: "human",
            });
          });
        },
        {
          onStdout: (text) => {
            observedStdout += text;
          },
        }
      );

      await vi.waitFor(() => {
        if (!onCloseHandler) {
          throw new Error("onClose handler was not registered");
        }
      });
      await vi.waitFor(() => {
        expect(stripTerminalControl(observedStdout)).toMatch(
          HUMAN_CHAT_GUIDANCE_TO_PROMPT_REGEX
        );
      });
      if (onCloseHandler === null || resolveClosed === null) {
        throw new Error("missing close test harness handlers");
      }
      const closeHandler = onCloseHandler as (
        code: number,
        reason: string
      ) => void;
      const closeResolver = resolveClosed as () => void;

      closeHandler(1000, "client_closed");
      closeResolver();

      const { stdout } = await connectPromise;
      const normalizedStdout = stripTerminalControl(stdout);
      expect(normalizedStdout).toContain(
        "Press @ to insert @Name(wake) or @Name(reference)."
      );
      expect(normalizedStdout).toContain(
        "Type your message and press Enter to send."
      );
      expect(normalizedStdout).toContain(
        "Exit with '/quit', ':q', Ctrl+D, or Ctrl+C."
      );
      expect(normalizedStdout).toContain(
        "What would you like to say in this space?"
      );
      expect(normalizedStdout).toMatch(HUMAN_CHAT_GUIDANCE_TO_PROMPT_REGEX);
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
    }
  });

  it("renders replying status line with system and agent emoji prefixes", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      const selfProfileId = "11111111-0000-0000-0000-000000000006";
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: selfProfileId,
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-start",
          ts: 31,
          profileId: "profile-bot",
          profileName: "Hey Bot",
          text: "@hey-bot is replying...",
          meta: {
            transient: true,
            purpose: "agent_replying",
            dispatchId: "dispatch-replying-1",
            targetProfileId: selfProfileId,
          },
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(plainStdout).toContain("* 📣 system · 🤖 @hey-bot is replying...");
      expect(plainStdout.includes("OpenMeld System ·")).toBe(false);
      const normalizedStdout = stripTerminalControl(stdout);
      expect(normalizedStdout).toMatch(REPLYING_STATUS_PROMPT_GAP_REGEX);
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
    }
  });

  it("renders each replying agent on its own status line instead of collapsing to (+n)", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      const selfProfileId = "11111111-0000-0000-0000-000000000016";
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--multi-replying-status",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: selfProfileId,
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-codex",
          ts: 31,
          profileId: "profile-codex",
          profileName: "dev-repro-codex",
          text: "@dev-repro-codex is replying...",
          meta: {
            transient: true,
            purpose: "agent_replying",
            dispatchId: "dispatch-replying-codex",
            targetProfileId: selfProfileId,
          },
        })
      );
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-claude",
          ts: 32,
          profileId: "profile-claude",
          profileName: "dev-repro-claude",
          text: "@dev-repro-claude is replying...",
          meta: {
            transient: true,
            purpose: "agent_replying",
            dispatchId: "dispatch-replying-claude",
            targetProfileId: selfProfileId,
          },
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(plainStdout).toContain(
        "* 📣 system · 🤖 @dev-repro-claude is replying..."
      );
      expect(plainStdout).toContain(
        "* 📣 system · 🤖 @dev-repro-codex is replying..."
      );
      expect(plainStdout).not.toContain("(+1)");
      expect(plainStdout).not.toContain("(+2)");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
    }
  });

  it("keeps a sending row visible alongside an active replying row", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    try {
      const selfProfileId = "11111111-0000-0000-0000-000000000017";
      const outboundText = "@dev-repro-codex what is the date";
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--sending-row-alongside-replying",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: selfProfileId,
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            localEcho: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-claude-before-send",
          ts: 41,
          profileId: "profile-claude",
          profileName: "dev-repro-claude",
          text: "@dev-repro-claude is replying...",
          meta: {
            transient: true,
            purpose: "agent_replying",
            dispatchId: "dispatch-replying-claude-before-send",
            targetProfileId: selfProfileId,
          },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit("data", Buffer.from(`${outboundText}\n`));
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(2);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(plainStdout).toContain(
        "* 📣 system · 🤖 @dev-repro-claude is replying..."
      );
      expect(plainStdout).toContain(
        "* 📣 system · 🤖 Sending: @dev-repro-codex what is the date"
      );
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        Reflect.deleteProperty(process.env, INTERACTIVE_SPACE_SHELL_ENV_NAME);
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("re-renders the remaining replying status after multiple statuses shrink back to one line", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 48,
    });

    try {
      const selfProfileId = "11111111-0000-0000-0000-000000000017";
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--replying-status-shrink",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: selfProfileId,
              profileName: "OpenMeld Dev Local Test",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-codex-shrink",
          ts: 41,
          profileId: "profile-codex",
          profileName: "dev-repro-codex",
          text: "@dev-repro-codex is replying...",
          meta: {
            transient: true,
            purpose: "agent_replying",
            dispatchId: "dispatch-replying-codex-shrink",
            targetProfileId: selfProfileId,
          },
        })
      );
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-claude-shrink",
          ts: 42,
          profileId: "profile-claude",
          profileName: "dev-repro-claude",
          text: "@dev-repro-claude is replying...",
          meta: {
            transient: true,
            purpose: "agent_replying",
            dispatchId: "dispatch-replying-claude-shrink",
            targetProfileId: selfProfileId,
          },
        })
      );
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-claude-shrink-end",
          ts: 43,
          profileId: "profile-claude",
          profileName: "dev-repro-claude",
          text: "done",
          meta: {
            transient: true,
            purpose: "agent_replying_end",
            dispatchId: "dispatch-replying-claude-shrink",
            targetProfileId: selfProfileId,
          },
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const normalizedStdout = stripAnsi(stripTerminalControl(stdout));
      const lastCodexIndex = normalizedStdout.lastIndexOf(
        "@dev-repro-codex is replying..."
      );
      const lastClaudeIndex = normalizedStdout.lastIndexOf(
        "@dev-repro-claude is replying..."
      );
      expect(lastCodexIndex).toBeGreaterThan(lastClaudeIndex);
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
    }
  });

  it("does not leak transient live reply preview into the final transcript output", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const startSpy = vi.spyOn(LegacyInteractiveSpaceShell.prototype, "start");
    const previousShellMode = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 72,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-preview",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000099",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await vi.waitFor(() => {
        expect(startSpy).toHaveBeenCalled();
      });
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-preview-start",
          ts: 41,
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
          profileKind: "system",
          text: "This is a preview text that keeps growing while the agent is still generating\nan answer for the current dispatch with unique-tail-marker-xyz.",
          meta: {
            transient: true,
            purpose: "agent_reply_preview",
            dispatchId: "dispatch-preview-1",
            targetProfileId: "profile-bot",
            targetProfileName: "Hey Bot",
          },
        })
      );
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-preview-end",
          ts: 42,
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
          profileKind: "system",
          text: "Hey Bot preview ended",
          meta: {
            transient: true,
            purpose: "agent_reply_preview_end",
            dispatchId: "dispatch-preview-1",
            targetProfileId: "profile-bot",
          },
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(plainStdout.includes("* 📣 system · 🤖 Hey Bot preview:")).toBe(
        false
      );
      expect(plainStdout.includes("This is a preview")).toBe(false);
      expect(plainStdout.includes("OpenMeld System preview")).toBe(false);
      expect(plainStdout.includes("unique-tail-marker-xyz")).toBe(false);
    } finally {
      if (previousShellMode === undefined) {
        Reflect.deleteProperty(process.env, INTERACTIVE_SPACE_SHELL_ENV_NAME);
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = previousShellMode;
      }
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
    }
  });

  it("does not leak a transient continuity warning into the final transcript output and still renders the final reply", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const startSpy = vi.spyOn(LegacyInteractiveSpaceShell.prototype, "start");
    const previousShellMode = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 96,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "claude--continuity-warning",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-0000000000aa",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await vi.waitFor(() => {
        expect(startSpy).toHaveBeenCalled();
      });
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-continuity-warning",
          ts: 51,
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
          profileKind: "system",
          text: "⚠️ Hey Bot conversation ID rotated unexpectedly; OpenMeld adopted the new ID to keep replies working.",
          meta: {
            transient: true,
            purpose: "conversation_continuity_warning",
            dispatchId: "dispatch-warning-1",
            targetProfileId: "profile-bot",
            targetProfileName: "Hey Bot",
          },
        })
      );
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-final-reply",
          ts: 52,
          profileId: "profile-bot",
          profileName: "Hey Bot",
          profileKind: "agent",
          text: "Final reply after continuity warning.",
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      expect(
        plainStdout.includes(
          "* 📣 system · 🤖 ⚠️ Hey Bot conversation ID rotated unexpectedly; OpenMeld adopted the new ID to keep replies working."
        )
      ).toBe(false);
      expect(plainStdout).toContain(
        `- 🤖 Hey Bot ${formatExpectedSignalTimestamp(52)}: Final reply after continuity warning.\nagent`
      );
    } finally {
      if (previousShellMode === undefined) {
        Reflect.deleteProperty(process.env, INTERACTIVE_SPACE_SHELL_ENV_NAME);
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = previousShellMode;
      }
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
    }
  });

  it("adds a leading line break for SIGINT normal-leave card", async () => {
    let onCloseHandler: ((code: number, reason: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn((handler: (code: number, reason: string) => void) => {
        onCloseHandler = handler;
      }),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "11111111-0000-0000-0000-000000000004",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await vi.waitFor(() => {
      if (!onCloseHandler) {
        throw new Error("onClose handler was not registered");
      }
    });
    if (onCloseHandler === null || resolveClosed === null) {
      throw new Error("missing close test harness handlers");
    }
    const closeHandler = onCloseHandler as (
      code: number,
      reason: string
    ) => void;
    const closeResolver = resolveClosed as () => void;

    closeHandler(1000, "SIGINT");
    closeResolver();

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);
    expect(plainStdout.startsWith("\n\n👋 Space Left")).toBe(true);
  });

  it("renders the same Space Left card for local pi-tui exits even if the socket closes abnormally", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    const startSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "start")
      .mockImplementation(() => {
        // Skip terminal startup in this connect-level contract test.
      });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--pi-tui-normal-leave-card",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-0000000000ad",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      process.emit("SIGINT", "SIGINT");
      harness.close(1006, "");

      const { plainStdout, plainStderr } = await connectPromise;
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(plainStdout).toContain("👋 Space Left");
      expect(plainStdout).toContain(
        "You have left the space. (closed code=1000)"
      );
      expect(plainStdout).toContain(
        formatOpenMeldCliCommand("openmeld space join ops-room")
      );
      const leaveSection = plainStdout.slice(
        plainStdout.lastIndexOf("👋 Space Left")
      );
      expect(leaveSection).not.toContain("┐");
      expect(leaveSection).not.toContain("│");
      expect(leaveSection).not.toContain("┘");
      expect(plainStderr).not.toContain("Connection closed.");
      expect(plainStderr).not.toContain("closed code=1006");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("adds separation and highlight for close message in TTY terminals", async () => {
    let onCloseHandler: ((code: number, reason: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn((handler: (code: number, reason: string) => void) => {
        onCloseHandler = handler;
      }),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess();
    const stderrTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stderr,
      "isTTY"
    );
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000001",
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: false,
            output: "text",
            view: "human",
          });
        });
      });

      await vi.waitFor(() => {
        if (!onCloseHandler) {
          throw new Error("onClose handler was not registered");
        }
      });
      if (onCloseHandler === null || resolveClosed === null) {
        throw new Error("missing close test harness handlers");
      }
      const closeHandler = onCloseHandler as (
        code: number,
        reason: string
      ) => void;
      const closeResolver = resolveClosed as () => void;

      closeHandler(1006, "");
      closeResolver();

      const { stderr } = await connectPromise;
      const plain = stripAnsi(stderr);
      expect(plain).toContain("\n\nclosed code=1006 (abnormal_closure)");
      if (pc.isColorSupported) {
        expect(stderr).toMatch(ANSI_ESCAPE_MATCH_REGEX);
      }
    } finally {
      if (stderrTtyDescriptor) {
        Object.defineProperty(process.stderr, "isTTY", stderrTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stderr, "isTTY");
      }
    }
  });

  it("adds separation and highlight for error message in TTY terminals", async () => {
    let onErrorHandler: ((error: unknown) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn((handler: (error: unknown) => void) => {
        onErrorHandler = handler;
      }),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess();
    const stderrTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stderr,
      "isTTY"
    );
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000002",
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: false,
            output: "text",
            view: "human",
          });
        });
      });

      await vi.waitFor(() => {
        if (!onErrorHandler) {
          throw new Error("onError handler was not registered");
        }
      });
      if (onErrorHandler === null || resolveClosed === null) {
        throw new Error("missing error test harness handlers");
      }
      const errorHandler = onErrorHandler as (error: unknown) => void;
      const closeResolver = resolveClosed as () => void;

      errorHandler(new Error("connect ECONNREFUSED 127.0.0.1:65535"));
      closeResolver();

      const { stderr } = await connectPromise;
      const plain = stripAnsi(stderr);
      expect(plain).toContain(
        "\n\nerror: connect ECONNREFUSED 127.0.0.1:65535"
      );
      if (pc.isColorSupported) {
        expect(stderr).toMatch(ANSI_ESCAPE_MATCH_REGEX);
      }
    } finally {
      if (stderrTtyDescriptor) {
        Object.defineProperty(process.stderr, "isTTY", stderrTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stderr, "isTTY");
      }
    }
  });

  it("does not render a human message before the server confirms it", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000008",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            localEcho: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit("data", Buffer.from("@hey-bot wake up\n"));
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(2);
      });
      harness.close(1006, "");

      const { stdout, stderr } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      const plainStderr = stripAnsi(stderr);
      expect(plainStdout).not.toContain("@hey-bot wake up");
      expect(plainStderr).toContain(
        "last message may not have been confirmed before the connection closed"
      );
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  it("accepts valid typed canonical mentions on human interactive submit and sends the original text", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: createTypedCanonicalMembersSnapshot(),
    });
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    try {
      const outboundText =
        "@Budget Analyst(wake) Please propose the rollout plan.";
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--typed-canonical-valid",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000008",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit("data", Buffer.from(`${outboundText}\n`));
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(2);
      });
      harness.close(1006, "");

      const submittedSignal = JSON.parse(
        String(harness.send.mock.calls[1]?.[0] ?? "{}")
      ) as {
        data?: {
          messageEnvelope?: {
            activationTargets?: string[];
            referenceTargets?: string[];
            text?: string;
          };
          meta?: {
            clientMessageId?: string;
          };
          text?: string;
        };
      };
      const { stderr } = await connectPromise;

      expect(submittedSignal.data?.text).toBe(outboundText);
      expect(submittedSignal.data?.meta?.clientMessageId?.trim()).toBeTruthy();
      expect(submittedSignal.data?.messageEnvelope).toMatchObject({
        activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
        referenceTargets: [],
        text: outboundText,
      });
      expect(stripAnsi(stderr)).not.toContain("Rejected:");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        Reflect.deleteProperty(process.env, INTERACTIVE_SPACE_SHELL_ENV_NAME);
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("turns agent ndjson stdio canonical wake text into a message envelope before sending", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: createTypedCanonicalMembersSnapshot(),
    });
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      const outboundText =
        "@Budget Analyst(wake) Please propose the rollout plan.";
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--typed-canonical-agent-stdio",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "agt_99999999-0000-4000-8000-000000000001",
              profileName: "Ops Bot",
              profileKind: "agent",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "ndjson",
            view: "agent",
          });
        });
      });

      await harness.waitUntilReady();
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit("data", Buffer.from(`${outboundText}\n`));
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(2);
      });
      harness.close(1006, "");

      const submittedSignal = JSON.parse(
        String(harness.send.mock.calls[1]?.[0] ?? "{}")
      ) as {
        data?: {
          messageEnvelope?: {
            activationTargets?: string[];
            referenceTargets?: string[];
            text?: string;
          };
          meta?: {
            clientMessageId?: string;
          };
          text?: string;
        };
      };
      await connectPromise;

      expect(submittedSignal.data?.text).toBe(outboundText);
      expect(submittedSignal.data?.meta?.clientMessageId?.trim()).toBeTruthy();
      expect(submittedSignal.data?.messageEnvelope).toMatchObject({
        activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
        referenceTargets: [],
        text: outboundText,
      });
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  it("rejects invalid typed canonical mentions on human interactive submit before sending", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: createTypedCanonicalMembersSnapshot(),
    });
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--typed-canonical-invalid",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000009",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit(
        "data",
        Buffer.from("@budget analyst(wake) Please propose the rollout plan.\n")
      );
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit("data", Buffer.from("\n"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      harness.close(1006, "");

      const { stderr } = await connectPromise;
      expect(stripAnsi(stderr)).toContain("Rejected:");
      expect(stripAnsi(stderr)).toContain(
        "That mention does not match a current member. Type @ and choose a member from the list."
      );
      expect(stripAnsi(stderr)).not.toContain("Rejected: empty");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        Reflect.deleteProperty(process.env, INTERACTIVE_SPACE_SHELL_ENV_NAME);
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("does not leave a wrapped prompt ghost when sending during an active replying status", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 48,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    try {
      const selfProfileId = "11111111-0000-0000-0000-0000000000bb";
      const outboundText = "@dev-repro-codex what is current conversation id";
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--wrapped-prompt-ghost",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: selfProfileId,
              profileName: "OpenMeld Dev Local Test",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-replying-before-send",
          ts: 61,
          profileId: "profile-claude",
          profileName: "dev-repro-claude",
          profileKind: "agent",
          text: "@dev-repro-claude is replying...",
          meta: {
            transient: true,
            purpose: "agent_replying",
            dispatchId: "dispatch-replying-before-send-1",
            targetProfileId: selfProfileId,
          },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit("data", Buffer.from(`${outboundText}\n`));
      await vi.waitFor(() => {
        expect(harness.send).toHaveBeenCalledTimes(2);
      });
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-self-echo-after-send",
          ts: 62,
          profileId: selfProfileId,
          profileName: "OpenMeld Dev Local Test",
          profileKind: "human",
          text: outboundText,
        })
      );
      harness.close(1006, "");

      const { stdout } = await connectPromise;
      const normalizedStdout = stripAnsi(stripTerminalControl(stdout));
      expect(normalizedStdout).toContain(
        `- 👤 OpenMeld Dev Local Test ${formatExpectedSignalTimestamp(62)}: ${outboundText}\nhuman`
      );
      expect(normalizedStdout).not.toContain(
        `- OpenMeld Dev Local Test (human): ${outboundText}`
      );
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("refreshes members again when /members opens in legacy interactive mode", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--members-open-refresh",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-0000000000be",
              profileName: "OpenMeld Dev Local Test",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const fetchMock = vi.mocked(globalThis.fetch);
      const countMembersFetches = () =>
        fetchMock.mock.calls.filter(([input, init]) => {
          const url = new URL(String(input));
          const method = String(init?.method ?? "GET").toUpperCase();
          return method === "GET" && url.pathname.endsWith("/members");
        }).length;
      const initialMembersFetchCount = countMembersFetches();

      process.stdin.emit("data", Buffer.from("/members\n"));

      await vi.waitFor(() => {
        expect(countMembersFetches()).toBeGreaterThan(initialMembersFetchCount);
      });

      harness.close(1000, "");
      await connectPromise;
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("reports websocket send failures instead of optimistic local echo", async () => {
    const harness = createMessageStreamHarness();
    const outboundText = "@hey-bot wake up";
    harness.send.mockImplementation((data: string) => {
      if (data.includes('"type":"signal.text"')) {
        throw new Error("socket closed");
      }
    });
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--connect-experience",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-000000000009",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.stdin.emit("data", Buffer.from(`${outboundText}\n`));
      await vi.waitFor(() => {
        expect(
          harness.send.mock.calls
            .map(([data]) => String(data))
            .filter((data) => data.includes('"type":"signal.text"'))
        ).toEqual([expect.stringContaining(outboundText)]);
      });
      harness.close(1006, "");

      const { stdout, stderr } = await connectPromise;
      const plainStdout = stripAnsi(stdout);
      const plainStderr = stripAnsi(stderr);
      expect(plainStdout).not.toContain(outboundText);
      expect(plainStderr).toContain("couldn't send the message: socket closed");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  it("falls back to legacy interactive shell when pi-tui startup fails", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    const piTuiStartSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "start")
      .mockImplementation(() => {
        throw new Error("pi-tui startup failed");
      });
    const legacyStartSpy = vi.spyOn(
      LegacyInteractiveSpaceShell.prototype,
      "start"
    );

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--pi-tui-fallback",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-0000000000ff",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      harness.close(1000, "fallback-test");

      const { plainStderr, plainStdout } = await connectPromise;
      expect(piTuiStartSpy).toHaveBeenCalledTimes(1);
      expect(legacyStartSpy).toHaveBeenCalledTimes(1);
      expect(plainStdout).toContain(
        "pi-tui composer fallback to legacy shell: pi-tui startup failed"
      );
      expect(plainStderr).toContain("🛰️ Space Info");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("passes the compact space summary through the pi-tui active-session document view state", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: "ops-room",
        organizationId: "org-1",
        visibility: "private",
        name: "ops-room",
        passwordProtected: false,
      },
    });
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    const startSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "start")
      .mockImplementation(() => {
        // Intentionally skip terminal startup in this connect-level contract test.
      });
    let renderedViewState: SpaceSessionViewState | null = null;
    const renderSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "render")
      .mockImplementation((viewState) => {
        renderedViewState = viewState;
      });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--pi-tui-top-context",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-0000000000ac",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      harness.close(1000, "pi-tui-top-context");

      const { plainStderr } = await connectPromise;
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(renderSpy).toHaveBeenCalled();
      expect(plainStderr).not.toContain("🛰️ Space Info");
      expect(plainStderr).not.toContain("👥 Space Members");
      const activeViewState = requireSessionViewState(renderedViewState);
      expect(activeViewState.sessionDocument.visible).toBe(true);
      expect(activeViewState.transcript.visible).toBe(true);
      expect(activeViewState.sessionDocument.blocks[0]?.kind).toBe(
        "session_header"
      );
      expect(activeViewState.sessionDocument.blocks[1]?.kind).toBe(
        "transcript"
      );
      const sessionHeaderBlock = activeViewState.sessionDocument.blocks[0];
      const summaryFacts =
        sessionHeaderBlock && "summaryFacts" in sessionHeaderBlock
          ? sessionHeaderBlock.summaryFacts
          : null;
      expect(sessionHeaderBlock?.kind).toBe("session_header");
      expect(
        sessionHeaderBlock && "versionLabel" in sessionHeaderBlock
          ? sessionHeaderBlock.versionLabel
          : ""
      ).toContain("v ");
      expect(summaryFacts?.spaceId).toBe("ops-room");
      expect(summaryFacts?.accessLabel).toBe("anyone with the link");
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("refreshes composer footer storage usage from /meta after live persisted events", async () => {
    const harness = createMessageStreamHarness();
    let metaFetchCount = 0;
    let releaseRecentHistory!: () => void;
    const recentHistoryGate = new Promise<void>((resolve) => {
      releaseRecentHistory = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname.endsWith("/meta")) {
        metaFetchCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId: "ops-room",
              organizationId: "org-1",
              visibility: "private",
              name: "ops-room",
              passwordProtected: false,
              storageUsage:
                metaFetchCount === 1
                  ? {
                      usedBytes: 1_000_000,
                      softLimitBytes: 9_000_000,
                      usagePercent: 11,
                    }
                  : {
                      usedBytes: 2_100_000,
                      softLimitBytes: 9_000_000,
                      usagePercent: 24,
                    },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }

      if (method === "GET" && url.pathname.includes("/cursors/")) {
        return Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }

      if (method === "GET" && url.pathname.endsWith("/members")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId: "ops-room",
              generatedAt: "2026-03-06T00:00:00.000Z",
              summary: {
                totalCount: 0,
                humanCount: 0,
                agentCount: 0,
                liveNowCount: 0,
              },
              humans: [],
              agents: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }

      if (
        method === "GET" &&
        url.pathname.endsWith("/signals") &&
        url.searchParams.get("recent") === "1"
      ) {
        return recentHistoryGate.then(
          () =>
            new Response(
              JSON.stringify({
                signals: [],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
        );
      }

      if (method === "PATCH" && url.pathname.includes("/cursors/")) {
        return Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }

      throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
    });

    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    const startSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "start")
      .mockImplementation(() => {
        // Skip terminal startup in this connect-level contract test.
      });
    let renderedViewState: SpaceSessionViewState | null = null;
    const renderSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "render")
      .mockImplementation((viewState) => {
        renderedViewState = viewState;
      });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--pi-tui-storage-refresh",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "11111111-0000-0000-0000-0000000000ae",
            profileName: "Felix",
            profileKind: "human",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: true,
          output: "text",
          view: "human",
        });
      });
    });
    let streamClosed = false;

    try {
      await harness.waitUntilReady();
      expect(startSpy).not.toHaveBeenCalled();

      releaseRecentHistory();
      await vi.waitFor(() => {
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(renderSpy).toHaveBeenCalled();
      });

      vi.useFakeTimers();
      harness.emit(
        createTextSignalRawEvent({
          id: "signal-storage-refresh",
          ts: 100,
          profileId: "profile-a",
          profileName: "Alpha",
          text: "hello storage refresh",
        })
      );
      await vi.advanceTimersByTimeAsync(1000);

      await vi.waitFor(
        () => {
          const activeViewState = requireSessionViewState(renderedViewState);
          expect(
            activeViewState.spaceSummary.composerFooterSegments
          ).toContainEqual({
            key: "storageUsage",
            text: "2.1 MB ( 24% used )",
          });
          expect(
            activeViewState.spaceSummary.sessionSummarySegments
          ).not.toContainEqual({
            key: "storageUsage",
            text: "2.1 MB ( 24% used )",
          });
        },
        { timeout: 3000 }
      );

      harness.close(1000, "pi-tui-storage-refresh");
      streamClosed = true;
      await connectPromise;
      expect(metaFetchCount).toBeGreaterThanOrEqual(2);
    } finally {
      releaseRecentHistory();
      if (!streamClosed) {
        harness.close(1000, "pi-tui-storage-refresh-test-cleanup");
      }
      await connectPromise;
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("replays recent history into the pi-tui active-session transcript without historical presence churn", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      cursorPayload: {
        lastSeenTs: 500,
      },
      recentSignals: [
        JSON.parse(
          createTextSignalRawEvent({
            id: "signal-history-1",
            ts: 101,
            profileId: "profile-a",
            profileName: "Alpha",
            text: "history-1",
          })
        ),
        JSON.parse(
          createTextSignalRawEvent({
            id: "signal-history-2",
            ts: 102,
            profileId: "profile-a",
            profileName: "Alpha",
            text: "history-2",
          })
        ),
      ],
    });
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    const startSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "start")
      .mockImplementation(() => {
        // Skip terminal startup in this connect-level contract test.
      });
    let renderedViewState: SpaceSessionViewState | null = null;
    const renderSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "render")
      .mockImplementation((viewState) => {
        renderedViewState = viewState;
      });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--pi-tui-history-replay",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-0000000000ad",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await vi.waitFor(() => {
        expect(startSpy).toHaveBeenCalledTimes(1);
      });
      harness.close(1000, "pi-tui-history-replay");

      await connectPromise;
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(renderSpy).toHaveBeenCalled();
      const activeViewState = requireSessionViewState(renderedViewState);
      const transcriptBlock = activeViewState.sessionDocument.blocks[1];
      expect(transcriptBlock?.kind).toBe("transcript");
      const transcriptBlocks =
        transcriptBlock?.kind === "transcript" ? transcriptBlock.blocks : [];
      expect(transcriptBlocks).toHaveLength(1);
      expect(transcriptBlocks[0]?.kind).toBe("plain_text_group");
      const renderedHistoryGroup =
        transcriptBlocks[0]?.kind === "plain_text_group"
          ? transcriptBlocks[0].messages
              .flatMap((message) => message.rawLines)
              .join("\n")
          : "";
      expect(renderedHistoryGroup).toContain("history-1");
      expect(renderedHistoryGroup).toContain("history-2");
      expect(renderedHistoryGroup.indexOf("history-1")).toBeLessThan(
        renderedHistoryGroup.indexOf("history-2")
      );
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("uses a readonly pi-tui shell for human watch without join prompts", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: "ops-room",
        organizationId: "org-1",
        visibility: "private",
        name: "ops-room",
        passwordProtected: false,
      },
    });
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns"
    );
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const shellOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    const startSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "start")
      .mockImplementation(() => {
        // Skip terminal startup in this connect-level contract test.
      });
    let renderedViewState: SpaceSessionViewState | null = null;
    const renderSpy = vi
      .spyOn(PiTuiInteractiveSpaceShell.prototype, "render")
      .mockImplementation((viewState) => {
        renderedViewState = viewState;
      });

    try {
      const connectPromise = withCapturedStdio(async () => {
        await withTempHome(async () => {
          await runConnect({
            profile: "codex--pi-tui-watch-readonly",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "11111111-0000-0000-0000-0000000000af",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://example.com",
            space: "ops-room",
            connectionMode: "watch",
            stdio: true,
            output: "text",
            view: "human",
          });
        });
      });

      await harness.waitUntilReady();
      await vi.waitFor(() => {
        expect(startSpy).toHaveBeenCalledTimes(1);
      });
      harness.close(1000, "pi-tui-watch-readonly");

      const { plainStdout } = await connectPromise;
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(renderSpy).toHaveBeenCalled();
      const activeViewState = requireSessionViewState(renderedViewState);
      expect(activeViewState.context.connectionMode).toBe("watch");
      expect(activeViewState.composer.visible).toBe(false);
      expect(plainStdout).not.toContain(
        "Press @ to insert @Name(wake) or @Name(reference)."
      );
      expect(plainStdout).not.toContain(
        "What would you like to say in this space?"
      );
    } finally {
      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
      if (stdoutColumnsDescriptor) {
        Object.defineProperty(
          process.stdout,
          "columns",
          stdoutColumnsDescriptor
        );
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (shellOverride === undefined) {
        delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
      } else {
        process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = shellOverride;
      }
    }
  });

  it("adds structured hint for common websocket connection errors in agent view", async () => {
    let onErrorHandler: ((error: unknown) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn((handler: (error: unknown) => void) => {
        onErrorHandler = handler;
      }),
      waitUntilClosed: vi.fn(() => closedPromise),
    });

    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "22222222-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });
    });

    await vi.waitFor(() => {
      if (!onErrorHandler) {
        throw new Error("onError handler was not registered");
      }
    });
    if (onErrorHandler === null || resolveClosed === null) {
      throw new Error("missing error test harness handlers");
    }
    const errorHandler = onErrorHandler as (error: unknown) => void;
    const closeResolver = resolveClosed as () => void;

    errorHandler(new Error("connect ECONNREFUSED 127.0.0.1:65535"));
    closeResolver();

    const { stdout } = await connectPromise;
    const envelopes = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            type?: string;
            code?: string;
            message?: string;
            data?: Record<string, unknown>;
          }
      );
    const connectErrorEnvelope = envelopes.find(
      (item) => item.type === "error" && item.code === "connect.error"
    );
    expect(connectErrorEnvelope).toBeDefined();
    expect(connectErrorEnvelope?.message).toContain("hint:");
    expect(connectErrorEnvelope?.data?.category).toBe("connection_refused");
    expect(String(connectErrorEnvelope?.data?.hint ?? "")).toContain(
      "can't reach the gateway"
    );
  });

  it("emits system.space.members after system.session.meta in agent ndjson output", async () => {
    const harness = createMessageStreamHarness();
    const fetchSpy = mockConnectFetchSuccess({
      membersSnapshot: {
        spaceId: "ops-room",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
        },
        humans: [
          {
            profileId: "11111111-1111-1111-1111-111111111111",
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "user-1",
            ownerName: "Felix",
          },
        ],
        agents: [
          createSpaceMemberAgentSnapshot({
            profileId: "agt_44444444-4444-4444-4444-444444444444",
            profileName: "ops-bot",
            mentionAlias: null,
            status: "active",
            memberSource: "joined_directly",
            memberSourceLabel: "Joined directly",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: true,
            ownerUserId: "user-1",
            ownerName: "Felix",
            agentControllerRef: "builtin:ops-bot",
            agentControllerConversationId: null,
            wakeRouteEvidence: READY_DAEMON_ROUTE_OBSERVATION,
            wakeabilityStatus: "ready",
          }),
        ],
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "22222222-0000-0000-0000-000000000001",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });
    });

    await harness.waitUntilReady();
    harness.close(1000, "client_closed");

    const { stdout } = await connectPromise;
    const envelopes = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const sessionMetaIndex = envelopes.findIndex(
      (item) => item.type === "system.session.meta"
    );
    const spaceMembersIndex = envelopes.findIndex(
      (item) => item.type === "system.space.members"
    );

    expect(sessionMetaIndex).toBeGreaterThanOrEqual(0);
    expect(spaceMembersIndex).toBe(sessionMetaIndex + 1);
    expect(envelopes[spaceMembersIndex]).toMatchObject({
      type: "system.space.members",
      payload: {
        spaceId: "ops-room",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
        },
        agents: [
          {
            profileId: "agt_44444444-4444-4444-4444-444444444444",
            agentWakeAvailability: {
              action: "none",
              badgeLabel: "Available",
              phase: "available",
              reasonCode: "agent_execution.ready",
              status: "available_for_wake",
            },
          },
        ],
      },
    });
    const membersRequests = fetchSpy.mock.calls.filter(([request, init]) => {
      const url = new URL(String(request));
      const method = String(init?.method ?? "GET").toUpperCase();
      return method === "GET" && url.pathname.endsWith("/members");
    });
    expect(membersRequests).toHaveLength(1);
  });

  it("sanitizes fetched space guide before text rendering", async () => {
    const harness = createMessageStreamHarness();
    const oscLink =
      "\u001B]8;;https://openmeld.invalid\u0007docs\u001B]8;;\u0007";

    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: "ops-room",
        organizationId: "org-1",
        visibility: "private",
        guide: `keep calm\r\n${oscLink}\n\u001B[41mred\u001B[0m\b!`,
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "22222222-0000-0000-0000-000000000003",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    harness.close(1000, "client_closed");

    const { stdout, stderr, plainStdout, plainStderr } = await connectPromise;
    const renderedText = `${stdout}\n${stderr}`;
    const plainRenderedText = stripTerminalControl(renderedText);

    expect(renderedText.includes(oscLink)).toBe(false);
    expect(renderedText.includes("\u001B[41mred\u001B[0m")).toBe(false);
    expect(renderedText.includes("\r")).toBe(false);
    expect(renderedText.includes("\b")).toBe(false);
    expect(plainStdout).not.toContain("Space guide (ops-room):");
    expect(plainStdout).not.toContain("keep calm");
    expect(plainStderr).toContain("Space guide (ops-room):");
    expect(plainStderr).toContain("keep calm");
    expect(plainRenderedText).toContain("Space guide (ops-room):");
    expect(plainRenderedText).toContain("keep calm");
    expect(plainRenderedText).toContain("docs");
    expect(plainRenderedText).toContain("red!");
  });

  it("preserves raw guide in ndjson output", async () => {
    const harness = createMessageStreamHarness();
    const rawGuide =
      "\u001B]8;;https://openmeld.invalid\u0007docs\u001B]8;;\u0007\r\n\u001B[41mred\u001B[0m";

    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: "ops-room",
        organizationId: "org-1",
        visibility: "private",
        guide: rawGuide,
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "22222222-0000-0000-0000-000000000004",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });
    });

    await harness.waitUntilReady();
    harness.close(1000, "client_closed");

    const { stdout } = await connectPromise;
    const envelopes = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const guideEnvelope = envelopes.find(
      (item) => item.type === "system.space.guide"
    );

    expect(guideEnvelope).toMatchObject({
      type: "system.space.guide",
      spaceId: "ops-room",
      guide: rawGuide.trim(),
    });
  });

  it("emits stream-only join guidance for agent no-stdio join connections", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess();

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "22222222-0000-0000-0000-000000000002",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          connectionMode: "join",
          sendCommand:
            "openmeld space send --profile 22222222-0000-0000-0000-000000000002 ops-room <text...>",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });
    });

    await harness.waitUntilReady();
    harness.close(1000, "client_closed");

    const { stdout } = await connectPromise;
    const envelopes = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const connectedEvent = envelopes.find(
      (item) => item.code === "connect.connected_no_stdio"
    );

    expect(connectedEvent).toMatchObject({
      type: "info",
      code: "connect.connected_no_stdio",
      message: `joined in stream-only mode; use \`${formatOpenMeldCliCommand("openmeld space send --profile 22222222-0000-0000-0000-000000000002 ops-room <text...>")}\` to send messages`,
      data: {
        connectionMode: "join",
        profileId: "22222222-0000-0000-0000-000000000002",
        spaceId: "ops-room",
        sendCommand:
          "openmeld space send --profile 22222222-0000-0000-0000-000000000002 ops-room <text...>",
      },
    });
  });

  it("keeps only session meta, members, and signal events in agent raw-stream mode", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      metaPayload: {
        spaceId: "ops-room",
        organizationId: "org-1",
        visibility: "private",
        guide: "raw stream should suppress this wrapper",
      },
      membersSnapshot: {
        spaceId: "ops-room",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 1,
          humanCount: 0,
          agentCount: 1,
          liveNowCount: 1,
        },
        humans: [],
        agents: [
          createSpaceMemberAgentSnapshot({
            profileId: "agt_44444444-4444-4444-4444-555555555555",
            profileName: "ops-bot",
            mentionAlias: null,
            status: "active",
            memberSource: "joined_directly",
            memberSourceLabel: "Joined directly",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: true,
            ownerUserId: "user-1",
            ownerName: "Felix",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId: null,
            wakeRouteEvidence: READY_DAEMON_ROUTE_OBSERVATION,
            wakeabilityStatus: "ready",
          }),
        ],
      },
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-experience",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "22222222-0000-0000-0000-000000000005",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          connectionMode: "watch",
          stdio: false,
          output: "ndjson",
          rawStream: true,
          view: "agent",
        });
      });
    });

    await harness.waitUntilReady();
    harness.emit(
      createTextSignalRawEvent({
        id: "signal-raw-stream-1",
        ts: 101,
        profileId: "agt_44444444-4444-4444-4444-555555555555",
        profileName: "ops-bot",
        profileKind: "agent",
        profileAgentControllerRef: "codex",
        profileOwnerUserId: "user-1",
        profileOwnerName: "Felix",
        text: "hello from raw stream",
      })
    );
    harness.close(1000, "client_closed");

    const { stdout } = await connectPromise;
    const envelopes = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(
      envelopes.some(
        (item) =>
          item.type === "info" && item.code === "connect.connected_no_stdio"
      )
    ).toBe(false);
    expect(envelopes.some((item) => item.type === "system.space.guide")).toBe(
      false
    );
    expect(envelopes[0]).toMatchObject({
      type: "system.session.meta",
    });
    expect(envelopes[1]).toMatchObject({
      type: "system.space.members",
    });
    expect(envelopes[2]).toMatchObject({
      type: "signal.text",
      id: "signal-raw-stream-1",
      profile: {
        profileId: "agt_44444444-4444-4444-4444-555555555555",
        ownerUserId: "user-1",
        ownerName: "Felix",
        agentControllerRef: "builtin:codex",
      },
      messageReadProjection: {
        text: "hello from raw stream",
        wakeTargets: [],
        referenceTargets: [],
        replyToSignalId: null,
        replyToContext: null,
      },
    });
  });

  it("renders a semantic reply cue for replayed non-interactive text history", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: createReplyContextMembersSnapshot(),
      recentSignals: [
        createReplyAnchorSignal(),
        createReplySignal({
          id: "sig-reply-history",
          ts: 2,
        }),
      ],
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-reply-history",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "11111111-0000-0000-0000-000000000110",
            profileName: "Felix",
            profileKind: "human",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          connectionMode: "watch",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    await new Promise((resolve) => setTimeout(resolve, 10));
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);

    expect(plainStdout).toContain("reply to Mira · wake: Phase 2a Agent");
    expect(plainStdout).not.toContain(
      "reply to Mira · @Phase 2a Agent(wake) anchor"
    );
  });

  it("renders a semantic reply cue for live text events after replaying the anchor history", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: createReplyContextMembersSnapshot(),
      recentSignals: [createReplyAnchorSignal()],
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-reply-live",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "11111111-0000-0000-0000-000000000111",
            profileName: "Felix",
            profileKind: "human",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          connectionMode: "watch",
          stdio: false,
          output: "text",
          view: "human",
        });
      });
    });

    await harness.waitUntilReady();
    await new Promise((resolve) => setTimeout(resolve, 10));
    harness.emit(
      JSON.stringify(
        createReplySignal({
          id: "sig-reply-live",
          ts: 3,
        })
      )
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const plainStdout = stripAnsi(stdout);

    expect(plainStdout).toContain("reply to Mira · wake: Phase 2a Agent");
    expect(plainStdout).toContain("Ack");
  });

  it("keeps ndjson reply projection parity when replay and live events share the same signal index", async () => {
    const harness = createMessageStreamHarness();
    mockConnectFetchSuccess({
      membersSnapshot: createReplyContextMembersSnapshot(),
      recentSignals: [createReplyAnchorSignal()],
    });

    const connectPromise = withCapturedStdio(async () => {
      await withTempHome(async () => {
        await runConnect({
          profile: "codex--connect-reply-ndjson",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "agt_11111111-0000-0000-0000-000000000112",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          connectionMode: "watch",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });
    });

    await harness.waitUntilReady();
    await new Promise((resolve) => setTimeout(resolve, 10));
    harness.emit(
      JSON.stringify(
        createReplySignal({
          id: "sig-reply-ndjson",
          ts: 3,
        })
      )
    );
    harness.close(1006, "");

    const { stdout } = await connectPromise;
    const envelopes = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const replyEvent = envelopes.find(
      (item) => item.type === "signal.text" && item.id === "sig-reply-ndjson"
    ) as
      | {
          messageReadProjection?: {
            replyToContext?: {
              resolved?: boolean;
              actorDisplayName?: string | null;
              relationSummary?: Array<{
                relation?: string;
                targets?: Array<{ displayName?: string }>;
              }>;
            } | null;
          };
        }
      | undefined;

    expect(replyEvent?.messageReadProjection?.replyToContext).toMatchObject({
      resolved: true,
      actorDisplayName: "Mira",
      relationSummary: [
        {
          relation: "wake",
          targets: [{ displayName: "Phase 2a Agent" }],
        },
      ],
    });
  });
});

function mockConnectFetchSuccess(options?: {
  metaPayload?: Record<string, unknown>;
  membersSnapshot?: Record<string, unknown>;
  cursorPayload?: Record<string, unknown>;
  recentSignals?: readonly unknown[];
}) {
  const okJson = (payload: unknown): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(String(input));
    const method = String(init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname.endsWith("/meta")) {
      return okJson(
        options?.metaPayload ?? {
          spaceId: "ops-room",
          organizationId: "org-1",
          visibility: "private",
        }
      );
    }

    if (method === "GET" && url.pathname.includes("/cursors/")) {
      return okJson(options?.cursorPayload ?? {});
    }

    if (method === "GET" && url.pathname.endsWith("/members")) {
      return okJson(
        options?.membersSnapshot ?? {
          spaceId: "ops-room",
          generatedAt: "2026-03-06T00:00:00.000Z",
          summary: {
            totalCount: 0,
            humanCount: 0,
            agentCount: 0,
            liveNowCount: 0,
          },
          humans: [],
          agents: [],
        }
      );
    }

    if (
      method === "GET" &&
      url.pathname.endsWith("/signals") &&
      url.searchParams.get("recent") === "1"
    ) {
      return okJson({
        signals: options?.recentSignals ?? [],
        nextCursor: null,
      });
    }

    if (method === "PATCH" && url.pathname.includes("/cursors/")) {
      return okJson({});
    }

    throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
  });
}

function createMessageStreamHarness(): {
  waitUntilReady: () => Promise<void>;
  emit: (raw: string) => void;
  close: (code: number, reason: string) => void;
  send: ReturnType<typeof vi.fn>;
} {
  let onMessageHandler: ((raw: string) => void) | null = null;
  let onCloseHandler: ((code: number, reason: string) => void) | null = null;
  let resolveClosed: (() => void) | null = null;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const send = vi.fn();

  connectWebSocketMock.mockResolvedValue({
    send,
    close: vi.fn(),
    terminate: vi.fn(),
    onMessage: vi.fn((handler: (raw: string) => void) => {
      onMessageHandler = handler;
    }),
    onClose: vi.fn((handler: (code: number, reason: string) => void) => {
      onCloseHandler = handler;
    }),
    onError: vi.fn(),
    waitUntilClosed: vi.fn(() => closedPromise),
  });

  return {
    waitUntilReady: async () => {
      await vi.waitFor(() => {
        if (!(onMessageHandler && onCloseHandler)) {
          throw new Error("message stream handlers were not registered");
        }
      });
    },
    emit: (raw: string) => {
      if (!onMessageHandler) {
        throw new Error("missing onMessage handler");
      }
      onMessageHandler(raw);
    },
    close: (code: number, reason: string) => {
      if (!(onCloseHandler && resolveClosed)) {
        throw new Error("missing close handlers");
      }
      onCloseHandler(code, reason);
      resolveClosed();
    },
    send,
  };
}

function createTextSignalRawEvent(input: {
  id: string;
  ts: number;
  profileId: string;
  profileName: string;
  profileKind?: "human" | "agent" | "system";
  profileOwnerUserId?: string;
  profileOwnerName?: string;
  profileAgentControllerRef?: string;
  text: string;
  meta?: Record<string, unknown>;
  messageEnvelope?: {
    text: string;
    activationTargets: string[];
    referenceTargets: string[];
    replyToSignalId?: string;
  };
  replyTo?: {
    signalId: string;
    profileId: string;
    profileKind: "human" | "agent" | "system" | null;
    profileName: string;
    previewText: string;
  };
}): string {
  return JSON.stringify({
    v: 1,
    id: input.id,
    spaceId: "ops-room",
    ts: input.ts,
    profile: {
      kind: input.profileKind ?? "human",
      profileId: input.profileId,
      profileName: input.profileName,
      ...(input.profileOwnerUserId ? { owner: input.profileOwnerUserId } : {}),
      ...(input.profileOwnerName ? { ownerName: input.profileOwnerName } : {}),
      ...(input.profileAgentControllerRef
        ? { agentControllerRef: input.profileAgentControllerRef }
        : {}),
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.messageEnvelope
        ? { messageEnvelope: input.messageEnvelope }
        : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    },
  });
}

function createReplyContextMembersSnapshot() {
  return createSpaceMembersSnapshot({
    spaceId: "ops-room",
    generatedAt: "2026-04-10T00:00:00.000Z",
    humans: [
      createSpaceMemberHumanSnapshot({
        profileId: "11111111-1111-1111-1111-111111111111",
        profileName: "Mira",
        mentionAlias: null,
        status: "active" as const,
        memberSource: "joined_directly" as const,
        memberSourceLabel: "Joined directly",
        addedAt: "2026-04-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        addedByProfileId: null,
        addedByOwnerUserId: null,
        addedByDisplayName: null,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: null,
        lastSeenLabel: null,
        liveNow: false,
        ownerUserId: "user-mira",
        ownerName: "Mira",
      }),
    ],
    agents: [
      createSpaceMemberAgentSnapshot({
        profileId: "agt_33333333-3333-4333-8333-333333333333",
        profileName: "Phase 2a Agent",
        mentionAlias: null,
        status: "active" as const,
        memberSource: "added_by_member" as const,
        memberSourceLabel: "Added by member",
        addedAt: "2026-04-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        addedByProfileId: "11111111-1111-1111-1111-111111111111",
        addedByOwnerUserId: "user-mira",
        addedByDisplayName: "Mira",
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: null,
        lastSeenLabel: null,
        liveNow: false,
        ownerUserId: "user-mira",
        ownerName: "Mira",
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: null,
        workingDirectory: null,
        wakeabilityStatus: "ready",
      }),
    ],
  });
}

function createReplyAnchorSignal() {
  return JSON.parse(
    createTextSignalRawEvent({
      id: "sig-anchor-1",
      ts: 1,
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Mira",
      text: "@Phase 2a Agent(wake) anchor",
      messageEnvelope: {
        text: "@Phase 2a Agent(wake) anchor",
        activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
        referenceTargets: [],
      },
    })
  ) as Record<string, unknown>;
}

function createReplySignal(input: { id: string; ts: number }) {
  return {
    v: 1,
    id: input.id,
    spaceId: "ops-room",
    ts: input.ts,
    profile: {
      kind: "agent",
      profileId: "agt_33333333-3333-4333-8333-333333333333",
      profileName: "Phase 2a Agent",
      owner: "user-mira",
      ownerName: "Mira",
      agentControllerRef: "builtin:codex",
    },
    type: "signal.text",
    data: {
      text: "Ack",
      messageEnvelope: {
        text: "Ack",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-anchor-1",
      },
      replyTo: {
        signalId: "sig-anchor-1",
        profileId: "11111111-1111-1111-1111-111111111111",
        profileKind: "human",
        profileName: "Mira",
        previewText: "@Phase 2a Agent(wake) anchor",
      },
    },
  };
}

function createPresenceRawEvent(input: {
  id: string;
  ts: number;
  profileId: string;
  profileName: string;
  profileKind?: "human" | "agent" | "system";
  type: "presence.join" | "presence.quit";
}): string {
  return JSON.stringify({
    v: 1,
    id: input.id,
    spaceId: "ops-room",
    ts: input.ts,
    profile: {
      kind: input.profileKind ?? "human",
      profileId: input.profileId,
      profileName: input.profileName,
    },
    type: input.type,
    data: {},
  });
}

function createOpenMeldProfileInput(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
  ownerName?: string;
}) {
  return createTestOpenMeldProfile({
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    ...(input.ownerName ? { ownerName: input.ownerName } : {}),
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  });
}

function createTypedCanonicalMembersSnapshot() {
  return createSpaceMembersSnapshot({
    spaceId: "ops-room",
    generatedAt: "2026-04-01T00:00:00.000Z",
    humans: [
      createSpaceMemberHumanSnapshot({
        profileId: "11111111-0000-0000-0000-000000000008",
        profileName: "Felix",
        mentionAlias: null,
        status: "active" as const,
        memberSource: "space_creator" as const,
        memberSourceLabel: "Creator",
        addedAt: "2026-04-01T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        addedByProfileId: null,
        addedByOwnerUserId: null,
        addedByDisplayName: null,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: "2026-04-01T00:00:00.000Z",
        lastEnteredAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenLabel: "Seen just now",
        liveNow: false,
        ownerUserId: null,
        ownerName: null,
      }),
    ],
    agents: [
      createSpaceMemberAgentSnapshot({
        profileId: "agt_11111111-2222-4333-8444-555555555555",
        profileName: "Budget Analyst",
        mentionAlias: null,
        status: "active" as const,
        memberSource: "added_by_member" as const,
        memberSourceLabel: "Added by Felix",
        addedAt: "2026-04-01T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        addedByProfileId: "11111111-0000-0000-0000-000000000008",
        addedByOwnerUserId: null,
        addedByDisplayName: "Felix",
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenLabel: "Seen just now",
        liveNow: false,
        ownerUserId: null,
        ownerName: null,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: null,
        wakeRouteEvidence: READY_DAEMON_ROUTE_OBSERVATION,
        wakeabilityStatus: "ready",
      }),
    ],
  });
}

function extractInlineTrueColorPrefixForLabel(
  value: string,
  label: string
): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(
    new RegExp(
      `(${TRUECOLOR_PREFIX_START}[0-9;]+m)${escapedLabel}\\u001B\\[39m`
    )
  );
  return match?.[1];
}

function requireSessionViewState(
  value: SpaceSessionViewState | null
): SpaceSessionViewState {
  if (value === null) {
    throw new Error(
      "pi-tui shell did not receive an active-session view state"
    );
  }
  return value;
}
