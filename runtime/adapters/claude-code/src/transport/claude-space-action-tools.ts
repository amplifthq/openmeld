import {
  createSdkMcpServer,
  type Options,
  type Query,
  type SDKMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type AdapterDispatchSpaceTools,
  buildDispatchSpaceActionMcpToolIds,
  isDispatchSpaceActionDeliveryOnly,
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";

import { OPENMELD_CLAUDE_ALLOWED_TOOLS } from "./claude-permission-policy.js";

type ClaudeSpaceToolInput = {
  env?: Record<string, string | undefined>;
  spaceActionTools?: AdapterDispatchSpaceTools;
  executionContext?: unknown;
};

export function isClaudeDeliveryOnly(input: ClaudeSpaceToolInput): boolean {
  return Boolean(
    input.spaceActionTools?.deliveryOnly ||
      isDispatchSpaceActionDeliveryOnly(input.env)
  );
}

export function buildClaudeSpaceToolOptions(
  input: ClaudeSpaceToolInput
): Partial<Options> {
  const server = resolveDispatchSpaceActionMcpServer(input.env);
  const deliveryOnly = isClaudeDeliveryOnly(input);
  const isolated = Boolean(input.executionContext || deliveryOnly);
  const tools = input.spaceActionTools;
  let names: string[] = [];
  if (tools) {
    names = tools.tools.map(
      (definition) =>
        `mcp__${OPENMELD_SPACE_ACTION_MCP_SERVER_ID}__${definition.name}`
    );
  } else if (server) {
    names = buildDispatchSpaceActionMcpToolIds("__", input.env).map(
      (name) => `mcp__${name}`
    );
  }
  const options: Partial<Options> = {
    allowedTools:
      isolated || tools ? names : [...OPENMELD_CLAUDE_ALLOWED_TOOLS, ...names],
  };
  if (tools) {
    options.mcpServers = {
      [OPENMELD_SPACE_ACTION_MCP_SERVER_ID]:
        createClaudeDispatchSpaceToolServer(tools),
    };
  } else if (server) {
    options.mcpServers = {
      [server.id]: {
        args: [...server.args],
        command: server.commandPath,
        env: server.env,
        alwaysLoad: true,
      },
    };
  }
  if (isolated) {
    options.tools = [];
    options.strictMcpConfig = true;
    // Delivery-only correction receives only the original deny/ask rules.
    // Loading whole project settings would also import model and environment.
    options.settingSources = deliveryOnly ? [] : ["user"];
    options.settings = { disableAllHooks: true };
    options.additionalDirectories = [];
  }
  if (deliveryOnly && tools) {
    options.outputFormat = {
      type: "json_schema",
      schema: CLAUDE_DELIVERY_REPORT_SCHEMA,
    };
  }
  return options;
}

export function createClaudeDispatchConnectionObserver(
  tools?: AdapterDispatchSpaceTools
) {
  let checked = false;
  return async (message: SDKMessage, query: Query): Promise<void> => {
    if (
      checked ||
      !tools ||
      message.type !== "system" ||
      message.subtype !== "init"
    ) {
      return;
    }
    checked = true;
    await checkClaudeDispatchSpaceToolConnection(query);
  };
}

export function createClaudeDispatchSpaceToolServer(
  tools: AdapterDispatchSpaceTools
) {
  // Final effects still pass the SDK's native deny/ask checks. Structured
  // output may report delivery, but is never an alternative publication path.
  const definitions = tools.tools;
  return createSdkMcpServer({
    name: OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
    version: "1.0.0",
    tools: definitions.map((definition) =>
      tool(
        definition.name,
        definition.description,
        definition.inputSchema.shape,
        async (args) => tools.call(definition.name, args),
        {
          alwaysLoad:
            tools.deliveryOnly ||
            definition.name === "reply" ||
            definition.name === "stay_silent" ||
            definition.name === "project_shell",
          annotations: definition.annotations,
        }
      )
    ),
  });
}

export const CLAUDE_DELIVERY_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { recorded: { type: "boolean" } },
  required: ["recorded"],
};

export async function verifyClaudeDeliveryReport(
  tools: AdapterDispatchSpaceTools,
  report: unknown
): Promise<string> {
  const result = await tools.call("read_receipt", {});
  const receipt = result.structuredContent?.receipt;
  const saved =
    receipt &&
    typeof receipt === "object" &&
    "status" in receipt &&
    receipt.status === "proposal_saved_locally";
  // Native SDK versions can finish without structured_output. Recover an
  // independently verified saved receipt; never publish the report or prose.
  if (saved) {
    return result.content.map((item) => item.text).join("\n");
  }
  const claimed =
    report &&
    typeof report === "object" &&
    "recorded" in report &&
    report.recorded === true;
  throw Object.assign(
    new Error(
      claimed
        ? "Claude reported delivery, but no saved Space action receipt was verified."
        : "Claude did not record a final Space action during delivery-only correction."
    ),
    {
      code: "space.action.delivery_unconfirmed",
      errorType: "adapter",
    }
  );
}

/** One host-side check; native automatic reconnect owns any pending state. */
export async function checkClaudeDispatchSpaceToolConnection(
  query: Query
): Promise<void> {
  const name = OPENMELD_SPACE_ACTION_MCP_SERVER_ID;
  const status = (await query.mcpServerStatus()).find(
    (server) => server.name === name
  );
  if (!status || status.status === "pending") {
    return;
  }
  if (status.status === "connected") {
    return;
  }
  if (status.status === "failed") {
    await query.reconnectMcpServer(name);
    const recovered = (await query.mcpServerStatus()).find(
      (server) => server.name === name
    );
    if (recovered?.status === "connected" || recovered?.status === "pending") {
      return;
    }
  }
  // In particular, reconnect is not a way to bypass a needs-auth state.
  throw Object.assign(
    new Error(
      `The dispatch Space tool connection is ${status.status}; no transport replay was attempted.`
    ),
    {
      code: "space.action.tool_connection_failed",
      errorType: "adapter",
    }
  );
}
