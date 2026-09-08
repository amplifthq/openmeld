import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SpaceMemberDirectorySendTargetEntry } from "@openmeld/space";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
  OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV,
} from "../src/runtime/dispatch-runtime-env";
import {
  createDispatchSpaceActionContext,
  type DispatchSpaceActionContext,
  OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
  readDispatchSpaceActionContextFromEnv,
  readDispatchSpaceActionRecord,
  supersedeDispatchSpaceActionRecordForReconsideration,
  writeDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";
import {
  runSpaceActionHelp,
  runSpaceActionReply,
  runSpaceActionStatus,
  runSpaceActionTargets,
  runSpaceActionWake,
} from "../src/space/action-command";
import { createSpaceActionMcpServer } from "../src/space/action-mcp-server";

const AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_PROFILE_ID_TWO = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const tempDirs: string[] = [];
const originalActionContextPath =
  process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalActionContextPath === undefined) {
    delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
  } else {
    process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
      originalActionContextPath;
  }
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("OpenMeld Space Action command", () => {
  it("records wake as a post_message action with activationTargets", async () => {
    const context = createTestContext([
      createProjectionEntry({
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        primaryMentionLabel: "QA Agent",
      }),
    ]);

    await runSpaceActionWake({
      target: "@QA Agent",
      messageParts: ["Please", "review", "this."],
    });

    const record = readLoadedActionRecord(context);
    expect(record.action).toEqual({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [AGENT_PROFILE_ID],
        mentionTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-reply",
        text: "Please review this.",
      },
    });
  });

  it("records reply --mention as a Human Mention without waking the person", async () => {
    const humanProfileId = "11111111-1111-4111-8111-111111111111";
    const context = createTestContext([
      createProjectionEntry({
        profileId: humanProfileId,
        profileKind: "human",
        primaryMentionLabel: "Mira",
      }),
    ]);

    await runSpaceActionReply({
      mentionTargets: ["@Mira"],
      messageParts: ["Please", "take", "a", "look."],
    });

    const record = readLoadedActionRecord(context);
    expect(record.action).toMatchObject({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [],
        mentionTargets: [humanProfileId],
        referenceTargets: [],
        text: "Please take a look.",
      },
    });
  });

  it("records reply --wake as the authoritative CLI action", async () => {
    const context = createTestContext([
      createProjectionEntry({
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        primaryMentionLabel: "Review Agent",
      }),
    ]);

    await runSpaceActionReply({
      messageParts: ["Implementation", "is", "done."],
      wakeTargets: ["Review Agent"],
    });

    const record = readLoadedActionRecord(context);
    expect(record.command).toBe("reply");
    expect(record.action).toMatchObject({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [AGENT_PROFILE_ID],
        text: "Implementation is done.",
      },
    });
  });

  it("records message-file text without changing newlines or backslashes", async () => {
    const context = createTestContext([]);
    const messageFilePath = `${tempDirs.at(-1)}/reply.txt`;
    const message =
      'First line\nLiteral \\n stays literal.\n`code` "$HOME" $(whoami) 😀';
    writeFileSync(messageFilePath, message, "utf8");

    await runSpaceActionReply({
      messageFilePath,
      messageParts: [],
    });

    expect(readLoadedActionRecord(context).action).toMatchObject({
      type: "post_message",
      messageEnvelope: { text: message },
    });
  });

  it("rejects ambiguous reply message sources", () => {
    createTestContext([]);

    expect(() =>
      runSpaceActionReply({
        messageFilePath: "reply.txt",
        messageParts: ["Inline reply."],
      })
    ).toThrow("Choose either a reply message or --message-file, not both.");
  });

  it("rejects removed CC syntax in action message text", () => {
    createTestContext([]);

    expect(() =>
      runSpaceActionReply({
        messageParts: ["@Mira(cc)", "Please review."],
      })
    ).toThrow(
      "CC has been removed from Space Message Addressing. Use Reference instead."
    );
  });

  it("rejects status working because status actions are final outcomes", () => {
    createTestContext([]);

    expect(() =>
      runSpaceActionStatus({
        status: "working",
        textParts: ["Checking", "trace."],
      })
    ).toThrow("would close the current Wake");
  });

  it("keeps final action records first-write-wins", async () => {
    createTestContext([]);

    await runSpaceActionReply({
      messageParts: ["First", "answer."],
    });

    expect(() =>
      runSpaceActionReply({
        messageParts: ["Second", "answer."],
      })
    ).toThrow("already been recorded");
  });

  it("acknowledges an identical reply retry without replacing the first record", async () => {
    const context = createTestContext([]);
    await runSpaceActionReply({ messageParts: ["One answer."] });
    const original = readLoadedActionRecord(context);

    await runSpaceActionReply({ messageParts: ["One answer."] });

    expect(readLoadedActionRecord(context)).toEqual(original);
  });

  it("preserves a superseded action before one bounded reconsideration", async () => {
    const context = createTestContext([]);
    await runSpaceActionReply({ messageParts: ["First answer."] });

    const superseded = supersedeDispatchSpaceActionRecordForReconsideration({
      context,
    });
    expect(superseded?.record.action).toMatchObject({
      type: "post_message",
      messageEnvelope: { text: "First answer." },
    });
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");

    await runSpaceActionReply({ messageParts: ["Reconsidered answer."] });
    expect(readLoadedActionRecord(context).action).toMatchObject({
      type: "post_message",
      messageEnvelope: { text: "Reconsidered answer." },
    });
  });

  it("describes the local action record without claiming Space publication", async () => {
    const chunks: string[] = [];
    createTestContext([]);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    await runSpaceActionReply({
      messageParts: ["Visible", "answer."],
    });

    expect(chunks.join("")).toContain(
      "Action recorded: OpenMeld saved this unpublished Space action proposal (post_message) for the current Wake."
    );
    expect(chunks.join("")).not.toContain("Posted to Space");
  });

  it("emits reply timing diagnostics on stderr without exposing message text", async () => {
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    createTestContext([]);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    await runSpaceActionReply({
      messageParts: ["Timing", "answer."],
    });

    const stdout = stdoutChunks.join("");
    const stderr = stderrChunks.join("");
    expect(stdout).toContain(
      "Action recorded: OpenMeld saved this unpublished Space action proposal (post_message) for the current Wake."
    );
    expect(stdout).not.toContain("openmeld.space_action.reply_timing");
    expect(stderr).not.toContain("Timing answer.");

    const timingPayloads = stderr
      .split("\n")
      .filter((line) =>
        line.startsWith("[openmeld.space_action.reply_timing] ")
      )
      .map((line) =>
        JSON.parse(line.replace("[openmeld.space_action.reply_timing] ", ""))
      ) as Array<{
      commandStartProcessUptimeMs: number;
      dispatchId: string | null;
      durationMs: number;
      elapsedMs: number;
      event: string;
      messageLength?: number;
      phase: string;
      taskId: string | null;
    }>;

    expect(timingPayloads.map((payload) => payload.phase)).toEqual([
      "command_start",
      "context_ready",
      "targets_resolved",
      "record_written",
      "done",
    ]);
    expect(timingPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messagePartCount: 2,
          phase: "command_start",
          wakeTargetCount: 0,
        }),
        expect.objectContaining({
          dispatchId: "dispatch-1",
          event: "openmeld.space_action.reply_timing",
          phase: "context_ready",
          taskId: "task-1",
        }),
        expect.objectContaining({
          messageLength: "Timing answer.".length,
          phase: "targets_resolved",
        }),
      ])
    );
    for (const payload of timingPayloads) {
      expect(payload.commandStartProcessUptimeMs).toBeGreaterThanOrEqual(0);
      expect(payload.durationMs).toBeGreaterThanOrEqual(0);
      expect(payload.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps a valid action record after the dispatch context expires", () => {
    const context = createTestContext([], { ttlMs: 1 });

    writeDispatchSpaceActionRecord({
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "Recorded before expiry.",
        },
      },
      command: "reply",
      context,
      nowMs: context.expiresAtMs - 1,
    });

    const record = readDispatchSpaceActionRecord({
      context,
      nowMs: context.expiresAtMs + 60_000,
    });
    expect(record.status).toBe("loaded");
  });

  it("rejects writing a new action after the dispatch context expires", () => {
    const context = createTestContext([], { ttlMs: 1 });

    expect(() =>
      writeDispatchSpaceActionRecord({
        action: {
          type: "stay_silent",
          reason: "Too late.",
        },
        command: "silent",
        context,
        nowMs: context.expiresAtMs + 1,
      })
    ).toThrow("dispatch context has expired");
  });

  it("fails closed when wake targets a human profile", () => {
    createTestContext([
      createProjectionEntry({
        allowedRelations: {
          wake: false,
          reference: false,
          mention: true,
        },
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
        primaryMentionLabel: "Felix",
      }),
    ]);

    expect(() =>
      runSpaceActionWake({
        target: "Felix",
        messageParts: ["Please", "review."],
      })
    ).toThrow("Wake is not allowed");
  });

  it("records wake targets without local readiness gating", async () => {
    const context = createTestContext([
      createProjectionEntry({
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        primaryMentionLabel: "QA Agent",
      }),
    ]);

    await runSpaceActionWake({
      target: "QA Agent",
      messageParts: ["Please", "review."],
    });

    const record = readLoadedActionRecord(context);
    expect(record.action).toMatchObject({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [AGENT_PROFILE_ID],
        text: "Please review.",
      },
    });
  });

  it("shows wake-capable targets without local readiness state", () => {
    let stdout = "";
    createTestContext([
      createProjectionEntry({
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        primaryMentionLabel: "QA Agent",
      }),
      createProjectionEntry({
        profileId: AGENT_PROFILE_ID_TWO,
        profileKind: "agent",
        primaryMentionLabel: "Review Agent",
      }),
    ]);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    runSpaceActionTargets();

    expect(stdout).toContain("Wake targets:");
    expect(stdout).toContain("QA Agent");
    expect(stdout).toContain("Review Agent");
    expect(stdout).not.toContain("Blocked wake targets:");
  });

  it("fails closed on ambiguous target lookup", () => {
    createTestContext([
      createProjectionEntry({
        lookupTokens: ["qa"],
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        primaryMentionLabel: "QA East",
      }),
      createProjectionEntry({
        lookupTokens: ["qa"],
        profileId: AGENT_PROFILE_ID_TWO,
        profileKind: "agent",
        primaryMentionLabel: "QA West",
      }),
    ]);

    expect(() =>
      runSpaceActionWake({
        target: "qa",
        messageParts: ["Please", "review."],
      })
    ).toThrow("ambiguous");
  });

  it("fails closed when the dispatch target projection is malformed", () => {
    createTestContext([
      {
        profileId: AGENT_PROFILE_ID,
      } as unknown as SpaceMemberDirectorySendTargetEntry,
    ]);

    expect(() =>
      runSpaceActionWake({
        target: AGENT_PROFILE_ID,
        messageParts: ["Please", "review."],
      })
    ).toThrow("OpenMeld Space Action target projection entry 0");
  });

  it("allows help without context but requires context for targets", () => {
    delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    expect(() => runSpaceActionHelp()).not.toThrow();
    expect(() => runSpaceActionTargets()).toThrow(
      "No active OpenMeld Space Action dispatch context"
    );
  });

  it("shows a dispatch command placeholder when help has no active context", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    runSpaceActionHelp();

    const stdout = chunks.join("");
    expect(stdout).toContain(
      '<DISPATCH_ACTION_CLI> space action reply "message"'
    );
    expect(stdout).toContain(
      '<DISPATCH_ACTION_CLI> space action reply --reference "@Agent Name" "message"'
    );
    expect(stdout).not.toContain("--cc");
    expect(stdout).toContain("<DISPATCH_ACTION_CLI> space action targets");
    expect(stdout).toContain(
      "Run exactly one final action for the current Wake. OpenMeld posts the accepted action to the Space."
    );
    expect(stdout).toContain(
      "<DISPATCH_ACTION_CLI> is a placeholder for the exact Space Action command prefix"
    );
    expect(stdout).not.toContain("RuntimeCoordinator");
    expect(stdout).not.toContain('openmeld-dev space action reply "message"');
    expect(stdout).not.toContain("openmeld-dev space action targets");
  });

  it("formats help examples with the active dispatch user-facing CLI command", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    createTestContext([]);
    const chunks: string[] = [];
    vi.restoreAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    runSpaceActionHelp();

    const stdout = chunks.join("");
    expect(stdout).toContain('openmeld-dev space action reply "message"');
    expect(stdout).toContain("openmeld-dev space action targets");
    expect(stdout).toContain("Active dispatch: dispatch-1");
    expect(stdout).not.toContain("<DISPATCH_ACTION_CLI>");
    expect(stdout).not.toContain("openmeld space action targets");
  });

  it("fails closed when a context path belongs to a different dispatch runtime", () => {
    createTestContext([]);

    expect(() =>
      readDispatchSpaceActionContextFromEnv({
        [OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]:
          process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV],
        [OPENMELD_DISPATCH_RUNTIME_MODE_ENV]: "dispatch-owned-runtime",
        [OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]: "dispatch-other",
        [OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]: "agt_current",
      })
    ).toThrow("does not match the active dispatch runtime");
  });

  it("fails closed when a context path belongs to a different target profile", () => {
    createTestContext([]);

    expect(() =>
      readDispatchSpaceActionContextFromEnv({
        [OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]:
          process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV],
        [OPENMELD_DISPATCH_RUNTIME_MODE_ENV]: "dispatch-owned-runtime",
        [OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]: "dispatch-1",
        [OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]: "agt_other",
      })
    ).toThrow("target profile does not match the active dispatch runtime");
  });
});

describe("OpenMeld Space Action MCP server", () => {
  it("rejects a self-Wake before recording and accepts the corrected plain reply", async () => {
    const context = createTestContext(
      [
        createProjectionEntry({
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          primaryMentionLabel: "Current Agent",
        }),
      ],
      { targetProfileId: AGENT_PROFILE_ID }
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "openmeld-test", version: "1.0.0" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const rejected = await client.callTool({
        name: "reply",
        arguments: { message: "Done", wakeTargets: [AGENT_PROFILE_ID] },
      });
      expect(rejected.isError).toBe(true);
      expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
      const corrected = await client.callTool({
        name: "reply",
        arguments: { message: "Done" },
      });
      expect(corrected.isError).not.toBe(true);
      expect(readLoadedActionRecord(context).action).toMatchObject({
        type: "post_message",
        messageEnvelope: { text: "Done", activationTargets: [] },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("records the exact structured reply without writing CLI text to stdout", async () => {
    const context = createTestContext([]);
    const stdoutChunks: string[] = [];
    vi.restoreAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "openmeld-test", version: "1.0.0" });

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const message =
        'First line\nLiteral \\n stays literal.\n`code` "$HOME" $(whoami) 😀';
      const result = await client.callTool({
        name: "reply",
        arguments: { message },
      });

      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        "unpublished Space action proposal"
      );
      expect(JSON.stringify(result.content)).not.toContain(
        "will publish the accepted action"
      );
      expect(readLoadedActionRecord(context).action).toMatchObject({
        type: "post_message",
        messageEnvelope: { text: message },
      });
      expect(stdoutChunks.join("")).toBe("");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("fails the second final tool call for the same Wake", async () => {
    createTestContext([]);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "openmeld-test", version: "1.0.0" });

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const first = await client.callTool({
        name: "stay_silent",
        arguments: { reason: "No public reply is needed." },
      });
      const second = await client.callTool({
        name: "status",
        arguments: { status: "done", text: "Done." },
      });

      expect(first.isError).not.toBe(true);
      expect(second.isError).toBe(true);
      expect(JSON.stringify(second.content)).toContain("already been recorded");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function createTestContext(
  projection: SpaceMemberDirectorySendTargetEntry[],
  options?: { ttlMs?: number; targetProfileId?: string }
): DispatchSpaceActionContext {
  const openMeldHome = mkdtempSync(`${tmpdir()}/openmeld-space-action-`);
  tempDirs.push(openMeldHome);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const { context, contextPath } = createDispatchSpaceActionContext({
    attemptId: "attempt-1",
    dispatchId: "dispatch-1",
    env: {
      OPENMELD_HOME: openMeldHome,
    },
    replyToSignalId: "sig-reply",
    sendTargetReference: {
      status: "loaded",
      projection,
      referenceLines: [],
    },
    sourceEventId: "sig-source",
    spaceContractSnapshot: {
      allowedActions: ["post_message", "post_status", "stay_silent"],
      publicationMode: "collaboration",
    },
    spaceId: "space-1",
    targetProfileId: options?.targetProfileId ?? "agt_current",
    taskId: "task-1",
    ...(options?.ttlMs ? { ttlMs: options.ttlMs } : {}),
  });
  process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] = contextPath;
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return context;
}

function readLoadedActionRecord(context: DispatchSpaceActionContext) {
  const record = readDispatchSpaceActionRecord({ context });
  if (record.status !== "loaded") {
    throw new Error("expected loaded record");
  }
  return record.record;
}

function createProjectionEntry(input: {
  allowedRelations?: SpaceMemberDirectorySendTargetEntry["allowedRelations"];
  lookupTokens?: readonly string[];
  profileId: string;
  profileKind: "agent" | "human";
  primaryMentionLabel: string;
}): SpaceMemberDirectorySendTargetEntry {
  return {
    allowedRelations:
      input.allowedRelations ??
      (input.profileKind === "agent"
        ? { wake: true, reference: true, mention: false }
        : { wake: false, reference: false, mention: true }),
    agentCard: null,
    displayName: input.primaryMentionLabel,
    labelSource: "profile_name",
    mentionLabels: [input.primaryMentionLabel],
    lookupTokens: [...(input.lookupTokens ?? [input.primaryMentionLabel])],
    mentionAlias: null,
    ownerName: null,
    ownerUserId: "usr_test",
    preferredLookupToken: input.primaryMentionLabel,
    primaryMentionLabel: input.primaryMentionLabel,
    profileId: input.profileId,
    profileIdShort: input.profileId.slice(0, 12),
    profileKind: input.profileKind,
    spaceRole: null,
  };
}
