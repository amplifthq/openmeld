import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { parseChangelogQuery } from "../src/routes/rpc-http.changelog";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const CHANGELOG_RESPONSE = {
  entries: [
    {
      areas: ["web"],
      audiences: ["members"],
      body: "People can read official product updates on the Web.",
      evidence: ["pr:77"],
      id: "web-changelog",
      kind: "new" as const,
      publishedAt: "2026-08-18",
      title: "Read the Changelog on the Web",
    },
  ],
  hasMore: false,
  latestPublishedAt: "2026-08-18",
  schemaVersion: 1 as const,
  source: {
    kind: "github" as const,
    path: "changelog/index.json",
    ref: "main",
    repository: "amplifthq/openmeld",
  },
  totalMatching: 1,
};

function makeEnv(readChangelog = vi.fn(async () => CHANGELOG_RESPONSE)) {
  const authRpc = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: false,
      code: "auth.unauthenticated",
      message: "authentication required",
    })),
    resolveProfile: vi.fn(),
  };
  return {
    authRpc,
    readChangelog,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: { readChangelog },
    } as unknown as CloudflareBindings,
  };
}

describe("Changelog routes", () => {
  it("parses strict bounded filters", () => {
    expect(
      parseChangelogQuery(
        "http://local/v1/changelog?area=web&audience=members&kind=new&limit=10&offset=20&since=2026-08-01"
      )
    ).toEqual({
      ok: true,
      value: {
        areas: ["web"],
        audiences: ["members"],
        kinds: ["new"],
        limit: 10,
        offset: 20,
        since: "2026-08-01",
      },
    });
    expect(
      parseChangelogQuery("http://local/v1/changelog?unknown=true")
    ).toEqual({
      ok: false,
      message: "Unknown Changelog query field: unknown",
    });
  });

  it("serves published updates without requiring authentication", async () => {
    const { authRpc, env, readChangelog } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/changelog?area=web&limit=10"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    await expect(response.json()).resolves.toEqual(CHANGELOG_RESPONSE);
    expect(readChangelog).toHaveBeenCalledExactlyOnceWith({
      areas: ["web"],
      limit: 10,
    });
    expect(authRpc.resolveRequestAuth).not.toHaveBeenCalled();
  });

  it("preserves a stable unavailable error without leaking source details", async () => {
    const sourceError = Object.assign(
      new Error("The official OpenMeld Changelog is temporarily unavailable."),
      { code: "changelog.source_unavailable", status: 503 }
    );
    const readChangelog = vi.fn(() => Promise.reject(sourceError));
    const { env } = makeEnv(readChangelog);
    const response = await app.fetch(
      new Request("http://local/v1/changelog"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "changelog.source_unavailable",
        message: "The official OpenMeld Changelog is temporarily unavailable.",
      },
    });
  });
});
