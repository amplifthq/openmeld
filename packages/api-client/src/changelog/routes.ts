import type { ChangelogQuery } from "@openmeld/schemas/types";

const CHANGELOG_PATH = "/v1/changelog";

export function buildChangelogPath(query: ChangelogQuery = {}): string {
  const searchParams = new URLSearchParams();
  appendList(searchParams, "area", query.areas);
  appendList(searchParams, "audience", query.audiences);
  appendList(searchParams, "kind", query.kinds);
  if (query.limit !== undefined) {
    searchParams.set("limit", String(query.limit));
  }
  if (query.offset !== undefined) {
    searchParams.set("offset", String(query.offset));
  }
  if (query.release !== undefined) {
    searchParams.set("release", query.release);
  }
  if (query.since !== undefined) {
    searchParams.set("since", query.since);
  }

  const queryString = searchParams.toString();
  return queryString ? `${CHANGELOG_PATH}?${queryString}` : CHANGELOG_PATH;
}

function appendList(
  searchParams: URLSearchParams,
  key: string,
  values: readonly string[] | undefined
): void {
  for (const value of values ?? []) {
    searchParams.append(key, value);
  }
}
