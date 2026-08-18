import { object, string } from "valibot";
import { describe, expect, it } from "vitest";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  createRemoteAgentCapabilityDiscoveryDefinitions,
  REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME,
  REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME,
} from "../flue-adapter/capability-discovery";

const DEFINITIONS: RemoteAgentToolDefinition[] = [
  {
    description: "Discover the actions available for one connected App.",
    execute: () => Promise.resolve({ actions: [] }),
    input: object({ service: string() }),
    name: "openmeld_list_app_actions",
  },
  {
    description: "Execute one discovered connected App action.",
    execute: () => Promise.resolve({ status: "completed" }),
    input: object({ actionId: string(), service: string() }),
    name: "openmeld_execute_app_action",
  },
  {
    description: "Create one GitHub issue.",
    execute: () => Promise.resolve({ status: "completed" }),
    input: object({ title: string() }),
    name: "github_create_issue",
  },
  {
    description: "Search messages in Slack without changing them.",
    execute: () => Promise.resolve({ messages: [] }),
    input: object({ query: string() }),
    name: "slack_search_messages",
  },
  {
    description: "Send one message to a Slack conversation.",
    execute: () => Promise.resolve({ status: "completed" }),
    input: object({ text: string() }),
    name: "slack_send_message",
  },
];

describe("Remote Agent capability discovery", () => {
  it("searches a fixed turn catalog without returning every schema", async () => {
    const definitions =
      createRemoteAgentCapabilityDiscoveryDefinitions(DEFINITIONS);
    const search = definitions.find(
      (definition) =>
        definition.name === REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME
    );
    if (!search) {
      throw new Error("Capability search is unavailable.");
    }

    await expect(
      search.execute({ query: "list app actions" })
    ).resolves.toEqual({
      capabilities: [
        {
          description: "Discover the actions available for one connected App.",
          name: "openmeld_list_app_actions",
        },
        {
          description: "Execute one discovered connected App action.",
          name: "openmeld_execute_app_action",
        },
      ],
      matchingCount: 2,
      truncated: false,
    });
  });

  it("loads model-visible schemas only for selected known capabilities", async () => {
    const definitions =
      createRemoteAgentCapabilityDiscoveryDefinitions(DEFINITIONS);
    const describeCapability = definitions.find(
      (definition) =>
        definition.name === REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME
    );
    if (!describeCapability) {
      throw new Error("Capability describe is unavailable.");
    }

    await expect(
      describeCapability.execute({
        names: ["openmeld_list_app_actions", "missing_capability"],
      })
    ).resolves.toEqual({
      capabilities: [
        {
          description: "Discover the actions available for one connected App.",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            properties: { service: { type: "string" } },
            required: ["service"],
            type: "object",
          },
          name: "openmeld_list_app_actions",
          usage:
            "Call codemode.openmeld_list_app_actions(input) inside the Code Mode async function.",
        },
      ],
      unknownNames: ["missing_capability"],
    });
  });

  it("ignores filler words instead of matching nearly every capability", async () => {
    const definitions =
      createRemoteAgentCapabilityDiscoveryDefinitions(DEFINITIONS);
    const search = definitions.find(
      (definition) =>
        definition.name === REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME
    );
    if (!search) {
      throw new Error("Capability search is unavailable.");
    }

    await expect(
      search.execute({ query: "send a message to Slack" })
    ).resolves.toMatchObject({
      capabilities: [
        { name: "slack_send_message" },
        { name: "slack_search_messages" },
      ],
      matchingCount: 2,
      truncated: false,
    });
  });

  it("keeps conversational fragments from crowding a large catalog", async () => {
    const noisyDefinitions: RemoteAgentToolDefinition[] = Array.from(
      { length: 20 },
      (_, index) => ({
        description: "Manage one OpenMeld Project profile.",
        execute: () => Promise.resolve({ status: "completed" }),
        input: object({ id: string() }),
        name: `openmeld_profile_${index.toString().padStart(2, "0")}`,
      })
    );
    const definitions = createRemoteAgentCapabilityDiscoveryDefinitions([
      ...DEFINITIONS,
      ...noisyDefinitions,
    ]);
    const search = definitions.find(
      (definition) =>
        definition.name === REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME
    );
    if (!search) {
      throw new Error("Capability search is unavailable.");
    }

    await expect(
      search.execute({ query: "help me reply in Slack" })
    ).resolves.toEqual({
      capabilities: [
        {
          description: "Search messages in Slack without changing them.",
          name: "slack_search_messages",
        },
        {
          description: "Send one message to a Slack conversation.",
          name: "slack_send_message",
        },
      ],
      matchingCount: 2,
      truncated: false,
    });
  });
});
