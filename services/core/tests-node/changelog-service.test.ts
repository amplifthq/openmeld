import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChangelogSourceError,
  createChangelogService,
  OPENMELD_CHANGELOG_SOURCE,
} from "../src/changelog/changelog-service";

const INDEX = {
  entries: [
    {
      areas: ["center-agent", "channels"],
      audiences: ["members"],
      body: "Members can ask the Center Agent what changed.",
      evidence: ["pr:100"],
      id: "center-agent-changelog",
      kind: "new" as const,
      publishedAt: "2026-08-18",
      title: "Ask what changed",
    },
    {
      areas: ["developer-experience"],
      audiences: ["contributors"],
      body: "Contributors can maintain one Git-backed Changelog.",
      evidence: ["pr:73"],
      id: "changelog-foundation",
      kind: "improved" as const,
      publishedAt: "2026-08-17",
      release: "v0.3.61",
      title: "Maintain one Changelog",
    },
  ],
  schemaVersion: 1 as const,
};

describe("ChangelogService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the GitHub projection, filters it, bounds results, and caches briefly", async () => {
    let nowMs = 1000;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(INDEX, { status: 200 })
    );
    const service = createChangelogService({
      cacheTtlMs: 60_000,
      fetch: fetchImpl,
      nowMs: () => nowMs,
    });

    const first = await service.query({
      githubToken: "repository-token",
      query: { areas: ["center-agent"], limit: 1 },
    });
    nowMs += 30_000;
    const second = await service.query({
      query: { limit: 1, offset: 1, since: "2026-08-17" },
    });

    expect(first).toEqual({
      entries: [INDEX.entries[0]],
      hasMore: false,
      latestPublishedAt: "2026-08-18",
      schemaVersion: 1,
      source: OPENMELD_CHANGELOG_SOURCE,
      totalMatching: 1,
    });
    expect(second.entries).toEqual([INDEX.entries[1]]);
    expect(second.hasMore).toBe(false);
    expect(second.totalMatching).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/amplifthq/openmeld/contents/changelog/index.json?ref=main",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github.raw+json",
          Authorization: "Bearer repository-token",
          "User-Agent": "OpenMeld-Core",
          "X-GitHub-Api-Version": "2022-11-28",
        }),
      })
    );
  });

  it("refreshes after the cache lifetime", async () => {
    let nowMs = 1000;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(INDEX, { status: 200 })
    );
    const service = createChangelogService({
      cacheTtlMs: 60_000,
      fetch: fetchImpl,
      nowMs: () => nowMs,
    });

    await service.query({ query: { limit: 10 } });
    nowMs += 60_001;
    await service.query({ query: { limit: 10 } });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails visibly when GitHub returns invalid Changelog data", async () => {
    const service = createChangelogService({
      fetch: async () => Response.json({ entries: [], schemaVersion: 2 }),
    });

    await expect(service.query({ query: { limit: 10 } })).rejects.toThrow(
      ChangelogSourceError
    );
    await expect(service.query({ query: { limit: 10 } })).rejects.toThrow(
      "violated schema version 1"
    );
  });

  it("preserves the Cloudflare fetch receiver for the default GitHub reader", async () => {
    const hostFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(Response.json(INDEX, { status: 200 }));
    });
    vi.stubGlobal("fetch", hostFetch);
    const service = createChangelogService();

    await expect(
      service.query({ query: { limit: 10 } })
    ).resolves.toMatchObject({
      entries: INDEX.entries,
      totalMatching: 2,
    });
    expect(hostFetch).toHaveBeenCalledOnce();
  });
});
