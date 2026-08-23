import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createGrokBuildAdapter,
  GrokBuildAcpTransportError,
  invokeGrokBuildAcpTransport,
  resolveInstalledGrokBuildLaunchCandidates,
} from "../dist/index.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const GROK_LOGIN_RE = /grok login/;

function modelState() {
  return {
    availableModels: [
      {
        _meta: {
          reasoningEffort: "high",
          reasoningEfforts: [
            { id: "xhigh", value: "xhigh" },
            { id: "high", value: "high" },
            { id: "medium", value: "medium" },
            { id: "low", value: "low" },
          ],
          supportsReasoningEffort: true,
        },
        modelId: "grok-4.6",
        name: "Grok 4.6",
      },
      {
        _meta: {
          reasoningEffort: "high",
          reasoningEfforts: [
            { id: "high", value: "high" },
            { id: "medium", value: "medium" },
            { id: "low", value: "low" },
          ],
          supportsReasoningEffort: true,
        },
        modelId: "grok-4.5",
        name: "Grok 4.5",
      },
    ],
    currentModelId: "grok-4.6",
  };
}

async function createFixture() {
  const fixtureDir = await mkdtemp(join(tmpdir(), "openmeld-grok-acp-"));
  const scriptPath = join(fixtureDir, "fixture.mjs");
  const transcriptPath = join(fixtureDir, "transcript.jsonl");
  await writeFile(
    scriptPath,
    `
      import { appendFileSync } from "node:fs";
      import readline from "node:readline";

      const transcriptPath = process.env.GROK_TEST_TRANSCRIPT;
      const scenario = process.env.GROK_TEST_SCENARIO || "text";
      if (process.argv.includes("version")) {
        process.stdout.write("grok 1.0.3 (fixture)\\n");
        process.exit(0);
      }
      const sessionId = ${JSON.stringify(SESSION_ID)};
      const modelState = ${JSON.stringify(modelState())};
      let reverseRequestId = 700;
      let pendingCloseId = null;
      let pendingPromptId = null;
      const lines = readline.createInterface({ input: process.stdin });
      appendFileSync(transcriptPath, JSON.stringify({ args: process.argv.slice(2) }) + "\\n");

      function send(message) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
      }

      function finishPrompt() {
        send({
          method: "session/update",
          params: {
            sessionId,
            update: {
              content: { text: "Hello from Grok", type: "text" },
              sessionUpdate: "agent_message_chunk"
            }
          }
        });
        send({ id: pendingPromptId, result: { stopReason: "end_turn" } });
        pendingPromptId = null;
      }

      lines.on("line", (line) => {
        const message = JSON.parse(line);
        appendFileSync(transcriptPath, JSON.stringify(message) + "\\n");
        if (message.method === "initialize") {
          if (scenario === "no_auth") {
            send({
              id: message.id,
              result: {
                _meta: { defaultAuthMethodId: "grok.com", modelState },
                agentCapabilities: {
                  loadSession: true,
                  promptCapabilities: { embeddedContext: true, image: false, audio: false },
                  sessionCapabilities: { close: {}, list: {}, resume: {} }
                },
                authMethods: [{ id: "grok.com", name: "Grok" }],
                protocolVersion: 1
              }
            });
            return;
          }
          const initializeMeta = { defaultAuthMethodId: "cached_token" };
          if (scenario !== "missing_initialize_models") {
            initializeMeta.modelState = modelState;
          }
          send({
            id: message.id,
            result: {
              _meta: initializeMeta,
              agentCapabilities: {
                loadSession: true,
                promptCapabilities: { embeddedContext: true, image: false, audio: false },
                sessionCapabilities: { close: {}, list: {}, resume: {} }
              },
              authMethods: [
                { id: "cached_token", name: "cached_token" },
                { id: "grok.com", name: "Grok" }
              ],
              protocolVersion: 1
            }
          });
          return;
        }
        if (message.method === "authenticate") {
          if (scenario === "auth_expired") {
            send({ id: message.id, error: { code: -32603, message: "Authentication token expired" } });
            return;
          }
          if (scenario === "authenticate_internal_error_usage_exhausted") {
            send({ id: message.id, error: { code: -32603, message: "Internal error" } });
            return;
          }
          send({ id: message.id, result: {} });
          return;
        }
        if (message.method === "_x.ai/billing") {
          if (scenario === "prompt_internal_error_billing_unavailable") {
            send({ id: message.id, error: { code: -32603, message: "Billing unavailable" } });
            return;
          }
          send({
            id: message.id,
            result: {
              config: {
                creditUsagePercent: scenario.includes("usage_exhausted") ? 100 : 27,
                currentPeriod: { end: "2026-08-27T00:00:00Z", type: "weekly" }
              }
            }
          });
          return;
        }
        if (message.method === "session/new") {
          const sessionModels = scenario === "conflicting_models"
            ? { ...modelState, availableModels: modelState.availableModels.slice(0, 1) }
            : modelState;
          send({ id: message.id, result: { sessionId, models: sessionModels } });
          return;
        }
        if (message.method === "session/resume") {
          if (scenario === "missing_context") {
            send({ id: message.id, error: { code: -32603, message: "Path not found" } });
            return;
          }
          if (scenario === "invalid_resume_params") {
            send({ id: message.id, error: { code: -32602, message: "Unsupported resume option" } });
            return;
          }
          send({ id: message.id, result: { sessionId, models: modelState } });
          return;
        }
        if (message.method === "session/set_model") {
          send({ id: message.id, result: { _meta: { model: message.params.modelId } } });
          return;
        }
        if (message.method === "session/prompt") {
          pendingPromptId = message.id;
          if (scenario === "quota_exhausted") {
            send({ id: message.id, error: { code: -32603, message: "Usage limit reached" } });
            pendingPromptId = null;
            return;
          }
          if (scenario.startsWith("prompt_internal_error")) {
            send({ id: message.id, error: { code: -32603, message: "Internal error" } });
            pendingPromptId = null;
            return;
          }
          if (scenario === "permission") {
            send({
              id: reverseRequestId,
              method: "session/request_permission",
              params: {
                options: [
                  { kind: "allow_once", name: "Allow once", optionId: "allow" },
                  { kind: "reject_once", name: "Reject", optionId: "reject" }
                ],
                sessionId,
                toolCall: { kind: "execute", rawInput: { command: "pwd" }, title: "Run pwd" }
              }
            });
            return;
          }
          if (scenario === "permission_missing_session") {
            send({
              id: reverseRequestId,
              method: "session/request_permission",
              params: {
                options: [{ kind: "allow_once", name: "Allow once", optionId: "allow" }],
                toolCall: { kind: "execute", rawInput: { command: "pwd" }, title: "Run pwd" }
              }
            });
            return;
          }
          if (scenario === "question") {
            send({
              id: reverseRequestId,
              method: "_x.ai/ask_user_question",
              params: {
                mode: "default",
                questions: [{
                  multiSelect: false,
                  options: [{ label: "Postgres", description: "Relational database" }],
                  question: "Which database?"
                }],
                sessionId,
                toolCallId: "tool-question"
              }
            });
            return;
          }
          if (scenario === "plan") {
            send({
              id: reverseRequestId,
              method: "x.ai/exit_plan_mode",
              params: {
                planContent: "# Plan\\n\\n1. Implement",
                sessionId,
                toolCallId: "tool-plan"
              }
            });
            return;
          }
          if (scenario === "unknown_request") {
            send({
              id: reverseRequestId,
              method: "x.ai/future_blocking_request",
              params: { sessionId }
            });
            return;
          }
          if (scenario === "cancel") {
            return;
          }
          finishPrompt();
          return;
        }
        if (message.id === reverseRequestId) {
          appendFileSync(transcriptPath, JSON.stringify({ reverseResponse: message }) + "\\n");
          if (pendingCloseId !== null) {
            send({ id: pendingCloseId, result: {} });
            pendingCloseId = null;
            return;
          }
          if (pendingPromptId !== null) {
            finishPrompt();
          }
          return;
        }
        if (message.method === "session/cancel") {
          if (scenario === "cancel" && pendingPromptId !== null) {
            send({ id: pendingPromptId, result: { stopReason: "cancelled" } });
            pendingPromptId = null;
          }
          return;
        }
        if (message.method === "session/close") {
          if (scenario === "permission_after_turn") {
            pendingCloseId = message.id;
            send({
              id: reverseRequestId,
              method: "session/request_permission",
              params: {
                options: [{ kind: "allow_once", name: "Allow once", optionId: "allow" }],
                sessionId,
                toolCall: { kind: "execute", rawInput: { command: "pwd" }, title: "Run pwd" }
              }
            });
            return;
          }
          send({ id: message.id, result: {} });
        }
      });
    `,
    "utf8"
  );
  return { fixtureDir, scriptPath, transcriptPath };
}

function invokeFixture(fixture, input = {}) {
  return invokeGrokBuildAcpTransport({
    agentControllerPermissionMode:
      input.agentControllerPermissionMode ?? "grok-build:default",
    conversationPolicy: input.conversationPolicy,
    env: {
      GROK_TEST_SCENARIO: input.scenario ?? "text",
      GROK_TEST_TRANSCRIPT: fixture.transcriptPath,
    },
    grokBuildTimeoutMs: 2000,
    grokBuildWorkdir: fixture.fixtureDir,
    launchContract: {
      kind: "node_script",
      nodePath: process.execPath,
      scriptPath: fixture.scriptPath,
    },
    onInteractionRequest: input.onInteractionRequest,
    onActiveTurn: input.onActiveTurn,
    prompt: "Say hello",
    sessionId: input.sessionId,
    taskId: "task-grok",
  });
}

async function readTranscript(path) {
  const raw = await readFile(path, "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function waitForTranscriptMethod(path, method) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const transcript = await readTranscript(path);
      if (transcript.some((message) => message.method === method)) {
        return;
      }
    } catch {
      // The supervised process may not have created its transcript yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for Grok ACP method '${method}'`);
}

test("Grok Build ACP authenticates headlessly, selects exact model and effort, and closes the session", async () => {
  const fixture = await createFixture();
  try {
    const result = await invokeFixture(fixture, {
      conversationPolicy: { model: "grok-4.5", reasoningLevel: "medium" },
    });
    assert.equal(result.output, "Hello from Grok");
    assert.equal(result.sessionId, SESSION_ID);
    assert.equal(result.diagnostics.modelNegotiation.sourceState, "consistent");

    const transcript = await readTranscript(fixture.transcriptPath);
    assert.deepEqual(transcript[0].args, [
      "--no-auto-update",
      "--permission-mode",
      "default",
      "agent",
      "--no-leader",
      "stdio",
    ]);
    const authenticate = transcript.find(
      (message) => message.method === "authenticate"
    );
    assert.deepEqual(authenticate.params, {
      _meta: { headless: true },
      methodId: "cached_token",
    });
    const setModel = transcript.find(
      (message) => message.method === "session/set_model"
    );
    assert.deepEqual(setModel.params, {
      _meta: { reasoningEffort: "medium" },
      modelId: "grok-4.5",
      sessionId: SESSION_ID,
    });
    assert.ok(transcript.some((message) => message.method === "session/close"));
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP resumes without replay and maps missing sessions to context_not_found", async () => {
  const fixture = await createFixture();
  try {
    const resumed = await invokeFixture(fixture, { sessionId: SESSION_ID });
    assert.equal(resumed.output, "Hello from Grok");
    const transcript = await readTranscript(fixture.transcriptPath);
    assert.ok(
      transcript.some((message) => message.method === "session/resume")
    );
    assert.equal(
      transcript.some((message) => message.method === "session/load"),
      false
    );

    await assert.rejects(
      invokeFixture(fixture, {
        scenario: "missing_context",
        sessionId: SESSION_ID,
      }),
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "context_not_found"
    );
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP preserves unrelated invalid resume parameters instead of healing context", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      invokeFixture(fixture, {
        scenario: "invalid_resume_params",
        sessionId: SESSION_ID,
      }),
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "protocol.invalid_params"
    );
    const methods = (await readTranscript(fixture.transcriptPath))
      .filter((message) => message.method)
      .map((message) => message.method);
    assert.equal(methods.includes("session/new"), false);
    assert.equal(methods.includes("session/prompt"), false);
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP classifies wrapped authentication and quota failures", async () => {
  for (const [scenario, expectedCode] of [
    ["auth_expired", "auth.failed"],
    ["quota_exhausted", "grok-build.quota_or_entitlement"],
  ]) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        invokeFixture(fixture, { scenario }),
        (error) =>
          error instanceof GrokBuildAcpTransportError &&
          error.code === expectedCode
      );
    } finally {
      await rm(fixture.fixtureDir, { force: true, recursive: true });
    }
  }
});

test("Grok Build ACP upgrades only ambiguous prompt failures with confirmed exhausted usage", async () => {
  for (const [scenario, expectedCode] of [
    [
      "prompt_internal_error_usage_exhausted",
      "grok-build.quota_or_entitlement",
    ],
    ["authenticate_internal_error_usage_exhausted", "protocol.request_failed"],
    ["prompt_internal_error_billing_unavailable", "protocol.request_failed"],
  ]) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        invokeFixture(fixture, { scenario }),
        (error) =>
          error instanceof GrokBuildAcpTransportError &&
          error.code === expectedCode
      );
    } finally {
      await rm(fixture.fixtureDir, { force: true, recursive: true });
    }
  }
});

test("Grok Build ACP rejects unsupported effort before prompting", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      invokeFixture(fixture, {
        conversationPolicy: { model: "grok-4.5", reasoningLevel: "xhigh" },
      }),
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "model.reasoning_unsupported"
    );
    const transcript = await readTranscript(fixture.transcriptPath);
    assert.equal(
      transcript.some((message) => message.method === "session/prompt"),
      false
    );
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP rejects a catalog model absent from the live account inventory", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      invokeFixture(fixture, {
        conversationPolicy: { model: "grok-unavailable" },
      }),
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "model.unavailable"
    );
    const transcript = await readTranscript(fixture.transcriptPath);
    assert.equal(
      transcript.some((message) => message.method === "session/prompt"),
      false
    );
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP requires complete, consistent initialize and session inventories", async () => {
  for (const scenario of ["missing_initialize_models", "conflicting_models"]) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        invokeFixture(fixture, { scenario }),
        (error) =>
          error instanceof GrokBuildAcpTransportError &&
          error.code === "model.inventory_unavailable"
      );
      const transcript = await readTranscript(fixture.transcriptPath);
      assert.equal(
        transcript.some((message) => message.method === "session/prompt"),
        false
      );
    } finally {
      await rm(fixture.fixtureDir, { force: true, recursive: true });
    }
  }
});

test("Grok Build ACP refuses browser-only authentication", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      invokeFixture(fixture, { scenario: "no_auth" }),
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "auth.required" &&
        GROK_LOGIN_RE.test(error.message)
    );
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP carries permission, question, and plan decisions over the real extension shapes", async () => {
  const fixtures = [];
  try {
    for (const scenario of ["permission", "question", "plan"]) {
      const fixture = await createFixture();
      fixtures.push(fixture);
      const result = await invokeFixture(fixture, {
        onInteractionRequest: (request) => {
          if (request.kind === "permission") {
            return { kind: "permission", optionId: "allow" };
          }
          if (request.kind === "question") {
            return {
              answers: [
                {
                  questionId: request.questions[0].questionId,
                  values: [request.questions[0].options[0].optionId],
                },
              ],
              kind: "question",
            };
          }
          return { action: "approve", kind: "plan_review" };
        },
        scenario,
      });
      assert.equal(result.output, "Hello from Grok");
      const transcript = await readTranscript(fixture.transcriptPath);
      const reverseResponse = transcript.find(
        (message) => message.reverseResponse
      )?.reverseResponse;
      assert.ok(reverseResponse);
      if (scenario === "permission") {
        assert.deepEqual(reverseResponse.result, {
          outcome: { optionId: "allow", outcome: "selected" },
        });
      } else if (scenario === "question") {
        assert.deepEqual(reverseResponse.result, {
          answers: { "Which database?": ["Postgres"] },
          outcome: "accepted",
        });
      } else {
        assert.deepEqual(reverseResponse.result, { outcome: "approved" });
      }
    }
  } finally {
    await Promise.all(
      fixtures.map((fixture) =>
        rm(fixture.fixtureDir, { force: true, recursive: true })
      )
    );
  }
});

test("Grok Build ACP rejects reverse requests without the active turn session", async () => {
  const fixture = await createFixture();
  let interactionCount = 0;
  try {
    await assert.rejects(
      invokeFixture(fixture, {
        onInteractionRequest: () => {
          interactionCount += 1;
          return { kind: "permission", optionId: "allow" };
        },
        scenario: "permission_missing_session",
      }),
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "interaction.session_mismatch"
    );
    assert.equal(interactionCount, 0);
    const reverseResponse = (await readTranscript(fixture.transcriptPath)).find(
      (message) => message.reverseResponse
    )?.reverseResponse;
    assert.equal(reverseResponse.error.code, -32_602);
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP rejects reverse requests after the active turn ends", async () => {
  const fixture = await createFixture();
  let interactionCount = 0;
  try {
    const result = await invokeFixture(fixture, {
      onInteractionRequest: () => {
        interactionCount += 1;
        return { kind: "permission", optionId: "allow" };
      },
      scenario: "permission_after_turn",
    });
    assert.equal(result.output, "Hello from Grok");
    assert.equal(interactionCount, 0);
    const reverseResponse = (await readTranscript(fixture.transcriptPath)).find(
      (message) => message.reverseResponse
    )?.reverseResponse;
    assert.equal(reverseResponse.error.code, -32_602);
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP fails closed on an unknown blocking reverse request", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      invokeFixture(fixture, { scenario: "unknown_request" }),
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "interaction.unsupported"
    );
    const transcript = await readTranscript(fixture.transcriptPath);
    const reverseResponse = transcript.find(
      (message) => message.reverseResponse
    )?.reverseResponse;
    assert.equal(reverseResponse.error.code, -32_601);
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build ACP Stop cancels, closes, and reports a stopped turn", async () => {
  const fixture = await createFixture();
  let activeTurn = null;
  let markActive;
  const active = new Promise((resolve) => {
    markActive = resolve;
  });

  try {
    const dispatch = invokeFixture(fixture, {
      onActiveTurn: (registration) => {
        activeTurn = registration;
        markActive();
        return () => undefined;
      },
      scenario: "cancel",
    });
    await active;
    const stoppedDispatch = assert.rejects(
      dispatch,
      (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "runtime.turn.cancelled"
    );
    await activeTurn.cancel();
    await stoppedDispatch;

    const transcript = await readTranscript(fixture.transcriptPath);
    const cancelIndex = transcript.findIndex(
      (message) => message.method === "session/cancel"
    );
    const closeIndex = transcript.findIndex(
      (message) => message.method === "session/close"
    );
    assert.ok(cancelIndex >= 0);
    assert.ok(closeIndex > cancelIndex);
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build RuntimeAdapter heals a missing session and returns the typed conversation ref", async () => {
  const fixture = await createFixture();
  try {
    const adapter = createGrokBuildAdapter({
      grokBuildTimeoutMs: 2000,
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath: fixture.scriptPath,
      },
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: SESSION_ID,
      agentControllerPermissionMode: "grok-build:default",
      agentId: "grok-build",
      conversationPolicy: { model: "grok-4.6", reasoningLevel: "high" },
      env: {
        GROK_TEST_SCENARIO: "missing_context",
        GROK_TEST_TRANSCRIPT: fixture.transcriptPath,
      },
      prompt: "Say hello",
      runtimeContext: {
        providerRuntimeWorkingDirectory: fixture.fixtureDir,
      },
      sourceEventId: "source-grok-heal",
      spaceId: "space-grok-heal",
      taskId: "task-grok-heal",
      transportMode: "acp",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "Hello from Grok");
    assert.equal(result.contextDelta?.refreshed, true);
    assert.deepEqual(result.contextDelta?.agentControllerConversation, {
      agentControllerConversationId: SESSION_ID,
      agentControllerConversationKind: "session",
      agentControllerRef: "builtin:grok-build",
    });
    const methods = (await readTranscript(fixture.transcriptPath))
      .filter((message) => message.method)
      .map((message) => message.method);
    assert.deepEqual(methods, [
      "initialize",
      "authenticate",
      "session/resume",
      "initialize",
      "authenticate",
      "session/new",
      "session/prompt",
      "session/close",
    ]);
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build RuntimeAdapter Stop uses cancel and close on the active turn", async () => {
  const fixture = await createFixture();
  try {
    const adapter = createGrokBuildAdapter({
      grokBuildTimeoutMs: 2000,
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath: fixture.scriptPath,
      },
    });
    const dispatchPromise = adapter.dispatch({
      agentControllerPermissionMode: "grok-build:default",
      agentId: "grok-build",
      env: {
        GROK_TEST_SCENARIO: "cancel",
        GROK_TEST_TRANSCRIPT: fixture.transcriptPath,
      },
      prompt: "Wait",
      runtimeContext: {
        providerRuntimeWorkingDirectory: fixture.fixtureDir,
      },
      sourceEventId: "source-grok-stop",
      spaceId: "space-grok-stop",
      taskId: "task-grok-stop-adapter",
      transportMode: "acp",
    });
    await waitForTranscriptMethod(fixture.transcriptPath, "session/prompt");

    const cancelResult = await adapter.cancel({
      taskId: "task-grok-stop-adapter",
    });
    const dispatchResult = await dispatchPromise;

    assert.deepEqual(cancelResult, {
      accepted: true,
      deliveryPath: "cancel",
      reasonCode: "accepted",
      signalDelivery: "sent",
      taskId: "task-grok-stop-adapter",
    });
    assert.equal(dispatchResult.status, "failed");
    assert.equal(dispatchResult.errorCode, "runtime.turn.cancelled");
    const methods = (await readTranscript(fixture.transcriptPath))
      .filter((message) => message.method)
      .map((message) => message.method);
    assert.ok(methods.includes("session/cancel"));
    assert.ok(
      methods.indexOf("session/close") > methods.indexOf("session/cancel")
    );
  } finally {
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("Grok Build install resolution verifies the configured official launcher", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "openmeld-grok-install-"));
  const launcherPath = join(fixtureDir, "grok");
  const previousConfiguredPath =
    process.env.OPENMELD_DAEMON_RUNTIME_GROK_BUILD_BIN;
  try {
    await writeFile(
      launcherPath,
      '#!/usr/bin/env node\nprocess.stdout.write("Grok CLI 1.0.3\\n");\n',
      "utf8"
    );
    await chmod(launcherPath, 0o755);
    process.env.OPENMELD_DAEMON_RUNTIME_GROK_BUILD_BIN = launcherPath;

    const resolution = await resolveInstalledGrokBuildLaunchCandidates({
      timeoutMs: 2000,
    });
    assert.equal(resolution.ok, true);
    assert.ok(
      resolution.ok &&
        resolution.candidates.some(
          (candidate) => candidate.commandPath === launcherPath
        )
    );
  } finally {
    if (previousConfiguredPath === undefined) {
      process.env.OPENMELD_DAEMON_RUNTIME_GROK_BUILD_BIN = undefined;
    } else {
      process.env.OPENMELD_DAEMON_RUNTIME_GROK_BUILD_BIN =
        previousConfiguredPath;
    }
    await rm(fixtureDir, { force: true, recursive: true });
  }
});
