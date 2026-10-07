import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare } = await import(
  pathToFileURL(wranglerRequire.resolve("miniflare")).href
);
const buildRoot = fileURLToPath(
  new URL("../dist/openmeld_remote_agent/", import.meta.url)
);
const STOPPED_DURING_LAUNCH = /stopped during launch/;
const CANCELLATION_UNSUPPORTED = /computer.cancellation_unsupported/;

test("native Computer uses official files and both isolate engines through the built RPC receiver", async () => {
  let enteredSlowRequest;
  let slowResponse;
  const slowRequest = new Promise((resolve) => {
    enteredSlowRequest = resolve;
  });
  const server = createServer((request, response) => {
    if (request.url === "/slow") {
      slowResponse = response;
      enteredSlowRequest();
      return;
    }
    response.end("network fixture");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
  const config = JSON.parse(
    await readFile(path.join(buildRoot, "wrangler.json"), "utf8")
  );
  const files = (await readdir(buildRoot, { recursive: true })).filter((file) =>
    file.endsWith(".js")
  );
  const modules = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        {
          type: "esm",
          contents: await readFile(path.join(buildRoot, file), "utf8"),
        },
      ])
    )
  );
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: "caller",
          compatibilityDate: config.compatibility_date,
          compatibilityFlags: config.compatibility_flags,
          manifest: {
            mainModule: "caller.mjs",
            modules: {
              "caller.mjs": {
                type: "esm",
                contents: `export default { async fetch(request, env) { try { const operation = await request.json(); if (operation.cleanup) return Response.json(await env.COMPUTER.get(env.COMPUTER.idFromName('personal-computer:native-test')).stopComputerCommands(operation.invocationId)); return Response.json(await env.REMOTE.cloudComputerOperation({ computer: { id: 'native-test', ownerUserId: 'test-owner', provider: 'cloudflare', createdAtMs: 0 }, operation })); } catch(error) { return Response.json({error: error.message}, {status: 500}); } } };`,
              },
            },
          },
          env: {
            REMOTE: { type: "worker", worker: "remote" },
            COMPUTER: {
              type: "durable-object",
              worker: "remote",
              exportName: "AgentComputer",
            },
          },
        },
      },
      {
        config: {
          name: "remote",
          manifest: {
            mainModule: config.main,
            modulesRoot: buildRoot,
            modules,
          },
          compatibilityDate: config.compatibility_date,
          compatibilityFlags: config.compatibility_flags,
          exports: {
            AgentComputer: { type: "durable-object", storage: "sqlite" },
          },
          env: {
            LOADER: { type: "worker-loader" },
            AGENT_COMPUTER: {
              type: "durable-object",
              worker: "remote",
              exportName: "AgentComputer",
            },
          },
        },
      },
    ],
  });
  const call = async (operation) => {
    const response = await runtime.dispatchFetch("https://caller.example/", {
      method: "POST",
      body: JSON.stringify(operation),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  try {
    const described = await call({ action: "describe" });
    assert.equal(described.capabilities.storage.scope, "persistent");
    assert.ok(described.capabilities.storage.databaseBytes > 0);
    assert.equal(described.capabilities.storage.limitBytes, 10_000_000_000);
    assert.equal(described.capabilities.storage.status, "available");
    assert.deepEqual(Object.keys(described.capabilities.backends).sort(), [
      "container",
      "worker-javascript",
      "worker-shell",
    ]);
    assert.equal(
      (
        await call({
          action: "files",
          tool: "write",
          input: {
            path: "/computer/home/source.txt",
            content: "persistent hello",
          },
        })
      ).result.isError,
      false
    );
    for (const [backend, command] of [
      ["worker-shell", "cat /computer/home/source.txt"],
      [
        "worker-javascript",
        "import { readFile, writeFile } from 'node:fs/promises'; export default async function(input) { const text = await readFile('/computer/home/source.txt', 'utf8'); await writeFile('/computer/home/result.txt', text + input.suffix); return { text, suffix: input.suffix }; }",
      ],
    ]) {
      const start = {
        action: "command",
        invocationId: backend,
        command: {
          action: "start",
          key: "native",
          command,
          backend,
          ...(backend === "worker-javascript"
            ? { input: { suffix: " from JS" } }
            : {}),
        },
      };
      let receipt = await call(start);
      for (
        let count = 0;
        receipt.status !== "completed" && count < 5;
        count++
      ) {
        receipt = await call({
          action: "command",
          invocationId: backend,
          command: { action: "poll", key: "native", waitSeconds: 1 },
        });
      }
      assert.equal(receipt.status, "completed");
      assert.equal(receipt.exitCode, 0, JSON.stringify(receipt));
      if (backend === "worker-shell") {
        assert.equal(receipt.stdout, "persistent hello");
      } else {
        assert.deepEqual(receipt.result, {
          text: "persistent hello",
          suffix: " from JS",
        });
      }
      const replay = await call(start);
      assert.equal(replay.id, receipt.id);
      assert.equal(replay.status, "completed");
      if (backend === "worker-shell") {
        const consumed = await call({
          action: "command",
          invocationId: backend,
          command: { action: "poll", key: "native", after: receipt.after },
        });
        assert.equal(consumed.stdout, "");
        assert.equal((await call(start)).stdout, "persistent hello");
      }
    }
    assert.equal(
      (await call({ action: "read", path: "/computer/home/result.txt" }))
        .content,
      "persistent hello from JS"
    );
    assert.equal(
      (
        await call({
          action: "files",
          tool: "find",
          input: { path: "/computer/home", pattern: "*.txt", limit: 1 },
        })
      ).result.isError,
      false
    );
    assert.equal(
      (
        await call({
          action: "files",
          tool: "delete",
          input: { path: "/computer/home/result.txt" },
        })
      ).result.isError,
      false
    );
    const [shell, javascript] = await Promise.all([
      call({
        action: "command",
        invocationId: "concurrent-shell",
        command: {
          action: "start",
          key: "network",
          backend: "worker-shell",
          command: `printf '%s:' "$PROBE"; cat; curl -s '${fixtureUrl}'`,
          env: { PROBE: "env" },
          stdin: "stdin:",
        },
      }),
      call({
        action: "command",
        invocationId: "concurrent-js",
        command: {
          action: "start",
          key: "network",
          backend: "worker-javascript",
          command:
            "export default async function(input) { return { text: await (await fetch(input.url)).text() }; }",
          input: { url: fixtureUrl },
        },
      }),
    ]);
    assert.equal(shell.exitCode, 0, JSON.stringify(shell));
    assert.equal(shell.stdout, "env:stdin:network fixture");
    assert.equal(javascript.exitCode, 0, JSON.stringify(javascript));
    assert.deepEqual(javascript.result, { text: "network fixture" });
    const pending = call({
      action: "command",
      invocationId: "cancel-shell",
      command: {
        action: "start",
        key: "slow",
        backend: "worker-shell",
        command: `curl -s '${fixtureUrl}slow'`,
        timeoutSeconds: 10,
      },
    }).then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    await slowRequest;
    await assert.rejects(
      call({
        action: "command",
        invocationId: "cancel-shell",
        command: { action: "stop", key: "slow" },
      }),
      CANCELLATION_UNSUPPORTED
    );
    const stop = await call({ cleanup: true, invocationId: "cancel-shell" });
    assert.equal(stop.unfinished, 1);
    slowResponse.end("finished naturally");
    assert.match(String((await pending).error), STOPPED_DURING_LAUNCH);
    const terminal = await call({
      action: "command",
      invocationId: "cancel-shell",
      command: { action: "poll", key: "slow" },
    });
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.exitCode, 0);
    assert.equal(terminal.stdout, "finished naturally");
    assert.deepEqual(
      await call({ cleanup: true, invocationId: "cancel-shell" }),
      { unfinished: 0, lostDuringCleanup: false }
    );
  } finally {
    await runtime.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
