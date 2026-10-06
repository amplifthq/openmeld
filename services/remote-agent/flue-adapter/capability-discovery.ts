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
import type { RemoteAgentStorage } from "../agent-core/callback-context";
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
  names: optional(
    pipe(
      array(pipe(string(), trim(), minLength(1), maxLength(160))),
      minLength(1),
      maxLength(CAPABILITY_DESCRIBE_MAX_COUNT)
    )
  ),
});

export function createRemoteAgentCapabilityDiscoveryDefinitions(
  definitions: RemoteAgentToolDefinition[],
  observe?: (input: {
    capabilityNames: string[];
    operation: "describe" | "search";
    resultCount: number;
  }) => Promise<void>,
  recovery?: { storage: RemoteAgentStorage; submissionId: string }
): RemoteAgentToolDefinition[] {
  const byName = new Map(
    definitions.map((definition) => [definition.name, definition])
  );
  return [
    {
      description:
        "Search this Agent's current capability catalog by goal. Returns a small ranked list grouped by stable namespace; call openmeld_describe_capabilities for the model-visible input schema before using an unfamiliar capability through Code Mode. A match proves that the capability exists in this turn, not that the current requester is authorized or that execution will succeed; trust the capability's structured result for those facts.",
      execute: async (input) => {
        const query = String(input.query ?? "").trim();
        const limit =
          typeof input.limit === "number"
            ? input.limit
            : CAPABILITY_SEARCH_DEFAULT_LIMIT;
        const matches = rankRemoteAgentCapabilities(definitions, query);
        const visible = matches.slice(0, limit);
        const result = {
          capabilities: visible.map(({ capability, namespace }) => ({
            description: summarizeCapabilityDescription(capability.description),
            name: capability.name,
            namespace,
          })),
          matchingCount: matches.length,
          truncated: matches.length > visible.length,
        };
        await observe?.({
          capabilityNames: result.capabilities.map(({ name }) => name),
          operation: "search",
          resultCount: result.capabilities.length,
        });
        return result;
      },
      input: capabilitySearchInputSchema,
      name: REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME,
      progressTracking: "observation",
    },
    {
      description:
        "Load descriptions and JSON input schemas for up to eight known capability names. After compaction, omit names to recover the most recently selected capabilities without searching again. Recovery uses the current catalog; it does not preserve old permission. Runtime validation and execution-time authorization remain authoritative.",
      execute: async (input) => {
        const recoveryKey = recovery
          ? `capability-selection:${recovery.submissionId}`
          : undefined;
        const remembered =
          recovery && recoveryKey && input.names === undefined
            ? await recovery.storage.get<string[]>(recoveryKey)
            : [];
        const requested = input.names ?? remembered ?? [];
        const names = [
          ...new Set(
            Array.isArray(requested)
              ? requested.filter(
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
        const result = {
          capabilities,
          unknownNames: names.filter((name) => !byName.has(name)),
        };
        if (recovery && recoveryKey && input.names !== undefined) {
          // Selection only: descriptions, schemas and access come from the
          // current catalog. No copied transcript or cached permission.
          await recovery.storage.putExpiring(
            recoveryKey,
            capabilities.map((capability) => capability.name),
            Date.now() + 7 * 24 * 60 * 60 * 1000
          );
        }
        await observe?.({
          capabilityNames: capabilities.map(({ name }) => name),
          operation: "describe",
          resultCount: capabilities.length,
        });
        return result;
      },
      input: capabilityDescribeInputSchema,
      name: REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME,
      // Restoring a schema after compaction is useful even when unchanged.
      // The ordinary per-assignment tool allowance still counts this call.
    },
  ];
}

function summarizeCapabilityDescription(value: string): string {
  return value.length <= CAPABILITY_DESCRIPTION_SUMMARY_MAX_CHARS
    ? value
    : `${value.slice(0, CAPABILITY_DESCRIPTION_SUMMARY_MAX_CHARS - 1)}…`;
}
