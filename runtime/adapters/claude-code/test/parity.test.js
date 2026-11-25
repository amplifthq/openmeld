import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDispatchSpaceActionMcpToolIds } from "@openmeld/adapter-core";
import { OPENMELD_CLAUDE_ALLOWED_TOOLS } from "../dist/transport/claude-permission-policy.js";

const AUTH_RE = /Not logged in/i;
const QUOTA_RE = /insufficient_quota/i;
const RATE_LIMIT_RE = /rate limit/i;
const SIGTERM_RE = /SIGTERM/;
const ORGANIZATION_ACCESS_RE = /organization has disabled Claude Code/i;
const SUBSCRIPTION_ACCESS_UNAVAILABLE_RE =
  /subscription access is unavailable/i;
const SUBSCRIPTION_DISABLED_RE = /subscription is disabled/i;
const CLAUDE_SDK_ENTRY_RE = /claude-sdk-entry\.mjs/;
const CLAUDE_PERMISSION_DENIED_RE = /permission for this tool use was denied/i;
const RUNTIME_PERMISSION_DENIAL_COPY =
  "The requested action was blocked by the Agent Profile’s permission settings. Review its permissions and choose a less restrictive mode only if you trust the access it grants, then wake the agent again.";
const createRuntimeContext = (
  providerRuntimeWorkingDirectory = process.cwd()
) => ({
  providerRuntimeWorkingDirectory,
});
const createNodeScriptLaunchContract = (scriptPath) => ({
  kind: "node_script",
  nodePath: process.execPath,
  scriptPath,
});

const validateClaudeTelemetry = (telemetry, input) => {
  if (!telemetry || typeof telemetry !== "object") {
    throw new Error("Expected claude telemetry to be an object");
  }

  const {
    completedAtMs,
    contextHealed,
    firstOutputAtMs,
    firstStdoutAtMs,
    invokedAtMs,
    previewEmitted,
    resumedContext,
    streamingMode,
  } = telemetry;

  if (typeof invokedAtMs !== "number") {
    throw new Error("Expected invokedAtMs to be a number");
  }

  if (typeof firstStdoutAtMs !== "number") {
    throw new Error("Expected firstStdoutAtMs to be a number");
  }

  if (typeof firstOutputAtMs !== "number") {
    throw new Error("Expected firstOutputAtMs to be a number");
  }

  if (typeof completedAtMs !== "number") {
    throw new Error("Expected completedAtMs to be a number");
  }

  if ("previewEmitted" in input && previewEmitted !== input.previewEmitted) {
    throw new Error("Expected previewEmitted to match fixture expectation");
  }

  if ("streamingMode" in input && streamingMode !== input.streamingMode) {
    throw new Error("Expected streamingMode to match fixture expectation");
  }

  if (resumedContext !== input.resumedContext) {
    throw new Error("Expected resumedContext to match fixture expectation");
  }

  if (firstStdoutAtMs < invokedAtMs) {
    throw new Error("Expected firstStdoutAtMs to be after invokedAtMs");
  }

  if (firstOutputAtMs < firstStdoutAtMs) {
    throw new Error("Expected firstOutputAtMs to be after firstStdoutAtMs");
  }

  if (completedAtMs < firstOutputAtMs) {
    throw new Error("Expected completedAtMs to be after firstOutputAtMs");
  }

  if ("contextHealed" in input) {
    if (contextHealed !== input.contextHealed) {
      throw new Error("Expected contextHealed to match fixture expectation");
    }
    return;
  }

  if (contextHealed !== undefined) {
    throw new Error("Expected contextHealed to be undefined");
  }
};

const createFakeClaudeAgentQueryFactory = (input) => {
  const captured = input.captured ?? {};
  return ({ options, prompt }) => {
    captured.options = options;
    let closed = false;
    const runtime = (async function* () {
      captured.promptMessages = [];
      // The SDK consumes input concurrently with output. A live prompt stream
      // stays open until the native result; draining it first would deadlock.
      const first = await prompt[Symbol.asyncIterator]().next();
      if (!first.done) {
        captured.promptMessages.push(first.value);
      }
      const interruptPromise = input.waitForInterrupt
        ? new Promise((resolve) => {
            captured.resolveInterrupt = resolve;
          })
        : null;
      await input.onStarted?.();
      if (interruptPromise) {
        await interruptPromise;
      }
      if (input.onBeforeMessages) {
        await input.onBeforeMessages({ options });
      }
      for (const [messageIndex, message] of input.messages.entries()) {
        yield message;
        await input.onAfterMessage?.({
          message,
          messageIndex,
          options,
        });
      }
    })();
    return Object.assign(runtime, {
      close: () => {
        closed = true;
        captured.closed = true;
        captured.resolveInterrupt?.();
        captured.resolveInterruptResult?.();
      },
      initializationResult: () => Promise.resolve({}),
      interrupt: () => {
        captured.interrupted = true;
        if (input.interruptWaitsForClose) {
          return new Promise((resolve) => {
            captured.resolveInterruptResult = resolve;
          });
        }
        if (input.interruptError) {
          throw input.interruptError;
        }
        captured.resolveInterrupt?.();
        return Promise.resolve();
      },
      setMaxThinkingTokens: () => Promise.resolve(),
      setModel: () => Promise.resolve(),
      setPermissionMode: (permissionMode) => {
        captured.permissionModes = [
          ...(captured.permissionModes ?? []),
          permissionMode,
        ];
        return Promise.resolve();
      },
      get closed() {
        return closed;
      },
    });
  };
};

test("claude cli transport maps denied tool-use result to public runtime permission copy", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-cli-dispatch-"));
  const fixturePath = join(fixtureDir, "claude-fixture-permission.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({",
      "  type: 'result',",
      "  subtype: 'error',",
      "  is_error: true,",
      "  result: 'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task.',",
      "  session_id: 'claude-permission-session-1'",
      "}));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: dispatchDir,
        prompt: "edit a denied file",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, CLAUDE_PERMISSION_DENIED_RE);
        assert.equal(
          resolveMappedPublicAgentFailureReason(error.code),
          RUNTIME_PERMISSION_DENIAL_COPY
        );
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter applies a saved permission mode to an active Agent SDK query", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const captured = {};
  let markStarted;
  let releaseQuery;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const queryReleased = new Promise((resolve) => {
    releaseQuery = resolve;
  });

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [],
        onBeforeMessages: async () => {
          await queryReleased;
        },
        onStarted: () => {
          markStarted();
        },
      }),
    });
    const dispatchPromise = adapter.dispatch({
      agentId: "agt-live-permission-mode",
      agentControllerPermissionMode: "claude-code:default",
      prompt: "review this repository",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-live-permission-mode",
      spaceId: "space-1",
      taskId: "task-live-permission-mode",
    });

    await started;
    try {
      const result = await adapter.updatePermissionMode({
        agentControllerPermissionMode: "claude-code:auto",
        taskId: "task-live-permission-mode",
      });

      assert.deepEqual(result, {
        effectiveFrom: "subsequent_tool_requests",
        status: "applied",
        taskId: "task-live-permission-mode",
      });
      assert.deepEqual(captured.permissionModes, ["auto"]);
    } finally {
      releaseQuery();
      await dispatchPromise;
    }
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("Claude SDK dispatch reports its actual process tree through cleanup", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const directory = await mkdtemp(join(tmpdir(), "claude-sdk-owned-process-"));
  const scriptPath = join(directory, "controller.mjs");
  const events = [];
  await writeFile(scriptPath, "process.stdin.resume();\n");
  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath,
      },
      registerRuntimeProcess: (event) => events.push(event),
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured: {},
        onBeforeMessages: async ({ options }) => {
          const child = options.spawnClaudeCodeProcess({
            command: options.pathToClaudeCodeExecutable,
            args: [],
            cwd: directory,
            env: process.env,
            signal: options.abortController.signal,
          });
          assert.equal(events[0]?.phase, "process_spawned");
          assert.equal(events[0]?.taskId, "sdk-owned-process");
          const exited = new Promise((resolve, reject) => {
            child.once("exit", resolve);
            child.once("error", reject);
          });
          child.stdin.end();
          await exited;
        },
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "Done",
            session_id: "owned-session",
          },
        ],
      }),
    });
    await adapter.dispatch({
      agentId: "owned-agent",
      prompt: "Complete the task",
      runtimeContext: createRuntimeContext(directory),
      sourceEventId: "owned-source",
      spaceId: "owned-space",
      taskId: "sdk-owned-process",
    });
    assert.equal(events.length, 2);
    assert.equal(typeof events[0].processId, "number");
    assert.deepEqual(events[1], { ...events[0], phase: "process_exit" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("claude adapter keeps temporary Plan mode for an active repair query", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const captured = {};
  let markStarted;
  let releaseQuery;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const queryReleased = new Promise((resolve) => {
    releaseQuery = resolve;
  });

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [],
        onBeforeMessages: async () => {
          await queryReleased;
        },
        onStarted: () => {
          markStarted();
        },
      }),
    });
    const dispatchPromise = adapter.dispatch({
      agentControllerConversationId: "claude-repair-session",
      agentControllerPermissionMode: "claude-code:default",
      agentId: "agt-repair-permission-mode",
      executionMode: "repair",
      prompt: "repair a structured Space action",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-repair-permission-mode",
      spaceId: "space-1",
      taskId: "task-repair-permission-mode",
    });

    await started;
    try {
      const result = await adapter.updatePermissionMode({
        agentControllerPermissionMode: "claude-code:auto",
        taskId: "task-repair-permission-mode",
      });

      assert.deepEqual(result, {
        reasonCode: "adapter.permission_mode_update_unsupported",
        status: "not_applied",
        taskId: "task-repair-permission-mode",
      });
      assert.deepEqual(captured.permissionModes ?? [], []);
    } finally {
      releaseQuery();
      await dispatchPromise;
    }
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter force cancel closes active Agent SDK query when interrupt reports query closure", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-sdk-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const fixturePath = join(fixtureDir, "claude-sdk-entry.mjs");
  const captured = {};
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--version')) {",
      "  console.log('Claude Code 2.0.0');",
      "  process.exit(0);",
      "}",
      "throw new Error('The SDK test should not execute this fixture directly.');",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        interruptError: new Error("Query closed before response received"),
        messages: [],
        onStarted: () => {
          markStarted();
        },
        waitForInterrupt: true,
      }),
    });

    const dispatchPromise = adapter.dispatch({
      agentId: "agt-sdk",
      prompt: "sleep until cancelled",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk-cancel",
      spaceId: "space-sdk",
      taskId: "task-sdk-cancel",
      transportMode: "local-cli",
    });
    await started;

    const cancelResult = await adapter.cancel({
      reason: "Stopped from OpenMeld Web.",
      taskId: "task-sdk-cancel",
    });

    assert.equal(cancelResult.accepted, true);
    assert.equal(cancelResult.deliveryPath, "force_interrupt_fallback");
    assert.equal(cancelResult.reasonCode, "accepted");
    assert.equal(cancelResult.signalDelivery, "sent");
    assert.equal(captured.interrupted, true);
    assert.equal(captured.closed, true);

    const dispatchResult = await dispatchPromise;
    assert.equal(dispatchResult.status, "failed");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter force cancel closes before waiting for Agent SDK interrupt", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-sdk-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const fixturePath = join(fixtureDir, "claude-sdk-entry.mjs");
  const captured = {};
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--version')) {",
      "  console.log('Claude Code 2.0.0');",
      "  process.exit(0);",
      "}",
      "throw new Error('The SDK test should not execute this fixture directly.');",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        interruptWaitsForClose: true,
        messages: [],
        onStarted: () => {
          markStarted();
        },
        waitForInterrupt: true,
      }),
    });

    const dispatchPromise = adapter.dispatch({
      agentId: "agt-sdk",
      prompt: "stop before the provider can finish",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk-cancel",
      spaceId: "space-sdk",
      taskId: "task-sdk-cancel",
      transportMode: "local-cli",
    });
    await started;

    const cancelResult = await Promise.race([
      adapter.cancel({
        reason: "Stopped from OpenMeld Web.",
        taskId: "task-sdk-cancel",
      }),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Claude force cancel waited for interrupt.")),
          100
        );
      }),
    ]);

    assert.equal(cancelResult.accepted, true);
    assert.equal(cancelResult.deliveryPath, "force_interrupt_fallback");
    assert.equal(cancelResult.reasonCode, "accepted");
    assert.equal(cancelResult.signalDelivery, "sent");
    assert.equal(captured.interrupted, true);
    assert.equal(captured.closed, true);

    const dispatchResult = await dispatchPromise;
    assert.equal(dispatchResult.status, "failed");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter dispatch uses the Agent SDK transport by default", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-sdk-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const fixturePath = join(fixtureDir, "claude-sdk-entry.mjs");
  const captured = {};
  const previews = [];

  const reasoning = [];

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--version')) {",
      "  console.log('Claude Code 2.0.0');",
      "  process.exit(0);",
      "}",
      "throw new Error('The SDK test should not execute this fixture directly.');",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "stream_event",
            event: { type: "message_start", message: { id: "msg-thinking" } },
            session_id: "sdk-session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "thinking_delta",
                thinking: "Checking the request",
              },
            },
            session_id: "sdk-session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "hello" },
            },
            session_id: "sdk-session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: " from sdk preview" },
            },
            session_id: "sdk-session-1",
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "hello from sdk preview",
            session_id: "sdk-session-1",
          },
        ],
        onBeforeMessages: async ({ options }) => {
          captured.wrapperText = await readFile(
            options.pathToClaudeCodeExecutable,
            "utf8"
          );
        },
      }),
    });

    const result = await adapter.dispatch({
      agentControllerConversationId: "existing-sdk-session",
      agentControllerPermissionMode: "claude-code:bypassPermissions",
      agentId: "agt-sdk",
      conversationPolicy: {
        fallbackModel: "claude-fallback",
        model: "claude-primary",
        reasoningLevel: "xhigh",
      },
      env: {
        OPENMELD_SDK_TEST_ENV: "yes",
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: "/tmp/action/bin/openmeld-dev",
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      onPreview: (preview) => {
        previews.push(preview.text);
      },
      prompt: "hello sdk",
      onRuntimeEvent: (event) => {
        if (event.phase === "reasoning") {
          reasoning.push(event);
        }
      },
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk",
      spaceId: "space-1",
      streamingMode: "stream",
      taskId: "task-sdk",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "hello from sdk preview");
    assert.equal(reasoning.length, 1);
    assert.equal(reasoning[0].blockId, "msg-thinking:0");
    assert.equal(reasoning[0].text, "Checking the request");
    assert.deepEqual(result.contextDelta, {
      agentControllerConversationId: "sdk-session-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationId: "sdk-session-1",
        agentControllerConversationKind: "session",
      },
    });
    assert.deepEqual(previews, ["hello", "hello from sdk preview"]);
    assert.equal(captured.options.cwd, dispatchDir);
    assert.deepEqual(captured.options.additionalDirectories, [dispatchDir]);
    assert.equal(captured.options.env.OPENMELD_SDK_TEST_ENV, "yes");
    assert.equal(typeof captured.options.env.PATH, "string");
    assert.deepEqual(captured.options.allowedTools, [
      ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
      ...buildDispatchSpaceActionMcpToolIds("__").map(
        (toolId) => `mcp__${toolId}`
      ),
    ]);
    assert.deepEqual(captured.options.mcpServers, {
      openmeld_internal_dispatch_space_action: {
        alwaysLoad: true,
        args: ["space", "action", "tool-server"],
        command: "/tmp/action/bin/openmeld-dev",
        env: {
          OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
          OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH:
            "/tmp/action/bin/openmeld-dev",
          OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
        },
      },
    });
    assert.equal(captured.options.permissionMode, "bypassPermissions");
    assert.equal(captured.options.allowDangerouslySkipPermissions, true);
    assert.equal(captured.options.resume, "existing-sdk-session");
    assert.equal(captured.options.model, "claude-primary");
    assert.equal(captured.options.fallbackModel, "claude-fallback");
    assert.equal(captured.options.effort, "xhigh");
    assert.equal(captured.options.includePartialMessages, true);
    assert.deepEqual(captured.options.systemPrompt, {
      append: "stable OpenMeld contract",
      excludeDynamicSections: true,
      preset: "claude_code",
      type: "preset",
    });
    assert.deepEqual(captured.options.settingSources, [
      "user",
      "project",
      "local",
    ]);
    assert.match(captured.wrapperText, CLAUDE_SDK_ENTRY_RE);
    assert.equal(captured.wrapperText.includes(process.execPath), true);
    assert.deepEqual(captured.promptMessages, [
      {
        message: {
          content: "current Wake only",
          role: "user",
        },
        parent_tool_use_id: null,
        type: "user",
      },
    ]);
    assert.equal(captured.closed, true);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude repair forks the Agent SDK session without replacing canonical continuity", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-repair-fixture-")
  );
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-repair-dispatch-")
  );
  const fixturePath = join(fixtureDir, "claude-sdk-entry.mjs");
  const captured = {};

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--version')) {",
      "  console.log('Claude Code 2.0.0');",
      "  process.exit(0);",
      "}",
      "throw new Error('The SDK test should not execute this fixture directly.');",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "recovered reply",
            session_id: "sdk-repair-fork-session",
          },
        ],
      }),
    });

    const result = await adapter.dispatch({
      agentControllerConversationId: "sdk-canonical-session",
      agentControllerPermissionMode: "claude-code:bypassPermissions",
      agentId: "agt-sdk-repair",
      executionMode: "repair",
      prompt: "recover the completed reply",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk-repair",
      spaceId: "space-sdk-repair",
      taskId: "task-sdk-repair",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "recovered reply");
    assert.equal(captured.options.resume, "sdk-canonical-session");
    assert.equal(captured.options.forkSession, true);
    assert.equal(captured.options.permissionMode, "plan");
    assert.equal(
      result.contextDelta?.agentControllerConversationId,
      "sdk-canonical-session"
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK waits for OpenMeld permission and applies session suggestions", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-permission-dispatch-")
  );
  const captured = {};
  const requests = [];
  const suggestions = [
    {
      behavior: "allow",
      destination: "session",
      rules: [{ ruleContent: "git push:*", toolName: "Bash" }],
      type: "addRules",
    },
  ];

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "permission granted",
            session_id: "sdk-permission-session",
          },
        ],
        onBeforeMessages: async ({ options }) => {
          captured.permissionResult = await options.canUseTool(
            "Bash",
            { command: "git push origin feature" },
            {
              description: "Claude needs network access for this command.",
              displayName: "Run command",
              signal: new AbortController().signal,
              suggestions,
              title: "Allow Claude to run this command?",
              toolUseID: "tool-use-permission-1",
            }
          );
        },
      }),
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          kind: "permission",
          optionId: request.options.find(
            (option) => option.intent === "allow_session"
          ).optionId,
        });
      },
      prompt: "push the branch",
      sessionId: null,
      taskId: "task-sdk-permission",
    });

    assert.deepEqual(requests, [
      {
        description: "Claude needs network access for this command.",
        kind: "permission",
        options: [
          {
            intent: "allow_once",
            label: "Allow once",
            optionId: "claude-permission-once",
          },
          {
            intent: "allow_session",
            label: "Allow for this session",
            optionId: "claude-permission-session",
          },
          {
            intent: "deny",
            label: "Deny",
            optionId: "claude-permission-deny",
          },
        ],
        subject: {
          command: "git push origin feature",
          type: "command",
        },
        title: "Allow Claude to run this command?",
      },
    ]);
    assert.deepEqual(captured.permissionResult, {
      behavior: "allow",
      toolUseID: "tool-use-permission-1",
      updatedInput: { command: "git push origin feature" },
      updatedPermissions: suggestions,
    });
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK publishes sanitized passive usage-limit evidence", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-usage-limits-dispatch-")
  );
  const runtimeEvents = [];

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        messages: [
          {
            rate_limit_info: {
              canUserPurchaseCredits: true,
              rateLimitType: "five_hour",
              resetsAt: 1_787_674_200,
              status: "allowed_warning",
              unifiedWindows: {
                five_hour: {
                  resetsAt: 1_787_674_200,
                  utilization: 0.28,
                },
                seven_day: {
                  resetsAt: 1_787_940_000,
                  utilization: 0.1,
                },
              },
            },
            session_id: "private-provider-session",
            type: "rate_limit_event",
            uuid: "private-provider-event",
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "completed",
            session_id: "sdk-usage-limits-session",
          },
        ],
      }),
      onRuntimeEvent: (event) => {
        runtimeEvents.push(event);
      },
      prompt: "continue the existing task",
      sessionId: null,
      taskId: "task-sdk-usage-limits",
    });

    const usageEvent = runtimeEvents.find(
      (event) => event.phase === "provider_usage_limits_observed"
    );
    assert.ok(usageEvent);
    assert.deepEqual(usageEvent.usageLimits, [
      {
        key: "claude-code:five-hour",
        label: "5-hour usage limit",
        observedAt: new Date(usageEvent.tsMs).toISOString(),
        resetsAt: "2026-08-25T16:10:00.000Z",
        status: "available",
        usedPercent: 28,
      },
      {
        key: "claude-code:seven-day",
        label: "Weekly usage limit",
        observedAt: new Date(usageEvent.tsMs).toISOString(),
        resetsAt: "2026-08-28T18:00:00.000Z",
        status: "available",
        usedPercent: 10,
      },
    ]);
    assert.equal(
      JSON.stringify(usageEvent).includes("private-provider"),
      false
    );
    assert.equal("canUserPurchaseCredits" in usageEvent, false);
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK releases and retries an aborted permission request", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-aborted-permission-dispatch-")
  );
  const captured = {};
  let requestCount = 0;

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "permission retried",
            session_id: "sdk-aborted-permission-session",
          },
        ],
        onBeforeMessages: async ({ options }) => {
          const abortController = new AbortController();
          const permissionOptions = {
            signal: abortController.signal,
            toolUseID: "tool-use-aborted-permission",
          };
          const first = options.canUseTool(
            "Bash",
            { command: "pnpm test" },
            permissionOptions
          );
          const duplicate = options.canUseTool(
            "Bash",
            { command: "pnpm test" },
            permissionOptions
          );
          assert.equal(first, duplicate);
          abortController.abort();
          captured.abortedPermissionResult = await first;
          captured.retriedPermissionResult = await options.canUseTool(
            "Bash",
            { command: "pnpm test" },
            {
              signal: new AbortController().signal,
              toolUseID: "tool-use-aborted-permission",
            }
          );
        },
      }),
      onInteractionRequest: (request) => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Promise(() => undefined);
        }
        return Promise.resolve({
          kind: "permission",
          optionId: request.options.find(
            (option) => option.intent === "allow_once"
          ).optionId,
        });
      },
      prompt: "run tests",
      sessionId: null,
      taskId: "task-sdk-aborted-permission",
    });

    assert.equal(requestCount, 2);
    assert.deepEqual(captured.abortedPermissionResult, {
      behavior: "deny",
      interrupt: true,
      message: "Cancelled because Claude stopped waiting for this response.",
      toolUseID: "tool-use-aborted-permission",
    });
    assert.deepEqual(captured.retriedPermissionResult, {
      behavior: "allow",
      toolUseID: "tool-use-aborted-permission",
      updatedInput: { command: "pnpm test" },
    });
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK returns user answers and plan feedback through canUseTool", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-question-dispatch-")
  );
  const captured = {};
  const requests = [];
  const questionInput = {
    questions: [
      {
        header: "Environment",
        multiSelect: false,
        options: [
          {
            description: "Use the local development lane.",
            label: "Localhost",
          },
          {
            description: "Use the production lane.",
            label: "Production",
          },
        ],
        question: "Where should I run the smoke test?",
      },
    ],
  };

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "plan revised",
            session_id: "sdk-question-session",
          },
        ],
        onBeforeMessages: async ({ options }) => {
          const permissionOptions = {
            signal: new AbortController().signal,
            toolUseID: "tool-use-question-1",
          };
          captured.questionResult = await options.canUseTool(
            "AskUserQuestion",
            questionInput,
            permissionOptions
          );
          captured.planResult = await options.canUseTool(
            "ExitPlanMode",
            { allowedPrompts: [] },
            {
              ...permissionOptions,
              toolUseID: "tool-use-plan-1",
            }
          );
          captured.elicitationResult = await options.onElicitation(
            {
              message: "Choose the deployment region.",
              mode: "form",
              requestedSchema: {
                properties: {
                  region: {
                    description: "Which region should the service use?",
                    enum: ["us-east-1", "us-west-2"],
                    title: "Region",
                    type: "string",
                  },
                },
                type: "object",
              },
              serverName: "deployment",
            },
            { signal: new AbortController().signal }
          );
        },
      }),
      onInteractionRequest: (request) => {
        requests.push(request);
        if (request.kind === "question") {
          return Promise.resolve({
            answers: [
              {
                questionId: request.questions[0].questionId,
                values: [request.questions[0].options[0].optionId],
              },
            ],
            kind: "question",
          });
        }
        return Promise.resolve({
          action: "request_changes",
          feedback: "Add a localhost smoke step.",
          kind: "plan_review",
        });
      },
      prompt: "plan and run smoke",
      sessionId: null,
      taskId: "task-sdk-question",
    });

    assert.equal(requests[0].kind, "question");
    assert.equal(requests[1].kind, "plan_review");
    assert.equal(requests[2].kind, "question");
    assert.deepEqual(captured.questionResult, {
      behavior: "allow",
      toolUseID: "tool-use-question-1",
      updatedInput: {
        ...questionInput,
        answers: {
          "Where should I run the smoke test?": "Localhost",
        },
      },
    });
    assert.deepEqual(captured.planResult, {
      behavior: "deny",
      interrupt: false,
      message: "Add a localhost smoke step.",
      toolUseID: "tool-use-plan-1",
    });
    assert.deepEqual(captured.elicitationResult, {
      action: "accept",
      content: {
        region: "us-east-1",
      },
    });
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK releases and retries an aborted MCP elicitation", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-aborted-elicitation-dispatch-")
  );
  const captured = {};
  let requestCount = 0;
  const elicitationRequest = {
    message: "Choose the deployment region.",
    mode: "form",
    requestedSchema: {
      properties: {
        region: {
          enum: ["us-east-1", "us-west-2"],
          type: "string",
        },
      },
      type: "object",
    },
    serverName: "deployment",
  };

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "elicitation retried",
            session_id: "sdk-aborted-elicitation-session",
          },
        ],
        onBeforeMessages: async ({ options }) => {
          const abortController = new AbortController();
          const first = options.onElicitation(elicitationRequest, {
            signal: abortController.signal,
          });
          const duplicate = options.onElicitation(elicitationRequest, {
            signal: abortController.signal,
          });
          assert.equal(first, duplicate);
          abortController.abort();
          captured.abortedElicitationResult = await first;
          captured.retriedElicitationResult = await options.onElicitation(
            elicitationRequest,
            { signal: new AbortController().signal }
          );
        },
      }),
      onInteractionRequest: (request) => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Promise(() => undefined);
        }
        return Promise.resolve({
          answers: [
            {
              questionId: request.questions[0].questionId,
              values: [request.questions[0].options[0].optionId],
            },
          ],
          kind: "question",
        });
      },
      prompt: "choose a deployment region",
      sessionId: null,
      taskId: "task-sdk-aborted-elicitation",
    });

    assert.equal(requestCount, 2);
    assert.deepEqual(captured.abortedElicitationResult, { action: "cancel" });
    assert.deepEqual(captured.retriedElicitationResult, {
      action: "accept",
      content: { region: "us-east-1" },
    });
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK presents streamed plan contents before ExitPlanMode resolves", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-plan-dispatch-")
  );
  const captured = {};
  const requests = [];

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            event: {
              delta: {
                text: "1. Inspect the runtime contract.\\n2. Run localhost smoke.",
                type: "text_delta",
              },
              type: "content_block_delta",
            },
            parent_tool_use_id: null,
            session_id: "sdk-plan-session",
            type: "stream_event",
            uuid: "plan-stream-message",
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "implementation complete",
            session_id: "sdk-plan-session",
          },
        ],
        onAfterMessage: async ({ messageIndex, options }) => {
          if (messageIndex !== 0) {
            return;
          }
          captured.planResult = await options.canUseTool(
            "ExitPlanMode",
            { allowedPrompts: [] },
            {
              signal: new AbortController().signal,
              toolUseID: "tool-use-plan-stream",
            }
          );
        },
      }),
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          action: "approve",
          kind: "plan_review",
        });
      },
      prompt: "plan and run smoke",
      sessionId: null,
      taskId: "task-sdk-plan",
    });

    assert.equal(captured.options.includePartialMessages, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, "plan_review");
    assert.equal(
      requests[0].plan,
      "1. Inspect the runtime contract.\\n2. Run localhost smoke."
    );
    assert.deepEqual(captured.planResult, {
      behavior: "allow",
      toolUseID: "tool-use-plan-stream",
    });
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK presents a plan captured from the Write tool instead of transition text", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-written-plan-dispatch-")
  );
  const captured = {};
  const requests = [];
  const plan = [
    "## Plan",
    "",
    "1. Add the interaction contract.",
    "2. Verify the localhost approval flow.",
  ].join("\n");

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "assistant",
            error: null,
            message: {
              content: [
                {
                  text: "The plan is written. Now I'll call ExitPlanMode.",
                  type: "text",
                },
                {
                  id: "tool-use-write-plan",
                  input: {
                    content: plan,
                    file_path: "/tmp/.claude/plans/hitl-smoke.md",
                  },
                  name: "Write",
                  type: "tool_use",
                },
              ],
              role: "assistant",
            },
            parent_tool_use_id: null,
            session_id: "sdk-written-plan-session",
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "implementation complete",
            session_id: "sdk-written-plan-session",
          },
        ],
        onAfterMessage: async ({ messageIndex, options }) => {
          if (messageIndex !== 0) {
            return;
          }
          captured.planResult = await options.canUseTool(
            "ExitPlanMode",
            { allowedPrompts: [] },
            {
              signal: new AbortController().signal,
              toolUseID: "tool-use-written-plan",
            }
          );
        },
      }),
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          action: "approve",
          kind: "plan_review",
        });
      },
      prompt: "plan the interaction work",
      sessionId: null,
      taskId: "task-sdk-written-plan",
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, "plan_review");
    assert.equal(requests[0].plan, plan);
    assert.deepEqual(captured.planResult, {
      behavior: "allow",
      toolUseID: "tool-use-written-plan",
    });
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude Agent SDK presents a plan from its isolated internal plan directory", async () => {
  const { invokeClaudeAgentSdkTransport } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "claude-sdk-internal-plan-dispatch-")
  );
  const captured = {};
  const requests = [];
  const plan = [
    "# Plan",
    "",
    "1. Inspect README.md for the health-check section.",
    "2. Add and verify the health-check note after approval.",
  ].join("\n");

  try {
    await invokeClaudeAgentSdkTransport({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      claudeWorkdir: dispatchDir,
      createQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "assistant",
            error: null,
            message: {
              content: [
                {
                  text: "Claude has finished planning and is ready to proceed.",
                  type: "text",
                },
              ],
              role: "assistant",
            },
            parent_tool_use_id: null,
            session_id: "sdk-internal-plan-session",
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "implementation complete",
            session_id: "sdk-internal-plan-session",
          },
        ],
        onBeforeMessages: async ({ options }) => {
          assert.equal(typeof options.settings, "object");
          assert.equal(typeof options.settings.plansDirectory, "string");
          captured.planDirectory = join(
            dispatchDir,
            options.settings.plansDirectory
          );
          await writeFile(
            join(captured.planDirectory, "plan.md"),
            plan,
            "utf8"
          );
        },
        onAfterMessage: async ({ messageIndex, options }) => {
          if (messageIndex !== 0) {
            return;
          }
          captured.planResult = await options.canUseTool(
            "ExitPlanMode",
            { allowedPrompts: [] },
            {
              signal: new AbortController().signal,
              toolUseID: "tool-use-internal-plan",
            }
          );
        },
      }),
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          action: "approve",
          kind: "plan_review",
        });
      },
      prompt: "plan the README health-check note",
      sessionId: null,
      taskId: "task-sdk-internal-plan",
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, "plan_review");
    assert.equal(requests[0].plan, plan);
    assert.deepEqual(captured.planResult, {
      behavior: "allow",
      toolUseID: "tool-use-internal-plan",
    });
    await assert.rejects(stat(captured.planDirectory), { code: "ENOENT" });
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter omits duplicate Agent SDK fallback model", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const captured = {};

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "ok",
            session_id: "sdk-session-duplicate-fallback",
          },
        ],
      }),
    });

    const result = await adapter.dispatch({
      agentId: "agt-sdk-duplicate-fallback",
      conversationPolicy: {
        fallbackModel: "claude-opus-4-8",
        model: "claude-opus-4-8",
      },
      prompt: "hello sdk",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk-duplicate-fallback",
      spaceId: "space-1",
      taskId: "task-sdk-duplicate-fallback",
    });

    assert.equal(result.status, "success");
    assert.equal(captured.options.model, "claude-opus-4-8");
    assert.equal(captured.options.fallbackModel, undefined);
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter interrupt targets the active Agent SDK query", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const captured = {};
  let queryStarted;
  const queryStartedPromise = new Promise((resolve) => {
    queryStarted = resolve;
  });
  const adapter = createClaudeCodeAdapter({
    launchContract: {
      kind: "executable",
      commandPath: process.execPath,
    },
    claudeTimeoutMs: 5000,
    createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
      captured,
      messages: [
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "interrupted cleanly",
          session_id: "sdk-interrupt-session",
        },
      ],
      onStarted: () => {
        queryStarted();
      },
      waitForInterrupt: true,
    }),
  });

  const dispatchPromise = adapter.dispatch({
    agentId: "agt-sdk-interrupt",
    prompt: "hello",
    runtimeContext: createRuntimeContext(process.cwd()),
    sourceEventId: "evt-sdk-interrupt",
    spaceId: "space-1",
    taskId: "task-sdk-interrupt",
  });
  await queryStartedPromise;

  const interruptResult = await adapter.interrupt({
    mode: "force",
    taskId: "task-sdk-interrupt",
  });
  const dispatchResult = await dispatchPromise;

  assert.equal(interruptResult.accepted, true);
  assert.equal(captured.interrupted, true);
  assert.equal(captured.closed, true);
  assert.equal(dispatchResult.status, "success");
  assert.equal(dispatchResult.output, "interrupted cleanly");
});

test("claude adapter dispatch uses dispatch-time runtime context for spawn cwd", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-dispatch-"));
  const fixturePath = join(fixtureDir, "claude-fixture-runtime-cwd.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: process.cwd(), session_id: 'session-runtime-cwd-1' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeTransport: "cli",
    });

    const result = await adapter.dispatch({
      agentId: "agt-demo",
      prompt: "hello",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-runtime-cwd-1",
      spaceId: "space-1",
      taskId: "task-runtime-cwd-1",
    });

    const expectedDispatchDir = await realpath(dispatchDir);
    assert.equal(result.status, "success");
    assert.equal(result.output, expectedDispatchDir);
    assert.deepEqual(result.contextDelta, {
      agentControllerConversationId: "session-runtime-cwd-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationId: "session-runtime-cwd-1",
        agentControllerConversationKind: "session",
      },
    });
    validateClaudeTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "final",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter keeps runtime cwd isolated across different profiles on the same controller", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const profileADir = await mkdtemp(join(tmpdir(), "claude-profile-a-"));
  const profileBDir = await mkdtemp(join(tmpdir(), "claude-profile-b-"));
  const fixturePath = join(fixtureDir, "claude-fixture-profile-isolation.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const profileName = process.cwd().split('/').filter(Boolean).at(-1) ?? 'unknown';",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: process.cwd(), session_id: 'session-' + profileName }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeTransport: "cli",
    });

    const resultA = await adapter.dispatch({
      agentId: "agt-profile-a",
      prompt: "hello from profile a",
      runtimeContext: createRuntimeContext(profileADir),
      sourceEventId: "evt-profile-a",
      spaceId: "space-1",
      taskId: "task-profile-a",
    });
    const resultB = await adapter.dispatch({
      agentId: "agt-profile-b",
      prompt: "hello from profile b",
      runtimeContext: createRuntimeContext(profileBDir),
      sourceEventId: "evt-profile-b",
      spaceId: "space-1",
      taskId: "task-profile-b",
    });

    const expectedProfileADir = await realpath(profileADir);
    const expectedProfileBDir = await realpath(profileBDir);
    assert.equal(resultA.status, "success");
    assert.equal(resultB.status, "success");
    assert.equal(resultA.output, expectedProfileADir);
    assert.equal(resultB.output, expectedProfileBDir);
    assert.notEqual(resultA.output, resultB.output);
    assert.equal(
      resultA.contextDelta?.agentControllerConversationId,
      `session-${expectedProfileADir.split("/").filter(Boolean).at(-1)}`
    );
    assert.equal(
      resultB.contextDelta?.agentControllerConversationId,
      `session-${expectedProfileBDir.split("/").filter(Boolean).at(-1)}`
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(profileADir, { force: true, recursive: true });
    await rm(profileBDir, { force: true, recursive: true });
  }
});

test("claude cli transport parses successful result and session id", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-success.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'hello from claude', session_id: 'session-success-1' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeClaudeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeWorkdir: process.cwd(),
      prompt: "hello",
      sessionId: null,
    });

    assert.deepEqual(
      {
        output: result.output,
        sessionId: result.sessionId,
      },
      {
        output: "hello from claude",
        sessionId: "session-success-1",
      }
    );
    validateClaudeTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "final",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport completes when provider terminal output arrives before process exit", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-terminal-output.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'terminal claude output', session_id: 'session-terminal-output-1' }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeClaudeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 1000,
      claudeWorkdir: process.cwd(),
      prompt: "hello",
      sessionId: null,
    });

    assert.equal(result.output, "terminal claude output");
    assert.equal(result.sessionId, "session-terminal-output-1");
    assert.equal(result.telemetry.exitObservedAtMs, undefined);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport allows OpenMeld CLI tools in normal and streaming invocations", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const argsPath = join(fixtureDir, "claude-args.json");
  const fixturePath = join(fixtureDir, "claude-fixture-args.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) {",
      "  console.log('1.0.0');",
      "  process.exit(0);",
      "}",
      "const argsPath = process.env.OPENMELD_CLAUDE_ARGS_PATH;",
      "if (!argsPath) {",
      "  throw new Error('OPENMELD_CLAUDE_ARGS_PATH is required');",
      "}",
      "writeFileSync(argsPath, JSON.stringify(args));",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 'session-args-1' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await invokeClaudeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeWorkdir: process.cwd(),
      env: {
        OPENMELD_CLAUDE_ARGS_PATH: argsPath,
      },
      prompt: "hello",
      sessionId: null,
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-p",
      "hello",
      "--allowedTools",
      ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
      "--permission-mode",
      "default",
      "--output-format",
      "json",
    ]);

    await invokeClaudeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeWorkdir: process.cwd(),
      env: {
        OPENMELD_CLAUDE_ARGS_PATH: argsPath,
      },
      executionMode: "repair",
      prompt: "stream hello",
      sessionId: "session-existing-1",
      streamingMode: "stream",
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "--resume",
      "session-existing-1",
      "--fork-session",
      "-p",
      "stream hello",
      "--allowedTools",
      ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
      "--permission-mode",
      "plan",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
    ]);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude adapter dispatch forwards Agent Controller Permission Mode into CLI args", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-policy-args-"));
  const argsPath = join(fixtureDir, "claude-policy-args.json");
  const fixturePath = join(fixtureDir, "claude-fixture-policy-args.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) {",
      "  console.log('1.0.0');",
      "  process.exit(0);",
      "}",
      "const argsPath = process.env.OPENMELD_CLAUDE_ARGS_PATH;",
      "if (!argsPath) {",
      "  throw new Error('OPENMELD_CLAUDE_ARGS_PATH is required');",
      "}",
      "writeFileSync(argsPath, JSON.stringify(args));",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 'session-policy-1' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeTransport: "cli",
    });
    const result = await adapter.dispatch({
      agentControllerPermissionMode: "claude-code:auto",
      agentId: "agt-policy",
      env: {
        OPENMELD_CLAUDE_ARGS_PATH: argsPath,
      },
      prompt: "auto dispatch",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "evt-policy",
      spaceId: "space-1",
      taskId: "task-policy",
    });

    assert.equal(result.status, "success");
    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-p",
      "auto dispatch",
      "--allowedTools",
      ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
      "--permission-mode",
      "auto",
      "--output-format",
      "json",
    ]);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport emits preview snapshots in stream mode", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-stream-preview.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-stream-1' }));",
      "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'message_start' }, session_id: 'session-stream-1' }));",
      "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }, session_id: 'session-stream-1' }));",
      "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' from claude' } }, session_id: 'session-stream-1' }));",
      "console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' stream preview' } }, session_id: 'session-stream-1' }));",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'hello from claude stream preview', session_id: 'session-stream-1' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  const previews = [];

  try {
    const result = await invokeClaudeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeWorkdir: process.cwd(),
      onPreview: (preview) => {
        previews.push(preview.text);
      },
      prompt: "hello",
      sessionId: null,
      streamingMode: "stream",
    });

    assert.equal(result.output, "hello from claude stream preview");
    assert.deepEqual(previews, ["hello", "hello from claude stream preview"]);
    validateClaudeTelemetry(result.telemetry, {
      previewEmitted: true,
      resumedContext: false,
      streamingMode: "stream",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport forwards route env into the provider process", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-env.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const mode = process.env.OPENMELD_DISPATCH_RUNTIME_MODE || 'missing';",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'env:' + mode, session_id: 'session-env-1' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeClaudeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeWorkdir: process.cwd(),
      env: {
        OPENMELD_DISPATCH_RUNTIME_MODE: "dispatch-owned-runtime",
      },
      prompt: "hello",
      sessionId: null,
    });

    assert.equal(result.output, "env:dispatch-owned-runtime");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport ignores non-result session ids", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-non-result-session.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-should-not-be-used' }));",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'hello from claude without result session id' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeClaudeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeWorkdir: process.cwd(),
      prompt: "hello",
      sessionId: null,
    });

    assert.deepEqual(
      {
        output: result.output,
        sessionId: result.sessionId,
      },
      {
        output: "hello from claude without result session id",
        sessionId: null,
      }
    );
    validateClaudeTelemetry(result.telemetry, {
      resumedContext: false,
      previewEmitted: false,
      streamingMode: "final",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport maps not logged in failures to auth.required", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-auth.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in · Please run /login', session_id: 'session-auth-1' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "auth.required");
        assert.equal(error.errorType, "auth");
        assert.equal(error.originalError, "Not logged in · Please run /login");
        assert.match(error.message, AUTH_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport maps account and organization access failures to existing provider access codes", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");

  const organizationDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const organizationFixturePath = join(
    organizationDir,
    "claude-fixture-organization-access.mjs"
  );
  await writeFile(
    organizationFixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Your organization has disabled Claude Code access for this account.' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(organizationFixturePath, 0o755);

  const subscriptionDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const subscriptionFixturePath = join(
    subscriptionDir,
    "claude-fixture-subscription-access.mjs"
  );
  await writeFile(
    subscriptionFixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Claude Code subscription is disabled for this account.' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(subscriptionFixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(organizationFixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "auth.required");
        assert.equal(error.errorType, "auth");
        assert.match(error.message, ORGANIZATION_ACCESS_RE);
        assert.equal(
          error.originalError,
          "Your organization has disabled Claude Code access for this account."
        );
        assert.ok(error.providerAccessEvidence);
        assert.deepEqual(error.providerAccessEvidence, {
          observedAtMs: error.providerAccessEvidence.observedAtMs,
          provider: "claude-code",
          reasonCode: "provider_account.organization_access_disabled",
          source: "wake_failure",
        });
        assert.equal(
          Number.isInteger(error.providerAccessEvidence.observedAtMs),
          true
        );
        return true;
      }
    );

    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(subscriptionFixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "quota.exceeded");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, SUBSCRIPTION_DISABLED_RE);
        assert.equal(
          error.originalError,
          "Claude Code subscription is disabled for this account."
        );
        assert.ok(error.providerAccessEvidence);
        assert.deepEqual(error.providerAccessEvidence, {
          observedAtMs: error.providerAccessEvidence.observedAtMs,
          provider: "claude-code",
          reasonCode: "provider_account.subscription_access_unavailable",
          source: "wake_failure",
        });
        assert.equal(
          Number.isInteger(error.providerAccessEvidence.observedAtMs),
          true
        );
        return true;
      }
    );
  } finally {
    await rm(organizationDir, { force: true, recursive: true });
    await rm(subscriptionDir, { force: true, recursive: true });
  }
});

test("claude adapter dispatch preserves provider access evidence from real cli failures", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(
    fixtureDir,
    "claude-fixture-subscription-stderr.mjs"
  );

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--version')) {",
      "  console.log('Claude Code 1.0.0');",
      "  process.exit(0);",
      "}",
      "console.error('Claude Code subscription access is unavailable for this account.');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeTransport: "cli",
    });

    const result = await adapter.dispatch({
      agentId: "agt-provider-access",
      prompt: "hello",
      runtimeContext: createRuntimeContext(process.cwd()),
      sourceEventId: "evt-provider-access",
      spaceId: "space-1",
      taskId: "task-provider-access",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "quota.exceeded");
    assert.equal(result.errorType, "adapter");
    assert.match(result.errorMessage, SUBSCRIPTION_ACCESS_UNAVAILABLE_RE);
    assert.ok(result.providerAccessEvidence);
    assert.deepEqual(result.providerAccessEvidence, {
      observedAtMs: result.providerAccessEvidence.observedAtMs,
      provider: "claude-code",
      reasonCode: "provider_account.subscription_access_unavailable",
      source: "wake_failure",
    });
    assert.equal(
      Number.isInteger(result.providerAccessEvidence.observedAtMs),
      true
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport maps quota and rate-limit failures", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");

  const quotaDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const quotaFixturePath = join(quotaDir, "claude-fixture-quota.mjs");
  await writeFile(
    quotaFixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'insufficient_quota: You exceeded your current quota.' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(quotaFixturePath, 0o755);

  const rateDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const rateFixturePath = join(rateDir, "claude-fixture-rate.mjs");
  await writeFile(
    rateFixturePath,
    [
      "#!/usr/bin/env node",
      "console.error('429 Too Many Requests: rate limit exceeded');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(rateFixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(quotaFixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "quota.exceeded");
        assert.equal(error.errorType, "adapter");
        assert.equal(
          error.originalError,
          "insufficient_quota: You exceeded your current quota."
        );
        assert.match(error.message, QUOTA_RE);
        return true;
      }
    );

    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(rateFixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "rate_limited");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.originalError, undefined);
        assert.match(error.message, RATE_LIMIT_RE);
        return true;
      }
    );
  } finally {
    await rm(quotaDir, { force: true, recursive: true });
    await rm(rateDir, { force: true, recursive: true });
  }
});

test("claude preserves an unfamiliar structured failure without exposing diagnostic stderr", async () => {
  const { classifyClaudeFailure } = await import(
    "../dist/transport/claude-cli-transport.js"
  );
  const message =
    "The upstream service ended this request.\nReference: request-42.";
  const result = classifyClaudeFailure({
    providerErrorMessages: [message],
    providerOriginalErrorMessages: [message],
    stderrText: "stack: internal diagnostics",
  });
  assert.equal(result.originalError, message);
  assert.equal(result.providerAccessEvidence, undefined);
  const untrusted = classifyClaudeFailure({
    providerErrorMessages: [],
    stderrText: message,
  });
  assert.equal(untrusted.originalError, undefined);
});

test("claude invoke heals stale session by retrying once without resume", async () => {
  const { invokeClaudeWithSingleContextHeal } = await import(
    "../dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-heal.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const resumeIndex = args.indexOf('--resume');",
      "if (resumeIndex >= 0) {",
      "  const sessionId = args[resumeIndex + 1] ?? 'unknown';",
      "  console.error('No conversation found with session ID: ' + sessionId);",
      "  process.exit(1);",
      "}",
      "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'healed output', session_id: 'session-healed-1' }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  const contextLostEvents = [];

  try {
    const result = await invokeClaudeWithSingleContextHeal({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeTransport: "cli",
      claudeWorkdir: process.cwd(),
      onContextLost: () => {
        contextLostEvents.push("context-lost");
      },
      prompt: "hello",
      sessionId: "00000000-0000-0000-0000-000000000000",
    });

    assert.deepEqual(
      {
        contextHealed: result.contextHealed,
        output: result.output,
        sessionId: result.sessionId,
      },
      {
        contextHealed: true,
        output: "healed output",
        sessionId: "session-healed-1",
      }
    );
    validateClaudeTelemetry(result.telemetry, {
      contextHealed: true,
      previewEmitted: false,
      resumedContext: true,
      streamingMode: "final",
    });
    assert.deepEqual(contextLostEvents, ["context-lost"]);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude invoke returns context.rebuild_failed when retry also fails", async () => {
  const { invokeClaudeWithSingleContextHeal } = await import(
    "../dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-heal-fail.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.error('No conversation found with session ID: stale-session');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeWithSingleContextHeal({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        claudeTimeoutMs: 5000,
        claudeTransport: "cli",
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: "00000000-0000-0000-0000-000000000000",
      }),
      (error) => {
        assert.equal(error.code, "context.rebuild_failed");
        assert.equal(error.errorType, "adapter");
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude cli transport classifies timeout after output as timed_out_after_output", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(
    fixtureDir,
    "claude-fixture-timeout-after-output.mjs"
  );

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "process.stdout.write('partial stdout observed before timeout\\n');",
      "process.stderr.write('partial output observed before timeout\\n');",
      "setInterval(() => {",
      "  process.stdout.write('partial stdout observed before timeout\\n');",
      "}, 250);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        claudeTimeoutMs: 2500,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
        streamingMode: "stream",
      }),
      (error) => {
        assert.equal(error.code, "timed_out_after_output");
        assert.equal(error.errorType, "timeout");
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude adapter classifies an Agent SDK success-subtype result with is_error as auth.required instead of returning it as output", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const captured = {};

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "assistant",
            error: "authentication_failed",
            message: { content: [], role: "assistant" },
            parent_tool_use_id: null,
            session_id: "sdk-session-auth-expired",
          },
          {
            type: "result",
            subtype: "success",
            is_error: true,
            result:
              "Failed to authenticate: OAuth session expired and could not be refreshed",
            session_id: "sdk-session-auth-expired",
          },
        ],
      }),
    });

    const result = await adapter.dispatch({
      agentId: "agt-sdk-auth-expired",
      conversationPolicy: {
        model: "claude-sonnet-5",
        reasoningLevel: "high",
      },
      prompt: "what is the time and date",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk-auth-expired",
      spaceId: "space-1",
      taskId: "task-sdk-auth-expired",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "auth.required");
    assert.equal(result.errorType, "auth");
    assert.notEqual(
      result.errorMessage,
      "Failed to authenticate: OAuth session expired and could not be refreshed"
    );
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter classifies a success-subtype result with is_error and no assistant error code via message text", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));
  const captured = {};

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured,
        messages: [
          {
            type: "result",
            subtype: "success",
            is_error: true,
            result:
              "Failed to authenticate: OAuth session expired and could not be refreshed",
            session_id: "sdk-session-auth-expired-text-only",
          },
        ],
      }),
    });

    const result = await adapter.dispatch({
      agentId: "agt-sdk-auth-expired-text-only",
      prompt: "what is the time and date",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk-auth-expired-text-only",
      spaceId: "space-1",
      taskId: "task-sdk-auth-expired-text-only",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "auth.required");
    assert.equal(result.errorType, "auth");
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude adapter preserves Agent SDK telemetry when the query ends before a result", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-sdk-dispatch-"));

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      claudeTimeoutMs: 5000,
      createAgentSdkQuery: createFakeClaudeAgentQueryFactory({
        captured: {},
        messages: [],
      }),
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "existing-sdk-session",
      agentId: "agt-sdk-provider-exit",
      prompt: "continue",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-sdk-provider-exit",
      spaceId: "space-1",
      taskId: "task-sdk-provider-exit",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "provider_exit_error");
    assert.equal(result.telemetry.firstOutputAtMs, undefined);
    assert.equal(result.telemetry.resumedContext, true);
    assert.equal(result.telemetry.streamingMode, "final");
    assert.equal(typeof result.telemetry.invokedAtMs, "number");
    assert.equal(typeof result.telemetry.completedAtMs, "number");
    assert.ok(result.telemetry.completedAtMs >= result.telemetry.invokedAtMs);
  } finally {
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude cli transport classifies unclassified non-zero exit as provider_exit_error", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(
    fixtureDir,
    "claude-fixture-provider-exit-error.mjs"
  );

  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "process.exit(7);"].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "provider_exit_error");
        assert.equal(error.errorType, "adapter");
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("claude adapter preserves process telemetry for an unclassified exit before output", async () => {
  const { createClaudeCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "claude-dispatch-"));
  const fixturePath = join(
    fixtureDir,
    "claude-fixture-provider-exit-telemetry.mjs"
  );

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "if (process.argv.includes('--version')) {",
      "  console.log('Claude Code 2.0.0');",
      "  process.exit(0);",
      "}",
      "process.exit(7);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createClaudeCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      claudeTimeoutMs: 5000,
      claudeTransport: "cli",
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "existing-claude-session",
      agentId: "agt-provider-exit",
      prompt: "continue",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-provider-exit",
      spaceId: "space-1",
      taskId: "task-provider-exit",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "provider_exit_error");
    assert.equal(result.telemetry.exitCode, 7);
    assert.equal(result.telemetry.exitSignal, undefined);
    assert.equal(result.telemetry.firstOutputAtMs, undefined);
    assert.equal(result.telemetry.firstStdoutAtMs, undefined);
    assert.equal(result.telemetry.resumedContext, true);
    assert.equal(result.telemetry.streamingMode, "final");
    assert.equal(typeof result.telemetry.invokedAtMs, "number");
    assert.equal(typeof result.telemetry.processSpawnedAtMs, "number");
    assert.equal(typeof result.telemetry.exitObservedAtMs, "number");
    assert.equal(typeof result.telemetry.completedAtMs, "number");
    assert.ok(
      result.telemetry.completedAtMs >= result.telemetry.exitObservedAtMs
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("claude cli transport reports an externally terminated process explicitly", async () => {
  const { invokeClaudeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "claude-cli-fixture-"));
  const fixturePath = join(fixtureDir, "claude-fixture-process-terminated.mjs");

  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "process.kill(process.pid, 'SIGTERM');"].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeClaudeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        claudeTimeoutMs: 5000,
        claudeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "provider.process_terminated");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, SIGTERM_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});
