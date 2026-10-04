import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod/v4";
import { invokeClaudeAgentSdkTransport } from "../dist/transport/claude-agent-sdk-transport.js";
import {
  checkClaudeDispatchSpaceToolConnection,
  createClaudeDispatchSpaceToolServer,
  verifyClaudeDeliveryReport,
} from "../dist/transport/claude-space-action-tools.js";

const NO_RECEIPT = /no saved Space action receipt/;
const NOT_RECORDED = /did not record/;
const NEEDS_AUTH = /needs-auth/;
const serverId = "openmeld_internal_dispatch_space_action";
function fixtureTools(deliveryOnly = false) {
  let recorded = false;
  const calls = [];
  return {
    deliveryOnly,
    calls,
    tools: [
      {
        name: "reply",
        description: "Explicit public reply",
        inputSchema: z.strictObject({ message: z.string().min(1) }),
      },
      {
        name: "stay_silent",
        description: "Intentional silence",
        inputSchema: z.strictObject({ reason: z.string().min(1) }),
      },
      {
        name: "read_receipt",
        description: "Read existing receipt",
        inputSchema: z.strictObject({}),
      },
    ],
    call(name, args) {
      calls.push({ name, args });
      if (name === "reply" || name === "stay_silent") {
        recorded = true;
      }
      return Promise.resolve({
        content: [
          {
            type: "text",
            text: recorded
              ? "Proposal saved locally; publication unconfirmed."
              : "No record.",
          },
        ],
        ...(recorded
          ? {
              structuredContent: {
                receipt: { status: "proposal_saved_locally" },
              },
            }
          : {}),
      });
    },
    close() {
      /* in-memory fixture has no external resources */
    },
  };
}

test("real SDK in-process MCP tools share the delivery handler and eagerly load only finals", async () => {
  const tools = fixtureTools();
  const server = createClaudeDispatchSpaceToolServer(tools);
  const client = new Client({ name: "delivery-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      client.connect(clientTransport),
      server.instance.connect(serverTransport),
    ]);
    const catalog = await client.listTools();
    assert.deepEqual(
      catalog.tools.map((entry) => entry.name),
      ["reply", "stay_silent", "read_receipt"]
    );
    for (const name of ["reply", "stay_silent"]) {
      assert.equal(
        catalog.tools.find((entry) => entry.name === name)._meta[
          "anthropic/alwaysLoad"
        ],
        true
      );
    }
    const invalid = await client.callTool({
      name: "reply",
      arguments: { message: 12 },
    });
    assert.equal(invalid.isError, true);
    assert.equal(tools.calls.length, 0);
    await client.callTool({
      name: "reply",
      arguments: { message: "No repository access; review not performed." },
    });
    assert.deepEqual(tools.calls, [
      {
        name: "reply",
        args: { message: "No repository access; review not performed." },
      },
    ]);
  } finally {
    await client.close();
    await server.instance.close();
  }
});

test("project contexts keep restricted file tools and the in-process project shell", async () => {
  const directory = await mkdtemp(join(tmpdir(), "claude-project-tools-"));
  const tools = fixtureTools();
  tools.tools.push({
    name: "project_shell",
    description: "Run a command in the task container",
    inputSchema: z.strictObject({ command: z.string().min(1) }),
  });
  let options;
  try {
    const result = await invokeClaudeAgentSdkTransport({
      agentControllerPermissionMode: "claude-code:auto",
      spaceActionTools: tools,
      executionContext: {
        version: 1,
        id: "11111111-1111-4111-8111-111111111111",
        scope: {
          organizationId: "org",
          requesterProfileId: "human",
          spaceId: "space",
          targetProfileId: "agent",
          threadId: null,
        },
        access: "workspace",
        workspace: "isolated",
        nativeConversationId: null,
        runtimeWorkspaceFingerprint: null,
      },
      launchContract: { kind: "executable", commandPath: process.execPath },
      claudeTimeoutMs: 5000,
      claudeWorkdir: directory,
      sessionId: null,
      prompt: "Read this project",
      createQuery(input) {
        options = input.options;
        const query = (async function* () {
          for await (const _ of input.prompt) {
            /* consume streaming input */
          }
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "project ready",
            session_id: "project-session",
            usage: {},
          };
        })();
        return Object.assign(query, {
          close() {
            /* generator fixture owns no process */
          },
          interrupt: () => Promise.resolve(),
          setPermissionMode: () => Promise.resolve(),
        });
      },
    });
    assert.equal(result.output, "project ready");
    assert.deepEqual(options.tools, ["Read", "Edit", "Write", "Glob", "Grep"]);
    assert.deepEqual(options.extraArgs, { restricted: null });
    assert.deepEqual(options.settingSources, []);
    assert.deepEqual(options.additionalDirectories, []);
    assert.equal(options.strictMcpConfig, true);
    assert.equal(options.permissionMode, "auto");
    assert.ok(options.allowedTools.includes(`mcp__${serverId}__project_shell`));
    const projectTool = options.mcpServers[serverId].instance;
    const client = new Client({ name: "project-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([
        client.connect(clientTransport),
        projectTool.connect(serverTransport),
      ]);
      const catalog = await client.listTools();
      assert.equal(
        catalog.tools.find((entry) => entry.name === "project_shell")?._meta?.[
          "anthropic/alwaysLoad"
        ],
        true
      );
    } finally {
      await client.close();
      await projectTool.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const mode of ["auto", "plan", "default", "bypassPermissions"]) {
  test(`independent Claude tasks retain native tools and ${mode} permissions`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-native-task-"));
    let options;
    try {
      await invokeClaudeAgentSdkTransport({
        agentControllerPermissionMode: `claude-code:${mode}`,
        executionContext: {
          version: 1,
          id: "11111111-1111-4111-8111-111111111111",
          scope: {
            organizationId: "org",
            requesterProfileId: "teammate",
            spaceId: "space",
            targetProfileId: "agent",
            threadId: null,
          },
          permissionSource: "agent_settings",
          access: "workspace",
          workspace: "current",
          nativeConversationId: null,
          runtimeWorkspaceFingerprint: null,
        },
        spaceActionTools: fixtureTools(),
        launchContract: { kind: "executable", commandPath: process.execPath },
        claudeTimeoutMs: 5000,
        claudeWorkdir: directory,
        sessionId: "existing-native-session",
        prompt: "Continue the task with your native tools.",
        createQuery(input) {
          options = input.options;
          const query = (async function* () {
            for await (const _ of input.prompt) {
              /* Consume the SDK's typed streaming input. */
            }
            yield {
              type: "result",
              subtype: "success",
              is_error: false,
              result: "done",
              session_id: "existing-native-session",
              usage: {},
            };
          })();
          return Object.assign(query, {
            close() {
              // The generator fixture owns no process.
            },
            interrupt: () => Promise.resolve(),
            setPermissionMode: () => Promise.resolve(),
          });
        },
      });
      assert.equal(options.permissionMode, mode);
      assert.equal(options.resume, "existing-native-session");
      assert.equal(options.tools, undefined);
      assert.equal(options.strictMcpConfig, undefined);
      assert.equal(options.extraArgs, undefined);
      assert.notEqual(options.settings?.disableAllHooks, true);
      assert.deepEqual(options.settingSources, ["user", "project", "local"]);
      assert.deepEqual(options.additionalDirectories, [directory]);
      assert.equal(options.mcpServers[serverId].type, "sdk");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const mode of ["auto", "plan", "default"]) {
  test(`SDK delivery-only repair preserves ${mode}, disables business tools, and verifies the real receipt`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-delivery-only-"));
    const tools = fixtureTools(true);
    let options;
    try {
      const result = await invokeClaudeAgentSdkTransport({
        agentControllerPermissionMode: `claude-code:${mode}`,
        spaceActionTools: tools,
        executionMode: "repair",
        launchContract: { kind: "executable", commandPath: process.execPath },
        claudeTimeoutMs: 5000,
        claudeWorkdir: directory,
        sessionId: "canonical-session",
        prompt: "Correct the public reply only.",
        createQuery(input) {
          options = input.options;
          const query = (async function* () {
            for await (const _ of input.prompt) {
              /* consume streaming input */
            }
            yield {
              type: "system",
              subtype: "init",
              session_id: "repair-fork",
            };
            await tools.call("reply", { message: "Known limitation." });
            yield {
              type: "result",
              subtype: "success",
              is_error: false,
              result: "Private text must not be published.",
              structured_output: { recorded: true },
              session_id: "repair-fork",
              usage: {},
            };
          })();
          return Object.assign(query, {
            close() {
              /* generator fixture owns no process */
            },
            interrupt: () => Promise.resolve(),
            setPermissionMode: () => Promise.resolve(),
            mcpServerStatus: async () => [
              { name: serverId, status: "connected" },
            ],
          });
        },
      });
      assert.equal(options.permissionMode, mode);
      assert.equal(options.forkSession, true);
      assert.equal(options.resume, "canonical-session");
      assert.deepEqual(options.tools, []);
      assert.equal(options.strictMcpConfig, true);
      assert.deepEqual(options.settings, {
        disableAllHooks: true,
        permissions: { deny: [], ask: [] },
      });
      assert.deepEqual(options.additionalDirectories, []);
      assert.deepEqual(options.settingSources, []);
      assert.equal(options.mcpServers[serverId].type, "sdk");
      assert.deepEqual(Object.keys(options.mcpServers), [serverId]);
      assert.deepEqual(options.outputFormat.schema.required, ["recorded"]);
      assert.equal(result.sessionId, "canonical-session");
      assert.equal(
        result.output,
        "Proposal saved locally; publication unconfirmed."
      );
      assert.deepEqual(
        tools.calls.map((call) => call.name),
        ["reply", "read_receipt"]
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("a claimed structured delivery never records or publishes anything", async () => {
  const tools = fixtureTools(true);
  await assert.rejects(
    verifyClaudeDeliveryReport(tools, { recorded: true }),
    NO_RECEIPT
  );
  await assert.rejects(
    verifyClaudeDeliveryReport(tools, undefined),
    NOT_RECORDED
  );
  assert.deepEqual(
    tools.calls.map((call) => call.name),
    ["read_receipt", "read_receipt"]
  );
});

test("connection recovery is bounded and does not replay tools or bypass authentication", async () => {
  const reconnected = [];
  let checks = 0;
  await checkClaudeDispatchSpaceToolConnection({
    mcpServerStatus: async () => [
      { name: serverId, status: checks++ === 0 ? "failed" : "connected" },
    ],
    reconnectMcpServer: (name) => {
      reconnected.push(name);
      return Promise.resolve();
    },
  });
  assert.deepEqual(reconnected, [serverId]);
  await assert.rejects(
    checkClaudeDispatchSpaceToolConnection({
      mcpServerStatus: async () => [{ name: serverId, status: "needs-auth" }],
      reconnectMcpServer: () =>
        Promise.reject(new Error("must not reconnect denied authorization")),
    }),
    NEEDS_AUTH
  );
});
