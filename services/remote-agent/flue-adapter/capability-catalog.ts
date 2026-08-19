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
  "openmeld",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

export type RemoteAgentCapabilityNamespace =
  | "agents_and_computers"
  | "connected_apps"
  | "github"
  | "organization"
  | "organization_knowledge"
  | "people_and_invitations"
  | "projects"
  | "slack"
  | "spaces_and_tasks"
  | "web_and_sandbox";

type CapabilityCatalogEntry = {
  aliases: readonly string[];
  dependencies?: readonly string[];
  namespace: RemoteAgentCapabilityNamespace;
};

const CAPABILITY_CATALOG_OVERRIDES: Readonly<
  Record<string, CapabilityCatalogEntry>
> = {
  openmeld_invite_slack_teammates: {
    aliases: [
      "invite a Slack teammate",
      "invite a coworker",
      "send an organization invitation",
      "send a private invitation",
      "direct message an invite link",
      "DM a teammate",
      "私信",
      "邀请同事",
      "邀请成员",
      "组织邀请",
      "邀请链接",
    ],
    dependencies: ["openmeld_read_slack_workspace_directory"],
    namespace: "people_and_invitations",
  },
  openmeld_read_slack_workspace_directory: {
    aliases: [
      "find a Slack teammate",
      "find a coworker",
      "resolve a Slack member",
      "Slack workspace directory",
      "invite a Slack teammate",
      "direct message an invite link",
      "查找同事",
      "查找成员",
      "私信",
      "邀请同事",
      "邀请成员",
      "组织邀请",
      "邀请链接",
    ],
    namespace: "people_and_invitations",
  },
};

export type RemoteAgentCapabilitySummary = {
  description: string;
  name: string;
};

export type RankedRemoteAgentCapability<
  T extends RemoteAgentCapabilitySummary = RemoteAgentCapabilitySummary,
> = {
  capability: T;
  namespace: RemoteAgentCapabilityNamespace;
  score: number;
};

export function rankRemoteAgentCapabilities<
  T extends RemoteAgentCapabilitySummary,
>(capabilities: readonly T[], query: string): RankedRemoteAgentCapability<T>[] {
  return capabilities
    .map((capability) => ({
      capability,
      namespace: resolveRemoteAgentCapabilityNamespace(capability.name),
      score: scoreCapabilityMatch(capability, query),
    }))
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.capability.name.localeCompare(right.capability.name)
    );
}

export function expandRemoteAgentCapabilityDependencies(
  capabilityNames: ReadonlySet<string>
): Set<string> {
  const expanded = new Set(capabilityNames);
  for (const capabilityName of capabilityNames) {
    for (const dependency of CAPABILITY_CATALOG_OVERRIDES[capabilityName]
      ?.dependencies ?? []) {
      expanded.add(dependency);
    }
  }
  return expanded;
}

export function resolveRemoteAgentCapabilityNamespace(
  capabilityName: string
): RemoteAgentCapabilityNamespace {
  const override = CAPABILITY_CATALOG_OVERRIDES[capabilityName];
  if (override) {
    return override.namespace;
  }
  const name = capabilityName.toLowerCase();
  if (name.startsWith("github_")) {
    return "github";
  }
  if (name.includes("slack")) {
    return "slack";
  }
  if (name.includes("app_") || name.includes("connector")) {
    return "connected_apps";
  }
  if (name.includes("space") || name.includes("task")) {
    return "spaces_and_tasks";
  }
  if (name.includes("project")) {
    return "projects";
  }
  if (name.includes("document") || name.includes("memory")) {
    return "organization_knowledge";
  }
  if (name.includes("profile") || name.includes("computer")) {
    return "agents_and_computers";
  }
  if (
    name.includes("browser") ||
    name.includes("sandbox") ||
    name.includes("web")
  ) {
    return "web_and_sandbox";
  }
  return "organization";
}

function scoreCapabilityMatch(
  capability: RemoteAgentCapabilitySummary,
  query: string
): number {
  const normalizedQuery = normalizeCapabilitySearchText(query);
  if (!normalizedQuery) {
    return 0;
  }
  const normalizedName = normalizeCapabilitySearchText(capability.name);
  const normalizedDescription = normalizeCapabilitySearchText(
    capability.description
  );
  if (normalizedName === normalizedQuery) {
    return 1000;
  }

  const queryTokens = normalizedQuery
    .split(" ")
    .filter(
      (token) => token.length >= 2 && !CAPABILITY_SEARCH_STOP_WORDS.has(token)
    );
  const nameTokens = normalizedName.split(" ");
  const descriptionTokens = normalizedDescription.split(" ");
  let score = containsCapabilityTokenSequence(nameTokens, queryTokens)
    ? 200
    : 0;
  for (const token of queryTokens) {
    score += scoreCapabilityTokenMatch(nameTokens, token, 30, 20);
    score += scoreCapabilityTokenMatch(descriptionTokens, token, 5, 3);
  }

  const aliases = CAPABILITY_CATALOG_OVERRIDES[capability.name]?.aliases ?? [];
  for (const alias of aliases) {
    const normalizedAlias = normalizeCapabilitySearchText(alias);
    if (
      normalizedAlias &&
      (normalizedQuery.includes(normalizedAlias) ||
        normalizedAlias.includes(normalizedQuery))
    ) {
      score += 120 + normalizedAlias.length;
    }
  }
  return score;
}

function containsCapabilityTokenSequence(
  candidateTokens: string[],
  queryTokens: string[]
): boolean {
  if (queryTokens.length === 0 || queryTokens.length > candidateTokens.length) {
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
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
