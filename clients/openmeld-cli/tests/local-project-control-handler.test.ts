import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindProject,
  listProjectBindings,
  ProjectBindingOperationError,
} from "../src/agent-activity/project-bindings";
import { LocalProjectConnectionError } from "../src/local-service/projects/local-project-connection";
import { handleLocalProjectControlFrame } from "../src/local-service/projects/local-project-control-handler";
import { buildLocalProjectCandidateId } from "../src/local-service/projects/local-project-discovery";
import { LocalProjectDiscoveryEpochs } from "../src/local-service/projects/local-project-discovery-epoch";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("local Project control daemon handler", () => {
  it("passes only Core-authored canonical Project facts into discovery", async () => {
    let observedInput: unknown;
    const result = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("discover_projects", {
          clientGeneration: 7,
          expectedOrganizationId: "org-1",
          projects: [
            { projectId: "project-1", repositoryFingerprint: FINGERPRINT },
          ],
        }),
      },
      {
        discover: (input) => {
          observedInput = input;
          return Promise.resolve({
            checkedAtMs: 123,
            clientGeneration: input.clientGeneration,
            deviceId: input.deviceId,
            gitStatus: "available",
            projects: [
              {
                candidates: [],
                connections: [],
                projectId: "project-1",
                status: "not_found",
              },
            ],
            requestId: input.requestId,
          });
        },
      }
    );

    expect(observedInput).toMatchObject({
      clientGeneration: 7,
      deviceId: "device-1",
      expectedOrganizationId: "org-1",
      projects: [
        { projectId: "project-1", repositoryFingerprint: FINGERPRINT },
      ],
      requestId: "request-1",
    });
    expect(result).toMatchObject({
      code: "daemon.local_project_control.discover_projects_result",
      payload: { result: { projects: [{ projectId: "project-1" }] } },
    });
  });

  it("requires explicit non-Git confirmation before the first mutation", async () => {
    const rootDir = await tempRoot();
    const declaredPath = join(rootDir, "plain-folder");
    await mkdir(declaredPath);
    const canonicalPath = await realpath(declaredPath);
    const request = {
      clientGeneration: 1,
      declaredPath,
      expectedOrganizationId: "org-1",
      idempotencyKey: "connect-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
    };
    const validate = (input: { allowUnverifiedNonGit: boolean }) => {
      if (!input.allowUnverifiedNonGit) {
        return Promise.reject(
          new LocalProjectConnectionError(
            "confirmation_required",
            "Confirm this non-Git folder."
          )
        );
      }
      return Promise.resolve({
        canonicalPath,
        normalizedFrom: null,
        repositoryFingerprint: null,
      });
    };

    await expect(
      handleLocalProjectControlFrame(
        {
          deviceId: "device-1",
          frame: requestFrame("connect_declared_path", request),
          rootDir,
        },
        { validate }
      )
    ).resolves.toMatchObject({
      payload: { result: { code: "needs_confirmation", status: "rejected" } },
    });
    await expect(listProjectBindings({ rootDir })).resolves.toEqual([]);

    await expect(
      handleLocalProjectControlFrame(
        {
          deviceId: "device-1",
          frame: requestFrame("connect_declared_path", {
            ...request,
            confirmNonGit: true,
            idempotencyKey: "connect-2",
          }),
          rootDir,
        },
        { validate }
      )
    ).resolves.toMatchObject({
      payload: {
        result: {
          canonicalPath,
          isDefault: true,
          status: "connected",
        },
      },
    });
    await expect(listProjectBindings({ rootDir })).resolves.toHaveLength(1);
  });

  it.each([
    ["path_not_found", "path_not_found"],
    ["path_not_directory", "path_not_directory"],
    ["path_unreadable", "path_unreadable"],
    ["repository_fingerprint_mismatch", "fingerprint_mismatch"],
    ["git_repository_required", "git_repository_required"],
    ["git_verification_unavailable", "git_unavailable"],
  ] as const)("maps %s to the frozen %s response code", async (source, code) => {
    const result = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("connect_declared_path", {
          clientGeneration: 1,
          declaredPath: "/tmp/repository",
          expectedOrganizationId: "org-1",
          idempotencyKey: `connect-${source}`,
          projectId: "project-1",
          projectSlug: "openmeld",
          repositoryFingerprint: FINGERPRINT,
        }),
      },
      {
        validate: () =>
          Promise.reject(new LocalProjectConnectionError(source, source)),
      }
    );

    expect(result).toMatchObject({
      payload: { result: { code, status: "rejected" } },
    });
  });

  it("preserves the confirmed move contract without exposing an Organization name", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "conflicted-repository");
    await mkdir(repositoryPath);
    const result = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("connect_declared_path", {
          clientGeneration: 1,
          declaredPath: repositoryPath,
          expectedOrganizationId: "org-conflict",
          idempotencyKey: "connect-conflict",
          projectId: "project-conflict",
          projectSlug: "current-project",
          repositoryFingerprint: FINGERPRINT,
        }),
        rootDir,
      },
      {
        bind: () =>
          Promise.reject(
            new ProjectBindingOperationError(
              "path_conflict",
              "This folder is already connected to the “other-project” Project in another Organization.",
              {
                pathConflict: {
                  conflictingProjectSlug: "other-project",
                  conflictScope: "another_organization",
                  moveConfirmationToken: "move-confirmation-1",
                  moveImpact: "only_connection",
                },
              }
            )
          ),
        validate: () =>
          Promise.resolve({
            canonicalPath: repositoryPath,
            normalizedFrom: null,
            repositoryFingerprint: FINGERPRINT,
          }),
      }
    );

    expect(result).toMatchObject({
      payload: {
        result: {
          code: "path_conflict",
          conflictingProjectSlug: "other-project",
          conflictScope: "another_organization",
          moveConfirmationToken: "move-confirmation-1",
          moveImpact: "only_connection",
          status: "rejected",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("Organization name");
  });

  it.each([
    ["command_line_tools_missing", "command_line_tools_missing"],
    ["timed_out", "timeout"],
    ["not_installed", "git_unavailable"],
  ] as const)("preserves the %s Git availability branch", async (gitStatus, code) => {
    const result = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("connect_declared_path", {
          clientGeneration: 1,
          declaredPath: "/tmp/repository",
          expectedOrganizationId: "org-1",
          idempotencyKey: `connect-${gitStatus}`,
          projectId: "project-1",
          projectSlug: "openmeld",
          repositoryFingerprint: FINGERPRINT,
        }),
      },
      {
        validate: () =>
          Promise.reject(
            new LocalProjectConnectionError(
              "git_verification_unavailable",
              "Git verification unavailable.",
              { gitStatus }
            )
          ),
      }
    );

    expect(result).toMatchObject({
      payload: { result: { code, status: "rejected" } },
    });
  });

  it("fails a stale candidate closed after fresh path verification", async () => {
    const result = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("connect_candidate", {
          candidateId: "candidate-stale",
          candidatePath: "/tmp/repository",
          clientGeneration: 1,
          expectedOrganizationId: "org-1",
          idempotencyKey: "connect-1",
          projectId: "project-1",
          projectSlug: "openmeld",
          repositoryFingerprint: FINGERPRINT,
        }),
      },
      {
        validate: () =>
          Promise.resolve({
            canonicalPath: "/tmp/repository",
            normalizedFrom: null,
            repositoryFingerprint: FINGERPRINT,
          }),
      }
    );

    expect(result).toMatchObject({
      payload: {
        result: { code: "candidate_unavailable", status: "rejected" },
      },
    });
  });

  it("accepts only an exact candidate from the current discovery epoch", async () => {
    const rootDir = await tempRoot();
    const candidatePath = join(rootDir, "repository");
    await mkdir(candidatePath);
    const canonicalPath = await realpath(candidatePath);
    const candidateId = buildLocalProjectCandidateId(
      canonicalPath,
      FINGERPRINT
    );
    const organizationId = "org-current-epoch";
    const projectId = "project-current-epoch";
    const discoveryEpochs = new LocalProjectDiscoveryEpochs(
      () => "epoch-current"
    );

    const discoveryFrame = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("discover_projects", {
          clientGeneration: 9,
          expectedOrganizationId: organizationId,
          projects: [{ projectId, repositoryFingerprint: FINGERPRINT }],
        }),
      },
      {
        discoveryEpochs,
        discover: (input) =>
          Promise.resolve({
            checkedAtMs: 123,
            clientGeneration: input.clientGeneration,
            deviceId: input.deviceId,
            gitStatus: "available",
            projects: [
              {
                candidates: [
                  {
                    candidateId,
                    candidateKind: "repository",
                    canonicalPath,
                    repositoryFingerprint: FINGERPRINT,
                  },
                ],
                connections: [],
                projectId,
                status: "found",
              },
            ],
            requestId: input.requestId,
          }),
      }
    );
    if (
      discoveryFrame.code !==
        "daemon.local_project_control.discover_projects_result" ||
      !("projects" in discoveryFrame.payload.result)
    ) {
      throw new Error("Expected Project discovery to return a candidate.");
    }
    const discoveredCandidateId =
      discoveryFrame.payload.result.projects[0]?.candidates[0]?.candidateId;
    if (!discoveredCandidateId) {
      throw new Error("Expected Project discovery to return a candidate ID.");
    }
    expect(
      discoveryEpochs.resolveDiscoveryCandidateId({
        candidateId: discoveredCandidateId,
        candidatePath: canonicalPath,
        organizationId,
        projectId,
      })
    ).toBe(candidateId);

    const validate = vi.fn(() =>
      Promise.resolve({
        canonicalPath,
        normalizedFrom: null,
        repositoryFingerprint: FINGERPRINT,
      })
    );
    const connectFrame = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("connect_candidate", {
          candidateId: discoveredCandidateId,
          candidatePath: canonicalPath,
          clientGeneration: 10,
          expectedOrganizationId: organizationId,
          idempotencyKey: "current-candidate",
          projectId,
          projectSlug: "current-project",
          repositoryFingerprint: FINGERPRINT,
        }),
        rootDir,
      },
      { discoveryEpochs, validate }
    );
    if (
      connectFrame.code !==
        "daemon.local_project_control.connect_candidate_result" ||
      connectFrame.payload.result.status === "rejected"
    ) {
      throw new Error(
        `Expected the discovered candidate to connect: ${JSON.stringify(connectFrame)}`
      );
    }
    expect(connectFrame).toMatchObject({
      payload: { result: { canonicalPath, status: "connected" } },
    });
    expect(validate).toHaveBeenCalledOnce();

    await expect(
      handleLocalProjectControlFrame(
        {
          deviceId: "device-1",
          frame: requestFrame("connect_candidate", {
            candidateId,
            candidatePath: canonicalPath,
            clientGeneration: 8,
            expectedOrganizationId: organizationId,
            idempotencyKey: "stale-candidate",
            projectId,
            projectSlug: "current-project",
            repositoryFingerprint: FINGERPRINT,
          }),
          rootDir,
        },
        { validate }
      )
    ).resolves.toMatchObject({
      payload: {
        result: { code: "candidate_unavailable", status: "rejected" },
      },
    });
    expect(validate).toHaveBeenCalledOnce();
  });

  it("keeps a late older discovery result from replacing the newer epoch", async () => {
    const rootDir = await tempRoot();
    const olderPath = join(rootDir, "older-repository");
    const newerPath = join(rootDir, "newer-repository");
    await Promise.all([mkdir(olderPath), mkdir(newerPath)]);
    const canonicalOlderPath = await realpath(olderPath);
    const canonicalNewerPath = await realpath(newerPath);
    const olderCandidateId = buildLocalProjectCandidateId(
      canonicalOlderPath,
      FINGERPRINT
    );
    const newerCandidateId = buildLocalProjectCandidateId(
      canonicalNewerPath,
      FINGERPRINT
    );
    const older = deferred<DiscoveryResult>();
    const newer = deferred<DiscoveryResult>();
    const discoveryEpochs = new LocalProjectDiscoveryEpochs();
    const organizationId = "org-interleaved-epoch";
    const projectId = "project-interleaved-epoch";
    const dependencies = {
      discoveryEpochs,
      discover: (input: { clientGeneration: number }) =>
        input.clientGeneration === 1 ? older.promise : newer.promise,
    };

    const olderRequest = handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("discover_projects", {
          clientGeneration: 1,
          expectedOrganizationId: organizationId,
          projects: [{ projectId, repositoryFingerprint: FINGERPRINT }],
        }),
      },
      dependencies
    );
    const newerRequest = handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("discover_projects", {
          clientGeneration: 2,
          expectedOrganizationId: organizationId,
          projects: [{ projectId, repositoryFingerprint: FINGERPRINT }],
        }),
      },
      dependencies
    );
    newer.resolve(
      discoveryResult({
        candidateId: newerCandidateId,
        candidatePath: canonicalNewerPath,
        clientGeneration: 2,
        projectId,
      })
    );
    const newerDiscoveryFrame = await newerRequest;
    if (
      newerDiscoveryFrame.code !==
        "daemon.local_project_control.discover_projects_result" ||
      !("projects" in newerDiscoveryFrame.payload.result)
    ) {
      throw new Error("Expected the newer Project discovery to succeed.");
    }
    const currentCandidateId =
      newerDiscoveryFrame.payload.result.projects[0]?.candidates[0]
        ?.candidateId;
    if (!currentCandidateId) {
      throw new Error("Expected the newer Project discovery candidate ID.");
    }
    older.resolve(
      discoveryResult({
        candidateId: olderCandidateId,
        candidatePath: canonicalOlderPath,
        clientGeneration: 1,
        projectId,
      })
    );
    const olderDiscoveryFrame = await olderRequest;
    if (
      olderDiscoveryFrame.code !==
        "daemon.local_project_control.discover_projects_result" ||
      !("projects" in olderDiscoveryFrame.payload.result)
    ) {
      throw new Error("Expected the older Project discovery to complete.");
    }
    const staleCandidateId =
      olderDiscoveryFrame.payload.result.projects[0]?.candidates[0]
        ?.candidateId;
    if (!staleCandidateId) {
      throw new Error("Expected the older Project discovery candidate ID.");
    }

    const validate = vi.fn(() =>
      Promise.resolve({
        canonicalPath: canonicalNewerPath,
        normalizedFrom: null,
        repositoryFingerprint: FINGERPRINT,
      })
    );
    await expect(
      handleLocalProjectControlFrame(
        {
          deviceId: "device-1",
          frame: requestFrame("connect_candidate", {
            candidateId: staleCandidateId,
            candidatePath: canonicalOlderPath,
            clientGeneration: 1,
            expectedOrganizationId: organizationId,
            idempotencyKey: "older-candidate",
            projectId,
            projectSlug: "interleaved-project",
            repositoryFingerprint: FINGERPRINT,
          }),
          rootDir,
        },
        { discoveryEpochs, validate }
      )
    ).resolves.toMatchObject({
      payload: {
        result: { code: "candidate_unavailable", status: "rejected" },
      },
    });
    expect(validate).not.toHaveBeenCalled();

    await expect(
      handleLocalProjectControlFrame(
        {
          deviceId: "device-1",
          frame: requestFrame("connect_candidate", {
            candidateId: currentCandidateId,
            candidatePath: canonicalNewerPath,
            clientGeneration: 2,
            expectedOrganizationId: organizationId,
            idempotencyKey: "newer-candidate",
            projectId,
            projectSlug: "interleaved-project",
            repositoryFingerprint: FINGERPRINT,
          }),
          rootDir,
        },
        { discoveryEpochs, validate }
      )
    ).resolves.toMatchObject({
      payload: { result: { status: "connected" } },
    });
    expect(validate).toHaveBeenCalledOnce();
  });

  it("invalidates the previous epoch when Web discovery generations restart", async () => {
    const discoveryEpochs = new LocalProjectDiscoveryEpochs();
    const organizationId = "org-failed-epoch";
    const projectId = "project-failed-epoch";
    const candidatePath = "/tmp/failed-epoch-repository";
    const candidateId = buildLocalProjectCandidateId(
      candidatePath,
      FINGERPRINT
    );
    const initialDiscoveryFrame = await handleLocalProjectControlFrame(
      {
        deviceId: "device-1",
        frame: requestFrame("discover_projects", {
          clientGeneration: 9,
          expectedOrganizationId: organizationId,
          projects: [{ projectId, repositoryFingerprint: FINGERPRINT }],
        }),
      },
      {
        discoveryEpochs,
        discover: () =>
          Promise.resolve(
            discoveryResult({
              candidateId,
              candidatePath,
              clientGeneration: 9,
              projectId,
            })
          ),
      }
    );
    if (
      initialDiscoveryFrame.code !==
        "daemon.local_project_control.discover_projects_result" ||
      !("projects" in initialDiscoveryFrame.payload.result)
    ) {
      throw new Error("Expected the initial Project discovery to succeed.");
    }
    const invalidatedCandidateId =
      initialDiscoveryFrame.payload.result.projects[0]?.candidates[0]
        ?.candidateId;
    if (!invalidatedCandidateId) {
      throw new Error("Expected the initial Project discovery candidate ID.");
    }
    await expect(
      handleLocalProjectControlFrame(
        {
          deviceId: "device-1",
          frame: requestFrame("discover_projects", {
            clientGeneration: 1,
            expectedOrganizationId: organizationId,
            projects: [{ projectId, repositoryFingerprint: FINGERPRINT }],
          }),
        },
        {
          discoveryEpochs,
          discover: () => Promise.reject(new Error("discovery failed")),
        }
      )
    ).resolves.toMatchObject({
      payload: { result: { code: "internal_error", status: "rejected" } },
    });

    const validate = vi.fn();
    await expect(
      handleLocalProjectControlFrame(
        {
          deviceId: "device-1",
          frame: requestFrame("connect_candidate", {
            candidateId: invalidatedCandidateId,
            candidatePath,
            clientGeneration: 2,
            expectedOrganizationId: organizationId,
            idempotencyKey: "invalidated-candidate",
            projectId,
            projectSlug: "failed-epoch-project",
            repositoryFingerprint: FINGERPRINT,
          }),
        },
        { discoveryEpochs, validate }
      )
    ).resolves.toMatchObject({
      payload: {
        result: { code: "candidate_unavailable", status: "rejected" },
      },
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it("replays the first mutation result for the same idempotency key", async () => {
    const rootDir = await tempRoot();
    const repositoryPath = join(rootDir, "repository");
    await mkdir(repositoryPath);
    const binding = await bindProject({
      organizationId: "org-idempotency",
      projectId: "project-idempotency",
      projectSlug: "idempotency",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir,
    });
    const request = {
      bindingGeneration: binding.bindingGeneration,
      clientGeneration: 1,
      expectedOrganizationId: "org-idempotency",
      idempotencyKey: "remove-once",
      projectId: "project-idempotency",
    };

    const first = await handleLocalProjectControlFrame({
      deviceId: "device-1",
      frame: requestFrame("remove_connection", request, "request-first"),
      rootDir,
    });
    const retry = await handleLocalProjectControlFrame({
      deviceId: "device-1",
      frame: requestFrame("remove_connection", request, "request-retry"),
      rootDir,
    });

    expect(first).toMatchObject({
      payload: { requestId: "request-first", result: { status: "removed" } },
    });
    expect(retry).toMatchObject({
      payload: { requestId: "request-retry", result: { status: "removed" } },
    });
  });

  it("rejects an idempotency key reused with a different mutation", async () => {
    const rootDir = await tempRoot();
    const firstPath = join(rootDir, "first-idempotency");
    const secondPath = join(rootDir, "second-idempotency");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    const first = await bindProject({
      organizationId: "org-idempotency-conflict",
      projectId: "project-idempotency-conflict",
      projectSlug: "idempotency-conflict",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
      rootDir,
    });
    const second = await bindProject({
      organizationId: "org-idempotency-conflict",
      projectId: "project-idempotency-conflict",
      projectSlug: "idempotency-conflict",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
      rootDir,
    });
    const common = {
      clientGeneration: 1,
      expectedOrganizationId: "org-idempotency-conflict",
      idempotencyKey: "one-key",
      projectId: "project-idempotency-conflict",
    };

    await handleLocalProjectControlFrame({
      deviceId: "device-1",
      frame: requestFrame("set_default_connection", {
        ...common,
        targetBindingGeneration: second.bindingGeneration,
      }),
      rootDir,
    });
    await expect(
      handleLocalProjectControlFrame({
        deviceId: "device-1",
        frame: requestFrame("set_default_connection", {
          ...common,
          targetBindingGeneration: first.bindingGeneration,
        }),
        rootDir,
      })
    ).resolves.toMatchObject({
      payload: { result: { code: "invalid_request", status: "rejected" } },
    });
  });

  it("returns mutation snapshots and preserves atomic replacement semantics", async () => {
    const rootDir = await tempRoot();
    const firstPath = join(rootDir, "first");
    const secondPath = join(rootDir, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    const first = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
      rootDir,
    });
    const second = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
      rootDir,
    });
    const common = {
      clientGeneration: 1,
      expectedOrganizationId: "org-1",
      idempotencyKey: "mutation-1",
      projectId: "project-1",
    };

    await expect(
      handleLocalProjectControlFrame({
        deviceId: "device-1",
        frame: requestFrame("remove_connection", {
          ...common,
          bindingGeneration: first.bindingGeneration,
        }),
        rootDir,
      })
    ).resolves.toMatchObject({
      payload: { result: { code: "replacement_required" } },
    });
    await expect(
      handleLocalProjectControlFrame({
        deviceId: "device-1",
        frame: requestFrame("remove_connection", {
          ...common,
          bindingGeneration: first.bindingGeneration,
          replacementBindingGeneration: second.bindingGeneration,
          idempotencyKey: "mutation-2",
        }),
        rootDir,
      })
    ).resolves.toMatchObject({
      payload: {
        result: {
          connections: [
            { bindingGeneration: second.bindingGeneration, isDefault: true },
          ],
          status: "removed",
        },
      },
    });
  });
});

function requestFrame(
  operation: string,
  request: unknown,
  requestId = "request-1"
) {
  return {
    code: `daemon.local_project_control.${operation}`,
    payload: { request, requestId },
    v: 1,
  };
}

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-project-control-"));
  temporaryRoots.push(path);
  return path;
}

type DiscoveryResult = {
  checkedAtMs: number;
  clientGeneration: number;
  deviceId: string;
  gitStatus: "available";
  projects: Array<{
    candidates: Array<{
      candidateId: string;
      candidateKind: "repository";
      canonicalPath: string;
      repositoryFingerprint: string;
    }>;
    connections: [];
    projectId: string;
    status: "found";
  }>;
  requestId: string;
};

function discoveryResult(input: {
  candidateId: string;
  candidatePath: string;
  clientGeneration: number;
  projectId: string;
}): DiscoveryResult {
  return {
    checkedAtMs: 123,
    clientGeneration: input.clientGeneration,
    deviceId: "device-1",
    gitStatus: "available",
    projects: [
      {
        candidates: [
          {
            candidateId: input.candidateId,
            candidateKind: "repository",
            canonicalPath: input.candidatePath,
            repositoryFingerprint: FINGERPRINT,
          },
        ],
        connections: [],
        projectId: input.projectId,
        status: "found",
      },
    ],
    requestId: "request-1",
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}
