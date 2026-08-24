import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const AUTH_RE = /not logged in|login required|unauthorized/i;
const CHATGPT_ACCOUNT_RE = /chatgpt account/i;
const QUOTA_RE = /quota/i;
const RATE_LIMIT_RE = /rate limit|too many requests|429/i;
const SYSTEM_RUN_DENIED_RE = /system_run_denied/i;
const RUNTIME_PERMISSION_DENIAL_COPY =
  "The requested action was blocked by the Agent Profile’s permission settings. Review its permissions and choose a less restrictive mode only if you trust the access it grants, then wake the agent again.";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

const restoreOptionalEnvVar = (name, originalValue) => {
  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = originalValue;
};

async function withMockedPlatform(platform, callback) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform"
  );

  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(process, "platform", originalDescriptor);
    }
  }
}

test("openclaw output never infers failure from assistant text", async () => {
  const { parseOpenClawOutputLine } = await import("../dist/index.js");
  const text =
    "The submitted value is invalid, so the user should choose another one.";

  assert.deepEqual(parseOpenClawOutputLine(JSON.stringify({ result: text })), {
    errorMessage: null,
    isErrorResult: null,
    resultText: text,
    sessionId: null,
    terminal: true,
  });
});

test("openclaw failure classification matches standalone 429 tokens only", async () => {
  const { classifyOpenClawFailureMessage } = await import(
    "../dist/transport/openclaw-failure.js"
  );

  assert.equal(
    classifyOpenClawFailureMessage({
      message: "HTTP 429 from upstream",
    }).code,
    "rate_limited"
  );
  assert.notEqual(
    classifyOpenClawFailureMessage({
      message: "HTTP 1429 from upstream",
    }).code,
    "rate_limited"
  );
  assert.notEqual(
    classifyOpenClawFailureMessage({
      message: "status 4290 from upstream",
    }).code,
    "rate_limited"
  );
});

test("openclaw failure classification keeps permission denial before auth fallback", async () => {
  const { classifyOpenClawFailureMessage } = await import(
    "../dist/transport/openclaw-failure.js"
  );

  const classification = classifyOpenClawFailureMessage({
    message:
      "SYSTEM_RUN_DENIED: approval required after provider returned 401 unauthorized",
  });

  assert.equal(classification.code, "permission.denied.runtime");
  assert.equal(classification.errorType, "adapter");
});

const validateOpenClawTelemetry = (telemetry, input) => {
  if (!telemetry || typeof telemetry !== "object") {
    throw new Error("Expected openclaw telemetry to be an object");
  }

  const {
    completedAtMs,
    contextHealed,
    exitCode,
    exitObservedAtMs,
    firstStderrAtMs,
    firstStdoutAtMs,
    invokedAtMs,
    processId,
    processSpawnedAtMs,
    resumedContext,
    stdinClosedAtMs,
  } = telemetry;

  if (typeof invokedAtMs !== "number") {
    throw new Error("Expected invokedAtMs to be a number");
  }

  if (typeof completedAtMs !== "number") {
    throw new Error("Expected completedAtMs to be a number");
  }

  if (completedAtMs < invokedAtMs) {
    throw new Error("Expected completedAtMs to be after invokedAtMs");
  }

  if (resumedContext !== input.resumedContext) {
    throw new Error("Expected resumedContext to match fixture expectation");
  }

  if (exitCode !== undefined && exitCode !== 0) {
    throw new Error("Expected exitCode to be zero when present");
  }

  if (exitObservedAtMs !== undefined) {
    if (typeof exitObservedAtMs !== "number") {
      throw new Error("Expected exitObservedAtMs to be a number when present");
    }

    if (exitObservedAtMs < invokedAtMs) {
      throw new Error("Expected exitObservedAtMs to be after invokedAtMs");
    }
  }

  if (typeof firstStdoutAtMs !== "number") {
    throw new Error("Expected firstStdoutAtMs to be a number");
  }

  if (firstStdoutAtMs < invokedAtMs) {
    throw new Error("Expected firstStdoutAtMs to be after invokedAtMs");
  }

  if (typeof processId !== "number") {
    throw new Error("Expected processId to be a number");
  }

  if (typeof processSpawnedAtMs !== "number") {
    throw new Error("Expected processSpawnedAtMs to be a number");
  }

  if (processSpawnedAtMs < invokedAtMs) {
    throw new Error("Expected processSpawnedAtMs to be after invokedAtMs");
  }

  if (typeof stdinClosedAtMs !== "number") {
    throw new Error("Expected stdinClosedAtMs to be a number");
  }

  if (stdinClosedAtMs < processSpawnedAtMs) {
    throw new Error("Expected stdinClosedAtMs to be after processSpawnedAtMs");
  }

  if (firstStderrAtMs !== undefined && typeof firstStderrAtMs !== "number") {
    throw new Error("Expected firstStderrAtMs to be a number when present");
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

test("openclaw adapter dispatch uses dispatch-time runtime context for spawn cwd", async () => {
  const { createOpenClawAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "openclaw-dispatch-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-runtime-cwd.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ ok: true, reply: { text: process.cwd() }, metadata: { session_id: 'openclaw-runtime-cwd-1' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createOpenClawAdapter({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 5000,
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
      agentControllerConversationId: "openclaw-runtime-cwd-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId: "openclaw-runtime-cwd-1",
        agentControllerConversationKind: "session",
      },
    });
    validateOpenClawTelemetry(result.telemetry, {
      resumedContext: false,
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("restoreOptionalEnvVar removes PATHEXT when it was originally unset", () => {
  const originalPathExt = process.env.PATHEXT;

  try {
    process.env.PATHEXT = ".CMD;.EXE";

    restoreOptionalEnvVar("PATHEXT", undefined);

    assert.equal("PATHEXT" in process.env, false);
  } finally {
    restoreOptionalEnvVar("PATHEXT", originalPathExt);
  }
});

test("resolveOpenClawBin prefers the Node sibling openclaw binary when PATH lookup is unavailable", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-node-sibling-"));
  const fakeNodePath = join(fixtureDir, "node");
  const fakeOpenClawPath = join(fixtureDir, "openclaw");
  const originalExecPath = process.execPath;
  const originalConfiguredOpenClawBin =
    process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN;

  await writeFile(fakeNodePath, "", "utf8");
  await chmod(fakeNodePath, 0o755);
  await writeFile(fakeOpenClawPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeOpenClawPath, 0o755);

  try {
    Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN");
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: fakeNodePath,
    });

    const { resolveOpenClawBin, resolveOpenClawBinCandidates } = await import(
      "../dist/index.js"
    );

    assert.equal(resolveOpenClawBin(), fakeOpenClawPath);
    assert.equal(resolveOpenClawBinCandidates()[0], fakeOpenClawPath);
    assert.equal(
      resolveOpenClawBinCandidates()[resolveOpenClawBinCandidates().length - 1],
      "openclaw"
    );
  } finally {
    if (originalConfiguredOpenClawBin === undefined) {
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN"
      );
    } else {
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN =
        originalConfiguredOpenClawBin;
    }
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: originalExecPath,
    });
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveOpenClawBin prefers the Windows Node sibling openclaw wrapper when PATH lookup is unavailable", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-node-sibling-"));
  const fakeNodePath = join(fixtureDir, "node.exe");
  const fakeOpenClawPath = join(fixtureDir, "openclaw.cmd");
  const originalExecPath = process.execPath;
  const originalConfiguredOpenClawBin =
    process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN;
  const originalPathExt = process.env.PATHEXT;

  await writeFile(fakeNodePath, "", "utf8");
  await chmod(fakeNodePath, 0o755);
  await writeFile(fakeOpenClawPath, "@echo off\r\nexit /b 0\r\n", "utf8");

  try {
    Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN");
    process.env.PATHEXT = ".CMD;.EXE";
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: fakeNodePath,
    });

    await withMockedPlatform("win32", async () => {
      const { resolveOpenClawBin, resolveOpenClawBinCandidates } = await import(
        "../dist/index.js"
      );

      assert.equal(resolveOpenClawBin(), fakeOpenClawPath);
      assert.equal(resolveOpenClawBinCandidates()[0], fakeOpenClawPath);
      assert.equal(
        resolveOpenClawBinCandidates()[
          resolveOpenClawBinCandidates().length - 1
        ],
        "openclaw"
      );
    });
  } finally {
    if (originalConfiguredOpenClawBin === undefined) {
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN"
      );
    } else {
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN =
        originalConfiguredOpenClawBin;
    }
    restoreOptionalEnvVar("PATHEXT", originalPathExt);
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: originalExecPath,
    });
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw gateway transport uses gateway agent with sessionKey", async () => {
  const { invokeOpenClawGatewayTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-gateway-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-gateway-fixture.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const method = args[2];",
      "if (method === 'agent') {",
      "  const params = JSON.parse(args[args.indexOf('--params') + 1]);",
      "  if (params.message !== 'current Wake only') throw new Error('missing native user prompt');",
      "  if (params.extraSystemPrompt !== 'stable OpenMeld contract') throw new Error('missing extraSystemPrompt');",
      "  console.log(JSON.stringify({ runId: 'run-gateway-1', status: 'ok', result: { payloads: [{ text: 'hello from gateway\\n\\n```openmeld-space-action\\npost_message\\n```' }], meta: { agentMeta: { sessionId: 'session-gateway-1' }, systemPromptReport: { sessionId: 'session-gateway-1', sessionKey: 'agent:openmeld-demo:openmeld-space:ops-room--abc12345' } } } }));",
      "  process.exit(0);",
      "}",
      "console.error('unexpected method: ' + method);",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeOpenClawGatewayTransport({
      agentId: "openmeld-demo",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 5000,
      openClawWorkdir: process.cwd(),
      idempotencyKey: "dispatch-1",
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      prompt: "hello",
      resumedContext: true,
      sessionKey: "agent:openmeld-demo:openmeld-space:ops-room--abc12345",
    });

    assert.deepEqual(
      {
        output: result.output,
        sessionId: result.sessionId,
        sessionKey: result.sessionKey,
      },
      {
        output:
          "hello from gateway\n\n```openmeld-space-action\npost_message\n```",
        sessionId: "session-gateway-1",
        sessionKey: "agent:openmeld-demo:openmeld-space:ops-room--abc12345",
      }
    );
    assert.equal(result.telemetry.resumedContext, true);
    assert.equal(typeof result.telemetry.invokedAtMs, "number");
    assert.equal(typeof result.telemetry.completedAtMs, "number");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw gateway transport maps unsupported-model errors to model.unsupported", async () => {
  const { invokeOpenClawGatewayTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-gateway-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-gateway-fixture-error.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ runId: 'run-gateway-error-1', status: 'error', summary: JSON.stringify({ detail: \"The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.\" }) }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawGatewayTransport({
        agentId: "openmeld-demo",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        idempotencyKey: "dispatch-gateway-model-1",
        prompt: "hello",
        resumedContext: false,
        sessionKey: "agent:openmeld-demo:openmeld-space:ops-room--abc12345",
      }),
      (error) => {
        assert.equal(error.code, "model.unsupported");
        assert.equal(error.errorType, "config");
        assert.match(error.message, CHATGPT_ACCOUNT_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw gateway transport falls back to the recent session-store error when the gateway call times out", async () => {
  const { invokeOpenClawGatewayTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-gateway-timeout-"));
  const fixturePath = join(fixtureDir, "openclaw-gateway-timeout.mjs");
  const stateDir = join(fixtureDir, "state");
  const sessionsDir = join(stateDir, "agents", "openmeld-demo", "sessions");
  const sessionId = "openclaw-session-timeout-1";
  const sessionKey = "agent:openmeld-demo:openmeld-space:ops-room--abc12345";
  const now = Date.now();

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, "sessions.json"),
    JSON.stringify(
      {
        [sessionKey]: {
          sessionFile: `${sessionId}.jsonl`,
          sessionId,
          updatedAt: now,
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(sessionsDir, `${sessionId}.jsonl`),
    `${JSON.stringify({
      message: {
        errorMessage: JSON.stringify({
          detail:
            "The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.",
        }),
        role: "assistant",
        stopReason: "error",
        timestamp: now,
      },
      timestamp: new Date(now).toISOString(),
      type: "message",
    })}\n`,
    "utf8"
  );
  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "setTimeout(() => process.exit(0), 250);"].join(
      "\n"
    ),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawGatewayTransport({
        agentId: "openmeld-demo",
        env: {
          OPENCLAW_STATE_DIR: stateDir,
        },
        idempotencyKey: "dispatch-gateway-timeout-1",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 10,
        openClawWorkdir: process.cwd(),
        prompt: "hello",
        resumedContext: false,
        sessionKey,
      }),
      (error) => {
        assert.equal(error.code, "model.unsupported");
        assert.equal(error.errorType, "config");
        assert.match(error.message, CHATGPT_ACCOUNT_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport parses successful result and session id", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-success.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ ok: true, reply: { text: 'hello from openclaw' }, metadata: { session_id: 'openclaw-session-success-1' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeOpenClawCliTransport({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 5000,
      openClawWorkdir: process.cwd(),
      prompt: "hello",
      sessionId: null,
    });

    assert.deepEqual(
      {
        output: result.output,
        sessionId: result.sessionId,
      },
      {
        output: "hello from openclaw",
        sessionId: "openclaw-session-success-1",
      }
    );
    validateOpenClawTelemetry(result.telemetry, {
      resumedContext: false,
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport maps system.run approval denial to public runtime permission copy", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-permission.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ ok: false, error: { message: 'SYSTEM_RUN_DENIED: approval required' }, metadata: { session_id: 'openclaw-permission-session-1' } }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        prompt: "run host command",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, SYSTEM_RUN_DENIED_RE);
        assert.equal(
          resolveMappedPublicAgentFailureReason(error.code),
          RUNTIME_PERMISSION_DENIAL_COPY
        );
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport maps raw permission denial stdout to public runtime permission copy", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-raw-permission.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log('exec.denied: SYSTEM_RUN_DENIED: approval required');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        prompt: "run host command",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, SYSTEM_RUN_DENIED_RE);
        assert.equal(
          resolveMappedPublicAgentFailureReason(error.code),
          RUNTIME_PERMISSION_DENIAL_COPY
        );
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport completes when provider terminal output arrives before process exit", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-terminal-output.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ ok: true, reply: { text: 'terminal openclaw output' }, metadata: { session_id: 'openclaw-terminal-output-1' } }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeOpenClawCliTransport({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 1000,
      openClawWorkdir: process.cwd(),
      prompt: "hello",
      sessionId: null,
    });

    assert.equal(result.output, "terminal openclaw output");
    assert.equal(result.sessionId, "openclaw-terminal-output-1");
    assert.equal(result.telemetry.exitObservedAtMs, undefined);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport starts fresh turns with an explicit session id", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-fresh-session.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const sessionIndex = args.indexOf('--session-id');",
      "const agentIndex = args.indexOf('--agent');",
      "if (sessionIndex < 0 || !args[sessionIndex + 1]) {",
      "  console.error('missing explicit session id');",
      "  process.exit(1);",
      "}",
      "if (agentIndex < 0 || args[agentIndex + 1] !== 'main') {",
      "  console.error('missing expected --agent main on fresh turn');",
      "  process.exit(1);",
      "}",
      "const sessionId = args[sessionIndex + 1];",
      "console.log(JSON.stringify({ ok: true, reply: { text: 'fresh openclaw turn' }, metadata: { session_id: sessionId } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeOpenClawCliTransport({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 5000,
      openClawWorkdir: process.cwd(),
      prompt: "hello",
      sessionId: null,
    });

    assert.equal(result.output, "fresh openclaw turn");
    assert.match(result.sessionId, UUID_RE);
    validateOpenClawTelemetry(result.telemetry, {
      resumedContext: false,
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport maps auth failures to auth.required", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-auth.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ ok: false, error: { message: 'Not logged in. Please run /login' } }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "auth.required");
        assert.equal(error.errorType, "auth");
        assert.match(error.message, AUTH_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport maps unsupported-model errors to model.unsupported", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(
    fixtureDir,
    "openclaw-fixture-model-unsupported.mjs"
  );

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ ok: false, error: { message: JSON.stringify({ detail: \"The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.\" }) } }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "model.unsupported");
        assert.equal(error.errorType, "config");
        assert.match(error.message, CHATGPT_ACCOUNT_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport forwards route env into the provider process", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-env.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const agentIndex = args.indexOf('--agent');",
      "const agentId = agentIndex >= 0 ? args[agentIndex + 1] : 'missing';",
      "const mode = process.env.OPENMELD_DISPATCH_RUNTIME_MODE || 'missing';",
      "console.log(JSON.stringify({ ok: true, reply: { text: 'env:' + mode + ':' + agentId }, metadata: { session_id: 'openclaw-session-env-1' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeOpenClawCliTransport({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 5000,
      openClawWorkdir: process.cwd(),
      env: {
        OPENMELD_DISPATCH_RUNTIME_MODE: "dispatch-owned-runtime",
      },
      prompt: "hello",
      sessionId: null,
    });

    assert.equal(result.output, "env:dispatch-owned-runtime:main");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("adapter-openclaw prefers OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID from dispatch env", async () => {
  const { createOpenClawAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-agent-env.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const agentIndex = args.indexOf('--agent');",
      "const agentId = agentIndex >= 0 ? args[agentIndex + 1] : 'missing';",
      "console.log(JSON.stringify({ ok: true, reply: { text: 'agent:' + agentId }, metadata: { session_id: 'openclaw-session-agent-env-1' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createOpenClawAdapter({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });

    const dispatchResult = await adapter.dispatch({
      agentId: "agt-demo",
      env: {
        OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: "openmeld-demo-bot",
      },
      prompt: "hello",
      runtimeContext: createRuntimeContext(),
      sourceEventId: "evt-agent-env-1",
      spaceId: "space-1",
      taskId: "task-agent-env-1",
    });

    assert.equal(dispatchResult.status, "success");
    assert.equal(dispatchResult.output, "agent:openmeld-demo-bot");
    assert.deepEqual(dispatchResult.contextDelta, {
      agentControllerConversationId: "openclaw-session-agent-env-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId: "openclaw-session-agent-env-1",
        agentControllerConversationKind: "session",
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("adapter-openclaw degrades stream intent to final result without preview output", async () => {
  const { createOpenClawAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-stream-final.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ ok: true, reply: { text: 'final-only openclaw output' }, metadata: { session_id: 'openclaw-session-stream-final-1' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  const previews = [];

  try {
    const adapter = createOpenClawAdapter({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });

    const dispatchResult = await adapter.dispatch({
      agentId: "agt-demo",
      onPreview: (preview) => {
        previews.push(preview.text);
      },
      prompt: "hello",
      runtimeContext: createRuntimeContext(),
      sourceEventId: "evt-stream-final-1",
      spaceId: "space-1",
      streamingMode: "stream",
      taskId: "task-stream-final-1",
    });

    assert.equal(dispatchResult.status, "success");
    assert.equal(dispatchResult.output, "final-only openclaw output");
    assert.deepEqual(dispatchResult.contextDelta, {
      agentControllerConversationId: "openclaw-session-stream-final-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId: "openclaw-session-stream-final-1",
        agentControllerConversationKind: "session",
      },
    });
    assert.deepEqual(previews, []);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport maps quota and rate-limit failures", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");

  const quotaDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const quotaFixturePath = join(quotaDir, "openclaw-fixture-quota.mjs");
  await writeFile(
    quotaFixturePath,
    [
      "#!/usr/bin/env node",
      "console.error('insufficient_quota: quota exceeded for current billing period');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(quotaFixturePath, 0o755);

  const rateDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const rateFixturePath = join(rateDir, "openclaw-fixture-rate.mjs");
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
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(quotaFixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "quota.exceeded");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, QUOTA_RE);
        return true;
      }
    );

    await assert.rejects(
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(rateFixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "rate_limited");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, RATE_LIMIT_RE);
        return true;
      }
    );
  } finally {
    await rm(quotaDir, { force: true, recursive: true });
    await rm(rateDir, { force: true, recursive: true });
  }
});

test("openclaw failure classification does not false-match non-auth 401 substrings", async () => {
  const { classifyOpenClawFailureMessage } = await import(
    "../dist/transport/openclaw-failure.js"
  );

  const nonAuthFailure = classifyOpenClawFailureMessage({
    message:
      "Request failed with internal code 14012 while upstream was unavailable.",
  });
  assert.equal(nonAuthFailure.code, "upstream_unreachable");
  assert.equal(nonAuthFailure.errorType, "adapter");

  const authFailure = classifyOpenClawFailureMessage({
    message: "401 unauthorized: please run /login",
  });
  assert.equal(authFailure.code, "auth.required");
  assert.equal(authFailure.errorType, "auth");
});

test("openclaw invoke heals stale session by retrying once with a fresh session id", async () => {
  const { invokeOpenClawWithSingleContextHeal } = await import(
    "../dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-heal.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const sessionIndex = args.indexOf('--session-id');",
      "if (sessionIndex >= 0) {",
      "  const sessionId = args[sessionIndex + 1] ?? 'unknown';",
      "  if (sessionId === 'openclaw-stale-session') {",
      "    console.error('No session found with session ID: ' + sessionId);",
      "    process.exit(1);",
      "  }",
      "  console.log(JSON.stringify({ ok: true, reply: { text: 'healed output' }, metadata: { session_id: sessionId } }));",
      "  process.exit(0);",
      "}",
      "console.error('missing explicit session id');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  const contextLostEvents = [];

  try {
    const result = await invokeOpenClawWithSingleContextHeal({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 5000,
      openClawWorkdir: process.cwd(),
      onContextLost: () => {
        contextLostEvents.push("context-lost");
      },
      prompt: "hello",
      sessionId: "openclaw-stale-session",
    });

    assert.deepEqual(
      {
        contextHealed: result.contextHealed,
        output: result.output,
      },
      {
        contextHealed: true,
        output: "healed output",
      }
    );
    assert.match(result.sessionId, UUID_RE);
    validateOpenClawTelemetry(result.telemetry, {
      contextHealed: true,
      resumedContext: true,
    });
    assert.deepEqual(contextLostEvents, ["context-lost"]);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw invoke returns context.rebuild_failed when retry also fails", async () => {
  const { invokeOpenClawWithSingleContextHeal } = await import(
    "../dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-heal-fail.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.error('No session found with session ID: stale-session');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawWithSingleContextHeal({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: "openclaw-stale-session",
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

test("openclaw cli transport parses pretty JSON document payloads", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(fixtureDir, "openclaw-fixture-document.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const doc = {",
      "  payloads: [{ text: 'line one' }, { text: 'line two' }],",
      "  meta: {",
      "    agentMeta: {",
      "      sessionId: 'openclaw-session-document-1'",
      "    }",
      "  }",
      "};",
      "console.log(JSON.stringify(doc, null, 2));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeOpenClawCliTransport({
      openClawAgentId: "main",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openClawTimeoutMs: 5000,
      openClawWorkdir: process.cwd(),
      prompt: "hello",
      sessionId: null,
    });

    assert.deepEqual(
      {
        output: result.output,
        sessionId: result.sessionId,
      },
      {
        output: "line one\n\nline two",
        sessionId: "openclaw-session-document-1",
      }
    );
    validateOpenClawTelemetry(result.telemetry, {
      resumedContext: false,
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport classifies no-output timeout as timed_out_no_output", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(
    fixtureDir,
    "openclaw-fixture-timeout-no-output.mjs"
  );

  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "setTimeout(() => process.exit(0), 1000);"].join(
      "\n"
    ),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 50,
        openClawWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "timed_out_no_output");
        assert.equal(error.errorType, "timeout");
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("openclaw cli transport classifies unclassified non-zero exit as provider_exit_error", async () => {
  const { invokeOpenClawCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-cli-fixture-"));
  const fixturePath = join(
    fixtureDir,
    "openclaw-fixture-provider-exit-error.mjs"
  );

  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "process.exit(7);"].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenClawCliTransport({
        openClawAgentId: "main",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openClawTimeoutMs: 5000,
        openClawWorkdir: process.cwd(),
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
