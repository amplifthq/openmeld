import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localProjectControlDiscoverProjectsResponseSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { bindProject } from "../src/agent-activity/project-bindings";
import type { GitRepositoryVerifier } from "../src/local-service/projects/git-repository-verifier";
import { discoverLocalProjects } from "../src/local-service/projects/local-project-discovery";

const FINGERPRINT_A = `sha256:${"a".repeat(64)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    })
  );
});

describe("local Project discovery", () => {
  it("reads durable connections without invoking Git or session discovery", async () => {
    const rootDir = await tempRoot();
    const folder = join(rootDir, "work");
    await mkdir(folder);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "work",
      repositoryFingerprint: FINGERPRINT_A,
      repositoryPath: folder,
      rootDir,
    });
    const forbidden = () => {
      throw new Error("Connection reads must not discover repositories");
    };
    const result = await discoverLocalProjects(
      {
        ...discoveryInput(rootDir, [
          { projectId: "project-1", repositoryFingerprint: FINGERPRINT_A },
          { projectId: "project-2", repositoryFingerprint: null },
        ]),
        includeCandidates: false,
      },
      {
        createVerifier: forbidden,
        collectProfileWorkspacePaths: forbidden,
        collectSessionWorkingDirectories: forbidden,
      }
    );
    expect(result.gitStatus).toBe("not_checked");
    expect(result.projects[0]).toMatchObject({
      status: "connected",
      connections: [
        { path: await realpath(folder), isDefault: true, status: "available" },
      ],
      candidates: [],
    });
    expect(result.projects[1]).toMatchObject({
      status: "not_connected",
      connections: [],
      candidates: [],
    });
    await rm(folder, { recursive: true });
    const missing = await discoverLocalProjects(
      {
        ...discoveryInput(rootDir, [
          { projectId: "project-1", repositoryFingerprint: FINGERPRINT_A },
        ]),
        includeCandidates: false,
      },
      { createVerifier: forbidden }
    );
    expect(missing.projects[0]).toMatchObject({
      status: "connected_folder_missing",
      connections: [{ isDefault: true, status: "missing" }],
    });
  });
  it("deduplicates candidate subdirectories after Git toplevel normalization", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "openmeld");
    const nestedPath = join(repositoryPath, "clients", "cli");
    await mkdir(nestedPath, { recursive: true });
    const verifier = fakeVerifier({
      inspect: async () => ({
        canonicalPath: repositoryPath,
        originUrl: "git@github.com:openmeld/openmeld.git",
        repositoryFingerprint: FINGERPRINT_A,
      }),
    });

    const result = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      {
        collectProfileWorkspacePaths: async () => [repositoryPath],
        collectSessionWorkingDirectories: async () => [nestedPath],
        createVerifier: () => verifier,
      }
    );

    expect(result.projects).toEqual([
      expect.objectContaining({
        candidates: [
          expect.objectContaining({
            candidateKind: "repository",
            canonicalPath: repositoryPath,
            repositoryFingerprint: FINGERPRINT_A,
          }),
        ],
        projectId: "project-1",
        status: "found",
      }),
    ]);
    expect(
      localProjectControlDiscoverProjectsResponseSchema.safeParse(result)
        .success
    ).toBe(true);
  });

  it("keeps the Project missing when its default is gone but another connection is available", async () => {
    const rootDir = await tempRoot();
    const missingDefault = join(rootDir, "missing-default");
    const availableAdditional = join(rootDir, "available-additional");
    await Promise.all([mkdir(missingDefault), mkdir(availableAdditional)]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: FINGERPRINT_A,
      repositoryPath: missingDefault,
      rootDir,
    });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: FINGERPRINT_A,
      repositoryPath: availableAdditional,
      rootDir,
    });
    const canonicalMissingDefault = await realpath(missingDefault);
    const canonicalAvailableAdditional = await realpath(availableAdditional);
    await rm(missingDefault, { recursive: true });

    const result = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      emptySources(
        fakeVerifier({
          inspect: async (path) => ({
            canonicalPath: path,
            originUrl: "git@github.com:openmeld/openmeld.git",
            repositoryFingerprint: FINGERPRINT_A,
          }),
        })
      )
    );

    expect(result.projects[0]).toMatchObject({
      connections: [
        {
          isDefault: true,
          path: canonicalMissingDefault,
          status: "missing",
        },
        {
          isDefault: false,
          path: canonicalAvailableAdditional,
          status: "available",
        },
      ],
      status: "connected_folder_missing",
    });
  });

  it("marks a missing connection as available again without rebinding it", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "returning-repository");
    await mkdir(repositoryPath);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: FINGERPRINT_A,
      repositoryPath,
      rootDir,
    });
    const canonicalRepositoryPath = await realpath(repositoryPath);
    await rm(repositoryPath, { recursive: true });
    const dependencies = emptySources(
      fakeVerifier({
        inspect: async (path) => ({
          canonicalPath: path,
          originUrl: null,
          repositoryFingerprint: null,
        }),
      })
    );

    const missing = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      dependencies
    );
    expect(missing.projects[0]?.status).toBe("connected_folder_missing");

    await mkdir(repositoryPath);
    const returned = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      dependencies
    );
    expect(returned.projects[0]).toMatchObject({
      connections: [{ path: canonicalRepositoryPath, status: "available" }],
      status: "connected",
    });
  });

  it("uses one 25-second verifier deadline for the whole discovery round", async () => {
    const rootDir = await tempRoot();
    let capturedDeadline = 0;
    const verifier = fakeVerifier({});

    await discoverLocalProjects(discoveryInput(rootDir, []), {
      collectProfileWorkspacePaths: async () => [],
      collectSessionWorkingDirectories: async () => [],
      createVerifier: (input) => {
        capturedDeadline = input?.deadlineMs ?? 0;
        return verifier;
      },
      now: () => 1000,
    });

    expect(capturedDeadline).toBe(26_000);
  });

  it("reports verification_unavailable instead of not_found when Git times out", async () => {
    const rootDir = await tempRoot();
    const result = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      emptySources(fakeVerifier({ availability: "timed_out" }))
    );

    expect(result).toMatchObject({
      gitStatus: "timed_out",
      projects: [
        { projectId: "project-1", status: "verification_unavailable" },
      ],
    });
  });

  it("skips one unavailable metadata source without hiding other discovery", async () => {
    const rootDir = await tempRoot();
    const diagnostics: Record<string, unknown>[] = [];
    const result = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      {
        collectProfileWorkspacePaths: () =>
          Promise.reject(new Error("profile metadata permission denied")),
        collectSessionWorkingDirectories: () => Promise.resolve([]),
        createVerifier: () => fakeVerifier({}),
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }
    );

    expect(result).toMatchObject({
      gitStatus: "available",
      projects: [{ projectId: "project-1", status: "not_found" }],
    });
    expect(diagnostics).toEqual([
      {
        code: "metadata_source_failed",
        errorCode: null,
        errorName: "Error",
      },
    ]);
  });

  it("keeps a verified candidate when an unrelated candidate cannot be inspected", async () => {
    const rootDir = await tempRoot();
    const brokenPath = join(rootDir, "broken");
    const repositoryPath = join(rootDir, "repository");
    await Promise.all([mkdir(brokenPath), mkdir(repositoryPath)]);
    const diagnostics: Record<string, unknown>[] = [];
    const result = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      {
        collectProfileWorkspacePaths: async () => [],
        collectSessionWorkingDirectories: async () => [
          brokenPath,
          repositoryPath,
        ],
        createVerifier: () =>
          fakeVerifier({
            inspect: (path) => {
              if (path === brokenPath) {
                return Promise.reject(
                  new Error("candidate cannot be inspected")
                );
              }
              return Promise.resolve({
                canonicalPath: path,
                originUrl: "git@github.com:openmeld/openmeld.git",
                repositoryFingerprint: FINGERPRINT_A,
              });
            },
          }),
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }
    );

    expect(result).toMatchObject({
      gitStatus: "available",
      projects: [
        {
          candidates: [
            expect.objectContaining({ canonicalPath: repositoryPath }),
          ],
          projectId: "project-1",
          status: "found",
        },
      ],
    });
    expect(diagnostics).toHaveLength(1);
  });

  it("returns within the round budget when a metadata collector never settles", async () => {
    const rootDir = await tempRoot();
    const startedAt = Date.now();
    let collectorAborted = false;
    const result = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      {
        budgetMs: 20,
        collectProfileWorkspacePaths: (signal) =>
          new Promise((resolve) => {
            signal?.addEventListener(
              "abort",
              () => {
                collectorAborted = true;
                resolve([]);
              },
              { once: true }
            );
          }),
        collectSessionWorkingDirectories: () => Promise.resolve([]),
        createVerifier: () => fakeVerifier({}),
      }
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(collectorAborted).toBe(true);
    expect(result).toMatchObject({
      gitStatus: "timed_out",
      projects: [
        { projectId: "project-1", status: "verification_unavailable" },
      ],
    });
  });

  it("marks the round timed out when candidate collection exhausts its budget", async () => {
    const rootDir = await tempRoot();
    const times = [1000, 26_001];
    const result = await discoverLocalProjects(
      discoveryInput(rootDir, [
        {
          projectId: "project-1",
          repositoryFingerprint: FINGERPRINT_A,
        },
      ]),
      {
        collectProfileWorkspacePaths: () => Promise.resolve([]),
        collectSessionWorkingDirectories: () => Promise.resolve([]),
        createVerifier: () => fakeVerifier({}),
        now: () => times.shift() ?? 26_001,
      }
    );

    expect(result).toMatchObject({
      gitStatus: "timed_out",
      projects: [
        { projectId: "project-1", status: "verification_unavailable" },
      ],
    });
  });
});

function discoveryInput(
  rootDir: string,
  projects: Array<{
    projectId: string;
    repositoryFingerprint: string | null;
  }>
) {
  return {
    checkedAtMs: 123,
    clientGeneration: 4,
    deviceId: "device-1",
    expectedOrganizationId: "org-1",
    projects,
    requestId: "request-1",
    rootDir,
  };
}

function emptySources(verifier: GitRepositoryVerifier) {
  return {
    collectProfileWorkspacePaths: async () => [],
    collectSessionWorkingDirectories: async () => [],
    createVerifier: () => verifier,
  };
}

function fakeVerifier(input: {
  availability?: "available" | "timed_out";
  inspect?: GitRepositoryVerifier["inspectRepository"];
}): GitRepositoryVerifier {
  return {
    checkAvailability: async () => input.availability ?? "available",
    inspectRepository:
      input.inspect ??
      (async (path) => ({
        canonicalPath: path,
        originUrl: null,
        repositoryFingerprint: null,
      })),
    listWorktrees: async () => [],
    runForTest: async () => ({ stderr: "", stdout: "" }),
  };
}

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-project-discovery-"));
  temporaryRoots.push(path);
  return path;
}
