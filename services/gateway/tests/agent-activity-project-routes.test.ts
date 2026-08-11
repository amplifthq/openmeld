import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "project_11111111-1111-4111-8111-111111111111";
const PROJECT = {
  archivedAtMs: null,
  canArchive: true,
  canManage: true,
  createdAtMs: 1_700_000_000_000,
  createdByUserId: "owner-1",
  id: PROJECT_ID,
  name: "OpenMeld",
  organizationId: "org-1",
  repositoryFingerprint: null,
  slug: "openmeld",
  updatedAtMs: 1_700_000_000_000,
};

const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

describe("Project routes", () => {
  it("forwards the provider-detail opt-in to Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/agent-activity?includeProviderMetadata=true"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.readAgentActivitySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ includeProviderMetadata: true })
    );
  });

  it("forwards organization stats reads with the snapshot authorization context", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/organizations/current/agent-activity/stats"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.readAgentActivityStats).toHaveBeenCalledWith({
      context: expect.any(Object),
    });
  });

  it("forwards the optional Project scope for stats reads", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/agent-activity/stats?projectId=${PROJECT_ID}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.readAgentActivityStats).toHaveBeenCalledWith({
      context: expect.any(Object),
      projectId: PROJECT_ID,
    });
  });

  it("forwards the complete Project HTTP surface to Core", async () => {
    const { coreRpc, env } = makeEnv();
    const responses = await Promise.all([
      app.fetch(
        new Request("http://local/v1/organizations/current/projects"),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest("http://local/v1/organizations/current/projects", "POST", {
          expectedOrganizationId: "org-1",
          name: "OpenMeld",
          slug: "openmeld",
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          `http://local/v1/organizations/current/projects/${PROJECT_ID}`,
          "PATCH",
          { expectedOrganizationId: "org-1", name: "OpenMeld Core" }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          `http://local/v1/organizations/current/projects/${PROJECT_ID}`,
          "DELETE",
          { expectedOrganizationId: "org-1" }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      200, 201, 200, 200,
    ]);
    expect(coreRpc.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.any(Object) })
    );
    expect(coreRpc.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "OpenMeld", slug: "openmeld" })
    );
    expect(coreRpc.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "OpenMeld Core", projectId: PROJECT_ID })
    );
    expect(coreRpc.archiveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        projectId: PROJECT_ID,
      })
    );
  });

  it("rejects unsafe or unknown fields before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const requests = [
      jsonRequest("http://local/v1/organizations/current/projects", "POST", {
        absolutePath: "/Users/felix/Desktop/work/openmeld",
        expectedOrganizationId: "org-1",
        name: "OpenMeld",
        slug: "openmeld",
      }),
      jsonRequest(
        `http://local/v1/organizations/current/projects/${PROJECT_ID}`,
        "PATCH",
        { expectedOrganizationId: "org-1", unknown: true }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/projects/${PROJECT_ID}`,
        "DELETE",
        { expectedOrganizationId: "org-1", unknown: true }
      ),
    ];

    for (const request of requests) {
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_payload" },
        ok: false,
      });
    }
    expect(coreRpc.createProject).not.toHaveBeenCalled();
    expect(coreRpc.updateProject).not.toHaveBeenCalled();
    expect(coreRpc.archiveProject).not.toHaveBeenCalled();
  });

  it("does not preserve the retired Agent Activity Project route", async () => {
    const { env } = makeEnv();
    const retiredPath = [
      "/v1/organizations/current/agent-activity",
      "projects",
    ].join("/");
    const response = await app.fetch(
      new Request(`http://local${retiredPath}`),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(404);
  });
});

function makeEnv() {
  const coreRpc = {
    archiveProject: vi.fn(async () => ({
      project: { ...PROJECT, archivedAtMs: 1_700_000_000_001 },
    })),
    createProject: vi.fn(async () => ({ project: PROJECT })),
    listProjects: vi.fn(async () => ({
      organizationId: "org-1",
      projects: [PROJECT],
    })),
    readAgentActivitySnapshot: vi.fn(async () => ({
      asOfMs: 1_700_000_000_000,
      digests: [],
      digestsTruncated: false,
      organizationId: "org-1",
      projects: [PROJECT],
      recentEvents: [],
      sessions: [],
      sessionsTruncated: false,
      stalenessThresholdMs: 300_000,
    })),
    readAgentActivityStats: vi.fn(async () => ({
      daily: [
        {
          activeDurationMs: 120_000,
          sessionCount: 2,
          utcDate: "2026-07-10",
        },
      ],
      dailyTruncated: false,
      organizationId: "org-1",
      sinceMs: Date.UTC(2026, 6, 10),
      totalActiveDurationMs: 120_000,
      totalSessions: 2,
    })),
    updateProject: vi.fn(async () => ({
      project: { ...PROJECT, name: "OpenMeld Core" },
    })),
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        ownerUserId: "owner-1",
        profileKind: "human",
        profileName: "Mira",
        openMeldProfileId: HUMAN_PROFILE_ID,
      },
    })),
    resolveRequestAuth: vi.fn(async () => ({
      claims: {
        activeOrganizationId: "org-1",
        authenticated: true,
        authMethod: "session",
        ownerIds: ["owner-1"],
        requestId: "req-agent-activity-project-route",
      },
      ok: true,
    })),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims: {
        activeOrganizationId: "org-1",
        authenticated: true,
        authMethod: "session",
        ownerIds: ["owner-1"],
        requestId: "req-agent-activity-project-route",
      },
      ok: true,
      profile: {
        ok: true,
        resolvedProfile: {
          ownerUserId: "owner-1",
          profileKind: "human",
          profileName: "Mira",
          openMeldProfileId: HUMAN_PROFILE_ID,
        },
      },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function jsonRequest(
  url: string,
  method: "DELETE" | "PATCH" | "POST",
  body: unknown
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}
