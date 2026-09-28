// biome-ignore-all lint/suspicious/noMisplacedAssertion: Compiled native acceptance; assertion failures must fail the job.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveDispatchSpaceActionMcpServer } from "../../../../runtime/adapters/core/src/dispatch-space-action-mcp";
import { buildDispatchOwnedRuntimeEnv } from "../../src/runtime/dispatch-owned-runtime";
import { DISPATCH_SPACE_ACTION_CLI_FALLBACK_COMMAND } from "../../src/runtime/dispatch-runtime-env";
import { createDispatchSpaceActionContext } from "../../src/runtime/dispatch-space-action-context";

assert.equal(process.platform, "win32");
assert.ok(process.versions.bun);
const home = process.env.OPENMELD_HOME;
assert.ok(home);
const managedCli = join(home, "bin", "openmeld.exe");
const { contextPath } = createDispatchSpaceActionContext({
  attemptId: "attempt-windows-mcp",
  dispatchId: "dispatch-windows-mcp",
  env: { OPENMELD_HOME: home },
  sendTargetReference: {
    status: "loaded",
    projection: [],
    referenceLines: [],
  },
  sourceEventId: "source-windows-mcp",
  spaceContractSnapshot: null,
  spaceId: "space-windows-mcp",
  targetProfileId: "agent-windows-mcp",
  taskId: "task-windows-mcp",
});
const runtimeEnv = buildDispatchOwnedRuntimeEnv({
  distribution: "binary",
  dispatchId: "dispatch-windows-mcp",
  targetProfileId: "agent-windows-mcp",
  env: { OPENMELD_HOME: home, PATH: process.env.PATH },
  spaceActionContextPath: contextPath,
});
const toolPath = runtimeEnv.OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH ?? "";
console.log(
  JSON.stringify({
    stage: "windows_dispatch_mcp_path",
    command: runtimeEnv.OPENMELD_USER_FACING_CLI_COMMAND,
    path: toolPath,
    basename: basename(toolPath),
    isAbsolute: isAbsolute(toolPath),
  })
);
const config = resolveDispatchSpaceActionMcpServer(runtimeEnv);
assert.ok(config);
assert.equal(config.commandPath, managedCli);
assert.equal(readFileSync(config.commandPath).toString("ascii", 0, 2), "MZ");
assert.equal(
  DISPATCH_SPACE_ACTION_CLI_FALLBACK_COMMAND,
  '& "$env:OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH"'
);

const transport = new StdioClientTransport({
  command: config.commandPath,
  args: config.args,
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
    ...config.env,
  },
});
const client = new Client({
  name: "windows-native-acceptance",
  version: "1.0.0",
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "reply"));
  console.log(
    JSON.stringify({
      stage: "windows_dispatch_space_action_mcp",
      status: "passed",
    })
  );
} finally {
  await client.close();
}
