import { describe, expect, it, vi } from "vitest";
import {
  buildAgentActivitySnapshotPath,
  buildAgentActivityStatsPath,
  createAgentActivityApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

describe("api-client Agent Activity API", () => {
  it("requests reviewed provider details only when the reader opts in", () => {
    expect(buildAgentActivitySnapshotPath()).toBe(
      "/v1/organizations/current/agent-activity"
    );
    expect(
      buildAgentActivitySnapshotPath({ includeProviderMetadata: true })
    ).toBe(
      "/v1/organizations/current/agent-activity?includeProviderMetadata=true"
    );
    expect(buildAgentActivityStatsPath()).toBe(
      "/v1/organizations/current/agent-activity/stats"
    );
    expect(buildAgentActivityStatsPath({ projectId: "project-1" })).toBe(
      "/v1/organizations/current/agent-activity/stats?projectId=project-1"
    );
  });

  it("reads strict organization Agent Activity stats", async () => {
    const statsUrl =
      "https://gateway.openmeld.invalid/v1/organizations/current/agent-activity/stats";
    const transport = vi.fn<OpenMeldApiClientTransport>((call) => {
      if (call.url !== statsUrl) {
        throw new Error(`Unexpected Agent Activity stats URL: ${call.url}`);
      }
      return Promise.resolve(
        jsonResponse({
          daily: [],
          dailyTruncated: false,
          organizationId: "org-1",
          sinceMs: null,
          totalActiveDurationMs: 0,
          totalSessions: 0,
        })
      );
    });
    const api = createAgentActivityApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(api.readStats()).resolves.toMatchObject({
      organizationId: "org-1",
      totalActiveDurationMs: 0,
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "agent_activity.stats.read",
        url: statsUrl,
      })
    );
  });

  it("reads aggregate stats within a Project scope", async () => {
    const statsUrl =
      "https://gateway.openmeld.invalid/v1/organizations/current/agent-activity/stats?projectId=project-1";
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        jsonResponse({
          daily: [],
          dailyTruncated: false,
          organizationId: "org-1",
          sinceMs: null,
          totalActiveDurationMs: 0,
          totalSessions: 0,
        })
      )
    );
    const api = createAgentActivityApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.readStats({ projectId: "project-1" });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "agent_activity.stats.read",
        url: statsUrl,
      })
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
