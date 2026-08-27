import assert from "node:assert/strict";
import test from "node:test";

const INVALID_ACTIVE_CLI_COMMAND_PATTERN = /active CLI command is invalid/;

test("dispatch Space Action MCP config is absent outside a Wake", async () => {
  const core = await import("../dist/index.js");

  assert.equal(core.resolveDispatchSpaceActionMcpServer({}), null);
});

test("dispatch Space Action MCP config forwards only its bounded authority", async () => {
  const core = await import("../dist/index.js");
  const server = core.resolveDispatchSpaceActionMcpServer({
    OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
    OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: "/tmp/action/bin/openmeld-dev",
    OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID: "dispatch-1",
    OPENMELD_DISPATCH_RUNTIME_MODE: "dispatch_owned",
    OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID: "agt_1",
    OPENMELD_ENV_PRESET: "dev-local",
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
    SECRET_THAT_MUST_NOT_LEAK: "secret",
  });

  assert.deepEqual(server, {
    args: ["space", "action", "tool-server"],
    command: "openmeld-dev",
    commandPath: "/tmp/action/bin/openmeld-dev",
    env: {
      OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
      OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: "/tmp/action/bin/openmeld-dev",
      OPENMELD_DISPATCH_RUNTIME_MODE: "dispatch_owned",
      OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID: "dispatch-1",
      OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID: "agt_1",
      OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      OPENMELD_ENV_PRESET: "dev-local",
    },
    id: "openmeld_internal_dispatch_space_action",
    toolNames: ["reply", "status", "stay_silent"],
  });
});

test("dispatch Space Action MCP config rejects an untrusted command", async () => {
  const core = await import("../dist/index.js");

  assert.throws(
    () =>
      core.resolveDispatchSpaceActionMcpServer({
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: "/tmp/action/bin/openmeld",
        OPENMELD_USER_FACING_CLI_COMMAND: "/bin/zsh",
      }),
    INVALID_ACTIVE_CLI_COMMAND_PATTERN
  );
});

test("dispatch Space Action MCP config projects the ACP stdio shape", async () => {
  const core = await import("../dist/index.js");

  assert.deepEqual(
    core.buildAcpDispatchSpaceActionMcpServers({
      OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/action/context.json",
      OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: "/tmp/action/bin/openmeld",
      OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
    }),
    [
      {
        args: ["space", "action", "tool-server"],
        command: "/tmp/action/bin/openmeld",
        env: [
          {
            name: "OPENMELD_SPACE_ACTION_CONTEXT_PATH",
            value: "/tmp/action/context.json",
          },
          {
            name: "OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH",
            value: "/tmp/action/bin/openmeld",
          },
          {
            name: "OPENMELD_USER_FACING_CLI_COMMAND",
            value: "openmeld",
          },
        ],
        name: "openmeld_internal_dispatch_space_action",
      },
    ]
  );
});
