import { describe, expect, it } from "vitest";
import {
  buildChangelogPath,
  createChangelogApi,
  createOpenMeldApiClient,
} from "../src";

const RESPONSE = {
  entries: [],
  hasMore: false,
  latestPublishedAt: null,
  schemaVersion: 1 as const,
  source: {
    kind: "github" as const,
    path: "changelog/index.json",
    ref: "main",
    repository: "amplifthq/openmeld",
  },
  totalMatching: 0,
};

describe("Changelog API", () => {
  it("builds repeated filters and bounded pagination", () => {
    expect(
      buildChangelogPath({
        areas: ["web", "center-agent"],
        kinds: ["new", "fixed"],
        limit: 10,
        offset: 20,
        since: "2026-08-01",
      })
    ).toBe(
      "/v1/changelog?area=web&area=center-agent&kind=new&kind=fixed&limit=10&offset=20&since=2026-08-01"
    );
  });

  it("reads and validates the public Changelog response", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const api = createChangelogApi(
      createOpenMeldApiClient({
        baseUrl: "https://openmeld.test",
        transport: ({ init, url }) => {
          requests.push({ init, url });
          return Promise.resolve(Response.json(RESPONSE));
        },
      })
    );

    await expect(api.readChangelog({ limit: 10 })).resolves.toEqual(RESPONSE);
    expect(requests).toEqual([
      {
        init: expect.objectContaining({ method: "GET" }),
        url: "https://openmeld.test/v1/changelog?limit=10",
      },
    ]);
  });
});
