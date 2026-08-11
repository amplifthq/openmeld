import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthSessionStateMock, projectsApiListMock } = vi.hoisted(() => ({
  getAuthSessionStateMock: vi.fn(),
  projectsApiListMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openmeld/api-client")>()),
  createAgentActivityApi: () => ({}),
  createProjectsApi: () => ({ list: projectsApiListMock }),
}));
vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: getAuthSessionStateMock,
}));
vi.mock("../src/agent-activity/project-binding-producer-gate", () => ({
  assertProjectBindingProducerCompatible: vi.fn(() => Promise.resolve()),
  isProjectBindingUpdateRequiredError: () => false,
}));

import {
  bindProject,
  listProjectBindings,
} from "../src/agent-activity/project-bindings";
import {
  runProjectsConnectionsList,
  runProjectsConnectionsRemove,
  runProjectsConnectionsSetDefault,
} from "../src/agent-activity/project-connections-command";

const project = {
  archivedAtMs: null,
  canArchive: true,
  canManage: true,
  createdAtMs: 1,
  createdByUserId: "user-1",
  id: "project-1",
  name: "OpenMeld",
  organizationId: "org-1",
  repositoryFingerprint: null,
  slug: "openmeld",
  updatedAtMs: 1,
};

let temporaryRoot: string;
let stdout: ReturnType<typeof captureStdout>;
const originalOpenMeldHome = process.env.OPENMELD_HOME;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(
    join(tmpdir(), "openmeld-connections-command-")
  );
  process.env.OPENMELD_HOME = temporaryRoot;
  process.exitCode = 0;
  stdout = captureStdout();
  getAuthSessionStateMock.mockResolvedValue({
    session: {
      activeOrganization: {
        id: "org-1",
        name: "OpenMeld",
        slug: "openmeld",
      },
    },
    state: "valid",
  });
  projectsApiListMock.mockResolvedValue({
    organizationId: "org-1",
    projects: [project],
  });
});

afterEach(async () => {
  process.exitCode = 0;
  stdout.mockRestore();
  vi.clearAllMocks();
  await rm(temporaryRoot, { force: true, recursive: true });
  if (originalOpenMeldHome === undefined) {
    process.env.OPENMELD_HOME = undefined;
  } else {
    process.env.OPENMELD_HOME = originalOpenMeldHome;
  }
});

describe("Project connections commands", () => {
  it("emits the strict list JSON snapshot with default and missing status", async () => {
    await createConnection("first");
    const secondPath = await createConnection("second");
    const connections = await listProjectBindings({});
    await rm(secondPath, { recursive: true });

    await runProjectsConnectionsList({
      json: true,
      projectSlug: "openmeld",
      view: "agent",
    });

    expect(readJsonOutput()).toEqual({
      connections: [
        {
          bindingGeneration: connections[0]?.bindingGeneration,
          isDefault: true,
          path: connections[0]?.repositoryPath,
          status: "available",
        },
        {
          bindingGeneration: connections[1]?.bindingGeneration,
          isDefault: false,
          path: connections[1]?.repositoryPath,
          status: "missing",
        },
      ],
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      schemaVersion: 1,
      type: "projects.connections.list",
    });
  });

  it("sets the default connection and reports the resulting snapshot", async () => {
    await createConnection("first");
    await createConnection("second");
    const before = await listProjectBindings({});
    const target = before[1];
    if (!target) {
      throw new Error("Expected a second connection.");
    }

    await runProjectsConnectionsSetDefault({
      generation: target.bindingGeneration,
      json: true,
      projectSlug: "openmeld",
      view: "agent",
    });

    expect(readJsonOutput()).toMatchObject({
      connections: expect.arrayContaining([
        expect.objectContaining({
          bindingGeneration: target.bindingGeneration,
          isDefault: true,
        }),
      ]),
      status: "updated",
      type: "projects.connections.set_default",
    });
    await expect(listProjectBindings({})).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bindingGeneration: target.bindingGeneration,
          isDefault: true,
        }),
      ])
    );
  });

  it("removes by path and atomically installs the requested replacement", async () => {
    const firstPath = await createConnection("first");
    await createConnection("second");
    const before = await listProjectBindings({});
    const replacement = before[1];
    if (!replacement) {
      throw new Error("Expected a replacement connection.");
    }

    await runProjectsConnectionsRemove({
      json: true,
      path: firstPath,
      projectSlug: "openmeld",
      replacementGeneration: replacement.bindingGeneration,
      view: "agent",
    });

    expect(readJsonOutput()).toEqual({
      connections: [
        {
          bindingGeneration: replacement.bindingGeneration,
          isDefault: true,
          path: replacement.repositoryPath,
          status: "available",
        },
      ],
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      schemaVersion: 1,
      status: "removed",
      type: "projects.connections.remove",
    });
  });

  it("removes the final connection by generation without requiring a replacement", async () => {
    await createConnection("only");
    const [connection] = await listProjectBindings({});
    if (!connection) {
      throw new Error("Expected a Project connection.");
    }

    await runProjectsConnectionsRemove({
      generation: connection.bindingGeneration,
      json: true,
      projectSlug: "openmeld",
      view: "agent",
    });

    expect(readJsonOutput()).toMatchObject({
      connections: [],
      status: "removed",
      type: "projects.connections.remove",
    });
    await expect(listProjectBindings({})).resolves.toEqual([]);
  });
});

async function createConnection(name: string): Promise<string> {
  const repositoryPath = join(temporaryRoot, name);
  await mkdir(repositoryPath, { recursive: true });
  await bindProject({
    organizationId: "org-1",
    projectId: "project-1",
    projectSlug: "openmeld",
    repositoryFingerprint: null,
    repositoryPath,
  });
  return repositoryPath;
}

function readJsonOutput(): unknown {
  const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
  return JSON.parse(output.trim());
}

function captureStdout() {
  return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}
