import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AcpProcessSession } from "../dist/index.js";

const NON_JSON_RPC_RE = /non-JSON-RPC/;

function createTestError(input) {
  const error = new Error(
    input.message,
    input.cause ? { cause: input.cause } : undefined
  );
  error.code = input.code;
  error.errorType = input.errorType;
  return error;
}

async function createFixture(source) {
  const fixtureDir = await mkdtemp(join(tmpdir(), "openmeld-acp-session-"));
  const scriptPath = join(fixtureDir, "fixture.mjs");
  await writeFile(scriptPath, source, "utf8");
  return {
    fixtureDir,
    launchContract: {
      kind: "node_script",
      nodePath: process.execPath,
      scriptPath,
    },
  };
}

function createSession(input) {
  return new AcpProcessSession({
    args: [],
    createError: createTestError,
    cwd: input.cwd,
    launchContract: input.launchContract,
    processLabel: "fixture",
    timeoutMs: input.timeoutMs ?? 2000,
    ...(input.onClientRequest
      ? { onClientRequest: input.onClientRequest }
      : {}),
    ...(input.onNotification ? { onNotification: input.onNotification } : {}),
  });
}

test("AcpProcessSession keeps stderr off the wire and routes notifications and reverse requests", async () => {
  const fixture = await createFixture(`
    import readline from "node:readline";
    const lines = readline.createInterface({ input: process.stdin });
    let requestId = null;
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        requestId = message.id;
        process.stderr.write("fixture diagnostic\\n");
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: "reverse-1",
          method: "session/request_permission",
          params: { options: [{ kind: "allow_once", optionId: "allow" }] }
        }) + "\\n");
        return;
      }
      if (message.id === "reverse-1") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { update: { sessionUpdate: "agent_message_chunk" } }
        }) + "\\n");
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          result: { protocolVersion: 1, permission: message.result }
        }) + "\\n");
      }
    });
  `);
  const notifications = [];
  const reverseRequests = [];
  const session = createSession({
    cwd: fixture.fixtureDir,
    launchContract: fixture.launchContract,
    onClientRequest: (request) => {
      reverseRequests.push(request);
      return {
        result: { outcome: { optionId: "allow", outcome: "selected" } },
      };
    },
    onNotification: (notification) => notifications.push(notification),
  });

  try {
    session.start();
    const result = await session.request("initialize", { protocolVersion: 1 });
    assert.deepEqual(result, {
      permission: { outcome: { optionId: "allow", outcome: "selected" } },
      protocolVersion: 1,
    });
    assert.deepEqual(reverseRequests, [
      {
        method: "session/request_permission",
        params: { options: [{ kind: "allow_once", optionId: "allow" }] },
      },
    ]);
    assert.deepEqual(notifications, [
      {
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk" } },
      },
    ]);
    assert.equal(session.readStderr(), "fixture diagnostic\n");
  } finally {
    await session.close();
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("AcpProcessSession fails closed on non-JSON-RPC stdout", async () => {
  const fixture = await createFixture(`
    process.stdin.once("data", () => process.stdout.write("not json\\n"));
  `);
  const session = createSession({
    cwd: fixture.fixtureDir,
    launchContract: fixture.launchContract,
  });

  try {
    session.start();
    await assert.rejects(
      session.request("initialize", {}),
      (error) =>
        error.code === "protocol.invalid" && NON_JSON_RPC_RE.test(error.message)
    );
  } finally {
    await session.close();
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("AcpProcessSession returns method-not-found for an unhandled blocking request", async () => {
  const fixture = await createFixture(`
    import readline from "node:readline";
    const lines = readline.createInterface({ input: process.stdin });
    let requestId = null;
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        requestId = message.id;
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: 900,
          method: "vendor/unknown_blocking_request",
          params: {}
        }) + "\\n");
        return;
      }
      if (message.id === 900) {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          result: { reverseError: message.error }
        }) + "\\n");
      }
    });
  `);
  const session = createSession({
    cwd: fixture.fixtureDir,
    launchContract: fixture.launchContract,
  });

  try {
    session.start();
    const result = await session.request("initialize", {});
    assert.deepEqual(result, {
      reverseError: {
        code: -32_601,
        message:
          "OpenMeld does not support ACP client method 'vendor/unknown_blocking_request'.",
      },
    });
  } finally {
    await session.close();
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("AcpProcessSession rejects pending work on its explicit process deadline", async () => {
  const fixture = await createFixture(`
    process.stdin.resume();
    setInterval(() => {}, 1_000);
  `);
  const session = createSession({
    cwd: fixture.fixtureDir,
    launchContract: fixture.launchContract,
    timeoutMs: 50,
  });

  try {
    session.start();
    await assert.rejects(
      session.request("initialize", {}),
      (error) => error.code === "process.timeout"
    );
    assert.ok(session.readLifecycle().timeoutTriggeredAtMs);
  } finally {
    await session.close();
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

test("AcpProcessSession close reaps detached supervised descendants", async () => {
  const fixture = await createFixture(`
    import { spawn } from "node:child_process";
    import readline from "node:readline";
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method !== "initialize") return;
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { detached: true, env: process.env, stdio: "ignore" }
      );
      child.unref();
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { descendantProcessId: child.pid }
      }) + "\\n");
    });
  `);
  const session = createSession({
    cwd: fixture.fixtureDir,
    launchContract: fixture.launchContract,
  });
  let descendantProcessId = null;

  try {
    session.start();
    const result = await session.request("initialize", {});
    descendantProcessId = result.descendantProcessId;
    assert.equal(Number.isInteger(descendantProcessId), true);
    assert.equal(isProcessAlive(descendantProcessId), true);

    await session.close();
    await waitForProcessExit(descendantProcessId);
    assert.equal(isProcessAlive(descendantProcessId), false);
  } finally {
    await session.close();
    if (descendantProcessId && isProcessAlive(descendantProcessId)) {
      process.kill(descendantProcessId, "SIGKILL");
    }
    await rm(fixture.fixtureDir, { force: true, recursive: true });
  }
});

async function waitForProcessExit(processId) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && isProcessAlive(processId)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isProcessAlive(processId) {
  if (!processId) {
    return false;
  }
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}
