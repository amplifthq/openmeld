import { describe, expect, it, vi } from "vitest";
import {
  buildLocalProjectControlPath,
  buildProjectCommonAgentsPath,
  buildProjectIssueRoutingPath,
  buildProjectPath,
  buildProjectRepositoriesPath,
  buildProjectsPath,
  createLocalProjectControlApi,
  createOpenMeldApiClient,
  createProjectsApi,
  type OpenMeldApiClientTransport,
} from "../src";

const PROJECT_ID = "project/with spaces";
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
  repositoryUrl: null,
  slug: "openmeld",
  updatedAtMs: 1_700_000_000_000,
} as const;

describe("api-client Projects API", () => {
  it("sends explicit Project writes to the same device and lane without leaking routing fields into their body", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>(async (call) =>
      jsonResponse(
        call.url.endsWith("set-default")
          ? { status: "updated", connections: [] }
          : {
              status: "connected",
              bindingGeneration: "binding-a",
              canonicalPath: "/work/Design 中文 ",
              isDefault: true,
            }
      )
    );
    const api = createLocalProjectControlApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    const input = {
      target: { deviceId: "mac-a", runtimeLane: "canary" as const },
      expectedOrganizationId: "org-1",
      projectId: PROJECT_ID,
      clientGeneration: 1,
      idempotencyKey: "connect",
    };
    await api.connectCandidate({
      ...input,
      candidateId: "candidate-a",
      candidatePath: "/work/Design 中文 ",
    });
    await api.connectDeclaredPath({
      ...input,
      declaredPath: "/work/Design 中文 ",
      confirmNonGit: true,
    });
    await api.setDefaultConnection({
      ...input,
      targetBindingGeneration: "binding-a",
    });
    expect(
      transport.mock.calls.map(([call]) => new URL(call.url).pathname)
    ).toEqual([
      "/v1/people-computers/mac-a/lanes/canary/projects/connect-candidate",
      "/v1/people-computers/mac-a/lanes/canary/projects/connect-declared-path",
      "/v1/people-computers/mac-a/lanes/canary/projects/connections/set-default",
    ]);
    for (const [call] of transport.mock.calls) {
      expect(JSON.parse(String(call.init?.body))).not.toHaveProperty("target");
    }
    expect(
      JSON.parse(String(transport.mock.calls[1]?.[0].init?.body))
    ).toMatchObject({
      declaredPath: "/work/Design 中文 ",
      confirmNonGit: true,
    });
  });
  it("builds only the hard-cut Project routes", () => {
    expect(buildProjectsPath()).toBe("/v1/organizations/current/projects");
    expect(buildProjectPath(PROJECT_ID)).toBe(
      "/v1/organizations/current/projects/project%2Fwith%20spaces"
    );
    expect(buildProjectIssueRoutingPath(PROJECT_ID)).toBe(
      "/v1/organizations/current/projects/project%2Fwith%20spaces/issue-routing"
    );
    expect(buildProjectRepositoriesPath(PROJECT_ID)).toBe(
      "/v1/organizations/current/projects/project%2Fwith%20spaces/repositories"
    );
    expect(buildProjectCommonAgentsPath(PROJECT_ID)).toBe(
      "/v1/organizations/current/projects/project%2Fwith%20spaces/common-agents"
    );
  });

  it("uses one strict API surface for every Project operation", async () => {
    const projectsUrl =
      "https://gateway.openmeld.invalid/v1/organizations/current/projects";
    const projectUrl = `${projectsUrl}/project%2Fwith%20spaces`;
    const routingUrl = `${projectUrl}/issue-routing`;
    const repositoriesUrl = `${projectUrl}/repositories`;
    const commonAgentsUrl = `${projectUrl}/common-agents`;
    const responses = new Map<string, Response>([
      [
        `GET ${projectsUrl}`,
        jsonResponse({ organizationId: "org-1", projects: [PROJECT] }),
      ],
      [`POST ${projectsUrl}`, jsonResponse({ project: PROJECT }, 201)],
      [
        `PATCH ${projectUrl}`,
        jsonResponse({ project: { ...PROJECT, name: "OpenMeld Core" } }),
      ],
      [
        `DELETE ${projectUrl}`,
        jsonResponse({
          project: { ...PROJECT, archivedAtMs: 1_700_000_000_001 },
        }),
      ],
      [
        `GET ${routingUrl}`,
        jsonResponse({
          routing: {
            destination: null,
            projectId: PROJECT_ID,
            revision: 0,
            updatedAtMs: null,
            updatedByUserId: null,
          },
        }),
      ],
      [
        `PUT ${routingUrl}`,
        jsonResponse({
          routing: {
            destination: {
              provider: "linear",
              teamId: "d1a7c1f0-290e-4cdb-9b4b-b11f102ed448",
            },
            projectId: PROJECT_ID,
            revision: 1,
            updatedAtMs: 1_700_000_000_001,
            updatedByUserId: "owner-1",
          },
        }),
      ],
      [
        `GET ${repositoriesUrl}`,
        jsonResponse({
          settings: {
            projectId: PROJECT_ID,
            repositories: [],
            legacyDefaultFingerprint: null,
            revision: 0,
            updatedAtMs: null,
            updatedByUserId: null,
          },
        }),
      ],
      [
        `PUT ${repositoriesUrl}`,
        jsonResponse({
          settings: {
            projectId: PROJECT_ID,
            repositories: [],
            legacyDefaultFingerprint: null,
            revision: 1,
            updatedAtMs: 1_700_000_000_001,
            updatedByUserId: "owner-1",
          },
        }),
      ],
      [
        `GET ${commonAgentsUrl}`,
        jsonResponse({
          commonAgents: {
            projectId: PROJECT_ID,
            agentProfileIds: [],
            revision: 0,
            updatedAtMs: null,
            updatedByUserId: null,
          },
        }),
      ],
      [
        `PUT ${commonAgentsUrl}`,
        jsonResponse({
          commonAgents: {
            projectId: PROJECT_ID,
            agentProfileIds: [],
            revision: 1,
            updatedAtMs: 1_700_000_000_001,
            updatedByUserId: "owner-1",
          },
        }),
      ],
    ]);
    const transport = vi.fn<OpenMeldApiClientTransport>((call) => {
      const key = `${call.init?.method ?? "GET"} ${call.url}`;
      const response = responses.get(key);
      if (!response) {
        throw new Error(`Unexpected Projects API request: ${key}`);
      }
      return Promise.resolve(response.clone());
    });
    const api = createProjectsApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.list();
    await api.create({
      expectedOrganizationId: "org-1",
      name: "OpenMeld",
      repositoryUrl: "https://github.com/amplifthq/openmeld",
    });
    await api.update({
      expectedOrganizationId: "org-1",
      name: "OpenMeld Core",
      projectId: PROJECT_ID,
    });
    await api.archive({
      expectedOrganizationId: "org-1",
      projectId: PROJECT_ID,
    });
    await api.readIssueRouting({ projectId: PROJECT_ID });
    await api.updateIssueRouting({
      destination: {
        provider: "linear",
        teamId: "d1a7c1f0-290e-4cdb-9b4b-b11f102ed448",
      },
      expectedOrganizationId: "org-1",
      expectedRevision: 0,
      projectId: PROJECT_ID,
    });
    await api.readRepositorySettings({ projectId: PROJECT_ID });
    await api.updateRepositorySettings({
      defaultRepositoryUrl: null,
      expectedOrganizationId: "org-1",
      expectedRevision: 0,
      projectId: PROJECT_ID,
      repositoryUrls: [],
    });
    await api.readCommonAgents({ projectId: PROJECT_ID });
    await api.updateCommonAgents({
      agentProfileIds: [],
      expectedOrganizationId: "org-1",
      expectedRevision: 0,
      projectId: PROJECT_ID,
    });

    expect(
      transport.mock.calls.map(([call]) => ({
        body: call.init?.body,
        method: call.init?.method,
        operation: call.operation,
        url: call.url,
      }))
    ).toEqual([
      {
        body: undefined,
        method: "GET",
        operation: "project.list",
        url: projectsUrl,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: "org-1",
          name: "OpenMeld",
          repositoryUrl: "https://github.com/amplifthq/openmeld",
        }),
        method: "POST",
        operation: "project.create",
        url: projectsUrl,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: "org-1",
          name: "OpenMeld Core",
        }),
        method: "PATCH",
        operation: "project.update",
        url: projectUrl,
      },
      {
        body: JSON.stringify({ expectedOrganizationId: "org-1" }),
        method: "DELETE",
        operation: "project.archive",
        url: projectUrl,
      },
      {
        body: undefined,
        method: "GET",
        operation: "project.issue-routing.read",
        url: routingUrl,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: "org-1",
          expectedRevision: 0,
          destination: {
            provider: "linear",
            teamId: "d1a7c1f0-290e-4cdb-9b4b-b11f102ed448",
          },
        }),
        method: "PUT",
        operation: "project.issue-routing.update",
        url: routingUrl,
      },
      {
        body: undefined,
        method: "GET",
        operation: "project.repositories.read",
        url: repositoriesUrl,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: "org-1",
          expectedRevision: 0,
          repositoryUrls: [],
          defaultRepositoryUrl: null,
        }),
        method: "PUT",
        operation: "project.repositories.update",
        url: repositoriesUrl,
      },
      {
        body: undefined,
        method: "GET",
        operation: "project.common-agents.read",
        url: commonAgentsUrl,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: "org-1",
          expectedRevision: 0,
          agentProfileIds: [],
        }),
        method: "PUT",
        operation: "project.common-agents.update",
        url: commonAgentsUrl,
      },
    ]);
  });

  it("rejects unsafe input before transport", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>();
    const api = createProjectsApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.create({
        expectedOrganizationId: "org-1",
        name: "OpenMeld",
        repositoryFingerprint: "/Users/felix/Desktop/work/openmeld",
      })
    ).rejects.toThrow("Project create request is invalid");
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("api-client local Project control API", () => {
  it("uses the frozen current-computer routes and strict request bodies", async () => {
    const baseUrl = "https://gateway.openmeld.invalid";
    const connections = [
      {
        bindingGeneration: "binding-1",
        isDefault: true,
        path: "/work/openmeld",
        status: "available",
      },
    ] as const;
    const responses = new Map<string, unknown>([
      [
        "discover",
        {
          checkedAtMs: 1,
          clientGeneration: 1,
          deviceId: "device-1",
          gitStatus: "available",
          projects: [],
          requestId: "request-1",
        },
      ],
      [
        "connect-candidate",
        {
          code: "path_conflict",
          conflictingProjectSlug: "other-project",
          conflictScope: "another_organization",
          message:
            "This folder is already connected to the “other-project” Project in another Organization.",
          moveConfirmationToken: "move-confirmation-1",
          moveImpact: "only_connection",
          status: "rejected",
        },
      ],
      [
        "connect-declared-path",
        {
          bindingGeneration: "binding-1",
          canonicalPath: "/work/openmeld",
          isDefault: true,
          status: "unchanged",
        },
      ],
      ["connections/set-default", { connections, status: "updated" }],
      ["connections/remove", { connections: [], status: "removed" }],
      ["connections/remove-missing", { connections, removedCount: 1 }],
    ]);
    const transport = vi.fn<OpenMeldApiClientTransport>((call) => {
      const suffix = call.url.split("/projects/")[1] ?? "";
      const response = responses.get(suffix);
      if (!response) {
        throw new Error(
          `Unexpected local Project control request: ${call.url}`
        );
      }
      return Promise.resolve(jsonResponse(response));
    });
    const api = createLocalProjectControlApi(
      createOpenMeldApiClient({ baseUrl, transport })
    );
    const base = {
      clientGeneration: 1,
      expectedOrganizationId: "org-1",
      idempotencyKey: "idempotency-1",
      projectId: "project-1",
    };

    await api.discoverProjects({
      clientGeneration: 1,
      expectedOrganizationId: "org-1",
      projectIds: ["project-1"],
    });
    const conflict = await api.connectCandidate({
      ...base,
      candidateId: "candidate-1",
      candidatePath: "/work/openmeld",
    });
    expect(conflict).toMatchObject({
      code: "path_conflict",
      moveConfirmationToken: "move-confirmation-1",
      status: "rejected",
    });
    await api.connectDeclaredPath({
      ...base,
      confirmNonGit: true,
      declaredPath: "/work/openmeld",
      moveConfirmationToken: "move-confirmation-1",
    });
    await api.setDefaultConnection({
      ...base,
      targetBindingGeneration: "binding-1",
    });
    await api.removeConnection({
      ...base,
      bindingGeneration: "binding-1",
    });
    await api.removeMissingConnections(base);

    expect(
      transport.mock.calls.map(([call]) => ({
        body: JSON.parse(String(call.init?.body)),
        operation: call.operation,
        path: new URL(call.url).pathname,
      }))
    ).toEqual([
      {
        body: {
          clientGeneration: 1,
          expectedOrganizationId: "org-1",
          projectIds: ["project-1"],
        },
        operation: "local-project-control.discover",
        path: buildLocalProjectControlPath("discover"),
      },
      {
        body: {
          ...base,
          candidateId: "candidate-1",
          candidatePath: "/work/openmeld",
        },
        operation: "local-project-control.connect-candidate",
        path: buildLocalProjectControlPath("connect-candidate"),
      },
      {
        body: {
          ...base,
          confirmNonGit: true,
          declaredPath: "/work/openmeld",
          moveConfirmationToken: "move-confirmation-1",
        },
        operation: "local-project-control.connect-declared-path",
        path: buildLocalProjectControlPath("connect-declared-path"),
      },
      {
        body: { ...base, targetBindingGeneration: "binding-1" },
        operation: "local-project-control.set-default",
        path: buildLocalProjectControlPath("connections/set-default"),
      },
      {
        body: { ...base, bindingGeneration: "binding-1" },
        operation: "local-project-control.remove",
        path: buildLocalProjectControlPath("connections/remove"),
      },
      {
        body: base,
        operation: "local-project-control.remove-missing",
        path: buildLocalProjectControlPath("connections/remove-missing"),
      },
    ]);
  });

  it.each([
    false,
    true,
  ])("keeps transport controls out of strict Project bodies (explicit target: %s)", async (explicitTarget) => {
    const controller = new AbortController();
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        jsonResponse({
          checkedAtMs: 1,
          clientGeneration: 1,
          deviceId: "device-1",
          gitStatus: "available",
          projects: [],
          requestId: "request-1",
        })
      )
    );
    const api = createLocalProjectControlApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const input = {
      clientGeneration: 1,
      expectedOrganizationId: "org-1",
      projectIds: ["project-1"],
      signal: controller.signal,
      timeoutMs: 12_000,
    };
    if (explicitTarget) {
      await api.discoverPeopleComputerProjects({
        ...input,
        deviceId: "device-1",
        runtimeLane: "canary",
      });
    } else {
      await api.discoverProjects(input);
    }

    expect(transport).toHaveBeenCalledOnce();
    const [request] = transport.mock.calls[0] ?? [];
    expect(request).toMatchObject({ timeoutMs: 12_000 });
    expect(request?.url).toBe(
      explicitTarget
        ? "https://gateway.openmeld.invalid/v1/people-computers/device-1/lanes/canary/projects/discover"
        : `https://gateway.openmeld.invalid${buildLocalProjectControlPath("discover")}`
    );
    expect(request?.init?.signal).toBe(controller.signal);
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      clientGeneration: 1,
      expectedOrganizationId: "org-1",
      projectIds: ["project-1"],
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
