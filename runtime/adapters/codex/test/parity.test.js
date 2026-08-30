import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const AUTH_401_RE = /401 Unauthorized/;
const MODEL_NOT_FOUND_RE = /model_not_found|requested model/i;
const CODEX_UPGRADE_REQUIRED_RE = /requires a newer version of codex/i;
const DANGEROUS_BYPASS_FLAG = "--dangerously-bypass-approvals-and-sandbox";
const CODEX_COMMAND_DENIED_BY_SANDBOX_RE = /command denied by sandbox/i;
const CODEX_EXECUTION_DENIED_RE = /execution denied/i;
const QUOTA_RE = /insufficient_quota/;
const RATE_LIMIT_RE = /rate limit/i;
const USAGE_LIMIT_RE = /usage limit/i;
const STARTUP_RETRY_OUTPUT_RE = /start safely after one transient bootstrap/;
const STARTUP_RETRY_FAILURE_RE = /one automatic retry/;
const LONG_TURN_OUTPUT_RE = /allow a healthy long-running turn/;
const NATIVE_RUNTIME_OUTPUT_RE = /launch the official packaged native runtime/;
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

test("codex classifies only its official thread writer conflict as conversation occupancy", async () => {
  const { classifyCodexThreadWriterConflict } = await import(
    "../dist/index.js"
  );

  assert.deepEqual(
    classifyCodexThreadWriterConflict({
      agentControllerConversationId: "01a04ded-5af8-7f00-a2dd-4abee50f8724",
      operation: "thread/resume",
      rpcErrorCode: -32_600,
      rpcErrorMessage:
        "thread 01a04ded-5af8-7f00-a2dd-4abee50f8724 already has an active writer",
    }),
    {
      agentControllerConversationId: "01a04ded-5af8-7f00-a2dd-4abee50f8724",
      contractVersion: 1,
      state: "occupied",
    }
  );

  for (const candidate of [
    {
      operation: "turn/start",
      rpcErrorCode: -32_600,
      rpcErrorMessage:
        "thread 01a04ded-5af8-7f00-a2dd-4abee50f8724 already has an active writer",
    },
    {
      operation: "thread/resume",
      rpcErrorCode: -32_000,
      rpcErrorMessage:
        "thread 01a04ded-5af8-7f00-a2dd-4abee50f8724 already has an active writer",
    },
    {
      operation: "thread/resume",
      rpcErrorCode: -32_600,
      rpcErrorMessage: "transport busy",
    },
  ]) {
    assert.equal(
      classifyCodexThreadWriterConflict({
        agentControllerConversationId: "01a04ded-5af8-7f00-a2dd-4abee50f8724",
        ...candidate,
      }),
      null
    );
  }
});

test("codex waits on an official writer conflict and retries the same dispatch", async () => {
  const { CodexAppServerTransportError, createCodexAdapter } = await import(
    "../dist/index.js"
  );
  const events = [];
  let dispatchCalls = 0;
  let availabilityWaits = 0;
  const occupancy = {
    agentControllerConversationId: "thread-occupied",
    contractVersion: 1,
    state: "occupied",
  };
  const adapter = createCodexAdapter({
    invokeByMode: {
      "codex-app-server": () => {
        dispatchCalls += 1;
        if (dispatchCalls === 1) {
          throw new CodexAppServerTransportError({
            agentControllerConversationOccupancy: occupancy,
            code: "agent_controller.conversation_occupied",
            errorType: "adapter",
            message: "thread thread-occupied already has an active writer",
            rpcErrorCode: -32_600,
          });
        }
        return {
          contextDelta: {
            agentControllerConversationId: "thread-occupied",
          },
          output: "accepted after release",
        };
      },
    },
    waitForThreadWriterAvailability: ({ occupancy: observed }) => {
      availabilityWaits += 1;
      assert.deepEqual(observed, occupancy);
    },
  });

  const result = await adapter.dispatch({
    agentControllerConversationId: "thread-occupied",
    agentId: "agt-demo",
    onRuntimeEvent: (event) => {
      if (event.phase.startsWith("agent_controller_conversation_")) {
        events.push(event.phase);
      }
    },
    prompt: "continue",
    runtimeContext: createRuntimeContext(),
    sourceEventId: "evt-occupied",
    spaceId: "space-1",
    taskId: "task-occupied",
    transportMode: "codex-app-server",
  });

  assert.equal(result.status, "success");
  assert.equal(result.output, "accepted after release");
  assert.equal(dispatchCalls, 2);
  assert.equal(availabilityWaits, 1);
  assert.deepEqual(events, [
    "agent_controller_conversation_occupied",
    "agent_controller_conversation_available",
  ]);
});

test("codex retries immediately when the official writer lock is released", async () => {
  const { waitForCodexThreadWriterAvailability } = await import(
    "../dist/index.js"
  );
  const codexHome = await mkdtemp(join(tmpdir(), "codex-home-lock-"));
  const lockDirectory = join(codexHome, "thread-writer-locks");
  const lockPath = join(lockDirectory, "thread-release.lock");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(lockPath, "");

  try {
    const startedAtMs = Date.now();
    const waiting = waitForCodexThreadWriterAvailability({
      env: { CODEX_HOME: codexHome },
      occupancy: {
        agentControllerConversationId: "thread-release",
        contractVersion: 1,
        state: "occupied",
      },
      recoveryRetryMs: 2000,
    });
    setTimeout(() => {
      rm(lockPath, { force: true }).catch(() => undefined);
    }, 25);
    await waiting;
    assert.ok(Date.now() - startedAtMs < 1000);
  } finally {
    await rm(codexHome, { force: true, recursive: true });
  }
});

test("codex distinguishes subscription access from a transient rate limit", async () => {
  const { classifyCodexProviderAccountFailure } = await import(
    "../dist/output/codex-provider-failure.js"
  );

  const subscription = classifyCodexProviderAccountFailure({
    message: "This model is not available on your plan. Upgrade your plan.",
  });
  assert.equal(subscription.code, "provider.subscription_access_unavailable");
  assert.equal(
    subscription.providerAccessEvidence.reasonCode,
    "provider_account.subscription_access_unavailable"
  );

  const transientRateLimit = classifyCodexProviderAccountFailure({
    message: "429 Too Many Requests: rate limit exceeded",
  });
  assert.equal(transientRateLimit.code, "rate_limited");
  assert.equal(transientRateLimit.providerAccessEvidence, undefined);

  const overlappingTransientRateLimit = classifyCodexProviderAccountFailure({
    message:
      "429 Too Many Requests: usage limit reached for this billing window",
  });
  assert.equal(overlappingTransientRateLimit.code, "rate_limited");
  assert.equal(overlappingTransientRateLimit.providerAccessEvidence, undefined);
});

const CODEX_PLATFORM_LAYOUTS = {
  "darwin-arm64": {
    packageName: "@openai/codex-darwin-arm64",
    targetTriple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    packageName: "@openai/codex-darwin-x64",
    targetTriple: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    packageName: "@openai/codex-linux-arm64",
    targetTriple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    packageName: "@openai/codex-linux-x64",
    targetTriple: "x86_64-unknown-linux-musl",
  },
};

const writeFakeCodexAppServerFixture = async (fixturePath) => {
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
      "const logPath = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_LOG;",
      "const startupAttemptPath = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH;",
      "let startupAttempt = 1;",
      "if (startupAttemptPath) {",
      "  try { startupAttempt = Number(readFileSync(startupAttemptPath, 'utf8')) + 1; } catch {}",
      "  writeFileSync(startupAttemptPath, String(startupAttempt), 'utf8');",
      "}",
      "let buffer = '';",
      "let activeTurn = null;",
      "let completionTimer = null;",
      "let pendingServerRequest = null;",
      "let turnCompleted = false;",
      "const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
      "const log = (message) => {",
      "  if (!logPath) return;",
      "  appendFileSync(logPath, JSON.stringify({",
      "    argv: process.argv.slice(2),",
      "    cwd: process.cwd(),",
      "    managedPackageRoot: process.env.CODEX_MANAGED_PACKAGE_ROOT ?? null,",
      "    method: message.method,",
      "    params: message.params ?? null,",
      "    result: message.result ?? null,",
      "  }) + '\\n', 'utf8');",
      "};",
      "const buildThread = (id, threadSource = 'user') => ({ id, sessionId: 'session-1', forkedFromId: null, parentThreadId: null, preview: '', ephemeral: false, modelProvider: 'openai', createdAt: 1, updatedAt: 1, status: 'idle', path: null, cwd: process.cwd(), cliVersion: 'fake', source: 'appServer', threadSource, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] });",
      "const buildCompletedTurn = (threadId, prompt, cwd) => {",
      "  const items = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_EMPTY_OUTPUT === '1' ? [] : [{ type: 'agentMessage', id: 'msg-1', text: 'app-server:' + process.cwd() + ':' + cwd + ':' + prompt, phase: null, memoryCitation: null }];",
      "  return { id: 'turn-1', items, itemsView: 'complete', status: 'completed', error: null, startedAt: 1, completedAt: 1, durationMs: 1 };",
      "};",
      "const buildFailedTurn = (message) => { const codexErrorInfo = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_CODEX_ERROR_INFO; return { id: 'turn-1', items: [], itemsView: 'complete', status: 'failed', error: codexErrorInfo ? { message, codexErrorInfo } : { message }, startedAt: 1, completedAt: 1, durationMs: 1 }; };",
      "const buildInterruptedTurn = () => ({ id: 'turn-1', items: [], itemsView: 'complete', status: 'interrupted', error: null, startedAt: 1, completedAt: 1, durationMs: 1 });",
      "const readDeltaOutput = () => {",
      "  const raw = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_DELTA_OUTPUT;",
      "  if (!raw) return [];",
      "  const parsed = JSON.parse(raw);",
      "  return Array.isArray(parsed) ? parsed : [];",
      "};",
      "const completeTurn = (status = 'completed') => {",
      "  if (!activeTurn || turnCompleted) return;",
      "  turnCompleted = true;",
      "  const failureMessage = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE;",
      "  const turn = status === 'interrupted' ? buildInterruptedTurn() : failureMessage ? buildFailedTurn(failureMessage) : buildCompletedTurn(activeTurn.threadId, activeTurn.prompt, activeTurn.cwd);",
      "  const tokenUsage = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TOKEN_USAGE;",
      "  if (tokenUsage) write({ jsonrpc: '2.0', method: 'thread/tokenUsage/updated', params: { threadId: activeTurn.threadId, turnId: activeTurn.turnId, tokenUsage: JSON.parse(tokenUsage) } });",
      "  if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_CONTEXT_COMPACTION === '1') write({ jsonrpc: '2.0', method: 'item/completed', params: { threadId: activeTurn.threadId, turnId: activeTurn.turnId, item: { id: 'compact-1', type: 'contextCompaction' } } });",
      "  for (const delta of readDeltaOutput()) {",
      "    write({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { itemId: 'msg-delta-1', delta } });",
      "  }",
      "  write({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: activeTurn.threadId, turn } });",
      "};",
      "const handle = (message) => {",
      "  log(message);",
      "  if (!message.method && pendingServerRequest && message.id === pendingServerRequest.id) {",
      "    pendingServerRequest = null;",
      "    completeTurn('completed');",
      "    return;",
      "  }",
      "  if (message.method === 'initialize') {",
      "    const hangingStartupAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_STARTUP_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= hangingStartupAttempts) return;",
      "    write({ jsonrpc: '2.0', id: message.id, result: { userAgent: 'fake-codex-app-server', codexHome: '/tmp/fake-codex-home', platformFamily: 'unix', platformOs: 'macos' } });",
      "    return;",
      "  }",
      "  if (message.method === 'initialized') return;",
      "  if (message.method === 'collaborationMode/list') {",
      "    write({ jsonrpc: '2.0', id: message.id, result: { data: [",
      "      { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' },",
      "      { name: 'Default', mode: 'default', model: null, reasoning_effort: null },",
      "    ] } });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/resume') {",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_NO_ROLLOUT === '1') {",
      "      write({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'no rollout found for thread id ' + message.params.threadId } });",
      "      return;",
      "    }",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_EPHEMERAL_RESUME === '1' && message.params.threadId === 'thread-fork-1') {",
      "      write({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'no rollout found for thread id thread-fork-1' } });",
      "      return;",
      "    }",
      "    const hangingResumeAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_RESUME_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= hangingResumeAttempts) return;",
      "    const model = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL === '1' ? {} : { model: 'gpt-5' };",
      "    const threadSource = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_SOURCE ?? 'user';",
      "    write({ jsonrpc: '2.0', id: message.id, result: { thread: buildThread(message.params.threadId, threadSource), ...model, modelProvider: 'openai', serviceTier: null, cwd: message.params.cwd, instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'client', sandbox: { mode: 'read-only' }, reasoningEffort: null } });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/fork') {",
      "    write({ jsonrpc: '2.0', id: message.id, result: { thread: buildThread('thread-fork-1') } });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/name/set') {",
      "    write({ jsonrpc: '2.0', id: message.id, result: {} });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/start') {",
      "    const hangingThreadStartAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_THREAD_START_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= hangingThreadStartAttempts) return;",
      "    const model = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL === '1' ? {} : { model: 'gpt-5' };",
      "    write({ jsonrpc: '2.0', id: message.id, result: { thread: buildThread('thread-new-1', message.params.threadSource), ...model, modelProvider: 'openai', serviceTier: null, cwd: message.params.cwd, instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'client', sandbox: { mode: 'read-only' }, reasoningEffort: null } });",
      "    return;",
      "  }",
      "  if (message.method === 'turn/start') {",
      "    const hangingTurnStartAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_TURN_START_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= hangingTurnStartAttempts) return;",
      "    const prompt = message.params.input[0].text;",
      "    const cwd = message.params.cwd;",
      "    write({ jsonrpc: '2.0', id: message.id, result: { turn: { id: 'turn-1', items: [], itemsView: 'complete', status: 'inProgress', error: null, startedAt: 1, completedAt: null, durationMs: null } } });",
      "    activeTurn = { cwd, prompt, threadId: message.params.threadId, turnId: 'turn-1' };",
      "    turnCompleted = false;",
      "    const serverRequest = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST;",
      "    if (serverRequest) {",
      "      const parsed = JSON.parse(serverRequest);",
      "      pendingServerRequest = { id: 700, method: parsed.method };",
      "      write({ jsonrpc: '2.0', id: pendingServerRequest.id, method: parsed.method, params: parsed.params });",
      "      if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_EXIT_AFTER_REQUEST === '1') setImmediate(() => process.exit(0));",
      "      return;",
      "    }",
      "    const delayMs = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS ?? '10');",
      "    completionTimer = setTimeout(() => completeTurn('completed'), delayMs);",
      "    return;",
      "  }",
      "  if (message.method === 'turn/interrupt') {",
      "    write({ jsonrpc: '2.0', id: message.id, result: {} });",
      "    if (completionTimer) clearTimeout(completionTimer);",
      "    completeTurn('interrupted');",
      "    return;",
      "  }",
      "  write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported method ' + message.method } });",
      "};",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      "  buffer += chunk;",
      "  while (true) {",
      "    const index = buffer.indexOf('\\n');",
      "    if (index < 0) break;",
      "    const line = buffer.slice(0, index).trim();",
      "    buffer = buffer.slice(index + 1);",
      "    if (line) handle(JSON.parse(line));",
      "  }",
      "});",
    ].join("\n"),
    "utf8"
  );
};

const readFakeAppServerMethods = async (logPath) => {
  const text = await readFile(logPath, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).method);
};

const readFakeAppServerMessages = async (logPath) => {
  const text = await readFile(logPath, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const waitForFakeAppServerMethod = async (
  logPath,
  expectedMethod,
  timeoutMs = 1000
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const messages = await readFakeAppServerMessages(logPath);
      const message = messages.find(
        (candidate) => candidate.method === expectedMethod
      );
      if (message) {
        return message;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fake app-server ${expectedMethod}`);
};

const countDangerousBypassFlags = (args) =>
  args.filter((arg) => arg === DANGEROUS_BYPASS_FLAG).length;

const validateCodexTelemetry = (telemetry, input) => {
  if (!telemetry || typeof telemetry !== "object") {
    throw new Error("Expected codex telemetry to be an object");
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

test("codex adapter dispatch uses dispatch-time runtime context for spawn cwd", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-dispatch-"));
  const fixturePath = join(fixtureDir, "codex-fixture-runtime-cwd.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-runtime-cwd-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: process.cwd() } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      enableLocalCliTransport: true,
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
      agentControllerConversationId: "thread-runtime-cwd-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-runtime-cwd-1",
        agentControllerConversationKind: "thread",
      },
    });
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "final",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex adapter keeps runtime cwd isolated across different profiles on the same controller", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const profileADir = await mkdtemp(join(tmpdir(), "codex-profile-a-"));
  const profileBDir = await mkdtemp(join(tmpdir(), "codex-profile-b-"));
  const fixturePath = join(fixtureDir, "codex-fixture-profile-isolation.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const profileName = process.cwd().split('/').filter(Boolean).at(-1) ?? 'unknown';",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-' + profileName }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: process.cwd() } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      enableLocalCliTransport: true,
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
      `thread-${expectedProfileADir.split("/").filter(Boolean).at(-1)}`
    );
    assert.equal(
      resultB.contextDelta?.agentControllerConversationId,
      `thread-${expectedProfileBDir.split("/").filter(Boolean).at(-1)}`
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(profileADir, { force: true, recursive: true });
    await rm(profileBDir, { force: true, recursive: true });
  }
});

test("invokeCodexCliTransport builds valid exec args for repair and resume modes", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const tempDir = await mkdtemp(join(tmpdir(), "openmeld-codex-cli-args-"));
  const argsPath = join(tempDir, "args.json");
  const fakeBinPath = join(tempDir, "fake-codex.mjs");

  await writeFile(
    fakeBinPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argsPath = process.env.OPENMELD_CODEX_ARGS_PATH;
if (!argsPath) {
  throw new Error("OPENMELD_CODEX_ARGS_PATH is required");
}
writeFileSync(argsPath, JSON.stringify(process.argv.slice(2)));
readFileSync(0, "utf8");
console.log(JSON.stringify({ type: "response.completed", response: { output_text: "ok" } }));
`,
    "utf8"
  );
  await chmod(fakeBinPath, 0o755);

  try {
    await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      executionMode: "repair",
      prompt: "repair me",
      threadId: null,
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-s",
      "read-only",
      "-a",
      "untrusted",
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);

    await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      executionMode: "repair",
      prompt: "resume me",
      threadId: "thread-1",
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-s",
      "read-only",
      "-a",
      "untrusted",
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "thread-1",
      "-",
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("codex cli transport maps turn.failed sandbox denial to public runtime permission copy", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-cli-dispatch-"));
  const fixturePath = join(fixtureDir, "codex-fixture-permission.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-permission-1' }));",
      "console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'Command denied by sandbox: write access outside workspace' } }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        prompt: "write outside workspace",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, CODEX_COMMAND_DENIED_BY_SANDBOX_RE);
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

test("invokeCodexCliTransport applies Agent Controller Permission Mode flags in spawned argv", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const tempDir = await mkdtemp(join(tmpdir(), "openmeld-codex-policy-args-"));
  const argsPath = join(tempDir, "args.json");
  const fakeBinPath = join(tempDir, "fake-codex.mjs");

  await writeFile(
    fakeBinPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argsPath = process.env.OPENMELD_CODEX_ARGS_PATH;
if (!argsPath) {
  throw new Error("OPENMELD_CODEX_ARGS_PATH is required");
}
writeFileSync(argsPath, JSON.stringify(process.argv.slice(2)));
readFileSync(0, "utf8");
console.log(JSON.stringify({ type: "response.completed", response: { output_text: "ok" } }));
`,
    "utf8"
  );
  await chmod(fakeBinPath, 0o755);

  try {
    await invokeCodexCliTransport({
      agentControllerPermissionMode: "codex:approveForMe",
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      prompt: "approve for me",
      threadId: "thread-approve-for-me",
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-s",
      "workspace-write",
      "-a",
      "on-request",
      "-c",
      'approvals_reviewer="auto_review"',
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "thread-approve-for-me",
      "-",
    ]);

    await invokeCodexCliTransport({
      agentControllerPermissionMode: "codex:fullAccess",
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      prompt: "full access",
      threadId: "thread-bypass",
    });

    const bypassArgs = JSON.parse(await readFile(argsPath, "utf8"));
    assert.equal(countDangerousBypassFlags(bypassArgs), 1);
    assert.deepEqual(bypassArgs, [
      "exec",
      "resume",
      DANGEROUS_BYPASS_FLAG,
      "--json",
      "--skip-git-repo-check",
      "thread-bypass",
      "-",
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport keeps the controller process out of the workspace while dispatching there", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-dispatch-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const runtimeEvents = [];
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_CONTEXT_COMPACTION: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_TOKEN_USAGE: JSON.stringify({
          last: {
            cacheWriteInputTokens: 0,
            cachedInputTokens: 800,
            inputTokens: 1000,
            outputTokens: 40,
            reasoningOutputTokens: 20,
            totalTokens: 1060,
          },
          modelContextWindow: 258_400,
          total: {
            cacheWriteInputTokens: 0,
            cachedInputTokens: 1400,
            inputTokens: 1800,
            outputTokens: 70,
            reasoningOutputTokens: 30,
            totalTokens: 1900,
          },
        }),
      },
      onRuntimeEvent: (event) => {
        runtimeEvents.push(event);
      },
      agentControllerPermissionMode: "codex:approveForMe",
      prompt: "hello from app-server",
      taskId: "task-app-server-dispatch",
      threadId: "thread-existing-1",
    });
    const expectedControllerDir = await realpath(tmpdir());
    const methods = await readFakeAppServerMethods(logPath);
    const messages = await readFakeAppServerMessages(logPath);

    assert.equal(result.threadId, "thread-existing-1");
    assert.equal(
      messages[0].argv.some((arg) =>
        arg.startsWith("mcp_servers.openmeld_internal_dispatch_space_action.")
      ),
      false
    );
    assert.equal(
      result.output,
      `app-server:${expectedControllerDir}:${dispatchDir}:hello from app-server`
    );
    assert.deepEqual(methods, [
      "initialize",
      "initialized",
      "thread/resume",
      "turn/start",
    ]);
    const processSpawnedEvent = runtimeEvents.find(
      (event) => event.phase === "process_spawned"
    );
    assert.ok(processSpawnedEvent);
    assert.equal(processSpawnedEvent.processLaunchKind, "package_entrypoint");
    assert.equal(
      processSpawnedEvent.processWorkingDirectoryKind,
      "runtime_host"
    );
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params.cwd,
      dispatchDir
    );
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params
        .excludeTurns,
      true
    );
    assert.equal(
      messages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      messages.find((message) => message.method === "turn/start").params.cwd,
      dispatchDir
    );
    assert.deepEqual(
      runtimeEvents
        .filter((event) => event.phase === "provider_conversation_observed")
        .map((event) => event.agentControllerConversationId),
      ["thread-existing-1"]
    );
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: true,
      streamingMode: "final",
    });
    assert.equal(result.telemetry.contextCompactionObserved, true);
    assert.deepEqual(result.telemetry.tokenUsage, {
      last: {
        cacheWriteInputTokens: 0,
        cachedInputTokens: 800,
        inputTokens: 1000,
        outputTokens: 40,
        reasoningOutputTokens: 20,
        totalTokens: 1060,
      },
      modelContextWindow: 258_400,
      total: {
        cacheWriteInputTokens: 0,
        cachedInputTokens: 1400,
        inputTokens: 1800,
        outputTokens: 70,
        reasoningOutputTokens: 30,
        totalTokens: 1900,
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test(
  "codex app-server launches the official packaged native runtime without the Node wrapper",
  {
    skip:
      process.platform === "win32" ||
      !CODEX_PLATFORM_LAYOUTS[`${process.platform}-${process.arch}`],
  },
  async () => {
    const { invokeCodexAppServerTransport } = await import("../dist/index.js");
    const { buildCodexAppServerLaunch } = await import(
      "../dist/transport/codex-app-server-launch.js"
    );
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-runtime-"));
    const dispatchDir = await mkdtemp(
      join(tmpdir(), "codex-native-runtime-dispatch-")
    );
    const packageRoot = join(fixtureDir, "codex");
    const scriptPath = join(packageRoot, "bin", "codex.js");
    const layout =
      CODEX_PLATFORM_LAYOUTS[`${process.platform}-${process.arch}`];
    const platformPackageRoot = join(
      packageRoot,
      "node_modules",
      ...layout.packageName.split("/")
    );
    const nativePath = join(
      platformPackageRoot,
      "vendor",
      layout.targetTriple,
      "bin",
      "codex"
    );
    const logPath = join(fixtureDir, "rpc-log.jsonl");

    await mkdir(join(packageRoot, "bin"), { recursive: true });
    await mkdir(join(nativePath, ".."), { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        bin: { codex: "bin/codex.js" },
        name: "@openai/codex",
      }),
      "utf8"
    );
    await writeFile(
      join(platformPackageRoot, "package.json"),
      JSON.stringify({ name: "@openai/codex" }),
      "utf8"
    );
    await writeFile(
      scriptPath,
      "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
      "utf8"
    );
    await writeFakeCodexAppServerFixture(nativePath);
    await chmod(scriptPath, 0o755);
    await chmod(nativePath, 0o755);

    try {
      const expectedNativePath = await realpath(nativePath);
      const expectedPackageRoot = await realpath(packageRoot);
      const launch = buildCodexAppServerLaunch({
        args: ["app-server", "--listen", "stdio://"],
        env: {},
        launchContract: {
          ...createNodeScriptLaunchContract(scriptPath),
          argsPrefix: ["--official-prefix"],
        },
      });
      assert.equal(launch.bin, expectedNativePath);
      assert.equal(launch.processLaunchKind, "native_binary");
      assert.deepEqual(launch.args, [
        "--official-prefix",
        "app-server",
        "--listen",
        "stdio://",
      ]);
      assert.equal(launch.env.CODEX_MANAGED_PACKAGE_ROOT, expectedPackageRoot);
      assert.equal(launch.env.CODEX_MANAGED_BY_NPM, "1");
      assert.equal(launch.env.CODEX_MANAGED_BY_BUN, undefined);
      assert.equal(launch.env.CODEX_MANAGED_BY_PNPM, undefined);
      const result = await invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(scriptPath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        },
        prompt: "launch the official packaged native runtime",
        // This is a real child-process startup under the full parallel suite.
        // Keep the assertion bounded without making scheduler contention the test.
        startupTimeoutMs: 3000,
        taskId: "task-native-runtime",
        threadId: null,
      });
      const messages = await readFakeAppServerMessages(logPath);

      assert.match(result.output, NATIVE_RUNTIME_OUTPUT_RE);
      assert.equal(messages[0].managedPackageRoot, expectedPackageRoot);
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
      await rm(dispatchDir, { force: true, recursive: true });
    }
  }
);

test("codex app-server creates new OpenMeld threads with native developer instructions", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-new-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-native-new-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: { OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      prompt: "complete fallback prompt",
      taskId: "task-native-new",
      threadId: null,
    });

    const messages = await readFakeAppServerMessages(logPath);
    const threadStart = messages.find(
      (message) => message.method === "thread/start"
    );
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );

    assert.equal(
      threadStart.params.threadSource,
      "openmeld/openmeld-native-instructions-v1:abc123"
    );
    assert.equal(
      threadStart.params.developerInstructions,
      "stable OpenMeld contract"
    );
    assert.equal(turnStart.params.input[0].text, "current Wake only");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server keeps the complete fallback prompt for legacy resumed threads", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-legacy-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-native-legacy-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: { OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      prompt: "complete fallback prompt",
      taskId: "task-native-legacy",
      threadId: "legacy-thread",
    });

    const messages = await readFakeAppServerMessages(logPath);
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );
    assert.equal(turnStart.params.input[0].text, "complete fallback prompt");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server reuses the native user prompt on matching resumed threads", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-resume-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-native-resume-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_SOURCE:
          "openmeld/openmeld-native-instructions-v1:abc123",
      },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "second Wake only",
      },
      prompt: "complete second fallback prompt",
      taskId: "task-native-resume",
      threadId: "native-thread",
    });

    const messages = await readFakeAppServerMessages(logPath);
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );
    assert.equal(turnStart.params.input[0].text, "second Wake only");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server waits for an OpenMeld permission response and resumes the same turn", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-interaction-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-interaction-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "item/commandExecution/requestApproval",
          params: {
            availableDecisions: [
              "accept",
              "acceptForSession",
              "decline",
              "cancel",
            ],
            command: "git push origin feature",
            cwd: dispatchDir,
            itemId: "command-1",
            reason: "This command needs network access.",
            startedAtMs: Date.now(),
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          kind: "permission",
          optionId: request.options.find(
            (option) => option.intent === "allow_session"
          ).optionId,
        });
      },
      agentControllerPermissionMode: "codex:askForApproval",
      prompt: "push the branch",
      taskId: "task-app-server-interaction",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.equal(result.threadId, "thread-existing-1");
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      description: "This command needs network access.",
      kind: "permission",
      options: [
        {
          intent: "allow_once",
          label: "Allow once",
          optionId: "codex-command-decision-0",
        },
        {
          intent: "allow_session",
          label: "Allow for this session",
          optionId: "codex-command-decision-1",
        },
        {
          intent: "deny",
          label: "Deny",
          optionId: "codex-command-decision-2",
        },
      ],
      subject: {
        command: "git push origin feature",
        cwd: dispatchDir,
        type: "command",
      },
      title: "Allow Codex to run this command?",
    });
    assert.deepEqual(response.result, { decision: "acceptForSession" });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server fails promptly when it exits during a human decision", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-exit-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-exit-dispatch-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  let resolveInteraction;
  const interactionResponse = new Promise((resolve) => {
    resolveInteraction = resolve;
  });

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const startedAt = Date.now();
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_EXIT_AFTER_REQUEST: "1",
          OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
            method: "item/commandExecution/requestApproval",
            params: {
              availableDecisions: ["accept", "decline"],
              command: "git push origin feature",
              itemId: "command-1",
              threadId: "thread-existing-1",
              turnId: "turn-1",
            },
          }),
        },
        onInteractionRequest: () => interactionResponse,
        agentControllerPermissionMode: "codex:askForApproval",
        prompt: "push the branch",
        taskId: "task-app-server-exit",
        threadId: "thread-existing-1",
      }),
      (error) => error?.code === "upstream_unreachable"
    );
    assert.ok(Date.now() - startedAt < 1000);

    resolveInteraction({
      kind: "permission",
      optionId: "codex-command-decision-0",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server carries request_user_input questions and returns provider answer values", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-question-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-question-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "item/tool/requestUserInput",
          params: {
            autoResolutionMs: null,
            itemId: "question-1",
            questions: [
              {
                header: "Deployment",
                id: "environment",
                isOther: true,
                isSecret: false,
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
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
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
      conversationPolicy: {
        collaborationMode: "plan",
      },
      prompt: "run smoke",
      taskId: "task-app-server-question",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.deepEqual(
      messages
        .filter((message) => message.method)
        .map((message) => message.method)
        .filter((method) => method === "collaborationMode/list"),
      ["collaborationMode/list"]
    );
    assert.deepEqual(turnStart.params.collaborationMode, {
      mode: "plan",
      settings: {
        developer_instructions: null,
        model: "gpt-5",
        reasoning_effort: "medium",
      },
    });
    assert.deepEqual(requests, [
      {
        kind: "question",
        questions: [
          {
            allowOther: true,
            header: "Deployment",
            multiple: false,
            options: [
              {
                description: "Use the local development lane.",
                label: "Localhost",
                optionId: "environment-option-0",
              },
              {
                description: "Use the production lane.",
                label: "Production",
                optionId: "environment-option-1",
              },
            ],
            prompt: "Where should I run the smoke test?",
            questionId: "environment",
          },
        ],
        title: "Codex needs your input",
      },
    ]);
    assert.deepEqual(response.result, {
      answers: {
        environment: {
          answers: ["Localhost"],
        },
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server carries MCP form elicitations and preserves typed values", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-mcp-form-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-mcp-form-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "mcpServer/elicitation/request",
          params: {
            message: "Choose where and how to deploy.",
            mode: "form",
            requestedSchema: {
              properties: {
                region: {
                  description: "Choose a region.",
                  oneOf: [
                    { const: "us-east-1", title: "US East" },
                    { const: "us-west-2", title: "US West" },
                  ],
                  title: "Region",
                  type: "string",
                },
                dry_run: {
                  description: "Run without applying changes?",
                  type: "boolean",
                },
                replicas: {
                  description: "How many replicas?",
                  type: "integer",
                },
              },
              required: ["region", "replicas"],
              type: "object",
            },
            serverName: "deployment",
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          answers: request.questions.map((question) => {
            if (question.header === "Region") {
              return {
                questionId: question.questionId,
                values: [question.options[0].optionId],
              };
            }
            if (question.header === "dry_run") {
              return {
                questionId: question.questionId,
                values: [
                  question.options.find((option) => option.label === "Skip")
                    .optionId,
                ],
              };
            }
            return {
              questionId: question.questionId,
              values: ["3"],
            };
          }),
          kind: "question",
        });
      },
      prompt: "deploy the service",
      taskId: "task-app-server-mcp-form",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, "question");
    assert.equal(requests[0].title, "deployment needs your input");
    assert.equal(requests[0].questions.length, 3);
    assert.deepEqual(
      requests[0].questions[0].options.map((option) => option.label),
      ["US East", "US West"]
    );
    assert.deepEqual(
      requests[0].questions[1].options.map((option) => option.label),
      ["Yes", "No", "Skip"]
    );
    assert.equal(requests[0].questions[2].allowOther, true);
    assert.deepEqual(response.result, {
      action: "accept",
      content: {
        region: "us-east-1",
        replicas: 3,
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server carries MCP URL elicitations", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-mcp-url-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-mcp-url-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "mcpServer/elicitation/request",
          params: {
            elicitationId: "oauth-1",
            message: "Connect your deployment account.",
            mode: "url",
            serverName: "deployment",
            threadId: "thread-existing-1",
            turnId: "turn-1",
            url: "https://example.com/connect",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          kind: "permission",
          optionId: request.options[0].optionId,
        });
      },
      prompt: "connect the deployment account",
      taskId: "task-app-server-mcp-url",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.deepEqual(requests, [
      {
        description: "Connect your deployment account.",
        kind: "permission",
        options: [
          {
            intent: "allow_once",
            label: "I've completed this step",
            optionId: "codex-mcp-elicitation-completed",
          },
          {
            intent: "deny",
            label: "Decline",
            optionId: "codex-mcp-elicitation-decline",
          },
        ],
        subject: {
          resource: "https://example.com/connect",
          type: "tool",
        },
        title: "deployment needs your attention",
      },
    ]);
    assert.deepEqual(response.result, { action: "accept" });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server interrupts the active turn when a person cancels a question", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "codex-app-question-cancel-")
  );
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-question-cancel-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
    });
    const result = await adapter.dispatch({
      agentId: "agt-codex-question-cancel",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "item/tool/requestUserInput",
          params: {
            itemId: "question-1",
            questions: [
              {
                header: "Deployment",
                id: "environment",
                isOther: true,
                isSecret: false,
                options: [],
                question: "Where should I run the smoke test?",
              },
            ],
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: () => ({ kind: "cancel" }),
      prompt: "ask before running smoke",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-codex-question-cancel",
      spaceId: "space-1",
      taskId: "task-codex-question-cancel",
      transportMode: "codex-app-server",
    });
    const messages = await readFakeAppServerMessages(logPath);

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "interaction.cancelled");
    assert.deepEqual(
      messages.find((message) => message.method === "turn/interrupt")?.params,
      {
        threadId: "thread-existing-1",
        turnId: "turn-1",
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server transport maps failed turn approval denial to public runtime permission copy", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-dispatch-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE:
            "Execution denied: Execution forbidden by policy",
        },
        prompt: "run a blocked command",
        taskId: "task-app-server-permission",
        threadId: "thread-existing-1",
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, CODEX_EXECUTION_DENIED_RE);
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

test("codex app-server transport submits structured Usage exhaustion and a bounded original error", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-dispatch-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const usageLimitMessage =
    "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:03 AM.";

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE:
            usageLimitMessage,
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_CODEX_ERROR_INFO:
            "usageLimitExceeded",
        },
        prompt: "reply",
        taskId: "task-app-server-usage-limit",
        threadId: "thread-existing-1",
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(
          error.providerAccessEvidence.reasonCode,
          "usage_exhausted"
        );
        assert.equal(error.message, usageLimitMessage);
        assert.equal(error.originalError, usageLimitMessage);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex cli text can explain Usage exhaustion without changing Wakeability", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-usage-limit.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'turn.failed', error: { message: \"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:03 AM.\" } }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 1000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.match(error.message, USAGE_LIMIT_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex adapter interrupts active app-server turns by task id", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-interrupt-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-interrupt-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
    });
    const dispatchPromise = adapter.dispatch({
      agentId: "agt-codex-interrupt",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "5000",
      },
      prompt: "keep working until interrupted",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-codex-interrupt",
      spaceId: "space-1",
      taskId: "task-codex-interrupt",
      transportMode: "codex-app-server",
    });

    await waitForFakeAppServerMethod(logPath, "turn/start");
    const interruptResult = await adapter.interrupt({
      mode: "force",
      reason: "wake.stop",
      taskId: "task-codex-interrupt",
    });
    const dispatchResult = await dispatchPromise;
    const messages = await readFakeAppServerMessages(logPath);
    const interruptMessage = messages.find(
      (message) => message.method === "turn/interrupt"
    );

    assert.deepEqual(interruptResult, {
      accepted: true,
      plan: {
        initial: {
          mode: "force",
          reason: "wake.stop",
          taskId: "task-codex-interrupt",
        },
      },
      reasonCode: "accepted",
      signalDelivery: "sent",
      taskId: "task-codex-interrupt",
    });
    assert.equal(dispatchResult.status, "success");
    assert.equal(dispatchResult.output, "");
    assert.deepEqual(interruptMessage.params, {
      threadId: "thread-new-1",
      turnId: "turn-1",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport preserves thread id when app-server turn completes without agent output", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-empty-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-empty-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_EMPTY_OUTPUT: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      prompt: "reply through openmeld space action only",
      taskId: "task-app-server-empty-output",
      threadId: "thread-existing-empty-1",
    });
    const methods = await readFakeAppServerMethods(logPath);

    assert.equal(result.threadId, "thread-existing-empty-1");
    assert.equal(result.output, "");
    assert.deepEqual(methods, [
      "initialize",
      "initialized",
      "thread/resume",
      "turn/start",
    ]);
    assert.equal(result.telemetry.resumedContext, true);
    assert.equal(result.telemetry.firstOutputAtMs, undefined);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServer retries one startup timeout before beginning a turn", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-startup-retry-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-startup-retry-dispatch-")
  );
  const attemptPath = join(fixtureDir, "startup-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServer({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: null,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_HANG_STARTUP_ATTEMPTS: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
      },
      onProcessControlEvent: (event) => processEvents.push(event),
      prompt: "start safely after one transient bootstrap failure",
      startupTimeoutMs: 500,
      taskId: "task-app-server-startup-retry",
      threadId: null,
    });

    assert.match(result.output, STARTUP_RETRY_OUTPUT_RE);
    const methods = await readFakeAppServerMethods(logPath);
    assert.equal(methods.filter((method) => method === "initialize").length, 2);
    assert.equal(methods.filter((method) => method === "turn/start").length, 1);
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      2
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServer stops after one automatic startup retry", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-startup-fail-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-startup-fail-dispatch-")
  );
  const attemptPath = join(fixtureDir, "startup-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServer({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: null,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_HANG_STARTUP_ATTEMPTS: "2",
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
        },
        onProcessControlEvent: (event) => processEvents.push(event),
        prompt: "do not retry indefinitely",
        startupTimeoutMs: 500,
        taskId: "task-app-server-startup-fail",
        threadId: null,
      }),
      (error) =>
        error.code === "runtime.startup_timeout" &&
        error.errorType === "timeout" &&
        STARTUP_RETRY_FAILURE_RE.test(error.message)
    );
    const methods = await readFakeAppServerMethods(logPath);
    assert.deepEqual(methods, ["initialize", "initialize"]);
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      2
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server admission budgets keep rollover fast without rejecting a cold fresh start", async () => {
  const { resolveCodexAppServerControlRequestTimeoutMs } = await import(
    "../dist/transport/codex-app-server-admission.js"
  );

  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "thread/resume",
    }),
    15_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "collaborationMode/list",
    }),
    15_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "thread/start",
    }),
    90_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "turn/start",
    }),
    90_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "thread/start",
      overrideMs: 50,
    }),
    50
  );
});

test("invokeCodexAppServer rolls forward after stalled resume and transient fresh-thread admission", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-resume-heal-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-resume-heal-dispatch-")
  );
  const attemptPath = join(fixtureDir, "resume-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServer({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: null,
      codexWorkdir: dispatchDir,
      controlRequestTimeoutMs: 50,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_HANG_RESUME_ATTEMPTS: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_HANG_THREAD_START_ATTEMPTS: "2",
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
      },
      onProcessControlEvent: (event) => processEvents.push(event),
      prompt: "continue the current Wake after automatic rollover",
      // This test exercises control-request recovery, not process startup timing.
      startupTimeoutMs: 5000,
      taskId: "task-app-server-resume-heal",
      threadId: "thread-stalled-1",
    });

    const messages = await readFakeAppServerMessages(logPath);
    assert.equal(result.threadId, "thread-new-1");
    assert.equal(result.contextHealed, true);
    assert.equal(result.telemetry.contextHealed, true);
    assert.equal(result.telemetry.resumedContext, true);
    assert.deepEqual(
      messages
        .filter((message) =>
          ["thread/resume", "thread/start", "turn/start"].includes(
            message.method
          )
        )
        .map((message) => message.method),
      ["thread/resume", "thread/start", "thread/start", "turn/start"]
    );
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      3
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServer does not resubmit an ambiguously acknowledged turn", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-turn-admission-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-turn-admission-dispatch-")
  );
  const attemptPath = join(fixtureDir, "turn-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServer({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: null,
        codexWorkdir: dispatchDir,
        controlRequestTimeoutMs: 50,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_HANG_TURN_START_ATTEMPTS: "1",
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
        },
        onProcessControlEvent: (event) => processEvents.push(event),
        prompt: "never duplicate a turn after an uncertain acknowledgement",
        startupTimeoutMs: 200,
        taskId: "task-app-server-turn-admission",
        threadId: null,
      }),
      (error) =>
        error.code === "runtime.turn_start_timeout" &&
        error.errorType === "timeout"
    );
    const messages = await readFakeAppServerMessages(logPath);
    assert.deepEqual(
      messages
        .filter((message) =>
          ["thread/start", "turn/start"].includes(message.method)
        )
        .map((message) => message.method),
      ["thread/start", "turn/start"]
    );
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      1
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("app-server startup timeout does not become a total turn timeout", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-long-turn-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-long-turn-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServer({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: null,
      codexWorkdir: dispatchDir,
      controlRequestTimeoutMs: 500,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "1200",
      },
      prompt: "allow a healthy long-running turn",
      startupTimeoutMs: 1000,
      taskId: "task-app-server-long-turn",
      threadId: null,
    });

    assert.match(result.output, LONG_TURN_OUTPUT_RE);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport preserves spaces from agent message delta fallback", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-delta-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-delta-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_DELTA_OUTPUT: JSON.stringify([
          "Hi",
          " Felix",
          ",",
          " I'm",
          " here.",
        ]),
        OPENMELD_FAKE_CODEX_APP_SERVER_EMPTY_OUTPUT: "1",
      },
      prompt: "reply through app-server deltas",
      taskId: "task-app-server-delta-output",
      threadId: "thread-existing-delta-1",
    });

    assert.equal(result.threadId, "thread-existing-delta-1");
    assert.equal(result.output, "Hi Felix, I'm here.");
    assert.equal(result.telemetry.firstOutputAtMs > 0, true);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport applies interactive Ask for approval policy to new app-server threads", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-policy-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-policy-dir-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      prompt: "new app-server thread",
      taskId: "task-app-server-default-policy",
      threadId: null,
    });
    const messages = await readFakeAppServerMessages(logPath);

    assert.equal(
      messages.find((message) => message.method === "thread/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      messages.find((message) => message.method === "thread/start").params
        .sandbox,
      "workspace-write"
    );
    assert.equal(
      messages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      "sandbox" in
        messages.find((message) => message.method === "turn/start").params,
      false
    );
    assert.equal(
      "sandboxPolicy" in
        messages.find((message) => message.method === "turn/start").params,
      false
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport isolates structured-action repair from the source thread", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-repair-policy-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-repair-dir-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:fullAccess",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_EPHEMERAL_RESUME: "1",
      },
      executionMode: "repair",
      prompt: "repair the structured Space action",
      taskId: "task-app-server-repair-policy",
      threadId: "thread-existing-repair-policy",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const forkParams = messages.find(
      (message) => message.method === "thread/fork"
    ).params;
    const turnParams = messages.find(
      (message) => message.method === "turn/start"
    ).params;

    assert.equal(result.threadId, "thread-existing-repair-policy");
    assert.equal(forkParams.threadId, "thread-existing-repair-policy");
    assert.equal(forkParams.ephemeral, true);
    assert.equal(forkParams.cwd, dispatchDir);
    assert.equal(forkParams.approvalPolicy, "untrusted");
    assert.equal(forkParams.sandbox, "read-only");
    assert.equal(
      messages.some((message) => message.method === "thread/resume"),
      false
    );
    assert.equal(turnParams.threadId, "thread-fork-1");
    assert.equal(turnParams.approvalPolicy, "untrusted");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport reports a missing rollout as missing context", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-no-rollout-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-no-rollout-dir-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_NO_ROLLOUT: "1",
        },
        prompt: "resume missing context",
        taskId: "task-app-server-no-rollout",
        threadId: "thread-missing-rollout",
      }),
      (error) =>
        error?.code === "context_not_found" && error?.errorType === "config"
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport does not require a thread model in Default collaboration mode", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-no-model-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-no-model-dir-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL: "1",
      },
      prompt: "default mode without a response model",
      taskId: "task-app-server-no-model",
      threadId: null,
    });

    assert.equal(result.threadId, "thread-new-1");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport requires a resolved model only for Plan collaboration mode", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-plan-no-model-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-plan-no-model-dir-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        conversationPolicy: {
          collaborationMode: "plan",
        },
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL: "1",
        },
        prompt: "plan without a response model",
        taskId: "task-app-server-plan-no-model",
        threadId: null,
      }),
      (error) =>
        error?.code === "protocol.invalid" &&
        error.message.includes(
          "Plan collaboration mode requires a resolved model"
        )
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport applies model and reasoning to every app-server turn", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-conversation-"));
  const newDispatchDir = await mkdtemp(join(tmpdir(), "codex-app-conv-new-"));
  const resumeDispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-conv-resume-")
  );
  const newLogPath = join(fixtureDir, "new-rpc-log.jsonl");
  const resumeLogPath = join(fixtureDir, "resume-rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: newDispatchDir,
      conversationPolicy: {
        model: "gpt-5.3-codex-spark",
        reasoningLevel: "low",
      },
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: newLogPath,
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(
          newDispatchDir,
          "space-action-context.json"
        ),
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: join(
          newDispatchDir,
          "openmeld-dev"
        ),
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      prompt: "new app-server thread with conversation policy",
      taskId: "task-app-server-conversation-new",
      threadId: null,
    });
    const newMessages = await readFakeAppServerMessages(newLogPath);
    const threadStartParams = newMessages.find(
      (message) => message.method === "thread/start"
    ).params;
    const newTurnStartParams = newMessages.find(
      (message) => message.method === "turn/start"
    ).params;
    assert.equal(
      newMessages[0].argv.includes(
        "mcp_servers.openmeld_internal_dispatch_space_action.required=true"
      ),
      true
    );
    assert.equal(newMessages[0].argv.includes("app-server"), true);
    assert.equal(threadStartParams.model, "gpt-5.3-codex-spark");
    assert.equal(newTurnStartParams.model, "gpt-5.3-codex-spark");
    assert.equal(newTurnStartParams.effort, "low");

    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: resumeDispatchDir,
      conversationPolicy: {
        model: "gpt-5.3-codex-spark",
        reasoningLevel: "low",
      },
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: resumeLogPath,
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(
          resumeDispatchDir,
          "space-action-context.json"
        ),
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: join(
          resumeDispatchDir,
          "openmeld-dev"
        ),
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      prompt: "resumed app-server thread with conversation policy",
      taskId: "task-app-server-conversation-resume",
      threadId: "thread-with-conversation-policy",
    });
    const resumeMessages = await readFakeAppServerMessages(resumeLogPath);
    const threadResumeParams = resumeMessages.find(
      (message) => message.method === "thread/resume"
    ).params;
    const resumeTurnStartParams = resumeMessages.find(
      (message) => message.method === "turn/start"
    ).params;
    assert.equal(
      resumeMessages[0].argv.includes(
        "mcp_servers.openmeld_internal_dispatch_space_action.required=true"
      ),
      true
    );
    assert.equal(resumeMessages[0].argv.includes("app-server"), true);
    assert.equal(threadResumeParams.model, "gpt-5.3-codex-spark");
    assert.equal(resumeTurnStartParams.model, "gpt-5.3-codex-spark");
    assert.equal(resumeTurnStartParams.effort, "low");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(newDispatchDir, { force: true, recursive: true });
    await rm(resumeDispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport applies bounded policy-driven approval params", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-bounded-policy-"));
  const trustedDispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-trusted-")
  );
  const bypassDispatchDir = await mkdtemp(join(tmpdir(), "codex-app-bypass-"));
  const boundedDispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-boundary-")
  );
  const trustedLogPath = join(fixtureDir, "trusted-rpc-log.jsonl");
  const bypassLogPath = join(fixtureDir, "bypass-rpc-log.jsonl");
  const boundedLogPath = join(fixtureDir, "bounded-rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:approveForMe",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: trustedDispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: trustedLogPath,
      },
      prompt: "approve app-server",
      taskId: "task-app-server-approve",
      threadId: null,
    });
    const trustedMessages = await readFakeAppServerMessages(trustedLogPath);
    assert.equal(
      trustedMessages.find((message) => message.method === "thread/start")
        .params.approvalPolicy,
      "on-request"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "thread/start")
        .params.sandbox,
      "workspace-write"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "thread/start")
        .params.approvalsReviewer,
      "auto_review"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "turn/start").params
        .approvalsReviewer,
      "auto_review"
    );
    assert.equal(
      "sandbox" in
        trustedMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );
    assert.equal(
      "sandboxPolicy" in
        trustedMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );

    await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:fullAccess",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: bypassDispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: bypassLogPath,
      },
      prompt: "bypass app-server",
      taskId: "task-app-server-bypass",
      threadId: "thread-bypass-app-server",
    });
    const bypassMessages = await readFakeAppServerMessages(bypassLogPath);
    assert.equal(
      bypassMessages.find((message) => message.method === "thread/resume")
        .params.approvalPolicy,
      "never"
    );
    assert.equal(
      bypassMessages.find((message) => message.method === "thread/resume")
        .params.sandbox,
      "danger-full-access"
    );
    assert.equal(
      bypassMessages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "never"
    );
    assert.equal(
      "sandbox" in
        bypassMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );
    assert.equal(
      "sandboxPolicy" in
        bypassMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );

    await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:approveForMe",
      computerFileAccessBoundary: {
        folders: [boundedDispatchDir],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: boundedDispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: boundedLogPath,
      },
      prompt: "bounded app-server",
      taskId: "task-app-server-boundary",
      threadId: null,
    });
    const boundedMessages = await readFakeAppServerMessages(boundedLogPath);
    const boundedThreadParams = boundedMessages.find(
      (message) => message.method === "thread/start"
    ).params;
    assert.equal(
      boundedMessages[0].argv.includes(
        `permissions.openmeld_computer_boundary={ extends = ":workspace", filesystem = { ":root" = "deny", ${JSON.stringify(boundedDispatchDir)} = "read", ${JSON.stringify(`${boundedDispatchDir}/**`)} = "read" } }`
      ),
      true
    );
    assert.equal(boundedThreadParams.approvalPolicy, "on-request");
    assert.equal("sandbox" in boundedThreadParams, false);
    assert.equal("sandboxPolicy" in boundedThreadParams, false);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(trustedDispatchDir, { force: true, recursive: true });
    await rm(bypassDispatchDir, { force: true, recursive: true });
    await rm(boundedDispatchDir, { force: true, recursive: true });
  }
});

test("verifyCodexAppServerThread proves thread control without starting a turn", async () => {
  const { verifyCodexAppServerThread } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-proof-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-proof-cwd-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await verifyCodexAppServerThread({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      threadId: "thread-proof-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const methods = messages.map((message) => message.method);

    assert.equal(result.threadId, "thread-proof-1");
    assert.deepEqual(methods, ["initialize", "initialized", "thread/resume"]);
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params
        .excludeTurns,
      true
    );
    assert.equal(
      "approvalPolicy" in
        messages.find((message) => message.method === "thread/resume").params,
      false
    );
    assert.equal(
      "sandbox" in
        messages.find((message) => message.method === "thread/resume").params,
      false
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("forkCodexAppServerThread forks the native thread and applies the OpenMeld title", async () => {
  const { forkCodexAppServerThread } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-fork-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-fork-cwd-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await forkCodexAppServerThread({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      sourceThreadId: "thread-source-1",
      title: "OpenMeld · Release Agent",
    });
    const messages = await readFakeAppServerMessages(logPath);

    assert.equal(result.threadId, "thread-fork-1");
    assert.deepEqual(
      messages.map((message) => message.method),
      ["initialize", "initialized", "thread/fork", "thread/name/set"]
    );
    assert.deepEqual(
      messages.find((message) => message.method === "thread/fork").params,
      { excludeTurns: true, threadId: "thread-source-1" }
    );
    assert.deepEqual(
      messages.find((message) => message.method === "thread/name/set").params,
      { name: "OpenMeld · Release Agent", threadId: "thread-fork-1" }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex cli transport parses successful result and thread id", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-success.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-success-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'hello from codex' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      prompt: "hello",
      threadId: null,
    });

    assert.deepEqual(
      {
        output: result.output,
        threadId: result.threadId,
      },
      {
        output: "hello from codex",
        threadId: "thread-success-1",
      }
    );
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "final",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport completes when provider terminal output arrives before process exit", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-terminal-output.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-terminal-output-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'terminal codex output' } }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 1000,
      codexWorkdir: process.cwd(),
      prompt: "hello",
      threadId: null,
    });

    assert.equal(result.output, "terminal codex output");
    assert.equal(result.threadId, "thread-terminal-output-1");
    assert.equal(result.telemetry.exitObservedAtMs, undefined);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport fails when provider terminal error arrives before process exit", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-terminal-error.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'insufficient_quota: quota exceeded for current billing period' } }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 1000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.equal(
          error.originalError,
          "insufficient_quota: quota exceeded for current billing period"
        );
        assert.match(error.message, QUOTA_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("adapter-codex default wait delays force escalation", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const gracefulTimeoutMs = 20;
  const expectedEscalationDelayMs = gracefulTimeoutMs;
  const observedWaits = [];
  const signalRecords = [];
  const adapter = createCodexAdapter({
    gracefulTimeoutMs,
    invoke: async () => ({
      output: "ok",
    }),
    sendInterrupt: (signal) => {
      signalRecords.push({
        signal,
      });
    },
    waitForMs: (delayMs) => {
      observedWaits.push(delayMs);
    },
  });

  await adapter.interrupt({
    taskId: "task-2",
  });

  assert.equal(signalRecords.length, 2);
  assert.equal(signalRecords[0]?.signal.mode, "graceful");
  assert.equal(signalRecords[1]?.signal.mode, "force");
  assert.deepEqual(observedWaits, [expectedEscalationDelayMs]);
});

test("adapter-codex reuses one exact file access capability attestation", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-boundary-probe-"));
  const fixturePath = join(fixtureDir, "codex-boundary-probe.mjs");
  const probeLogPath = join(fixtureDir, "probe-log.txt");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(probeLogPath)}, "probe\\n", "utf8");`,
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const request = {
      agentControllerPermissionMode: "codex:askForApproval",
      boundary: {
        folders: [fixtureDir],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      executionMode: "normal",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      transportMode: "local-cli",
      workingDirectory: fixtureDir,
    };

    assert.deepEqual(await adapter.verifyComputerFileAccessBoundary(request), {
      supported: true,
    });
    const firstAttestationLog = await readFile(probeLogPath, "utf8");
    assert.deepEqual(await adapter.verifyComputerFileAccessBoundary(request), {
      supported: true,
    });
    assert.equal(await readFile(probeLogPath, "utf8"), firstAttestationLog);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport maps auth failures from stdout events", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-auth.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-auth-1' }));",
      "console.log(JSON.stringify({ type: 'error', message: 'unexpected status 401 Unauthorized: Missing bearer token (request id: req_auth_1)' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "auth.required");
        assert.equal(error.errorType, "auth");
        assert.match(error.message, AUTH_401_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport forwards route env into the provider process", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-env.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const mode = process.env.OPENMELD_DISPATCH_RUNTIME_MODE || 'missing';",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'env:' + mode } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      env: {
        OPENMELD_DISPATCH_RUNTIME_MODE: "dispatch-owned-runtime",
      },
      prompt: "hello",
      threadId: null,
    });

    assert.equal(result.output, "env:dispatch-owned-runtime");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport ignores commentary messages before the final answer", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-commentary.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-commentary-1' }));",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: 'I will inspect first.' } }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'final public answer' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      prompt: "hello",
      threadId: null,
    });

    assert.equal(result.output, "final public answer");
    assert.equal(result.threadId, "thread-commentary-1");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport separates text-only Usage failures from rate limits", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");

  const quotaDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const quotaFixturePath = join(quotaDir, "codex-fixture-quota.mjs");
  await writeFile(
    quotaFixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'error', message: 'insufficient_quota: You exceeded your current quota.' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(quotaFixturePath, 0o755);

  const rateDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const rateFixturePath = join(rateDir, "codex-fixture-rate.mjs");
  await writeFile(
    rateFixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'error', message: '429 Too Many Requests: rate limit exceeded' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(rateFixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(quotaFixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.match(error.message, QUOTA_RE);
        return true;
      }
    );

    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(rateFixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "rate_limited");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.match(error.message, RATE_LIMIT_RE);
        return true;
      }
    );
  } finally {
    await rm(quotaDir, { force: true, recursive: true });
    await rm(rateDir, { force: true, recursive: true });
  }
});

test("codex cli transport maps invalid model configuration to config.invalid", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-invalid-model.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      'console.log(JSON.stringify({ type: \'error\', message: \'{\\n  "error": {\\n    "message": "The requested model \\\'gpt-5.3-codex-spark\\\' does not exist.",\\n    "type": "invalid_request_error",\\n    "param": "model",\\n    "code": "model_not_found"\\n  }\\n}\' }));',
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "config.invalid");
        assert.equal(error.errorType, "config");
        assert.match(error.message, MODEL_NOT_FOUND_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport maps upgrade-required model failures to controller.client.upgrade_required", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-upgrade-required.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      'console.log(JSON.stringify({ type: \'error\', message: `{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \\\'gpt-5.5\\\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.\\"}}` }));',
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "controller.client.upgrade_required");
        assert.equal(error.errorType, "config");
        assert.match(error.message, CODEX_UPGRADE_REQUIRED_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport does not emit a synthetic preview when output only arrives at completion", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-final-only-preview.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-final-only-preview-1' }));",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello from final only codex output' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const previews = [];
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      onPreview: (preview) => {
        previews.push(preview.text);
      },
      prompt: "hello",
      streamingMode: "stream",
      threadId: null,
    });

    assert.equal(result.output, "hello from final only codex output");
    assert.deepEqual(previews, []);
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "stream",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex invoke heals stale thread by retrying once without resume", async () => {
  const { invokeCodexWithSingleContextHeal } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-heal.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const resumeIndex = args.indexOf('resume');",
      "if (resumeIndex >= 0) {",
      "  const threadId = args[resumeIndex + 3] ?? 'unknown';",
      "  console.error('thread not found: ' + threadId);",
      "  process.exit(1);",
      "}",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-healed-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'healed codex output' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  const contextLostEvents = [];

  try {
    const result = await invokeCodexWithSingleContextHeal({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      onContextLost: () => {
        contextLostEvents.push("context-lost");
      },
      prompt: "hello",
      threadId: "thread-stale-1",
    });

    assert.deepEqual(
      {
        contextHealed: result.contextHealed,
        output: result.output,
        threadId: result.threadId,
      },
      {
        contextHealed: true,
        output: "healed codex output",
        threadId: "thread-healed-1",
      }
    );
    validateCodexTelemetry(result.telemetry, {
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

test("codex invoke returns context.rebuild_failed when retry also fails", async () => {
  const { invokeCodexWithSingleContextHeal } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-heal-fail.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.error('thread not found: stale-thread');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexWithSingleContextHeal({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: "thread-stale-2",
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

test("codex cli transport classifies no-output timeout as timed_out_no_output", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-timeout-no-output.mjs");
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
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 50,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
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

test("codex cli transport classifies unclassified non-zero exit as provider_exit_error", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-provider-exit-error.mjs");
  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "process.exit(7);"].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
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

test("codex adapter keeps bounded local paths out of every transport failure", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-boundary-error-"));
  const parentDir = join(fixtureDir, "private-parent");
  const workingDir = join(parentDir, "private-project");
  const additionalDir = join(fixtureDir, "private-additional");
  const cliFixturePath = join(fixtureDir, "fake-codex-cli-error.mjs");
  const appFixturePath = join(fixtureDir, "fake-codex-app-error.mjs");
  await Promise.all([
    mkdir(workingDir, { recursive: true }),
    mkdir(additionalDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      cliFixturePath,
      [
        "#!/usr/bin/env node",
        "if (process.argv.includes('--version')) { console.log('codex 1.0.0'); process.exit(0); }",
        "console.error(process.env.OPENMELD_FAKE_CODEX_BOUNDARY_ERROR);",
        "process.exit(1);",
      ].join("\n"),
      "utf8"
    ),
    writeFakeCodexAppServerFixture(appFixturePath),
  ]);
  await Promise.all([
    chmod(cliFixturePath, 0o755),
    chmod(appFixturePath, 0o755),
  ]);

  const privateFailure = [workingDir, parentDir, additionalDir].join(" | ");
  const boundary = {
    folders: [parentDir, additionalDir],
    mode: "only_selected_folders",
    revision: 2,
    updatedAtMs: 100,
  };

  try {
    const cliAdapter = createCodexAdapter({
      codexTimeoutMs: 5000,
      enableLocalCliTransport: true,
      launchContract: createNodeScriptLaunchContract(cliFixturePath),
    });
    const cliResult = await cliAdapter.dispatch({
      agentId: "agt-codex-boundary-cli-error",
      computerFileAccessBoundary: boundary,
      env: { OPENMELD_FAKE_CODEX_BOUNDARY_ERROR: privateFailure },
      prompt: "bounded cli failure",
      runtimeContext: createRuntimeContext(workingDir),
      sourceEventId: "evt-codex-boundary-cli-error",
      spaceId: "space-1",
      taskId: "task-codex-boundary-cli-error",
      transportMode: "local-cli",
    });

    const appAdapter = createCodexAdapter({
      codexTimeoutMs: 5000,
      launchContract: createNodeScriptLaunchContract(appFixturePath),
    });
    const appResult = await appAdapter.dispatch({
      agentId: "agt-codex-boundary-app-error",
      computerFileAccessBoundary: boundary,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE: privateFailure,
      },
      prompt: "bounded app failure",
      runtimeContext: createRuntimeContext(workingDir),
      sourceEventId: "evt-codex-boundary-app-error",
      spaceId: "space-1",
      taskId: "task-codex-boundary-app-error",
      transportMode: "codex-app-server",
    });

    for (const result of [cliResult, appResult]) {
      assert.equal(result.status, "failed");
      assert.equal(
        result.errorMessage,
        `${result.errorCode}: Codex failed while the Computer file access boundary was active. Local controller output was withheld because it may contain private folder paths.`
      );
      const outwardFailure = JSON.stringify(result);
      for (const privatePath of [workingDir, parentDir, additionalDir]) {
        assert.equal(outwardFailure.includes(privatePath), false);
      }
      assert.equal(result.errorType, "adapter");
    }

    const ordinaryResult = await cliAdapter.dispatch({
      agentId: "agt-codex-ordinary-cli-error",
      env: { OPENMELD_FAKE_CODEX_BOUNDARY_ERROR: "ordinary launch detail" },
      prompt: "ordinary cli failure",
      runtimeContext: createRuntimeContext(workingDir),
      sourceEventId: "evt-codex-ordinary-cli-error",
      spaceId: "space-1",
      taskId: "task-codex-ordinary-cli-error",
      transportMode: "local-cli",
    });
    assert.equal(ordinaryResult.status, "failed");
    assert.equal(
      JSON.stringify(ordinaryResult).includes("ordinary launch detail"),
      true
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});
