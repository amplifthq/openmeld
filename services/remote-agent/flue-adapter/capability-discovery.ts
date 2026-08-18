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
const CAPABILITY_SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

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
        "Search the current Center Agent capability catalog by goal. Returns a small ranked list only; call openmeld_describe_capabilities for the model-visible input schema before using an unfamiliar capability through Code Mode.",
      execute: (input) => {
        const query = String(input.query ?? "").trim();
        const limit =
          typeof input.limit === "number"
            ? input.limit
            : CAPABILITY_SEARCH_DEFAULT_LIMIT;
        const matches = definitions
          .map((definition) => ({
            definition,
            score: scoreCapabilityMatch(definition, query),
          }))
          .filter((match) => match.score > 0)
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.definition.name.localeCompare(right.definition.name)
          );
        const visible = matches.slice(0, limit);
        return Promise.resolve({
          capabilities: visible.map(({ definition }) => ({
            description: summarizeCapabilityDescription(definition.description),
            name: definition.name,
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
        "Load the descriptions and model-visible JSON input schemas for up to eight capability names returned by openmeld_search_capabilities. Runtime validation remains authoritative for normalization and custom constraints. The loaded definitions remain in this conversation, while the underlying executable catalog stays fixed for the turn.",
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

function scoreCapabilityMatch(
  definition: RemoteAgentToolDefinition,
  query: string
): number {
  const normalizedQuery = normalizeCapabilitySearchText(query);
  const normalizedName = normalizeCapabilitySearchText(definition.name);
  const normalizedDescription = normalizeCapabilitySearchText(
    definition.description
  );
  const nameTokens = normalizedName.split(" ");
  const descriptionTokens = normalizedDescription.split(" ");
  if (!normalizedQuery) {
    return 0;
  }
  if (normalizedName === normalizedQuery) {
    return 1000;
  }
  const queryTokens = normalizedQuery
    .split(" ")
    .filter(
      (token) => token.length >= 2 && !CAPABILITY_SEARCH_STOP_WORDS.has(token)
    );
  if (queryTokens.length === 0) {
    return 0;
  }
  let score = containsCapabilityTokenSequence(nameTokens, queryTokens)
    ? 200
    : 0;
  for (const token of queryTokens) {
    score += scoreCapabilityTokenMatch(nameTokens, token, 30, 20);
    score += scoreCapabilityTokenMatch(descriptionTokens, token, 5, 3);
  }
  return score;
}

function containsCapabilityTokenSequence(
  candidateTokens: string[],
  queryTokens: string[]
): boolean {
  if (queryTokens.length > candidateTokens.length) {
    return false;
  }
  for (
    let startIndex = 0;
    startIndex <= candidateTokens.length - queryTokens.length;
    startIndex += 1
  ) {
    if (
      queryTokens.every(
        (token, queryIndex) =>
          candidateTokens[startIndex + queryIndex] === token
      )
    ) {
      return true;
    }
  }
  return false;
}

function scoreCapabilityTokenMatch(
  candidateTokens: string[],
  queryToken: string,
  exactScore: number,
  prefixScore: number
): number {
  if (candidateTokens.includes(queryToken)) {
    return exactScore;
  }
  if (queryToken.length < 4) {
    return 0;
  }
  return candidateTokens.some(
    (candidateToken) =>
      candidateToken.length >= 4 &&
      (candidateToken.startsWith(queryToken) ||
        queryToken.startsWith(candidateToken))
  )
    ? prefixScore
    : 0;
}

function normalizeCapabilitySearchText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

function summarizeCapabilityDescription(value: string): string {
  return value.length <= CAPABILITY_DESCRIPTION_SUMMARY_MAX_CHARS
    ? value
    : `${value.slice(0, CAPABILITY_DESCRIPTION_SUMMARY_MAX_CHARS - 1)}…`;
}
