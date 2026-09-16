import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, describe, it } from "node:test";
import { promisify } from "node:util";
import {
  assertCodexScopedMcpInventory,
  buildCodexScopedMcpDisableArgs,
} from "../dist/transport/codex-scoped-mcp.js";

const execFileAsync = promisify(execFile);
const DISPATCH_SERVER = "openmeld_internal_dispatch_space_action";
const TOOL_NAMES = [
  "reply",
  "stay_silent",
  "read_file",
  "read_history",
  "status",
];
const ISOLATION_ERROR = /context\.mcp_isolation_unverified/;
const NAMESPACE_CONFLICT_ERROR =
  /execution_context\.mcp_server_namespace_conflict/;
const NATIVE_CONFIG_FALLBACK =
  /Invalid configuration|using defaults|config error/i;

// Captured from native Codex mcpServerStatus/list with an isolated synthetic
// stdio MCP server; matches its generated ListMcpServerStatusResponse schema.
const DISPATCH_STATUS = {
  name: DISPATCH_SERVER,
  runtimeStatus: "connected",
  pluginId: null,
  serverInfo: {
    name: "fixture",
    title: null,
    version: "1",
    description: null,
    icons: null,
    websiteUrl: null,
  },
  tools: Object.fromEntries(
    TOOL_NAMES.map((name) => [name, { name, inputSchema: { type: "object" } }])
  ),
  toolsError: null,
  resources: [],
  resourceTemplates: [],
  authStatus: "unsupported",
};
// Native full inventory retains these rows after enabled=false overrides.
const DISABLED_STATUS = {
  name: "ambient",
  runtimeStatus: "disabled",
  pluginId: null,
  serverInfo: null,
  tools: {},
  toolsError: null,
  resources: [],
  resourceTemplates: [],
  authStatus: "unsupported",
};

async function fixtureLaunch(script) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "openmeld-codex-mcp-"))
  );
  after(() => rm(root, { recursive: true, force: true }));
  const workingDirectory = join(root, "task");
  await mkdir(workingDirectory);
  const scriptPath = join(root, "codex-fixture.cjs");
  await writeFile(scriptPath, script);
  return {
    launchContract: {
      kind: "node_script",
      nodePath: process.execPath,
      scriptPath,
    },
    env: {
      ...process.env,
      CODEX_HOME: root,
      MCP_EXPECTED_CWD: workingDirectory,
    },
    workingDirectory,
  };
}

async function readNativeMcpInventory(input, args) {
  const child = spawn(
    process.env.OPENMELD_TEST_CODEX_BIN,
    [...args, "app-server", "--listen", "stdio://"],
    {
      // Match the product: bootstrap outside the task's project config scope.
      cwd: input.env.CODEX_HOME,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-65_536);
  });
  let processError;
  let threadResult;
  child.on("error", (error) => {
    processError = error;
    lines.close();
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    id: 1,
    method: "initialize",
    params: {
      clientInfo: { name: "openmeld-scoped-mcp-test", version: "1" },
      capabilities: { experimentalApi: true },
    },
  });
  try {
    for await (const line of lines) {
      const response = JSON.parse(line);
      if (response.error) {
        throw new Error("native app-server rejected the MCP fixture request");
      }
      if (response.id === 1) {
        if (!response.result) {
          throw new Error(
            "native app-server returned no initialization result"
          );
        }
        send({ method: "initialized" });
        send({
          id: 2,
          method: "thread/start",
          params: {
            cwd: input.workingDirectory,
            ephemeral: true,
            approvalPolicy: "never",
          },
        });
      } else if (response.id === 2) {
        threadResult = response.result;
        send({
          id: 3,
          method: "mcpServerStatus/list",
          params: {
            threadId: response.result.thread.id,
            detail: "full",
            limit: 100,
          },
        });
      } else if (response.id === 3) {
        return { inventory: response.result, threadResult, stderr };
      }
    }
    throw (
      processError ??
      new Error("native app-server closed before returning MCP inventory")
    );
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.kill("SIGKILL");
    await closed;
  }
}

describe("Codex scoped MCP configuration", () => {
  it("enumerates the selected installation in its task cwd and disables every server", async () => {
    const names = [
      "ordinary",
      "contains.dot",
      'contains"quote',
      "contains\\slash",
    ];
    // CLI list --json rows captured from native Codex; transport fields are
    // deliberately ignored because they may contain private configuration.
    const rows = names.map((name, index) => ({
      name,
      enabled: index !== 0,
      disabled_reason: null,
      transport: {
        type: "stdio",
        command: "fixture-only",
        args: [],
        env: { SECRET: "must-not-be-forwarded" },
        env_vars: [],
        cwd: null,
      },
      startup_timeout_sec: null,
      tool_timeout_sec: null,
      auth_status: "unsupported",
    }));
    const input = await fixtureLaunch(
      `require("node:assert/strict").deepEqual(process.argv.slice(2), ["mcp", "list", "--json"]);
       require("node:assert/strict").equal(process.cwd(), process.env.MCP_EXPECTED_CWD);
       process.stdout.write(${JSON.stringify(JSON.stringify(rows))});`
    );
    assert.deepEqual(await buildCodexScopedMcpDisableArgs(input), [
      "-c",
      `mcp_servers={${names.map((name) => `${JSON.stringify(name)}={command=${JSON.stringify(process.execPath)},args=["--version"],enabled=false}`).join(",")}}`,
    ]);
  });

  it("fails closed on malformed, duplicate, or non-JSON native inventory", async () => {
    for (const output of [
      "not JSON",
      "{}",
      '[{"name":"ambient","enabled":"true"}]',
      '[{"name":"","enabled":true}]',
      '[{"name":"ambient","enabled":true,"transport":{"type":"stdio"}},{"name":"ambient","enabled":false,"transport":{"type":"stdio"}}]',
      '[{"name":"ambient","enabled":true,"transport":{"type":"unknown"}}]',
      '[{"name":"ambient","enabled":true,"transport":null}]',
      "[null]",
    ]) {
      const input = await fixtureLaunch(
        `process.stdout.write(${JSON.stringify(output)});`
      );
      await assert.rejects(
        buildCodexScopedMcpDisableArgs(input),
        ISOLATION_ERROR
      );
    }
  });

  it("rejects failed or oversized probes without leaking process output", async () => {
    for (const script of [
      'process.stderr.write("fixture-private-secret"); process.exit(7);',
      'process.stdout.write("fixture-private-secret".repeat(100_000));',
    ]) {
      const input = await fixtureLaunch(script);
      await assert.rejects(buildCodexScopedMcpDisableArgs(input), (error) => {
        assert.match(error.message, ISOLATION_ERROR);
        assert.equal(error.message.includes("fixture-private-secret"), false);
        assert.equal(error.cause, undefined);
        return true;
      });
    }
  });

  it("accepts a complete empty native configuration inventory", async () => {
    const input = await fixtureLaunch('process.stdout.write("[]");');
    assert.deepEqual(await buildCodexScopedMcpDisableArgs(input), []);
  });

  it("rejects a configured reserved dispatch name even when disabled", async () => {
    for (const enabled of [true, false]) {
      const input = await fixtureLaunch(
        `process.stdout.write(${JSON.stringify(JSON.stringify([{ name: DISPATCH_SERVER, enabled }]))});`
      );
      await assert.rejects(
        buildCodexScopedMcpDisableArgs(input),
        NAMESPACE_CONFLICT_ERROR
      );
    }
  });

  it(
    "initializes native app-server outside the task and keeps project MCP servers disabled",
    { skip: !process.env.OPENMELD_TEST_CODEX_BIN },
    async () => {
      const input = await fixtureLaunch("");
      input.launchContract = {
        kind: "executable",
        commandPath: process.env.OPENMELD_TEST_CODEX_BIN,
      };
      await execFileAsync("git", ["init", "-q", input.workingDirectory]);
      await mkdir(join(input.workingDirectory, ".codex"));
      await writeFile(
        join(input.env.CODEX_HOME, "config.toml"),
        `[projects.${JSON.stringify(input.workingDirectory)}]\ntrust_level="trusted"\n`
      );
      const sentinel = join(input.env.CODEX_HOME, "ambient-server-ran");
      const ambientScript = `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "unexpected");`;
      await writeFile(
        join(input.workingDirectory, ".codex", "config.toml"),
        `[mcp_servers."task.stdio"]\ncommand=${JSON.stringify(process.execPath)}\nargs=["-e",${JSON.stringify(ambientScript)}]\n\n[mcp_servers.task_http]\nurl="http://127.0.0.1:9/never-connect"\n`
      );
      const args = await buildCodexScopedMcpDisableArgs(input);
      assert.ok(args.some((arg) => arg.includes('"task.stdio"')));
      assert.ok(args.some((arg) => arg.includes('"task_http"')));
      const { inventory, threadResult, stderr } = await readNativeMcpInventory(
        input,
        [
          ...args,
          "-c",
          'permissions.openmeld_mcp_test={extends=":read-only"}',
          "-c",
          'default_permissions="openmeld_mcp_test"',
        ]
      );
      assert.doesNotMatch(stderr, NATIVE_CONFIG_FALLBACK);
      assert.equal(
        threadResult.activePermissionProfile.id,
        "openmeld_mcp_test"
      );
      assertCodexScopedMcpInventory(inventory, { expectDispatchServer: false });
      assert.deepEqual(
        inventory.data.map((row) => ({
          name: row.name,
          runtimeStatus: row.runtimeStatus,
        })),
        [
          { name: "task.stdio", runtimeStatus: "disabled" },
          { name: "task_http", runtimeStatus: "disabled" },
        ]
      );
      await assert.rejects(stat(sentinel), { code: "ENOENT" });
    }
  );

  it(
    "disables arbitrary native keys and rejects a reserved dispatch-name collision",
    {
      skip: !process.env.OPENMELD_TEST_CODEX_BIN,
    },
    async () => {
      const input = await fixtureLaunch("");
      const names = [
        "ordinary",
        "contains.dot",
        'contains"quote',
        "contains\\slash",
      ];
      await writeFile(
        join(input.env.CODEX_HOME, "config.toml"),
        names
          .map(
            (name) =>
              `[mcp_servers.${JSON.stringify(name)}]\ncommand = "fixture-only"\nenabled = true\n`
          )
          .join("\n")
      );
      input.launchContract = {
        kind: "executable",
        commandPath: process.env.OPENMELD_TEST_CODEX_BIN,
      };
      const args = await buildCodexScopedMcpDisableArgs(input);
      const { stdout } = await execFileAsync(
        process.env.OPENMELD_TEST_CODEX_BIN,
        [...args, "mcp", "list", "--json"],
        {
          cwd: input.workingDirectory,
          env: input.env,
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        }
      );
      const rows = JSON.parse(stdout);
      assert.equal(rows.length, names.length);
      assert.equal(
        rows.every((row) => row.enabled === false),
        true
      );
      for (const enabled of [true, false]) {
        await writeFile(
          join(input.env.CODEX_HOME, "config.toml"),
          `[mcp_servers.${DISPATCH_SERVER}]\ncommand = "fixture-only"\nenabled = ${enabled}\n`
        );
        await assert.rejects(
          buildCodexScopedMcpDisableArgs(input),
          NAMESPACE_CONFLICT_ERROR
        );
      }
    }
  );
});

describe("Codex effective scoped MCP inventory", () => {
  it("accepts only dispatch tools alongside explicitly disabled empty servers", () => {
    assertCodexScopedMcpInventory({
      data: [DISABLED_STATUS, DISPATCH_STATUS],
      nextCursor: null,
    });
    const { runtimeStatus: _runtimeStatus, ...withoutOptionalStatus } =
      DISPATCH_STATUS;
    assertCodexScopedMcpInventory({ data: [withoutOptionalStatus] });
    assertCodexScopedMcpInventory(
      { data: [DISABLED_STATUS], nextCursor: null },
      { expectDispatchServer: false }
    );
    assertCodexScopedMcpInventory(
      { data: [] },
      { expectDispatchServer: false }
    );
  });

  it("rejects unknown, missing, duplicate, failed, or plugin-owned active servers", () => {
    for (const data of [
      [],
      [DISABLED_STATUS],
      [DISPATCH_STATUS, DISPATCH_STATUS],
      [DISPATCH_STATUS, { ...DISABLED_STATUS, runtimeStatus: "connected" }],
      [{ ...DISPATCH_STATUS, name: "ambient" }],
      [{ ...DISPATCH_STATUS, runtimeStatus: "failed" }],
      [{ ...DISPATCH_STATUS, runtimeStatus: null }],
      [{ ...DISPATCH_STATUS, pluginId: "ambient-plugin" }],
    ]) {
      assert.throws(
        () => assertCodexScopedMcpInventory({ data }),
        ISOLATION_ERROR
      );
    }
    assert.throws(
      () =>
        assertCodexScopedMcpInventory(
          { data: [DISPATCH_STATUS] },
          { expectDispatchServer: false }
        ),
      ISOLATION_ERROR
    );
  });

  it("rejects partial pagination and malformed native response shapes", () => {
    for (const value of [
      null,
      [],
      {},
      { data: [null] },
      { data: [DISPATCH_STATUS], nextCursor: "next-page" },
      { data: [DISPATCH_STATUS], nextCursor: "" },
      { data: [DISPATCH_STATUS], nextCursor: false },
      { data: [{ ...DISPATCH_STATUS, resources: null }] },
      { data: [{ ...DISPATCH_STATUS, authStatus: "unexpected" }] },
    ]) {
      assert.throws(
        () => assertCodexScopedMcpInventory(value),
        ISOLATION_ERROR
      );
    }
  });

  it("rejects extra, missing, malformed, or renamed tools and exposed resources", () => {
    for (const row of [
      { ...DISPATCH_STATUS, tools: {} },
      { ...DISPATCH_STATUS, tools: [] },
      {
        ...DISPATCH_STATUS,
        tools: {
          ...DISPATCH_STATUS.tools,
          exec: { name: "exec", inputSchema: {} },
        },
      },
      {
        ...DISPATCH_STATUS,
        tools: {
          ...DISPATCH_STATUS.tools,
          reply: { name: "exec", inputSchema: {} },
        },
      },
      {
        ...DISPATCH_STATUS,
        tools: { ...DISPATCH_STATUS.tools, reply: { name: "reply" } },
      },
      { ...DISPATCH_STATUS, toolsError: "catalog failed" },
      {
        ...DISPATCH_STATUS,
        resources: [{ name: "private", uri: "file:///private" }],
      },
      {
        ...DISPATCH_STATUS,
        resourceTemplates: [{ name: "private", uriTemplate: "file:///{path}" }],
      },
      {
        ...DISABLED_STATUS,
        tools: { exec: { name: "exec", inputSchema: {} } },
      },
    ]) {
      assert.throws(
        () => assertCodexScopedMcpInventory({ data: [row] }),
        ISOLATION_ERROR
      );
    }
  });
});
