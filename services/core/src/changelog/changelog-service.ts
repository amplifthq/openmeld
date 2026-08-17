import {
  CHANGELOG_QUERY_DEFAULT_LIMIT,
  changelogIndexSchema,
  changelogQueryResponseSchema,
} from "@openmeld/schemas";
import type {
  ChangelogIndex,
  ChangelogQuery,
  ChangelogQueryResponse,
  ChangelogSource,
} from "@openmeld/schemas/types";

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_CACHE_TTL_MS = 60_000;

export const OPENMELD_CHANGELOG_SOURCE = {
  kind: "github",
  path: "changelog/index.json",
  ref: "main",
  repository: "amplifthq/openmeld",
} as const satisfies ChangelogSource;

const OPENMELD_CHANGELOG_API_URL =
  "https://api.github.com/repos/amplifthq/openmeld/contents/changelog/index.json?ref=main";

type ChangelogServiceDependencies = {
  cacheTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  nowMs?: () => number;
};

export type ChangelogService = {
  query(input: {
    githubToken?: string;
    query: ChangelogQuery;
  }): Promise<ChangelogQueryResponse>;
};

export class ChangelogSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChangelogSourceError";
  }
}

export function createChangelogService(
  dependencies: ChangelogServiceDependencies = {}
): ChangelogService {
  const fetchImpl =
    dependencies.fetch ??
    ((request: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(request, init));
  const nowMs = dependencies.nowMs ?? Date.now;
  const cacheTtlMs = dependencies.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  let cachedIndex: { expiresAtMs: number; value: ChangelogIndex } | null = null;
  let pendingIndex: Promise<ChangelogIndex> | null = null;

  async function readIndex(githubToken?: string): Promise<ChangelogIndex> {
    if (cachedIndex && cachedIndex.expiresAtMs > nowMs()) {
      return cachedIndex.value;
    }
    if (pendingIndex) {
      return await pendingIndex;
    }

    pendingIndex = fetchIndex({ fetchImpl, githubToken });
    try {
      const value = await pendingIndex;
      cachedIndex = { expiresAtMs: nowMs() + cacheTtlMs, value };
      return value;
    } finally {
      pendingIndex = null;
    }
  }

  return {
    async query({ githubToken, query }) {
      const index = await readIndex(githubToken);
      const matchingEntries = index.entries.filter((entry) =>
        matchesQuery(entry, query)
      );
      const limit = query.limit ?? CHANGELOG_QUERY_DEFAULT_LIMIT;
      const offset = query.offset ?? 0;
      const response = {
        entries: matchingEntries.slice(offset, offset + limit),
        hasMore: matchingEntries.length > offset + limit,
        latestPublishedAt: latestPublishedDate(index),
        schemaVersion: 1 as const,
        source: OPENMELD_CHANGELOG_SOURCE,
        totalMatching: matchingEntries.length,
      };
      return changelogQueryResponseSchema.parse(response);
    },
  };
}

async function fetchIndex(input: {
  fetchImpl: typeof globalThis.fetch;
  githubToken?: string;
}): Promise<ChangelogIndex> {
  let response: Response;
  try {
    response = await input.fetchImpl(OPENMELD_CHANGELOG_API_URL, {
      headers: {
        Accept: "application/vnd.github.raw+json",
        ...(input.githubToken?.trim()
          ? { Authorization: `Bearer ${input.githubToken.trim()}` }
          : {}),
        "User-Agent": "OpenMeld-Core",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });
  } catch (error) {
    throw new ChangelogSourceError(
      "GitHub Changelog request could not be completed.",
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new ChangelogSourceError(
      `GitHub Changelog request failed with status ${response.status}.`
    );
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    throw new ChangelogSourceError(
      "GitHub Changelog response was not valid JSON.",
      { cause: error }
    );
  }
  const parsed = changelogIndexSchema.safeParse(value);
  if (!parsed.success) {
    throw new ChangelogSourceError(
      `GitHub Changelog response violated schema version 1: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`
    );
  }
  return parsed.data;
}

function matchesQuery(
  entry: ChangelogIndex["entries"][number],
  query: ChangelogQuery
): boolean {
  return (
    (!query.since || entry.publishedAt >= query.since) &&
    (!query.release || entry.release === query.release) &&
    (!query.areas || query.areas.some((area) => entry.areas.includes(area))) &&
    (!query.audiences ||
      query.audiences.some((audience) => entry.audiences.includes(audience))) &&
    (!query.kinds || query.kinds.includes(entry.kind))
  );
}

function latestPublishedDate(index: ChangelogIndex): string | null {
  let latest: string | null = null;
  for (const entry of index.entries) {
    if (!latest || entry.publishedAt > latest) {
      latest = entry.publishedAt;
    }
  }
  return latest;
}
