import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES } from "@openmeld/adapter-core";
import { dispatchSpaceActionToolResultSchema } from "@openmeld/schemas";
import type { SpaceMemberDirectorySendTargetEntry } from "@openmeld/space";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
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
import { startDispatchSpaceProgressRelay } from "../src/runtime/dispatch-space-progress-relay";
import {
  runSpaceActionHelp,
  runSpaceActionReply,
  runSpaceActionStatus,
  runSpaceActionTargets,
  runSpaceActionWake,
} from "../src/space/action-command";
import {
  createDispatchSpaceTools,
  createSpaceActionMcpServer,
} from "../src/space/action-mcp-server";
import { openDirectMessage } from "../src/space/direct-message";

const AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_PROFILE_ID_TWO = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const tempDirs: string[] = [];
const originalDispatchEnv = {
  actionContextPath: process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV],
  dispatchId: process.env[OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV],
  mode: process.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV],
  targetProfileId: process.env[OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV],
};

afterEach(() => {
  vi.unstubAllEnvs();
  restoreEnv(
    OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
    originalDispatchEnv.actionContextPath
  );
  restoreEnv(
    OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV,
    originalDispatchEnv.dispatchId
  );
  restoreEnv(OPENMELD_DISPATCH_RUNTIME_MODE_ENV, originalDispatchEnv.mode);
  restoreEnv(
    OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV,
    originalDispatchEnv.targetProfileId
  );
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("OpenMeld Space Action command", () => {
  it("records an explicit main-conversation placement as structured reply data", async () => {
    const context = createTestContext([]);
    await runSpaceActionReply({
      messageParts: ["Decision for everyone."],
      placement: "conversation",
    });
    expect(readLoadedActionRecord(context).action).toMatchObject({
      type: "post_message",
      placement: "conversation",
    });
  });
  it("keeps expired contexts from uploading files or listing targets while recovering plain replies", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const context = createTestContext([], { ttlMs: 1000 });
    runSpaceActionReply({ messageParts: ["Saved reply."] });
    const original = readLoadedActionRecord(context);
    clock.mockReturnValue(context.expiresAtMs + 1);
    const fetch = vi.spyOn(globalThis, "fetch");

    runSpaceActionReply({ messageParts: ["Saved reply."] });
    expect(readLoadedActionRecord(context)).toEqual(original);
    expect(() =>
      runSpaceActionReply({
        messageParts: ["Saved reply."],
        filePaths: ["/must-not-be-read-or-uploaded.txt"],
      })
    ).toThrow("dispatch context has expired");
    expect(() => runSpaceActionTargets()).toThrow(
      "dispatch context has expired"
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(readLoadedActionRecord(context)).toEqual(original);
  });
  it("records wake as a post_message action with activationTargets", async () => {
    const context = createTestContext([
      createProjectionEntry({
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        primaryMentionLabel: "QA Agent",
      }),
    ]);

    await runSpaceActionWake({
      target: AGENT_PROFILE_ID,
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
      mentionTargets: [humanProfileId],
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

  it("records reply --wake once for repeated explicit recipients", async () => {
    const context = createTestContext([
      createProjectionEntry({
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        primaryMentionLabel: "Review Agent",
      }),
    ]);

    await runSpaceActionReply({
      messageParts: ["Implementation", "is", "done."],
      wakeTargets: [AGENT_PROFILE_ID, AGENT_PROFILE_ID],
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

  it("preserves old control syntax as literal action text", async () => {
    const context = createTestContext([]);
    await runSpaceActionReply({
      messageParts: ["@Mira(cc)", "Please review."],
    });
    expect(readLoadedActionRecord(context).action).toMatchObject({
      type: "post_message",
      messageEnvelope: {
        text: "@Mira(cc) Please review.",
        activationTargets: [],
        referenceTargets: [],
      },
    });
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

  it("revises one reply without rolling back on an earlier retry", async () => {
    const context = createTestContext([]);

    await runSpaceActionReply({
      messageParts: ["First", "answer."],
    });

    await runSpaceActionReply({ messageParts: ["Second", "answer."] });
    await runSpaceActionReply({ messageParts: ["First", "answer."] });
    expect(readLoadedActionRecord(context).action).toMatchObject({
      messageEnvelope: { text: "Second answer." },
    });
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
        target: HUMAN_PROFILE_ID,
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
      target: AGENT_PROFILE_ID,
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

  it("rejects names instead of guessing an identity", () => {
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
    ).toThrow("full Profile ID");
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
      '<DISPATCH_ACTION_CLI> space action reply --reference <agent-profile-id> "message"'
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
  it("bridges non-final public progress back to the active Service process", async () => {
    const context = createTestContext([]);
    const updates: string[] = [];
    const contextPath = process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
    if (!contextPath) {
      throw new Error("expected dispatch action context path");
    }
    const relay = startDispatchSpaceProgressRelay({
      context,
      contextPath,
      reportProgress: (update) => {
        updates.push(update);
        return { status: "accepted" };
      },
      pollIntervalMs: 1,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "openmeld-test", version: "1.0.0" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const catalog = await client.listTools();
      expect(catalog.tools.map((tool) => tool.name).sort()).toEqual(
        [...OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES].sort()
      );
      expect(
        catalog.tools.some((tool) => tool.name === "report_progress")
      ).toBe(true);
      const result = await client.callTool({
        name: "report_progress",
        arguments: { update: "Starting verification." },
      });
      expect(result.content).toEqual([
        { type: "text", text: '{"status":"accepted"}' },
      ]);
      expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
    } finally {
      await relay.close();
      await client.close();
      await server.close();
    }
    expect(updates).toEqual(["Starting verification."]);
  });

  it("rejects a Task review without the exact result revision before invoking the action", async () => {
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
      const result = await client.callTool({
        name: "review_task",
        arguments: {
          taskId: "tsk_55555555-5555-4555-8555-555555555555",
          expectedRevision: 5,
          decision: "accepted",
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        "expectedResultRevision"
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

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
      expect(rejected.structuredContent).toMatchObject({
        receipt: {
          status: "rejected_before_recording",
          reasonCode: "space_action.invalid_input",
          coordinatorAcceptance: "unconfirmed",
          publication: "unconfirmed",
        },
      });
      expect(JSON.stringify(rejected.content)).toContain(
        "This call did not record an action"
      );
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
      expect(
        dispatchSpaceActionToolResultSchema.parse(result.structuredContent)
      ).toMatchObject({
        receipt: {
          status: "proposal_saved_locally",
          contextState: "active",
          coordinatorAcceptance: "unconfirmed",
          publication: "unconfirmed",
        },
      });
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

  it("does not expose a status tool and can explain a missing repository without shell access", async () => {
    const context = createTestContext([]);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "no-shell-agent", version: "1.0.0" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const catalog = await client.listTools();
      expect(catalog.tools.some((tool) => tool.name === "status")).toBe(false);
      const result = await client.callTool({
        name: "reply",
        arguments: {
          message:
            "I cannot read this repository with my current tools, so I have not reviewed the code. Please provide authorized access.",
        },
      });
      expect(result.isError).not.toBe(true);
      expect(readLoadedActionRecord(context).action).toMatchObject({
        type: "post_message",
        messageEnvelope: {
          text: expect.stringContaining("have not reviewed the code"),
        },
      });
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
        name: "reply",
        arguments: { message: "Done." },
      });

      expect(first.isError).not.toBe(true);
      expect(second.isError).toBe(true);
      expect(JSON.stringify(second.content)).toContain("already been recorded");
    } finally {
      await client.close();
      await server.close();
    }
  });
  it.each([
    { name: "reply", arguments: { message: "Done." } },
    { name: "stay_silent", arguments: { reason: "Nothing to add." } },
  ])("recovers $name's original receipt after expiry without accepting a new action", async (request) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const context = createTestContext([], { ttlMs: 1000 });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "openmeld-test", version: "1.0.0" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const first = await client.callTool(request);
      expect(first.isError).not.toBe(true);
      const receipt = dispatchSpaceActionToolResultSchema.parse(
        first.structuredContent
      ).receipt;
      expect(receipt).toMatchObject({
        status: "proposal_saved_locally",
        attemptId: context.attemptId,
        contextId: context.contextId,
        dispatchId: context.dispatchId,
        recordedAtMs: 1_000_000,
        contextState: "active",
        coordinatorAcceptance: "unconfirmed",
        publication: "unconfirmed",
      });
      const original = readLoadedActionRecord(context);
      clock.mockReturnValue(context.expiresAtMs + 1);

      const replay = await client.callTool(request);
      expect(replay.isError).not.toBe(true);
      expect(replay.structuredContent).toEqual({
        receipt: { ...receipt, contextState: "expired" },
      });
      expect(JSON.stringify(replay.content)).toContain("existing record");
      expect(readLoadedActionRecord(context)).toEqual(original);

      const changed = await client.callTool({
        name: "reply",
        arguments: { message: "A different final reply." },
      });
      expect(changed.isError).toBe(true);
      expect(changed.structuredContent).toEqual({
        receipt: {
          status: "rejected_closed",
          reasonCode: "space_action.context_expired",
          coordinatorAcceptance: "unconfirmed",
          publication: "unconfirmed",
        },
      });
      expect(JSON.stringify(changed.content)).not.toContain(
        "Nothing was recorded or published"
      );
      expect(readLoadedActionRecord(context)).toEqual(original);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    "dispatch",
    "profile",
  ])("rejects expired new actions and guards receipt recovery against %s changes", async (identity) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const context = createTestContext([], { ttlMs: 1000 });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "openmeld-test", version: "1.0.0" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      clock.mockReturnValue(context.expiresAtMs + 1);
      const rejected = await client.callTool({
        name: "reply",
        arguments: { message: "Too late." },
      });
      expect(rejected.isError).toBe(true);
      expect(rejected.structuredContent).toMatchObject({
        receipt: { reasonCode: "space_action.context_expired" },
      });
      expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");

      clock.mockReturnValue(context.expiresAtMs - 1);
      const request = {
        name: "reply",
        arguments: { message: "Saved before expiry." },
      };
      await client.callTool(request);
      const original = readLoadedActionRecord(context);
      clock.mockReturnValue(context.expiresAtMs + 1);
      vi.stubEnv(
        OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
        DISPATCH_OWNED_RUNTIME_MODE
      );
      vi.stubEnv(
        OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV,
        identity === "dispatch" ? "other-dispatch" : context.dispatchId
      );
      vi.stubEnv(
        OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV,
        identity === "profile" ? "other-profile" : context.targetProfileId
      );
      const mismatched = await client.callTool(request);
      expect(mismatched.isError).toBe(true);
      expect(mismatched.structuredContent).toMatchObject({
        receipt: { reasonCode: "space_action.context_mismatch" },
      });
      expect(readLoadedActionRecord(context)).toEqual(original);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    "invalid-json",
    "wrong-nonce",
    "recorded-after-expiry",
  ])("preserves an unreadable prior record and returns outcome_unknown: %s", async (failure) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const context = createTestContext([], { ttlMs: 1000 });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "openmeld-test", version: "1.0.0" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const request = { name: "reply", arguments: { message: "Saved reply." } };
      await client.callTool(request);
      const original = readLoadedActionRecord(context);
      const damaged =
        failure === "invalid-json"
          ? "{"
          : JSON.stringify({
              ...original,
              ...(failure === "wrong-nonce"
                ? { nonce: "other-context-nonce" }
                : { createdAtMs: context.expiresAtMs + 1 }),
            });
      writeFileSync(context.actionRecordPath, damaged);
      clock.mockReturnValue(context.expiresAtMs + 1);

      const result = await client.callTool(request);
      expect(result.isError).toBe(true);
      expect(
        dispatchSpaceActionToolResultSchema.parse(result.structuredContent)
      ).toEqual({
        receipt: {
          status: "outcome_unknown",
          reasonCode: "space_action.recording_outcome_unknown",
          coordinatorAcceptance: "unconfirmed",
          publication: "unconfirmed",
        },
      });
      expect(readFileSync(context.actionRecordPath, "utf8")).toBe(damaged);
      expect(JSON.stringify(result)).not.toContain(context.nonce);
      expect(JSON.stringify(result.content)).not.toContain(
        "Nothing was recorded or published"
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("dispatch-owned native Space tools", () => {
  it("refuses another sender and an expired Wake before making any DM request", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const context = createTestContext([], { ttlMs: 1000 });
    const fetch = vi.spyOn(globalThis, "fetch");
    const request = { targetProfileId: HUMAN_PROFILE_ID };
    await expect(
      openDirectMessage({ request, profile: AGENT_PROFILE_ID_TWO })
    ).rejects.toThrow("selected profile must match");
    clock.mockReturnValue(context.expiresAtMs + 1);
    await expect(openDirectMessage({ request })).rejects.toThrow(
      "dispatch context has expired"
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
  });
  it("rejects invalid DM input without ending the current Wake", async () => {
    const context = createTestContext([]);
    const tools = createDispatchSpaceTools({ env: { ...process.env } });
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "open_direct_message"
    );
    const result = await tools.call("open_direct_message", {
      targetProfileId: HUMAN_PROFILE_ID,
      message: { clientMessageId: "not-a-uuid", text: "Hello", wake: false },
    });
    expect(result.isError).toBe(true);
    const unpinnedWake = await tools.call("open_direct_message", {
      targetProfileId: AGENT_PROFILE_ID_TWO,
      message: {
        clientMessageId: "22222222-2222-4222-8222-222222222222",
        text: "Please review this.",
        wake: true,
      },
    });
    expect(unpinnedWake.isError).toBe(true);
    expect(JSON.stringify(unpinnedWake.content)).toContain("spaceId");
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
    await tools.call("reply", { message: "The current task is complete." });
    expect(readLoadedActionRecord(context).action).toMatchObject({
      messageEnvelope: { text: "The current task is complete." },
    });
    tools.close();
  });
  it("reports non-final public progress without recording a final action", async () => {
    const context = createTestContext([]);
    const reportProgress = vi
      .fn()
      .mockResolvedValueOnce({ status: "accepted" as const })
      .mockResolvedValueOnce({ status: "duplicate" as const });
    const tools = createDispatchSpaceTools({
      env: {
        ...process.env,
        [OPENMELD_DISPATCH_RUNTIME_MODE_ENV]: DISPATCH_OWNED_RUNTIME_MODE,
        [OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]: context.dispatchId,
        [OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]:
          context.targetProfileId,
      },
      reportProgress,
    });

    expect(tools.tools.map((tool) => tool.name)).toContain("report_progress");
    const first = await tools.call("report_progress", {
      update: "Confirmed the root cause; starting verification.",
    });
    const retry = await tools.call("report_progress", {
      update: "Confirmed the root cause; starting verification.",
    });

    expect(first.content).toEqual([
      { type: "text", text: '{"status":"accepted"}' },
    ]);
    expect(retry.content).toEqual([
      { type: "text", text: '{"status":"duplicate"}' },
    ]);
    expect(reportProgress).toHaveBeenCalledTimes(2);
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
    tools.close();
  });

  it("keeps concurrent Wake capabilities bound to their own context and closes old invocations", async () => {
    const first = createTestContext([], { targetProfileId: "agt_first" });
    const toolsA = createDispatchSpaceTools({ env: { ...process.env } });
    const second = createTestContext([], { targetProfileId: "agt_second" });
    const toolsB = createDispatchSpaceTools({ env: { ...process.env } });
    await toolsA.call("reply", { message: "First Wake reply." });
    await toolsB.call("reply", { message: "Second Wake reply." });
    expect(readLoadedActionRecord(first).action).toMatchObject({
      messageEnvelope: { text: "First Wake reply." },
    });
    expect(readLoadedActionRecord(second).action).toMatchObject({
      messageEnvelope: { text: "Second Wake reply." },
    });
    toolsA.close();
    const late = await toolsA.call("reply", { message: "First Wake reply." });
    expect(late.structuredContent).toMatchObject({
      receipt: { status: "rejected_closed" },
    });
    expect(readLoadedActionRecord(second).action).toMatchObject({
      messageEnvelope: { text: "Second Wake reply." },
    });
    toolsB.close();
  });

  it("corrects invalid native arguments before recording and recovers a lost receipt without another write", async () => {
    const context = createTestContext([]);
    const tools = createDispatchSpaceTools();
    const invalid = await tools.call("reply", { message: 42 });
    expect(invalid.structuredContent).toMatchObject({
      receipt: {
        status: "rejected_before_recording",
        reasonCode: "space_action.invalid_input",
      },
    });
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
    const saved = await tools.call("reply", {
      message: "I cannot access the repository.",
    });
    const bytes = readFileSync(context.actionRecordPath, "utf8");
    const recovered = await tools.call("read_receipt", {});
    expect(recovered.structuredContent).toEqual(saved.structuredContent);
    expect(readFileSync(context.actionRecordPath, "utf8")).toBe(bytes);
    tools.close();
  });

  it("restricts missing-action correction to delivery and does not grant legacy status-only permission", async () => {
    const context = createTestContext([], { allowedActions: ["post_status"] });
    const tools = createDispatchSpaceTools({
      env: { ...process.env, OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" },
    });
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "reply",
      "stay_silent",
      "read_receipt",
    ]);
    for (const [name, args] of [
      ["reply", { message: "Must not be published." }],
      ["stay_silent", { reason: "Must not change the policy." }],
      ["create_task", { title: "Must not run business work." }],
      ["status", { status: "done", text: "Retired." }],
    ] as const) {
      const denied = await tools.call(name, args);
      expect(denied.structuredContent).toMatchObject({
        receipt: {
          status: "rejected_before_recording",
          reasonCode: "space_action.not_allowed",
        },
      });
    }
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
    tools.close();
  });
});

function createTestContext(
  projection: SpaceMemberDirectorySendTargetEntry[],
  options?: {
    ttlMs?: number;
    targetProfileId?: string;
    allowedActions?: ("post_message" | "post_status" | "stay_silent")[];
  }
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
      allowedActions: options?.allowedActions ?? [
        "post_message",
        "post_status",
        "stay_silent",
      ],
      publicationMode: "collaboration",
    },
    spaceId: "space-1",
    targetProfileId: options?.targetProfileId ?? "agt_current",
    taskId: "task-1",
    ...(options?.ttlMs ? { ttlMs: options.ttlMs } : {}),
  });
  process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] = contextPath;
  process.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] = DISPATCH_OWNED_RUNTIME_MODE;
  process.env[OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV] = context.dispatchId;
  process.env[OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV] =
    context.targetProfileId;
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return context;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
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
