import {
  array,
  integer,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  pipe,
  strictObject,
  string,
  trim,
} from "valibot";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  rankRemoteAgentCapabilities,
  resolveRemoteAgentCapabilityNamespace,
} from "./capability-catalog";
import { toRemoteAgentToolJsonSchema } from "./tool-json-schema";

export const REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME =
  "openmeld_search_capabilities";
export const REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME =
  "openmeld_describe_capabilities";
export const REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES = [
  REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME,
  REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME,
] as const;

const CAPABILITY_SEARCH_DEFAULT_LIMIT = 8;
const CAPABILITY_SEARCH_MAX_LIMIT = 12;
const CAPABILITY_DESCRIPTION_SUMMARY_MAX_CHARS = 240;
const CAPABILITY_DESCRIBE_MAX_COUNT = 8;
const capabilitySearchInputSchema = strictObject({
  limit: optional(
    pipe(
      number(),
      integer(),
      minValue(1),
      maxValue(CAPABILITY_SEARCH_MAX_LIMIT)
    )
  ),
  query: pipe(string(), trim(), minLength(1), maxLength(160)),
});
const capabilityDescribeInputSchema = strictObject({
  names: pipe(
    array(pipe(string(), trim(), minLength(1), maxLength(160))),
    minLength(1),
    maxLength(CAPABILITY_DESCRIBE_MAX_COUNT)
  ),
});

export function createRemoteAgentCapabilityDiscoveryDefinitions(
  definitions: RemoteAgentToolDefinition[]
): RemoteAgentToolDefinition[] {
  const byName = new Map(
    definitions.map((definition) => [definition.name, definition])
  );
  return [
    {
      description:
        "Search the current Center Agent capability catalog by goal. Returns a small ranked list grouped by stable namespace; call openmeld_describe_capabilities for the model-visible input schema before using an unfamiliar capability through Code Mode. A match proves that the capability exists in this turn, not that the current requester is authorized or that execution will succeed; trust the capability's structured result for those facts.",
      execute: (input) => {
        const query = String(input.query ?? "").trim();
        const limit =
          typeof input.limit === "number"
            ? input.limit
            : CAPABILITY_SEARCH_DEFAULT_LIMIT;
        const matches = rankRemoteAgentCapabilities(definitions, query);
        const visible = matches.slice(0, limit);
        return Promise.resolve({
          capabilities: visible.map(({ capability, namespace }) => ({
            description: summarizeCapabilityDescription(capability.description),
            name: capability.name,
            namespace,
          })),
          matchingCount: matches.length,
          truncated: matches.length > visible.length,
        });
      },
      input: capabilitySearchInputSchema,
      name: REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME,
      progressTracking: "observation",
    },
    {
      description:
        "Load the descriptions and model-visible JSON input schemas for up to eight capability names returned by openmeld_search_capabilities. Runtime validation and capability-owned authorization remain authoritative. The loaded definitions remain in this conversation, while the underlying executable catalog stays fixed for the turn.",
      execute: (input) => {
        const names = [
          ...new Set(
            Array.isArray(input.names)
              ? input.names.filter(
                  (name): name is string => typeof name === "string"
                )
              : []
          ),
        ];
        const capabilities = names.flatMap((name) => {
          const definition = byName.get(name);
          return definition
            ? [
                {
                  description: definition.description,
                  inputSchema: toRemoteAgentToolJsonSchema(definition.input),
                  name: definition.name,
                  namespace: resolveRemoteAgentCapabilityNamespace(
                    definition.name
                  ),
                  usage: `Call codemode.${definition.name}(input) inside the Code Mode async function.`,
                },
              ]
            : [];
        });
        return Promise.resolve({
          capabilities,
          unknownNames: names.filter((name) => !byName.has(name)),
        });
      },
      input: capabilityDescribeInputSchema,
      name: REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME,
      progressTracking: "observation",
    },
  ];
}

function summarizeCapabilityDescription(value: string): string {
  return value.length <= CAPABILITY_DESCRIPTION_SUMMARY_MAX_CHARS
    ? value
    : `${value.slice(0, CAPABILITY_DESCRIPTION_SUMMARY_MAX_CHARS - 1)}…`;
}
