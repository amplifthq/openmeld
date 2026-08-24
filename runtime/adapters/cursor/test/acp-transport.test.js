import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const createNodeScriptLaunchContract = (scriptPath) => ({
  kind: "node_script",
  nodePath: process.execPath,
  scriptPath,
});

const createRuntimeContext = (providerRuntimeWorkingDirectory) => ({
  providerRuntimeWorkingDirectory,
});

async function writeFakeCursorAcp(fixturePath) {
  // Shape source: ACP session config options draft and generated schema.
  // https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/draft/session-config-options.mdx
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync } from 'node:fs';",
      "const logPath = process.env.OPENMELD_FAKE_CURSOR_ACP_LOG;",
      "let buffer = '';",
      "let activeSessionId = null;",
      "let pendingPromptId = null;",
      "const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
      "const log = (message) => {",
      "  if (!logPath) return;",
      "  appendFileSync(logPath, JSON.stringify({ argv: process.argv.slice(2), ...message }) + '\\n', 'utf8');",
      "};",
      "const allAvailableModels = [",
      "  { modelId: 'default[]', name: 'Auto' },",
      "  { modelId: 'gpt-5.6-sol[context=272k,reasoning=medium,fast=false]', name: 'gpt-5.6-sol' }",
      "];",
      "const extraModelCount = Number(process.env.OPENMELD_FAKE_CURSOR_ACP_EXTRA_MODEL_COUNT ?? '0');",
      "for (let index = 0; index < extraModelCount; index += 1) allAvailableModels.push({ modelId: 'extra-model-' + index, name: 'Extra ' + index });",
      "let descriptorReadCount = 0;",
      "let sessionLoadContextLossSent = false;",
      "let activeAvailableModels = allAvailableModels;",
      "const readAvailableModels = (source) => {",
      "  if (process.env.OPENMELD_FAKE_CURSOR_ACP_FIRST_INVENTORY_EMPTY === '1' && descriptorReadCount === 0) return [];",
      "  if (process.env['OPENMELD_FAKE_CURSOR_ACP_EMPTY_' + source + '_MODELS'] === '1') return [];",
      "  if (process.env['OPENMELD_FAKE_CURSOR_ACP_' + source + '_DEFAULT_ONLY'] === '1') return allAvailableModels.slice(0, 1);",
      "  return allAvailableModels;",
      "};",
      "const modes = { currentModeId: 'agent', availableModes: [",
      "  { id: 'agent', name: 'Agent', description: 'Full agent capabilities with tool access' },",
      "  { id: 'plan', name: 'Plan', description: 'Read-only mode for planning and designing before implementation' },",
      "  { id: 'ask', name: 'Ask', description: 'Q&A mode - no edits or command execution' }",
      "] };",
      "const configOptionId = (configId) => process.env.OPENMELD_FAKE_CURSOR_ACP_LEGACY_CONFIG_ID_FIELD === '1' ? { id: configId } : { configId };",
      "const buildSessionDescriptor = () => {",
      "  const legacyModels = readAvailableModels('LEGACY');",
      "  const configModels = readAvailableModels('CONFIG');",
      "  descriptorReadCount += 1;",
      "  activeAvailableModels = configModels.length > 0 ? configModels : legacyModels;",
      "  const models = { currentModelId: 'default[]', availableModels: legacyModels };",
      "  const configOptions = [",
      "    { ...configOptionId('mode'), name: 'Mode', type: 'select', currentValue: modes.currentModeId, options: modes.availableModes.map((mode) => ({ value: mode.id, name: mode.name, description: mode.description })) },",
      "    ...(process.env.OPENMELD_FAKE_CURSOR_ACP_OMIT_MODEL_CONFIG_OPTION === '1' ? [] : [{ ...configOptionId('model'), name: 'Model', type: 'select', currentValue: 'default[]', options: configModels.map((model) => ({ value: model.modelId, name: model.name })) }])",
      "  ];",
      "  return { modes, models, configOptions };",
      "};",
      "const finishPrompt = () => {",
      "  const reply = process.env.OPENMELD_FAKE_CURSOR_ACP_REPLY ?? 'Cursor ACP reply';",
      "  write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: activeSessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } } } });",
      "  write({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason: 'end_turn' } });",
      "  pendingPromptId = null;",
      "};",
      "const handle = (message) => {",
      "  log(message);",
      "  if (message.method === 'initialize') {",
      "    const protocolVersion = Number(process.env.OPENMELD_FAKE_CURSOR_ACP_PROTOCOL_VERSION ?? '1');",
      "    const authMethodId = process.env.OPENMELD_FAKE_CURSOR_ACP_AUTH_METHOD_ID ?? 'cursor_login';",
      "    write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion, agentCapabilities: { loadSession: true }, authMethods: [{ id: authMethodId, name: 'Cursor Login', description: 'Run agent login' }] } });",
      "    return;",
      "  }",
      "  if (message.method === 'authenticate') { write({ jsonrpc: '2.0', id: message.id, result: {} }); return; }",
      "  if (message.method === 'session/new') {",
      "    activeSessionId = 'cursor-session-new';",
      "    write({ jsonrpc: '2.0', id: message.id, result: { sessionId: activeSessionId, ...buildSessionDescriptor() } });",
      "    return;",
      "  }",
      "  if (message.method === 'session/load') {",
      "    if (process.env.OPENMELD_FAKE_CURSOR_ACP_LOAD_CONTEXT_NOT_FOUND_ONCE === '1' && message.params.sessionId === 'stale-session' && !sessionLoadContextLossSent) { sessionLoadContextLossSent = true; write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'session not found' } }); return; }",
      "    if (process.env.OPENMELD_FAKE_CURSOR_ACP_LOAD_INVALID_PARAMS === '1') { write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid params' } }); return; }",
      "    activeSessionId = message.params.sessionId;",
      "    if (process.env.OPENMELD_FAKE_CURSOR_ACP_REPLAY_HISTORY_ON_LOAD === '1') write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: activeSessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Historical Cursor reply' } } } });",
      "    write({ jsonrpc: '2.0', id: message.id, result: buildSessionDescriptor() });",
      "    return;",
      "  }",
      "  if (message.method === 'session/set_mode') {",
      "    write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: activeSessionId, update: { sessionUpdate: 'current_mode_update', currentModeId: message.params.modeId } } });",
      "    write({ jsonrpc: '2.0', id: message.id, result: {} });",
      "    return;",
      "  }",
      "  if (message.method === 'session/set_model') {",
      "    const allowed = activeAvailableModels.some((model) => model.modelId === message.params.modelId);",
      "    if (!allowed) { write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid params' } }); return; }",
      "    write({ jsonrpc: '2.0', id: message.id, result: {} });",
      "    return;",
      "  }",
      "  if (message.method === 'session/set_config_option') {",
      "    if (process.env.OPENMELD_FAKE_CURSOR_ACP_CONFIG_OPTION_UNSUPPORTED === '1') { write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }",
      "    const allowed = message.params.configId === 'model' && message.params.type === 'id' && activeAvailableModels.some((model) => model.modelId === message.params.value);",
      "    if (!allowed) { write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid params' } }); return; }",
      "    write({ jsonrpc: '2.0', id: message.id, result: { configOptions: [{ ...configOptionId('model'), name: 'Model', type: 'select', currentValue: message.params.value, options: activeAvailableModels.map((model) => ({ value: model.modelId, name: model.name })) }] } });",
      "    return;",
      "  }",
      "  if (message.method === 'session/prompt') {",
      "    pendingPromptId = message.id;",
      "    const interaction = process.env.OPENMELD_FAKE_CURSOR_ACP_INTERACTION;",
      "    if (process.env.OPENMELD_FAKE_CURSOR_ACP_WAIT_FOR_CANCEL === '1') return;",
      "    if (process.env.OPENMELD_FAKE_CURSOR_ACP_PROMPT_ERROR) { write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: process.env.OPENMELD_FAKE_CURSOR_ACP_PROMPT_ERROR } }); pendingPromptId = null; return; }",
      "    if (interaction === 'permission') {",
      "      const denyOption = process.env.OPENMELD_FAKE_CURSOR_ACP_PERSISTENT_DENY_ONLY === '1' ? { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' } : { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' };",
      "      write({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: { sessionId: activeSessionId, toolCall: { toolCallId: 'tool-1', title: 'Run command', kind: 'execute' }, options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, denyOption] } });",
      "      if (process.env.OPENMELD_FAKE_CURSOR_ACP_EXIT_AFTER_INTERACTION === '1') setImmediate(() => process.exit(0));",
      "      return;",
      "    }",
      "    if (interaction === 'question') {",
      "      write({ jsonrpc: '2.0', id: 'question-1', method: 'cursor/ask_question', params: { toolCallId: 'tool-1', questions: [{ id: 'q1', prompt: 'Choose', options: [{ id: 'a', label: 'A' }] }] } });",
      "      return;",
      "    }",
      "    if (interaction === 'plan') {",
      "      write({ jsonrpc: '2.0', id: 'plan-1', method: 'cursor/create_plan', params: { toolCallId: 'tool-1', plan: 'Plan', todos: [] } });",
      "      return;",
      "    }",
      "    finishPrompt();",
      "    return;",
      "  }",
      "  if (message.method === 'session/cancel') {",
      "    write({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason: 'cancelled' } });",
      "    pendingPromptId = null;",
      "    return;",
      "  }",
      "  if (message.id === 'permission-1' || message.id === 'question-1' || message.id === 'plan-1') { finishPrompt(); return; }",
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
}

async function readLog(logPath) {
  return (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForLogMethod(logPath, method) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      const log = await readLog(logPath);
      if (log.some((entry) => entry.method === method)) {
        return;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${method}`);
}

async function withFixture(callback) {
  const fixtureDir = await mkdtemp(join(tmpdir(), "cursor-acp-"));
  const fixturePath = join(fixtureDir, "fake-cursor-acp.mjs");
  const logPath = join(fixtureDir, "messages.jsonl");
  await writeFakeCursorAcp(fixturePath);
  try {
    await callback({ fixtureDir, fixturePath, logPath });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
}

test("Cursor ACP creates a session, applies mode and model, and returns structured output", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const model = "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]";
    const result = await invokeCursorAcpTransport({
      agentControllerPermissionMode: "cursor:plan",
      conversationPolicy: { model },
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: { OPENMELD_FAKE_CURSOR_ACP_LOG: logPath },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "complete Cursor fallback prompt",
      taskId: "task-1",
    });

    assert.equal(result.output, "Cursor ACP reply");
    assert.equal(result.sessionId, "cursor-session-new");
    const log = await readLog(logPath);
    assert.deepEqual(
      log.filter((entry) => entry.method).map((entry) => entry.method),
      [
        "initialize",
        "authenticate",
        "session/new",
        "session/set_mode",
        "session/set_config_option",
        "session/prompt",
      ]
    );
    assert.deepEqual(
      log.find((entry) => entry.method === "session/set_mode")?.params,
      { modeId: "plan", sessionId: "cursor-session-new" }
    );
    assert.deepEqual(
      log.find((entry) => entry.method === "session/set_config_option")?.params,
      {
        configId: "model",
        sessionId: "cursor-session-new",
        type: "id",
        value: model,
      }
    );
    assert.deepEqual(
      log.find((entry) => entry.method === "session/prompt")?.params,
      {
        prompt: [{ text: "complete Cursor fallback prompt", type: "text" }],
        sessionId: "cursor-session-new",
      }
    );
    assert.deepEqual(result.diagnostics?.modelNegotiation, {
      checkAttempt: 1,
      configAvailableModelCount: 2,
      configAvailableModelIds: [
        "default[]",
        "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
      ],
      configAvailableModelIdsTruncated: false,
      configCurrentModelId: "default[]",
      currentModelId: "default[]",
      legacyAvailableModelCount: 2,
      legacyAvailableModelIds: [
        "default[]",
        "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
      ],
      legacyAvailableModelIdsTruncated: false,
      legacyCurrentModelId: "default[]",
      protocol: "acp/v1",
      requestedModelId: model,
      requestedPresentInConfigOptions: true,
      requestedPresentInLegacyModels: true,
      sessionOperation: "new",
      sourceState: "consistent",
    });
  });
});

test("Cursor repair and the next normal turn keep the selected Run Everything permission", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const canonicalSessionId = "cursor-canonical-session";
    const dispatch = (executionMode, taskSuffix) =>
      adapter.dispatch({
        agentControllerConversationId: canonicalSessionId,
        agentControllerPermissionMode: "cursor:force",
        agentId: "cursor",
        env: { OPENMELD_FAKE_CURSOR_ACP_LOG: logPath },
        executionMode,
        prompt: `${executionMode} turn`,
        runtimeContext: createRuntimeContext(fixtureDir),
        sourceEventId: `source-cursor-${taskSuffix}`,
        spaceId: "space-cursor-permission-continuity",
        taskId: `task-cursor-${taskSuffix}`,
        transportMode: "acp",
      });

    const repairResult = await dispatch("repair", "repair");
    const normalResult = await dispatch("normal", "normal");

    assert.equal(repairResult.status, "success");
    assert.equal(normalResult.status, "success");
    assert.equal(
      repairResult.contextDelta?.agentControllerConversationId,
      canonicalSessionId
    );
    assert.equal(
      normalResult.contextDelta?.agentControllerConversationId,
      canonicalSessionId
    );
    const launches = (await readLog(logPath))
      .filter((entry) => entry.method === "initialize")
      .map((entry) => entry.argv);
    assert.deepEqual(launches, [
      ["--force", "acp"],
      ["--force", "acp"],
    ]);
  });
});

test("Cursor ACP keeps an exact plan-upgrade sentence as Agent content", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });

    const result = await adapter.dispatch({
      agentId: "cursor",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_REPLY: "\n\nUpgrade your plan to continue",
      },
      prompt: "Reply with exactly: OK",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-plan-upgrade",
      spaceId: "space-plan-upgrade",
      taskId: "task-plan-upgrade",
      transportMode: "acp",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "Upgrade your plan to continue");
  });
});

test("Cursor ACP classifies a structured plan-upgrade error", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });

    const result = await adapter.dispatch({
      agentId: "cursor",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_PROMPT_ERROR: "Upgrade your plan to continue",
      },
      prompt: "Reply with exactly: OK",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-structured-plan-upgrade",
      spaceId: "space-structured-plan-upgrade",
      taskId: "task-structured-plan-upgrade",
      transportMode: "acp",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "cursor.plan_upgrade_required");
    assert.equal(result.errorType, "adapter");
    assert.equal(result.errorMessage, "Upgrade your plan to continue");
  });
});

test("Cursor ACP does not misclassify a normal answer that discusses upgrades", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    const output =
      "You can upgrade your plan to continue receiving additional features.";
    const result = await invokeCursorAcpTransport({
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: { OPENMELD_FAKE_CURSOR_ACP_REPLY: output },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Explain subscription options",
      taskId: "task-normal-upgrade-answer",
    });

    assert.equal(result.output, output);
  });
});

test("Cursor ACP reports when model inventory diagnostics are truncated", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    const result = await invokeCursorAcpTransport({
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_EXTRA_MODEL_COUNT: "110",
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Inspect models",
      taskId: "task-model-diagnostics-truncated",
    });

    assert.equal(
      result.diagnostics.modelNegotiation?.configAvailableModelCount,
      112
    );
    assert.equal(
      result.diagnostics.modelNegotiation?.configAvailableModelIds.length,
      100
    );
    assert.equal(
      result.diagnostics.modelNegotiation?.configAvailableModelIdsTruncated,
      true
    );
    assert.equal(
      result.diagnostics.modelNegotiation?.legacyAvailableModelCount,
      112
    );
    assert.equal(
      result.diagnostics.modelNegotiation?.legacyAvailableModelIdsTruncated,
      true
    );
  });
});

test("Cursor ACP uses config options when the legacy model list is empty", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const model = "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]";
    const result = await invokeCursorAcpTransport({
      conversationPolicy: { model },
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_EMPTY_LEGACY_MODELS: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Config options",
      taskId: "task-config-options",
    });

    assert.equal(result.output, "Cursor ACP reply");
    assert.equal(
      result.diagnostics?.modelNegotiation.sourceState,
      "config_options_only"
    );
    assert.ok(
      (await readLog(logPath)).some(
        (entry) => entry.method === "session/set_config_option"
      )
    );
  });
});

test("Cursor ACP still reads Cursor's legacy id field for config options", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    const model = "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]";
    const result = await invokeCursorAcpTransport({
      conversationPolicy: { model },
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_EMPTY_LEGACY_MODELS: "1",
        OPENMELD_FAKE_CURSOR_ACP_LEGACY_CONFIG_ID_FIELD: "1",
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Legacy config ID",
      taskId: "task-legacy-config-id",
    });

    assert.equal(result.output, "Cursor ACP reply");
    assert.equal(
      result.diagnostics.modelNegotiation?.sourceState,
      "config_options_only"
    );
  });
});

test("Cursor ACP supports a legacy-only model inventory through the legacy setter", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const model = "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]";
    const result = await invokeCursorAcpTransport({
      conversationPolicy: { model },
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_CONFIG_OPTION_UNSUPPORTED: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
        OPENMELD_FAKE_CURSOR_ACP_OMIT_MODEL_CONFIG_OPTION: "1",
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Legacy inventory",
      taskId: "task-legacy-inventory",
    });

    assert.equal(result.output, "Cursor ACP reply");
    assert.equal(
      result.diagnostics?.modelNegotiation.sourceState,
      "legacy_models_only"
    );
    const methods = (await readLog(logPath))
      .filter((entry) => entry.method)
      .map((entry) => entry.method);
    assert.ok(methods.includes("session/set_config_option"));
    assert.ok(methods.includes("session/set_model"));
  });
});

test("Cursor ACP retries an incomplete model inventory once before prompting", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const result = await invokeCursorAcpTransport({
      conversationPolicy: { model: "default[]" },
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_FIRST_INVENTORY_EMPTY: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Retry inventory",
      taskId: "task-model-inventory-retry",
    });

    assert.equal(result.output, "Cursor ACP reply");
    assert.equal(result.diagnostics?.modelNegotiation.checkAttempt, 2);
    assert.deepEqual(
      (await readLog(logPath))
        .filter((entry) => entry.method)
        .map((entry) => entry.method),
      [
        "initialize",
        "authenticate",
        "session/new",
        "session/load",
        "session/prompt",
      ]
    );
  });
});

test("Cursor ACP rejects an incompatible negotiated protocol version before authentication", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    await assert.rejects(
      invokeCursorAcpTransport({
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
          OPENMELD_FAKE_CURSOR_ACP_PROTOCOL_VERSION: "2",
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        prompt: "Test protocol",
        taskId: "task-protocol",
      }),
      (error) =>
        error?.code === "protocol.invalid" && error?.errorType === "adapter"
    );
    assert.deepEqual(
      (await readLog(logPath))
        .filter((entry) => entry.method)
        .map((entry) => entry.method),
      ["initialize"]
    );
  });
});

test("Cursor ACP requires the negotiated cursor_login authentication method", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    await assert.rejects(
      invokeCursorAcpTransport({
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CURSOR_ACP_AUTH_METHOD_ID: "api_key",
          OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        prompt: "Test authentication",
        taskId: "task-auth-method",
      }),
      (error) =>
        error?.code === "protocol.invalid" && error?.errorType === "adapter"
    );
    assert.deepEqual(
      (await readLog(logPath))
        .filter((entry) => entry.method)
        .map((entry) => entry.method),
      ["initialize"]
    );
  });
});

test("Cursor ACP loads the existing session instead of creating another one", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "cursor-session-existing",
      agentControllerPermissionMode: "cursor:default",
      agentId: "cursor",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
        OPENMELD_FAKE_CURSOR_ACP_REPLAY_HISTORY_ON_LOAD: "1",
      },
      prompt: "Continue",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-1",
      spaceId: "space-1",
      taskId: "task-2",
      transportMode: "acp",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "Cursor ACP reply");
    assert.equal(
      result.contextDelta?.agentControllerConversationId,
      "cursor-session-existing"
    );
    const methods = (await readLog(logPath))
      .filter((entry) => entry.method)
      .map((entry) => entry.method);
    assert.ok(methods.includes("session/load"));
    assert.ok(!methods.includes("session/new"));
  });
});

test("Cursor ACP fails closed when an interactive permission is required", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    await assert.rejects(
      invokeCursorAcpTransport({
        agentControllerPermissionMode: "cursor:default",
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CURSOR_ACP_INTERACTION: "permission",
          OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        prompt: "Needs permission",
        taskId: "task-3",
      }),
      (error) =>
        error?.code === "interaction.permission_required" &&
        error?.errorType === "config"
    );
    const response = (await readLog(logPath)).find(
      (entry) => entry.id === "permission-1" && !entry.method
    );
    assert.deepEqual(response?.result, {
      outcome: { optionId: "reject-once", outcome: "selected" },
    });
  });
});

test("Cursor ACP never persists a deny when reject_once is unavailable", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    await assert.rejects(
      invokeCursorAcpTransport({
        agentControllerPermissionMode: "cursor:default",
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CURSOR_ACP_INTERACTION: "permission",
          OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
          OPENMELD_FAKE_CURSOR_ACP_PERSISTENT_DENY_ONLY: "1",
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        prompt: "Needs one-turn rejection",
        taskId: "task-permission-no-persistent-deny",
      }),
      (error) => error?.code === "interaction.permission_required"
    );
    const response = (await readLog(logPath)).find(
      (entry) => entry.id === "permission-1" && !entry.method
    );
    assert.deepEqual(response?.result, {
      outcome: { outcome: "cancelled" },
    });
  });
});

test("Cursor ACP carries an interactive permission decision through the active turn", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const requests = [];
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const result = await adapter.dispatch({
      agentId: "cursor",
      agentControllerPermissionMode: "cursor:default",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_INTERACTION: "permission",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return {
          kind: "permission",
          optionId: "allow-once",
        };
      },
      prompt: "Needs permission",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-permission-interactive",
      spaceId: "space-permission-interactive",
      taskId: "task-permission-interactive",
      transportMode: "acp",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "Cursor ACP reply");
    assert.deepEqual(requests, [
      {
        kind: "permission",
        options: [
          {
            intent: "allow_once",
            label: "Allow once",
            optionId: "allow-once",
          },
          {
            intent: "deny",
            label: "Reject once",
            optionId: "reject-once",
          },
        ],
        subject: {
          resource: "Run command",
          type: "command",
        },
        title: "Allow Cursor to run this command?",
      },
    ]);
    const response = (await readLog(logPath)).find(
      (entry) => entry.id === "permission-1" && !entry.method
    );
    assert.deepEqual(response?.result, {
      outcome: { optionId: "allow-once", outcome: "selected" },
    });
  });
});

test("Cursor ACP fails promptly when it exits during a human decision", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    let resolveInteraction;
    const interactionResponse = new Promise((resolve) => {
      resolveInteraction = resolve;
    });
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 5000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const startedAt = Date.now();

    const result = await adapter.dispatch({
      agentId: "cursor",
      agentControllerPermissionMode: "cursor:default",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_EXIT_AFTER_INTERACTION: "1",
        OPENMELD_FAKE_CURSOR_ACP_INTERACTION: "permission",
      },
      onInteractionRequest: () => interactionResponse,
      prompt: "Needs permission",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-permission-exit",
      spaceId: "space-permission-exit",
      taskId: "task-permission-exit",
      transportMode: "acp",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "upstream_unreachable");
    assert.ok(Date.now() - startedAt < 1000);

    resolveInteraction({
      kind: "permission",
      optionId: "allow-once",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
});

test("Run Everything selects only the one-time ACP permission option", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const result = await invokeCursorAcpTransport({
      agentControllerPermissionMode: "cursor:force",
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_INTERACTION: "permission",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      onInteractionRequest: () => {
        throw new Error(
          "Run Everything must not wait for a human permission response"
        );
      },
      prompt: "Force",
      taskId: "task-4",
    });
    assert.equal(result.output, "Cursor ACP reply");
    const log = await readLog(logPath);
    assert.deepEqual(log[0]?.argv, ["--force", "acp"]);
    const response = log.find(
      (entry) => entry.id === "permission-1" && !entry.method
    );
    assert.deepEqual(response?.result, {
      outcome: { optionId: "allow-once", outcome: "selected" },
    });
  });
});

test("Auto-review launches Cursor ACP with the official Smart Auto flag", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const result = await invokeCursorAcpTransport({
      agentControllerPermissionMode: "cursor:autoReview",
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: { OPENMELD_FAKE_CURSOR_ACP_LOG: logPath },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Auto-review",
      taskId: "task-auto-review",
    });

    assert.equal(result.output, "Cursor ACP reply");
    assert.deepEqual((await readLog(logPath))[0]?.argv, [
      "--auto-review",
      "acp",
    ]);
  });
});

test("Cursor ACP returns answers from Space to the Cursor question extension", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const requests = [];
    const result = await invokeCursorAcpTransport({
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_INTERACTION: "question",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      onInteractionRequest: (request) => {
        requests.push(request);
        return {
          answers: [{ questionId: "q1", values: ["a"] }],
          kind: "question",
        };
      },
      prompt: "Ask me",
      taskId: "task-question-interactive",
    });

    assert.equal(result.output, "Cursor ACP reply");
    assert.deepEqual(requests, [
      {
        kind: "question",
        questions: [
          {
            allowOther: false,
            multiple: false,
            options: [{ label: "A", optionId: "a" }],
            prompt: "Choose",
            questionId: "q1",
          },
        ],
        title: "Cursor needs your input",
      },
    ]);
    const response = (await readLog(logPath)).find(
      (entry) => entry.id === "question-1" && !entry.method
    );
    assert.deepEqual(response?.result, {
      outcome: {
        answers: [{ questionId: "q1", selectedOptionIds: ["a"] }],
        outcome: "answered",
      },
    });
  });
});

for (const review of [
  {
    response: { action: "approve", kind: "plan_review" },
    result: { outcome: { outcome: "accepted" } },
    title: "approves",
  },
  {
    response: {
      action: "request_changes",
      feedback: "Add a rollback step.",
      kind: "plan_review",
    },
    result: {
      outcome: {
        outcome: "rejected",
        reason: "Add a rollback step.",
      },
    },
    title: "returns plan feedback",
  },
]) {
  test(`Cursor ACP ${review.title} through the active Space turn`, async () => {
    const { invokeCursorAcpTransport } = await import("../dist/index.js");
    await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
      const requests = [];
      const result = await invokeCursorAcpTransport({
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CURSOR_ACP_INTERACTION: "plan",
          OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        onInteractionRequest: (request) => {
          requests.push(request);
          return review.response;
        },
        prompt: "Create a plan",
        taskId: `task-plan-${review.title}`,
      });

      assert.equal(result.output, "Cursor ACP reply");
      assert.deepEqual(requests, [
        {
          allowFeedback: true,
          kind: "plan_review",
          plan: "Plan",
          title: "Review Cursor's plan",
        },
      ]);
      const response = (await readLog(logPath)).find(
        (entry) => entry.id === "plan-1" && !entry.method
      );
      assert.deepEqual(response?.result, review.result);
    });
  });
}

test("Cursor ACP cancellation uses session/cancel and returns a stopped turn", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const dispatchPromise = adapter.dispatch({
      agentControllerPermissionMode: "cursor:default",
      agentId: "cursor",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
        OPENMELD_FAKE_CURSOR_ACP_WAIT_FOR_CANCEL: "1",
      },
      prompt: "Wait",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-cancel",
      spaceId: "space-cancel",
      taskId: "task-cancel",
      transportMode: "acp",
    });
    await waitForLogMethod(logPath, "session/prompt");

    const cancelResult = await adapter.cancel({
      taskId: "task-cancel",
    });
    const dispatchResult = await dispatchPromise;

    assert.deepEqual(cancelResult, {
      accepted: true,
      deliveryPath: "cancel",
      reasonCode: "accepted",
      signalDelivery: "sent",
      taskId: "task-cancel",
    });
    assert.equal(dispatchResult.status, "failed");
    assert.equal(dispatchResult.errorCode, "runtime.turn.cancelled");
    assert.ok(
      (await readLog(logPath)).some(
        (entry) =>
          entry.method === "session/cancel" &&
          entry.params?.sessionId === "cursor-session-new"
      )
    );
  });
});

test("Cursor ACP rejects independent reasoning strength before launch", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    await assert.rejects(
      invokeCursorAcpTransport({
        conversationPolicy: { reasoningLevel: "high" },
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        launchContract: createNodeScriptLaunchContract(fixturePath),
        prompt: "Reasoning",
        taskId: "task-reasoning",
      }),
      (error) =>
        error?.code === "model.reasoning_unsupported" &&
        error?.errorType === "config"
    );
  });
});

test("Cursor ACP rebuilds a persisted conversation when session/load returns Invalid params", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "stale-session",
      agentControllerPermissionMode: "cursor:default",
      agentId: "cursor",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_LOAD_INVALID_PARAMS: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      prompt: "Recover the unavailable persisted conversation",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-invalid-params-context-heal",
      spaceId: "space-invalid-params-context-heal",
      taskId: "task-invalid-params-context-heal",
      transportMode: "acp",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "Cursor ACP reply");
    assert.equal(
      result.contextDelta?.agentControllerConversationId,
      "cursor-session-new"
    );
    assert.equal(result.contextDelta?.refreshed, true);
    assert.deepEqual(
      (await readLog(logPath))
        .filter((entry) => entry.method)
        .map((entry) => entry.method),
      [
        "initialize",
        "authenticate",
        "session/load",
        "initialize",
        "authenticate",
        "session/new",
        "session/prompt",
      ]
    );
  });
});

test("Cursor ACP repair fails instead of replacing a missing canonical conversation", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "stale-session",
      agentControllerPermissionMode: "cursor:force",
      agentId: "cursor",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_LOAD_INVALID_PARAMS: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      executionMode: "repair",
      prompt: "Recover the exact persisted conversation",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-repair-missing-context",
      spaceId: "space-repair-missing-context",
      taskId: "task-repair-missing-context",
      transportMode: "acp",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "context_not_found");
    assert.deepEqual(
      (await readLog(logPath))
        .filter((entry) => entry.method)
        .map((entry) => entry.method),
      ["initialize", "authenticate", "session/load"]
    );
  });
});

test("Cursor ACP keeps Agent content authoritative after context healing", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "stale-session",
      agentControllerPermissionMode: "cursor:default",
      agentId: "cursor",
      env: {
        OPENMELD_FAKE_CURSOR_ACP_LOAD_INVALID_PARAMS: "1",
        OPENMELD_FAKE_CURSOR_ACP_REPLY: "Upgrade your plan to continue",
      },
      prompt: "Recover the unavailable persisted conversation",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-account-limit-context-heal",
      spaceId: "space-account-limit-context-heal",
      taskId: "task-account-limit-context-heal",
      transportMode: "acp",
    });

    assert.equal(result.status, "success");
    assert.equal(result.output, "Upgrade your plan to continue");
    assert.equal(result.contextDelta?.refreshed, true);
  });
});

test("Cursor ACP fails closed when a selected model is not in the session options", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    await assert.rejects(
      invokeCursorAcpTransport({
        conversationPolicy: {
          model: "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
        },
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CURSOR_ACP_CONFIG_DEFAULT_ONLY: "1",
          OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
          OPENMELD_FAKE_CURSOR_ACP_LEGACY_DEFAULT_ONLY: "1",
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        prompt: "Model",
        taskId: "task-model-unavailable",
      }),
      (error) =>
        error?.code === "model.unavailable" && error?.errorType === "config"
    );
    assert.deepEqual(
      (await readLog(logPath))
        .filter((entry) => entry.method)
        .map((entry) => entry.method),
      ["initialize", "authenticate", "session/new"]
    );
  });
});

test("Cursor ACP fails closed when the current model is absent from the session options", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    await assert.rejects(
      invokeCursorAcpTransport({
        conversationPolicy: { model: "default[]" },
        cursorTimeoutMs: 2000,
        cursorWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CURSOR_ACP_EMPTY_CONFIG_MODELS: "1",
          OPENMELD_FAKE_CURSOR_ACP_EMPTY_LEGACY_MODELS: "1",
          OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        prompt: "Current model",
        taskId: "task-current-model-unavailable",
      }),
      (error) =>
        error?.code === "model.inventory_unavailable" &&
        error?.errorType === "adapter" &&
        error?.diagnostics?.modelNegotiation.checkAttempt === 2 &&
        error?.diagnostics?.modelNegotiation.sourceState === "missing"
    );
    assert.deepEqual(
      (await readLog(logPath))
        .filter((entry) => entry.method)
        .map((entry) => entry.method),
      ["initialize", "authenticate", "session/new", "session/load"]
    );
  });
});

test("Cursor ACP reports conflicting model sources instead of guessing", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const result = await adapter.dispatch({
      agentControllerPermissionMode: "cursor:default",
      agentId: "cursor",
      conversationPolicy: {
        model: "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
      },
      env: {
        OPENMELD_FAKE_CURSOR_ACP_LEGACY_DEFAULT_ONLY: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      prompt: "Conflicting inventory",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-model-conflict",
      spaceId: "space-model-conflict",
      taskId: "task-model-conflict",
      transportMode: "acp",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "model.inventory_unavailable");
    assert.equal(result.errorType, "adapter");
    assert.deepEqual(result.diagnostics?.modelNegotiation, {
      checkAttempt: 2,
      configAvailableModelCount: 2,
      configAvailableModelIds: [
        "default[]",
        "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
      ],
      configAvailableModelIdsTruncated: false,
      configCurrentModelId: "default[]",
      currentModelId: "default[]",
      legacyAvailableModelCount: 1,
      legacyAvailableModelIds: ["default[]"],
      legacyAvailableModelIdsTruncated: false,
      legacyCurrentModelId: "default[]",
      protocol: "acp/v1",
      requestedModelId: "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
      requestedPresentInConfigOptions: true,
      requestedPresentInLegacyModels: false,
      sessionOperation: "load",
      sourceState: "conflicting",
    });
    assert.ok(
      !(await readLog(logPath)).some(
        (entry) => entry.method === "session/prompt"
      )
    );
  });
});

test("Cursor ACP preserves model diagnostics when context healing also fails", async () => {
  const { createCursorAdapter } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath }) => {
    const adapter = createCursorAdapter({
      cursorTimeoutMs: 2000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const result = await adapter.dispatch({
      agentControllerConversationId: "stale-session",
      agentControllerPermissionMode: "cursor:default",
      agentId: "cursor",
      conversationPolicy: { model: "default[]" },
      env: {
        OPENMELD_FAKE_CURSOR_ACP_EMPTY_CONFIG_MODELS: "1",
        OPENMELD_FAKE_CURSOR_ACP_EMPTY_LEGACY_MODELS: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOAD_CONTEXT_NOT_FOUND_ONCE: "1",
      },
      prompt: "Heal context",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-context-heal",
      spaceId: "space-context-heal",
      taskId: "task-context-heal",
      transportMode: "acp",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "context.rebuild_failed");
    assert.equal(result.diagnostics?.modelNegotiation.checkAttempt, 2);
    assert.equal(result.diagnostics?.modelNegotiation.sourceState, "missing");
  });
});

test("Cursor ACP falls back to the legacy model setter only when the standard method is unavailable", async () => {
  const { invokeCursorAcpTransport } = await import("../dist/index.js");
  await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
    const model = "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]";
    const result = await invokeCursorAcpTransport({
      conversationPolicy: { model },
      cursorTimeoutMs: 2000,
      cursorWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CURSOR_ACP_CONFIG_OPTION_UNSUPPORTED: "1",
        OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      prompt: "Legacy setter",
      taskId: "task-legacy-setter",
    });

    assert.equal(result.output, "Cursor ACP reply");
    const methods = (await readLog(logPath))
      .filter((entry) => entry.method)
      .map((entry) => entry.method);
    assert.ok(methods.includes("session/set_config_option"));
    assert.ok(methods.includes("session/set_model"));
  });
});

for (const interaction of ["question", "plan"]) {
  test(`Cursor ACP rejects unsupported ${interaction} interaction without hanging`, async () => {
    const { invokeCursorAcpTransport } = await import("../dist/index.js");
    await withFixture(async ({ fixtureDir, fixturePath, logPath }) => {
      await assert.rejects(
        invokeCursorAcpTransport({
          cursorTimeoutMs: 2000,
          cursorWorkdir: fixtureDir,
          env: {
            OPENMELD_FAKE_CURSOR_ACP_INTERACTION: interaction,
            OPENMELD_FAKE_CURSOR_ACP_LOG: logPath,
          },
          launchContract: createNodeScriptLaunchContract(fixturePath),
          prompt: "Interaction",
          taskId: "task-5",
        }),
        (error) => error?.code === `interaction.${interaction}_required`
      );
      const response = (await readLog(logPath)).find(
        (entry) =>
          entry.id === (interaction === "question" ? "question-1" : "plan-1") &&
          !entry.method
      );
      assert.deepEqual(
        response?.result,
        interaction === "question"
          ? {
              outcome: {
                outcome: "skipped",
                reason:
                  "OpenMeld does not support interactive Cursor questions yet.",
              },
            }
          : {
              outcome: {
                outcome: "rejected",
                reason:
                  "OpenMeld does not support interactive Cursor plan approval yet.",
              },
            }
      );
    });
  });
}
