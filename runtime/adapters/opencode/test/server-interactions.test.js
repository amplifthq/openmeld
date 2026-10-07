import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const OPEN_CODE_SERVER_EXIT_PATTERN =
  /opencode serve exited before the turn completed/;

const createNodeScriptLaunchContract = (scriptPath) => ({
  kind: "node_script",
  nodePath: process.execPath,
  scriptPath,
});

const createRuntimeContext = (providerRuntimeWorkingDirectory) => ({
  providerRuntimeWorkingDirectory,
});

import { writeFakeOpenCodeServer } from "./fixtures/server-v1.js";

test("preserves the structured OpenCode error independently of diagnostic stderr", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  const message =
    "The upstream service ended this request.\nReference: request-42.";
  await withServerFixture(async ({ fixtureDir, fixturePath }) => {
    await assert.rejects(
      invokeOpenCodeServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 5000,
        openCodeWorkdir: fixtureDir,
        prompt: "reply",
        sessionId: null,
        env: {
          OPENMELD_FAKE_OPENCODE_SESSION_ERROR: message,
          OPENMELD_FAKE_OPENCODE_START_STDERR:
            "stack: private internal diagnostics",
        },
      }),
      (error) => {
        assert.equal(error.originalError, message);
        assert.equal(error.providerAccessEvidence, undefined);
        return true;
      }
    );
  });
});

async function readLog(logPath) {
  return (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function withServerFixture(callback) {
  const fixtureDir = await realpath(
    await mkdtemp(join(tmpdir(), "opencode-server-fixture-"))
  );
  const fixturePath = join(fixtureDir, "fake-opencode-server.mjs");
  const logPath = join(fixtureDir, "requests.jsonl");
  await writeFakeOpenCodeServer(fixturePath);
  try {
    await callback({ fixtureDir, fixturePath, logPath });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
}

test("OpenCode forks the native Session and applies the OpenMeld title", async () => {
  const { forkOpenCodeServerSession } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const result = await forkOpenCodeServerSession({
      env: { OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
      openCodeWorkdir: fixtureDir,
      sourceSessionId: "opencode-session-server",
      title: "OpenMeld · Release Agent",
    });
    const requests = await readLog(logPath);

    assert.equal(result.sessionId, "opencode-session-fork-1");
    assert.deepEqual(
      requests.find((request) => request.path?.endsWith("/fork")),
      {
        body: null,
        method: "POST",
        path: "/session/opencode-session-server/fork",
      }
    );
    assert.deepEqual(
      requests.find((request) => request.method === "PATCH"),
      {
        body: { title: "OpenMeld · Release Agent" },
        method: "PATCH",
        path: "/session/opencode-session-fork-1",
      }
    );
  });
});

test("OpenCode repair runs on a native fork without replacing canonical continuity", async () => {
  const { createOpenCodeAdapter } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createOpenCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "opencode-session-server",
      agentId: "opencode-repair",
      env: { OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath },
      executionMode: "repair",
      openCodePermission: { edit: "ask" },
      prompt: "recover the completed reply",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-opencode-repair",
      spaceId: "space-opencode-repair",
      taskId: "task-opencode-repair",
    });
    assert.equal(result.status, "success", JSON.stringify(result));
    assert.equal(result.output, "OpenCode server reply");
    assert.equal(
      result.contextDelta?.agentControllerConversationId,
      "opencode-session-server"
    );
    const requests = await readLog(logPath);
    assert.equal(requests[0]?.permission, '{"edit":"ask"}');
    assert.equal(
      requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/session/opencode-session-server/fork"
      ),
      true
    );
    assert.equal(
      requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/session/opencode-session-fork-1/prompt_async"
      ),
      true
    );
  });
});

test("OpenCode carries permission approval through its official server API", async () => {
  const { createOpenCodeAdapter } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const requests = [];
    const reasoningEvents = [];
    const openCodePermission = {
      edit: "ask",
    };
    const adapter = createOpenCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
    });
    const result = await adapter.dispatch({
      agentId: "opencode",
      conversationPolicy: {
        model: "openai/gpt-5.4",
        reasoningLevel: "high",
      },
      env: {
        OPENMELD_FAKE_OPENCODE_INTERACTION: "permission",
        OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
      },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return {
          kind: "permission",
          optionId: "opencode-permission-always",
        };
      },
      openCodePermission,
      onRuntimeEvent: (event) => {
        if (event.phase === "reasoning") {
          reasoningEvents.push(event);
        }
      },
      prompt: "Change the app",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-opencode-permission",
      spaceId: "space-opencode-permission",
      taskId: "task-opencode-permission",
    });

    assert.equal(result.status, "success", JSON.stringify(result));
    assert.equal(result.output, "OpenCode server reply");
    assert.deepEqual(
      reasoningEvents.map(({ mode, text }) => ({ mode, text })),
      [
        { mode: "snapshot", text: "Checking" },
        { mode: "append", text: " dependencies." },
      ]
    );
    assert.equal(
      result.contextDelta?.agentControllerConversationId,
      "opencode-session-server"
    );
    assert.deepEqual(requests, [
      {
        description: "Edit app files",
        kind: "permission",
        options: [
          {
            intent: "allow_once",
            label: "Allow once",
            optionId: "opencode-permission-once",
          },
          {
            intent: "allow_always",
            label: "Always allow",
            optionId: "opencode-permission-always",
          },
          {
            intent: "deny",
            label: "Deny",
            optionId: "opencode-permission-deny",
          },
        ],
        subject: {
          resource: "src/**",
          type: "file_change",
        },
        title: "Allow OpenCode to change these files?",
      },
    ]);
    const log = await readLog(logPath);
    assert.equal(log[0]?.permission, JSON.stringify(openCodePermission));
    assert.equal(log[0]?.argv[0], "serve");
    const promptRequest = log.find(
      (entry) =>
        typeof entry.path === "string" && entry.path.endsWith("/prompt_async")
    );
    assert.equal(promptRequest?.body.messageID, undefined);
    assert.equal(promptRequest?.body.system, "stable OpenMeld contract");
    assert.deepEqual(promptRequest?.body.parts, [
      { text: "current Wake only", type: "text" },
    ]);
    assert.deepEqual(
      log.find((entry) => entry.path === "/permission/permission-1/reply")
        ?.body,
      { reply: "always" }
    );
    assert.deepEqual(
      log.find((entry) => entry.path === "/session")?.body.model,
      {
        id: "gpt-5.4",
        providerID: "openai",
        variant: "high",
      }
    );
  });
});

// biome-ignore lint/style/noDoneCallback: node:test passes TestContext, not a completion callback.
test("OpenCode lets a slow healthy server start without discarding its progress", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const result = await invokeOpenCodeServerTransport({
      env: {
        OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
        OPENMELD_FAKE_OPENCODE_START_DELAY_MS: "6000",
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: null,
      openCodeWorkdir: fixtureDir,
      prompt: "Continue after a slow server initialization",
      sessionId: null,
    });
    assert.equal(result.output, "OpenCode server reply");
    const slow = warnings.find(
      ([name]) => name === "[openmeld.opencode.server_start.slow]"
    )?.[1];
    assert.ok(
      slow,
      "a slow listener must leave evidence before it is terminated"
    );
    assert.equal(slow.portProbe.status, "connected");
    assert.equal(slow.stdoutBytes, 0);
    assert.equal(slow.readyLineObserved, false);
    assert.ok(slow.processId > 0);
    const log = await readLog(logPath);
    assert.equal(
      log.filter((entry) => Array.isArray(entry.argv)).length,
      1,
      "A healthy six-second initialization must not be killed and repeated"
    );
    assert.equal(
      log.filter((entry) => entry.path?.endsWith("/prompt_async")).length,
      1
    );
  });
});

test("OpenCode replaces a server that stalls during startup before running the Agent turn", async () => {
  const { createOpenCodeAdapter } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const processEvents = [];
    const stalledStartMarkerPath = join(fixtureDir, "stalled-start.marker");
    const adapter = createOpenCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: null,
      registerRuntimeProcess: (event) => processEvents.push(event),
    });
    const result = await adapter.dispatch({
      agentId: "opencode",
      env: {
        OPENMELD_FAKE_OPENCODE_IGNORE_SIGTERM: "1",
        OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
        OPENMELD_FAKE_OPENCODE_STALLED_START_MARKER: stalledStartMarkerPath,
      },
      onInteractionRequest: () => {
        throw new Error("Unexpected interaction");
      },
      prompt: "Reply after startup recovery",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-startup-retry",
      spaceId: "space-opencode-startup-retry",
      taskId: "task-startup-retry",
    });

    assert.equal(result.status, "success", JSON.stringify(result));
    const log = await readLog(logPath);
    assert.equal(
      log.filter((entry) => Array.isArray(entry.argv)).length,
      2,
      "the unhealthy process must be discarded before one clean retry"
    );
    assert.equal(
      log.filter((entry) => entry.path?.endsWith("/prompt_async")).length,
      1,
      "the Agent turn must run only on the healthy replacement"
    );
    assert.deepEqual(
      processEvents.map(({ phase }) => phase),
      ["process_spawned", "process_exit", "process_spawned", "process_exit"]
    );
    assert.notEqual(processEvents[0]?.processId, processEvents[2]?.processId);
  });
});

test("OpenCode bounds health checks and replaces a server that does not answer", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const processEvents = [];
    const stalledHealthMarkerPath = join(fixtureDir, "stalled-health.marker");
    const result = await invokeOpenCodeServerTransport({
      env: {
        OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
        OPENMELD_FAKE_OPENCODE_STALLED_HEALTH_MARKER: stalledHealthMarkerPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      onProcessControlEvent: (event) => processEvents.push(event),
      openCodeTimeoutMs: null,
      openCodeWorkdir: fixtureDir,
      prompt: "Reply after health recovery",
      sessionId: null,
    });

    assert.equal(result.output, "OpenCode server reply");
    const log = await readLog(logPath);
    assert.equal(log.filter((entry) => Array.isArray(entry.argv)).length, 2);
    assert.equal(
      log.filter((entry) => entry.path?.endsWith("/prompt_async")).length,
      1
    );
    assert.deepEqual(
      processEvents.map(({ phase }) => phase),
      ["process_spawned", "process_exit", "process_spawned", "process_exit"]
    );
  });
});

test("OpenCode startup recovery stays inside the configured turn timeout", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const stalledStartMarkerPath = join(fixtureDir, "bounded-start.marker");
    const startedAt = Date.now();
    await assert.rejects(
      invokeOpenCodeServerTransport({
        env: {
          OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
          OPENMELD_FAKE_OPENCODE_STALLED_START_MARKER: stalledStartMarkerPath,
          OPENMELD_FAKE_OPENCODE_START_STDERR:
            "INFO bootstrapping local OpenCode; authentication configuration loaded",
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 250,
        openCodeWorkdir: fixtureDir,
        prompt: "Do not exceed the turn budget",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "process.timeout");
        assert.ok(error.message.includes("No Agent task was sent"));
        assert.ok(error.originalError.includes("bootstrapping local OpenCode"));
        assert.ok(error.originalError.includes("attempt 1 of 2"));
        assert.ok(
          error.originalError.includes('"portProbe":{"status":"not_sampled"}')
        );
        return true;
      }
    );

    assert.ok(Date.now() - startedAt < 2000);
    const log = await readLog(logPath);
    assert.equal(
      log.filter((entry) => Array.isArray(entry.argv)).length,
      1,
      "an exhausted turn budget must not start a replacement process"
    );
  });
});

test("OpenCode distinguishes an unopened port from a missing listener announcement", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    await assert.rejects(
      invokeOpenCodeServerTransport({
        env: {
          OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
          OPENMELD_FAKE_OPENCODE_NO_LISTENER: "1",
          OPENMELD_FAKE_OPENCODE_START_STDERR: "Starting synthetic controller",
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 6500,
        openCodeWorkdir: fixtureDir,
        prompt: "Never submit before readiness",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "process.timeout");
        assert.ok(error.originalError.includes('"status":"refused"'));
        assert.ok(error.originalError.includes('"readyLineObserved":false'));
        return true;
      }
    );
    assert.equal(
      (await readLog(logPath)).filter((entry) => entry.path).length,
      0
    );
  });
});

test("OpenCode stops after one replacement without sending a task or exposing unsafe startup logs", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const startedAt = Date.now();
    await assert.rejects(
      invokeOpenCodeServerTransport({
        env: {
          OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
          OPENMELD_FAKE_OPENCODE_START_DELAY_MS: "60000",
          OPENMELD_FAKE_OPENCODE_START_STDERR:
            "Authorization: Bearer private-startup-test-token",
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: null,
        openCodeWorkdir: fixtureDir,
        prompt: "Do not run a task before server readiness",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "process.timeout");
        assert.ok(error.message.includes("attempt 2 of 2"));
        assert.ok(error.message.includes("No Agent task was sent"));
        assert.ok(error.originalError.includes("Startup evidence, attempt 1"));
        assert.ok(error.originalError.includes("Startup evidence, attempt 2"));
        assert.ok(error.originalError.includes('"status":"connected"'));
        assert.ok(
          !JSON.stringify(error).includes("private-startup-test-token")
        );
        return true;
      }
    );
    assert.ok(Date.now() - startedAt < 36_000);
    const log = await readLog(logPath);
    assert.equal(log.filter((entry) => Array.isArray(entry.argv)).length, 2);
    assert.equal(
      log.filter(
        (entry) =>
          entry.path === "/session" || entry.path?.endsWith("/prompt_async")
      ).length,
      0
    );
  });
});

test("OpenCode ignores stale idle events while resuming a session", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath }) => {
    const result = await invokeOpenCodeServerTransport({
      env: {
        OPENMELD_FAKE_OPENCODE_STALE_IDLE_ON_RESUME: "1",
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
      openCodeWorkdir: fixtureDir,
      prompt: "Continue the existing session",
      sessionId: "opencode-session-server",
    });

    assert.equal(result.output, "OpenCode server reply");
    assert.equal(result.sessionId, "opencode-session-server");
  });
});

test("OpenCode adapter resumes through the server when no interaction callback is needed", async () => {
  const { createOpenCodeAdapter } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createOpenCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "opencode-session-server",
      agentId: "opencode-resume",
      conversationPolicy: {
        model: "openai/gpt-5.4",
        reasoningLevel: "high",
      },
      env: { OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath },
      prompt: "Continue the existing session",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-opencode-resume",
      spaceId: "space-opencode-resume",
      taskId: "task-opencode-resume",
    });
    assert.equal(result.status, "success", JSON.stringify(result));
    assert.equal(result.output, "OpenCode server reply");
    const promptRequests = (await readLog(logPath)).filter((entry) =>
      entry.path?.endsWith("/prompt_async")
    );
    assert.equal(promptRequests.length, 1);
    assert.deepEqual(promptRequests[0].body.model, {
      modelID: "gpt-5.4",
      providerID: "openai",
    });
    assert.equal(promptRequests[0].body.variant, "high");
  });
});

test("OpenCode rejects a resumed session outside the selected working folder before prompt or fork", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  for (const executionMode of ["normal", "repair"]) {
    await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
      const oldDirectory = join(fixtureDir, "old-session-directory");
      await mkdir(oldDirectory);
      await assert.rejects(
        invokeOpenCodeServerTransport({
          env: {
            OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
            OPENMELD_FAKE_OPENCODE_SESSION_DIRECTORY: oldDirectory,
          },
          executionMode,
          launchContract: createNodeScriptLaunchContract(fixturePath),
          openCodeTimeoutMs: 5000,
          openCodeWorkdir: fixtureDir,
          prompt: "Continue the existing session",
          sessionId: "opencode-session-server",
        }),
        (error) => {
          assert.equal(error.code, "context.workspace_mismatch");
          assert.equal(error.message.includes("old-session-directory"), false);
          return true;
        }
      );
      const log = await readLog(logPath);
      assert.equal(
        log.filter(
          (entry) =>
            entry.path?.endsWith("/prompt_async") ||
            entry.path?.endsWith("/fork")
        ).length,
        0
      );
    });
  }
});

test("OpenCode adapter preserves the existing conversation when its folder differs", async () => {
  const { createOpenCodeAdapter } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const oldDirectory = join(fixtureDir, "old-session-directory");
    await mkdir(oldDirectory);
    const adapter = createOpenCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "opencode-session-server",
      agentId: "opencode-resume",
      env: {
        OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
        OPENMELD_FAKE_OPENCODE_SESSION_DIRECTORY: oldDirectory,
      },
      prompt: "Continue the existing session",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-opencode-resume",
      spaceId: "space-opencode-resume",
      taskId: "task-opencode-resume",
    });
    assert.equal(result.status, "failed", JSON.stringify(result));
    assert.equal(result.errorCode, "context.workspace_mismatch");
    const log = await readLog(logPath);
    assert.equal(
      log.some(
        (entry) =>
          entry.path === "/session" ||
          entry.path?.endsWith("/prompt_async") ||
          entry.path?.endsWith("/fork")
      ),
      false
    );
  });
});

test("OpenCode rejects a missing or unavailable session directory before prompt", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  for (const [sessionDirectory, expectedCode] of [
    ["", "protocol.invalid"],
    ["missing", "context.workspace_unavailable"],
  ]) {
    await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
      await assert.rejects(
        invokeOpenCodeServerTransport({
          env: {
            OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
            OPENMELD_FAKE_OPENCODE_SESSION_DIRECTORY: sessionDirectory
              ? join(fixtureDir, sessionDirectory)
              : "",
          },
          launchContract: createNodeScriptLaunchContract(fixturePath),
          openCodeTimeoutMs: 5000,
          openCodeWorkdir: fixtureDir,
          prompt: "Continue the existing session",
          sessionId: "opencode-session-server",
        }),
        (error) => {
          assert.equal(error.code, expectedCode);
          return true;
        }
      );
      assert.equal(
        (await readLog(logPath)).some((entry) =>
          entry.path?.endsWith("/prompt_async")
        ),
        false
      );
    });
  }
});

test("OpenCode resumes an equivalent folder alias through the session's event directory", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const aliasDirectory = join(fixtureDir, "alias");
    await symlink(fixtureDir, aliasDirectory, "dir");
    const result = await invokeOpenCodeServerTransport({
      env: { OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
      openCodeWorkdir: aliasDirectory,
      prompt: "Continue the existing session",
      sessionId: "opencode-session-server",
    });
    assert.equal(result.output, "OpenCode server reply");
    const log = await readLog(logPath);
    assert.equal(
      log.find((entry) => entry.path === "/event")?.directory,
      fixtureDir
    );
  });
});

test("OpenCode reports an empty completed assistant turn", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath }) => {
    await assert.rejects(
      invokeOpenCodeServerTransport({
        env: { OPENMELD_FAKE_OPENCODE_EMPTY_OUTPUT: "1" },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 5000,
        openCodeWorkdir: fixtureDir,
        prompt: "Reply exactly OK",
        sessionId: "opencode-session-server",
      }),
      (error) => {
        assert.equal(error.code, "runtime.output.empty");
        return true;
      }
    );
  });
});

test("OpenCode returns Space answers to its official question API", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const requests = [];
    const result = await invokeOpenCodeServerTransport({
      env: {
        OPENMELD_FAKE_OPENCODE_INTERACTION: "question",
        OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      onInteractionRequest: (request) => {
        requests.push(request);
        return {
          answers: [
            {
              questionId: "opencode-question-1",
              values: ["opencode-question-1-option-1"],
            },
            {
              questionId: "opencode-question-2",
              values: ["opencode-question-2-option-2", "Accessibility"],
            },
          ],
          kind: "question",
        };
      },
      openCodeTimeoutMs: 5000,
      openCodeWorkdir: fixtureDir,
      prompt: "Ask before continuing",
      sessionId: null,
    });

    assert.equal(result.output, "OpenCode server reply");
    assert.deepEqual(requests, [
      {
        kind: "question",
        questions: [
          {
            allowOther: false,
            header: "Release",
            multiple: false,
            options: [
              {
                description: "Ship the stable channel",
                label: "Stable",
                optionId: "opencode-question-1-option-1",
              },
            ],
            prompt: "Which release?",
            questionId: "opencode-question-1",
          },
          {
            allowOther: true,
            header: "Checks",
            multiple: true,
            options: [
              {
                description: "Run unit tests",
                label: "Unit",
                optionId: "opencode-question-2-option-1",
              },
              {
                description: "Run smoke tests",
                label: "Smoke",
                optionId: "opencode-question-2-option-2",
              },
            ],
            prompt: "Which checks?",
            questionId: "opencode-question-2",
          },
        ],
        title: "OpenCode needs your input",
      },
    ]);
    const log = await readLog(logPath);
    assert.deepEqual(
      log.find((entry) => entry.path === "/question/question-1/reply")?.body,
      {
        answers: [["Stable"], ["Smoke", "Accessibility"]],
      }
    );
  });
});

test("OpenCode carries child-session permissions through the parent turn", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const requests = [];
    const result = await invokeOpenCodeServerTransport({
      env: {
        OPENMELD_FAKE_OPENCODE_INTERACTION: "child_permission",
        OPENMELD_FAKE_OPENCODE_SERVER_LOG: logPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      onInteractionRequest: (request) => {
        requests.push(request);
        return {
          kind: "permission",
          optionId: "opencode-permission-once",
        };
      },
      openCodeTimeoutMs: 5000,
      openCodeWorkdir: fixtureDir,
      prompt: "Delegate the tests",
      sessionId: null,
    });

    assert.equal(result.output, "OpenCode server reply");
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.subject, {
      command: "pnpm test",
      resource: "pnpm test",
      type: "command",
    });
    const log = await readLog(logPath);
    assert.deepEqual(
      log.find((entry) => entry.path === "/permission/permission-1/reply")
        ?.body,
      { reply: "once" }
    );
  });
});

test("OpenCode fails promptly if the server exits while a person is deciding", async () => {
  const { invokeOpenCodeServerTransport } = await import("../dist/index.js");
  await withServerFixture(async ({ fixtureDir, fixturePath }) => {
    const startedAtMs = Date.now();
    await assert.rejects(
      invokeOpenCodeServerTransport({
        env: {
          OPENMELD_FAKE_OPENCODE_INTERACTION: "permission_then_exit",
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        onInteractionRequest: () => new Promise(() => undefined),
        openCodeTimeoutMs: 5000,
        openCodeWorkdir: fixtureDir,
        prompt: "Wait for approval",
        sessionId: null,
      }),
      OPEN_CODE_SERVER_EXIT_PATTERN
    );
    assert.ok(
      Date.now() - startedAtMs < 1000,
      "server exit should not wait for the unresolved human interaction"
    );
  });
});
