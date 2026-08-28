import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const AUTH_RE = /not logged in|login required|unauthorized|credentials/i;
const BAD_GATEWAY_RE = /Bad Gateway/i;
const PROVIDER_INSUFFICIENT_BALANCE_CODE_RE = /provider\.insufficient_balance/i;
const INSUFFICIENT_BALANCE_RE = /insufficient balance/i;
const PERMISSION_REQUESTED_RE = /permission requested/i;
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

const validateOpenCodeTelemetry = (telemetry, input) => {
  if (!telemetry || typeof telemetry !== "object") {
    throw new Error("Expected opencode telemetry to be an object");
  }

  const {
    completedAtMs,
    exitCode,
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
  if (exitCode !== 0) {
    throw new Error("Expected exitCode to be zero");
  }
  if (typeof firstStdoutAtMs !== "number") {
    throw new Error("Expected firstStdoutAtMs to be a number");
  }
  if (typeof processId !== "number") {
    throw new Error("Expected processId to be a number");
  }
  if (typeof processSpawnedAtMs !== "number") {
    throw new Error("Expected processSpawnedAtMs to be a number");
  }
  if (typeof stdinClosedAtMs !== "number") {
    throw new Error("Expected stdinClosedAtMs to be a number");
  }
};

test("opencode output parser accumulates text events and sessionID", async () => {
  const { parseOpenCodeOutputDocument } = await import("../dist/index.js");

  assert.deepEqual(
    parseOpenCodeOutputDocument(
      [
        JSON.stringify({
          type: "text",
          sessionID: "ses_123",
          part: { text: "hello " },
        }),
        JSON.stringify({
          type: "tool_use",
          sessionID: "ses_123",
          part: { tool: "bash" },
        }),
        JSON.stringify({
          type: "text",
          sessionID: "ses_123",
          part: { text: "world" },
        }),
      ].join("\n")
    ),
    {
      errorMessage: null,
      isErrorResult: null,
      outputText: "hello world",
      sessionId: "ses_123",
    }
  );
});

test("opencode output parser extracts nested error data messages", async () => {
  const { parseOpenCodeOutputDocument, parseOpenCodeOutputLine } = await import(
    "../dist/index.js"
  );

  const line = JSON.stringify({
    type: "error",
    timestamp: 1_782_818_374_884,
    sessionID: "ses_opencode_error",
    error: {
      name: "UnknownError",
      data: {
        message: "Token refresh failed: 401",
      },
    },
  });

  assert.deepEqual(parseOpenCodeOutputLine(line), {
    errorMessage: "Token refresh failed: 401",
    isErrorResult: true,
    resultText: null,
    sessionId: "ses_opencode_error",
    terminal: true,
  });
  assert.deepEqual(parseOpenCodeOutputDocument(line), {
    errorMessage: "Token refresh failed: 401",
    isErrorResult: true,
    outputText: null,
    sessionId: "ses_opencode_error",
  });
});

test("opencode output parser keeps failure words in agent text as content", async () => {
  const { parseOpenCodeOutputLine } = await import("../dist/index.js");
  const parsed = parseOpenCodeOutputLine(
    JSON.stringify({
      type: "text",
      sessionID: "ses_opencode_answer",
      message:
        "The earlier session error and invalid rate-limit failure are now fixed.",
    })
  );

  assert.deepEqual(parsed, {
    errorMessage: null,
    isErrorResult: null,
    resultText:
      "The earlier session error and invalid rate-limit failure are now fixed.",
    sessionId: "ses_opencode_answer",
    terminal: false,
  });
});

test("opencode output parser keeps a structured error authoritative without prose", async () => {
  const { parseOpenCodeOutputLine } = await import("../dist/index.js");

  assert.deepEqual(
    parseOpenCodeOutputLine(
      JSON.stringify({
        type: "error",
      })
    ),
    {
      errorMessage: null,
      isErrorResult: true,
      resultText: null,
      sessionId: null,
      terminal: true,
    }
  );
});

test("opencode output parser does not stringify object error payloads", async () => {
  const { parseOpenCodeOutputLine } = await import("../dist/index.js");

  assert.deepEqual(
    parseOpenCodeOutputLine(
      JSON.stringify({
        type: "error",
        sessionID: "ses_opencode_error_object",
        error: {
          name: "UnknownError",
          data: {
            retryable: false,
          },
        },
      })
    ),
    {
      errorMessage: null,
      isErrorResult: true,
      resultText: null,
      sessionId: "ses_opencode_error_object",
      terminal: true,
    }
  );
});

test("opencode cli transport passes cwd, prompt, model, variant, and session flags", async () => {
  const { invokeOpenCodeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "opencode-dispatch-"));
  const fixturePath = join(fixtureDir, "opencode-fixture-args.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { realpathSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const readArg = (name) => {",
      "  const index = args.indexOf(name);",
      "  return index >= 0 ? args[index + 1] : null;",
      "};",
      "if (args[0] !== 'run') throw new Error('missing run command');",
      "if (readArg('--format') !== 'json') throw new Error('missing json format');",
      "if (!args.includes('--print-logs')) throw new Error('missing print logs flag');",
      "if (realpathSync(readArg('--dir')) !== process.cwd()) throw new Error('expected spawn cwd as --dir');",
      "if (readArg('--model') !== 'openai/gpt-5.4') throw new Error('missing model');",
      "if (readArg('--variant') !== 'high') throw new Error('missing variant');",
      "if (readArg('--session') !== 'session-existing-1') throw new Error('missing session');",
      "const prompt = args[args.length - 1];",
      "console.log(JSON.stringify({ type: 'text', sessionID: 'session-existing-1', part: { text: prompt + ':' + process.cwd() } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeOpenCodeCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      conversationPolicy: {
        model: "openai/gpt-5.4",
        reasoningLevel: "high",
      },
      openCodeTimeoutMs: 5000,
      openCodeWorkdir: dispatchDir,
      prompt: "hello",
      sessionId: "session-existing-1",
    });

    const expectedDispatchDir = await realpath(dispatchDir);
    assert.deepEqual(
      {
        output: result.output,
        sessionId: result.sessionId,
      },
      {
        output: `hello:${expectedDispatchDir}`,
        sessionId: "session-existing-1",
      }
    );
    validateOpenCodeTelemetry(result.telemetry, {
      resumedContext: true,
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("opencode adapter dispatch returns canonical session conversation", async () => {
  const { createOpenCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-fixture-"));
  const fixturePath = join(fixtureDir, "opencode-fixture-dispatch.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'text', sessionID: 'opencode-session-1', part: { text: 'hello from opencode' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createOpenCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
    });

    const dispatchResult = await adapter.dispatch({
      agentId: "agt-demo",
      conversationPolicy: {
        model: "openai/gpt-5.4",
        reasoningLevel: "high",
      },
      prompt: "hello",
      runtimeContext: createRuntimeContext(),
      sourceEventId: "evt-opencode-1",
      spaceId: "space-1",
      taskId: "task-opencode-1",
    });

    assert.equal(dispatchResult.status, "success");
    assert.equal(dispatchResult.output, "hello from opencode");
    assert.deepEqual(dispatchResult.contextDelta, {
      agentControllerConversationId: "opencode-session-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:opencode",
        agentControllerConversationId: "opencode-session-1",
        agentControllerConversationKind: "session",
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("opencode adapter dispatch passes official OpenCode permission env", async () => {
  const { createOpenCodeAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-fixture-"));
  const fixturePath = join(fixtureDir, "opencode-fixture-permission-env.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({",
      "  type: 'text',",
      "  sessionID: 'opencode-session-permission-env',",
      "  part: {",
      "    text: JSON.stringify({",
      "      config: process.env.OPENCODE_CONFIG_CONTENT ?? null,",
      "      permission: process.env.OPENCODE_PERMISSION ?? null,",
      "      passthrough: process.env.OPENMELD_TEST_ENV ?? null,",
      "    }),",
      "  },",
      "}));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createOpenCodeAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      openCodeTimeoutMs: 5000,
    });
    const openCodePermission = {
      bash: {
        "*": "deny",
        "git status *": "allow",
      },
      edit: "ask",
      websearch: "allow",
    };

    const dispatchResult = await adapter.dispatch({
      agentId: "agt-demo",
      env: {
        OPENCODE_PERMISSION: '{"edit":"allow"}',
        OPENMELD_TEST_ENV: "kept",
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: "/tmp/action/bin/openmeld-dev",
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      openCodePermission,
      prompt: "hello",
      runtimeContext: createRuntimeContext(),
      sourceEventId: "evt-opencode-permission-env",
      spaceId: "space-1",
      taskId: "task-opencode-permission-env",
    });

    assert.equal(dispatchResult.status, "success");
    assert.deepEqual(JSON.parse(dispatchResult.output), {
      config: JSON.stringify({
        mcp: {
          openmeld_internal_dispatch_space_action: {
            command: [
              "/tmp/action/bin/openmeld-dev",
              "space",
              "action",
              "tool-server",
            ],
            enabled: true,
            environment: {
              OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
              OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH:
                "/tmp/action/bin/openmeld-dev",
              OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
            },
            type: "local",
          },
        },
        tools: {
          openmeld_internal_dispatch_space_action_reply: true,
          openmeld_internal_dispatch_space_action_status: true,
          openmeld_internal_dispatch_space_action_stay_silent: true,
        },
      }),
      permission: JSON.stringify({
        ...openCodePermission,
        openmeld_internal_dispatch_space_action_reply: "allow",
        openmeld_internal_dispatch_space_action_status: "allow",
        openmeld_internal_dispatch_space_action_stay_silent: "allow",
      }),
      passthrough: "kept",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("opencode cli transport stops after repeated provider stderr failures", async () => {
  const { invokeOpenCodeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-fixture-"));
  const fixturePath = join(fixtureDir, "opencode-fixture-bad-gateway.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "let count = 0;",
      "const retryInterval = setInterval(() => {",
      "  count += 1;",
      "  console.error('AI_APICallError: Bad Gateway attempt ' + count);",
      "}, 25);",
      "const keepAlive = setInterval(() => {}, 1000);",
      "const stop = () => {",
      "  clearInterval(retryInterval);",
      "  clearInterval(keepAlive);",
      "  process.exit(143);",
      "};",
      "process.on('SIGTERM', stop);",
      "setTimeout(() => process.exit(2), 5000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      withTestTimeout(
        invokeOpenCodeCliTransport({
          launchContract: createNodeScriptLaunchContract(fixturePath),
          openCodeTimeoutMs: null,
          openCodeWorkdir: process.cwd(),
          prompt: "hello",
          sessionId: null,
        }),
        2000,
        "opencode streaming provider failure did not stop"
      ),
      (error) => {
        assert.equal(error.code, "provider.unavailable");
        assert.equal(error.errorType, "network");
        assert.match(error.message, BAD_GATEWAY_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("opencode cli transport maps auth failures to auth.required", async () => {
  const { invokeOpenCodeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-fixture-"));
  const fixturePath = join(fixtureDir, "opencode-fixture-auth.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'error', sessionID: 'opencode-auth-1', error: { message: 'Not logged in. Please run opencode auth login' } }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenCodeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 5000,
        openCodeWorkdir: process.cwd(),
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

const withTestTimeout = (promise, timeoutMs, message) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });

test("opencode cli transport maps provider balance failures to provider.insufficient_balance", async () => {
  const { invokeOpenCodeCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-fixture-"));
  const fixturePath = join(fixtureDir, "opencode-fixture-balance.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'error', sessionID: 'opencode-balance-1', error: { message: 'AI_APICallError: Insufficient Balance' } }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenCodeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 5000,
        openCodeWorkdir: process.cwd(),
        prompt: "hello",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "provider.insufficient_balance");
        assert.equal(error.errorType, "adapter");
        assert.deepEqual(error.providerAccessEvidence, {
          observedAtMs: error.providerAccessEvidence.observedAtMs,
          provider: "opencode",
          reasonCode: "provider_account.capacity_exhausted",
          source: "wake_failure",
        });
        assert.match(error.message, PROVIDER_INSUFFICIENT_BALANCE_CODE_RE);
        assert.match(error.message, INSUFFICIENT_BALANCE_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("opencode distinguishes subscription access from a transient rate limit", async () => {
  const { classifyOpenCodeFailureMessage } = await import(
    "../dist/transport/opencode-failure.js"
  );
  const isContextLost = () => false;

  const subscription = classifyOpenCodeFailureMessage({
    isContextLost,
    message: "This model is not included in your subscription plan.",
  });
  assert.equal(subscription.code, "provider.subscription_access_unavailable");
  assert.equal(
    subscription.providerAccessEvidence.reasonCode,
    "provider_account.subscription_access_unavailable"
  );

  const transientRateLimit = classifyOpenCodeFailureMessage({
    isContextLost,
    message: "429 Too Many Requests: rate limit exceeded",
  });
  assert.equal(transientRateLimit.code, "provider.rate_limited");
  assert.equal(transientRateLimit.providerAccessEvidence, undefined);

  const overlappingTransientRateLimit = classifyOpenCodeFailureMessage({
    isContextLost,
    message: "429 Too Many Requests: usage limit reached for this request",
  });
  assert.equal(overlappingTransientRateLimit.code, "provider.rate_limited");
  assert.equal(overlappingTransientRateLimit.providerAccessEvidence, undefined);
});

test("opencode cli transport maps raw permission auto-reject stdout to public runtime permission copy", async () => {
  const { invokeOpenCodeCliTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-fixture-"));
  const fixturePath = join(fixtureDir, "opencode-fixture-permission.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log('\\u001b[33m!\\u001b[0m permission requested: external_directory (/tmp/*); auto-rejecting');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeOpenCodeCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 5000,
        openCodeWorkdir: process.cwd(),
        prompt: "write outside workspace",
        sessionId: null,
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, PERMISSION_REQUESTED_RE);
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
