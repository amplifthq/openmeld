import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function writeFakeOpenCodeServer(fixturePath) {
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, existsSync, writeFileSync } from 'node:fs';",
      "import { createServer } from 'node:http';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) {",
      "  console.log('1.18.7');",
      "  process.exit(0);",
      "}",
      "if (args[0] !== 'serve') throw new Error('missing serve command');",
      "const readArg = (name, fallback) => {",
      "  const inline = args.find((arg) => arg.startsWith(name + '='));",
      "  if (inline) return inline.slice(name.length + 1);",
      "  const index = args.indexOf(name);",
      "  return index >= 0 ? args[index + 1] : fallback;",
      "};",
      "const host = readArg('--hostname', '127.0.0.1');",
      "const port = Number(readArg('--port', '4096'));",
      "const logPath = process.env.OPENMELD_FAKE_OPENCODE_SERVER_LOG;",
      "const stalledStartMarkerPath = process.env.OPENMELD_FAKE_OPENCODE_STALLED_START_MARKER;",
      "const stalledStart = Boolean(stalledStartMarkerPath && !existsSync(stalledStartMarkerPath));",
      "if (stalledStartMarkerPath && stalledStart) writeFileSync(stalledStartMarkerPath, 'stalled', 'utf8');",
      "const stalledHealthMarkerPath = process.env.OPENMELD_FAKE_OPENCODE_STALLED_HEALTH_MARKER;",
      "const stalledHealth = Boolean(stalledHealthMarkerPath && !existsSync(stalledHealthMarkerPath));",
      "if (stalledHealthMarkerPath && stalledHealth) writeFileSync(stalledHealthMarkerPath, 'stalled', 'utf8');",
      "const ignoreSigterm = process.env.OPENMELD_FAKE_OPENCODE_IGNORE_SIGTERM === '1';",
      "const interaction = process.env.OPENMELD_FAKE_OPENCODE_INTERACTION;",
      "const staleIdleOnResume = process.env.OPENMELD_FAKE_OPENCODE_STALE_IDLE_ON_RESUME === '1';",
      "const sessionID = process.env.OPENMELD_FAKE_OPENCODE_SESSION_ID ?? 'opencode-session-server';",
      "const forkSessionID = 'opencode-session-fork-1';",
      "const sseClients = new Set();",
      "const queuedEvents = [];",
      "let promptMessageID = null;",
      "let promptSessionID = sessionID;",
      "let promptFinished = false;",
      "const log = (entry) => {",
      "  if (!logPath) return;",
      "  appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');",
      "};",
      "log({ argv: args, permission: process.env.OPENCODE_PERMISSION ?? null });",
      "const sendJson = (response, status, body) => {",
      "  response.writeHead(status, { 'content-type': 'application/json' });",
      "  response.end(JSON.stringify(body));",
      "};",
      "const readBody = async (request) => {",
      "  let body = '';",
      "  for await (const chunk of request) body += chunk;",
      "  return body ? JSON.parse(body) : null;",
      "};",
      "const emit = (event) => {",
      "  const frame = 'data: ' + JSON.stringify(event) + '\\n\\n';",
      "  if (sseClients.size === 0) { queuedEvents.push(frame); return; }",
      "  for (const client of sseClients) client.write(frame);",
      "};",
      "const finishPrompt = () => {",
      "  if (!promptMessageID || promptFinished) return;",
      "  promptFinished = true;",
      "  emit({ id: 'event-assistant', type: 'message.updated', properties: { sessionID: promptSessionID, info: { id: 'assistant-1', sessionID: promptSessionID, role: 'assistant', parentID: promptMessageID } } });",
      "  emit({ id: 'event-part', type: 'message.part.updated', properties: { sessionID: promptSessionID, time: Date.now(), part: { id: 'part-1', sessionID: promptSessionID, messageID: 'assistant-1', type: 'text', text: 'OpenCode server reply' } } });",
      "  emit({ id: 'event-idle', type: 'session.idle', properties: { sessionID: promptSessionID } });",
      "};",
      "const server = createServer(async (request, response) => {",
      "  const url = new URL(request.url, 'http://' + host + ':' + port);",
      "  if (request.method === 'GET' && url.pathname === '/event') {",
      "    response.writeHead(200, {",
      "      'cache-control': 'no-cache',",
      "      connection: 'keep-alive',",
      "      'content-type': 'text/event-stream',",
      "    });",
      "    sseClients.add(response);",
      "    response.write('data: ' + JSON.stringify({ id: 'server-connected', type: 'server.connected', properties: {} }) + '\\n\\n');",
      "    for (const frame of queuedEvents.splice(0)) response.write(frame);",
      "    request.on('close', () => sseClients.delete(response));",
      "    return;",
      "  }",
      "  if (request.method === 'GET' && url.pathname === '/global/health') {",
      "    if (stalledHealth) return;",
      "    sendJson(response, 200, { healthy: true, version: '1.18.7' });",
      "    return;",
      "  }",
      "  if (request.method === 'POST' && url.pathname === '/session') {",
      "    const body = await readBody(request);",
      "    log({ body, method: request.method, path: url.pathname });",
      "    sendJson(response, 200, { id: sessionID });",
      "    return;",
      "  }",
      "  if (request.method === 'POST' && url.pathname === '/session/' + sessionID + '/fork') {",
      "    const body = await readBody(request);",
      "    log({ body, method: request.method, path: url.pathname });",
      "    sendJson(response, 200, { id: forkSessionID });",
      "    return;",
      "  }",
      "  if (request.method === 'PATCH' && url.pathname === '/session/opencode-session-fork-1') {",
      "    const body = await readBody(request);",
      "    log({ body, method: request.method, path: url.pathname });",
      "    sendJson(response, 200, { id: 'opencode-session-fork-1', title: body.title });",
      "    return;",
      "  }",
      "  if (request.method === 'GET' && (url.pathname === '/session/' + sessionID || url.pathname === '/session/' + forkSessionID)) {",
      "    log({ method: request.method, path: url.pathname });",
      "    sendJson(response, 200, { id: url.pathname.endsWith(forkSessionID) ? forkSessionID : sessionID });",
      "    return;",
      "  }",
      "  if (request.method === 'GET' && (url.pathname === '/session/' + sessionID + '/message' || url.pathname === '/session/' + forkSessionID + '/message')) {",
      "    sendJson(response, 200, promptFinished ? [{",
      "      info: { id: 'assistant-1', sessionID: promptSessionID, role: 'assistant', parentID: promptMessageID },",
      "      parts: [{ id: 'part-1', sessionID: promptSessionID, messageID: 'assistant-1', type: 'text', text: 'OpenCode server reply' }],",
      "    }] : []);",
      "    return;",
      "  }",
      "  if (request.method === 'POST' && (url.pathname === '/session/' + sessionID + '/prompt_async' || url.pathname === '/session/' + forkSessionID + '/prompt_async')) {",
      "    const body = await readBody(request);",
      "    log({ body, method: request.method, path: url.pathname });",
      "    promptSessionID = url.pathname.includes('/session/' + forkSessionID + '/') ? forkSessionID : sessionID;",
      "    promptMessageID = body.messageID ?? 'msg_server_generated_current';",
      "    sendJson(response, 204);",
      "    emit({ id: 'event-user', type: 'message.updated', properties: { sessionID: promptSessionID, info: { id: promptMessageID, sessionID: promptSessionID, role: 'user' } } });",
      "    if (staleIdleOnResume) {",
      "      setTimeout(() => emit({ id: 'event-stale-idle', type: 'session.idle', properties: { sessionID: promptSessionID } }), 10);",
      "      setTimeout(finishPrompt, 40);",
      "      return;",
      "    }",
      "    if (interaction === 'permission' || interaction === 'permission_then_exit') {",
      "      emit({ id: 'event-permission', type: 'permission.asked', properties: {",
      "        id: 'permission-1',",
      "        sessionID: promptSessionID,",
      "        permission: 'edit',",
      "        patterns: ['src/**'],",
      "        always: ['src/**'],",
      "        metadata: { description: 'Edit app files' },",
      "      } });",
      "      if (interaction === 'permission_then_exit') setTimeout(() => process.exit(17), 25);",
      "      return;",
      "    }",
      "    if (interaction === 'child_permission') {",
      "      emit({ id: 'event-child-session', type: 'session.created', properties: { sessionID: 'child-session-1', info: { id: 'child-session-1', parentID: promptSessionID } } });",
      "      emit({ id: 'event-child-permission', type: 'permission.asked', properties: {",
      "        id: 'permission-1',",
      "        sessionID: 'child-session-1',",
      "        permission: 'bash',",
      "        patterns: ['pnpm test'],",
      "        always: [],",
      "        metadata: { command: 'pnpm test' },",
      "      } });",
      "      return;",
      "    }",
      "    if (interaction === 'question') {",
      "      emit({ id: 'event-question', type: 'question.asked', properties: {",
      "        id: 'question-1',",
      "        sessionID: promptSessionID,",
      "        questions: [",
      "          { header: 'Release', question: 'Which release?', options: [{ label: 'Stable', description: 'Ship the stable channel' }], multiple: false, custom: false },",
      "          { header: 'Checks', question: 'Which checks?', options: [{ label: 'Unit', description: 'Run unit tests' }, { label: 'Smoke', description: 'Run smoke tests' }], multiple: true, custom: true },",
      "        ],",
      "      } });",
      "      return;",
      "    }",
      "    finishPrompt();",
      "    return;",
      "  }",
      "  if (request.method === 'POST' && url.pathname === '/permission/permission-1/reply') {",
      "    const body = await readBody(request);",
      "    log({ body, method: request.method, path: url.pathname });",
      "    sendJson(response, 200, true);",
      "    finishPrompt();",
      "    return;",
      "  }",
      "  if (request.method === 'POST' && url.pathname === '/question/question-1/reply') {",
      "    const body = await readBody(request);",
      "    log({ body, method: request.method, path: url.pathname });",
      "    sendJson(response, 200, true);",
      "    finishPrompt();",
      "    return;",
      "  }",
      "  if (request.method === 'POST' && url.pathname === '/question/question-1/reject') {",
      "    log({ method: request.method, path: url.pathname });",
      "    sendJson(response, 200, true);",
      "    finishPrompt();",
      "    return;",
      "  }",
      "  if (request.method === 'POST' && (url.pathname === '/session/' + sessionID + '/abort' || url.pathname === '/session/' + forkSessionID + '/abort')) {",
      "    sendJson(response, 200, true);",
      "    finishPrompt();",
      "    return;",
      "  }",
      "  sendJson(response, 404, { name: 'NotFoundError', data: { message: 'not found: ' + url.pathname } });",
      "});",
      "server.listen(port, host, () => {",
      "  if (!stalledStart) console.log('opencode server listening on http://' + host + ':' + port);",
      "});",
      "const shutdown = () => {",
      "  for (const client of sseClients) client.end();",
      "  server.close(() => process.exit(0));",
      "  setTimeout(() => process.exit(0), 250).unref();",
      "};",
      "process.on('SIGTERM', () => { if (!ignoreSigterm) shutdown(); });",
      "process.on('SIGINT', shutdown);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);
}

async function readLog(logPath) {
  return (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function withServerFixture(callback) {
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-server-fixture-"));
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
      prompt: "Change the app",
      runtimeContext: createRuntimeContext(fixtureDir),
      sourceEventId: "source-opencode-permission",
      spaceId: "space-opencode-permission",
      taskId: "task-opencode-permission",
    });

    assert.equal(result.status, "success", JSON.stringify(result));
    assert.equal(result.output, "OpenCode server reply");
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
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        openCodeTimeoutMs: 250,
        openCodeWorkdir: fixtureDir,
        prompt: "Do not exceed the turn budget",
        sessionId: null,
      }),
      (error) => error?.code === "process.timeout"
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
