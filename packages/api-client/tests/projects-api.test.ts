import { describe, expect, it, vi } from "vitest";
import {
  buildLocalProjectControlPath,
  buildProjectPath,
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
  it("builds only the hard-cut Project routes", () => {
    expect(buildProjectsPath()).toBe("/v1/organizations/current/projects");
    expect(buildProjectPath(PROJECT_ID)).toBe(
      "/v1/organizations/current/projects/project%2Fwith%20spaces"
    );
  });

  it("uses one strict API surface for every Project operation", async () => {
    const projectsUrl =
      "https://gateway.openmeld.invalid/v1/organizations/current/projects";
    const projectUrl = `${projectsUrl}/project%2Fwith%20spaces`;
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
