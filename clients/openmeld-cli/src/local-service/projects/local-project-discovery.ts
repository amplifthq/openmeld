import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import type {
  LocalProjectControlCandidate,
  LocalProjectControlDiscoverProjectsResponse,
  LocalProjectControlGitStatus,
  LocalProjectControlProjectDiscovery,
} from "@openmeld/schemas";
import { localProjectControlDiscoverProjectsResponseSchema } from "@openmeld/schemas";
import { collectObservedSessionWorkingDirectories } from "../../agent-activity/local-observer";
import { isProjectConnectionUsableByOwner } from "../../agent-activity/project-binding-resolution";
import {
  listProjectBindings,
  type ProjectBinding,
} from "../../agent-activity/project-bindings";
import {
  createGitRepositoryVerifier,
  type GitRepositoryVerifier,
  GitVerificationUnavailableError,
  NotGitRepositoryError,
} from "./git-repository-verifier";
import { collectProfileWorkspaceCandidatePaths } from "./profile-workspace-candidates";

const DISCOVERY_BUDGET_MS = 25_000;
const MAX_PROJECTS = 500;

export type CanonicalLocalProject = {
  projectId: string;
  repositoryFingerprint: string | null;
};

type CandidateSource = {
  confirmedRepository: boolean;
  kind: "repository" | "worktree";
  path: string;
};

type DiscoveryDependencies = {
  budgetMs?: number;
  collectProfileWorkspacePaths?: (signal?: AbortSignal) => Promise<string[]>;
  collectSessionWorkingDirectories?: (
    signal?: AbortSignal
  ) => Promise<string[]>;
  createVerifier?: typeof createGitRepositoryVerifier;
  now?: () => number;
  onDiagnostic?: (input: DiscoveryDiagnostic) => void;
};

type DiscoveryDiagnostic = {
  code:
    | "candidate_source_failed"
    | "connection_status_failed"
    | "metadata_source_failed";
  errorCode: string | null;
  errorName: string;
};

class DiscoveryDeadlineExceededError extends Error {
  constructor() {
    super("The local Project discovery budget expired.");
    this.name = "DiscoveryDeadlineExceededError";
  }
}

export async function discoverLocalProjects(
  input: {
    includeCandidates?: boolean;
    checkedAtMs?: number;
    clientGeneration: number;
    deviceId: string;
    expectedOrganizationId: string;
    homeDir?: string;
    ownerUserId?: string;
    projects: CanonicalLocalProject[];
    requestId: string;
    rootDir?: string;
  },
  dependencies: DiscoveryDependencies = {}
): Promise<LocalProjectControlDiscoverProjectsResponse> {
  if (input.projects.length > MAX_PROJECTS) {
    throw new Error("Local Project discovery accepts at most 500 Projects.");
  }
  const now = dependencies.now ?? Date.now;
  const deadlineMs = now() + (dependencies.budgetMs ?? DISCOVERY_BUDGET_MS);
  const localState = await readLocalDiscoveryState({
    deadlineMs,
    expectedOrganizationId: input.expectedOrganizationId,
    ownerUserId: input.ownerUserId,
    now,
    onDiagnostic: dependencies.onDiagnostic,
    rootDir: input.rootDir,
  });
  if (localState.status === "timed_out") {
    return buildDiscoveryResponse({
      candidates: [],
      checkedAtMs: input.checkedAtMs ?? now(),
      clientGeneration: input.clientGeneration,
      connectionsByProject: new Map(),
      deviceId: input.deviceId,
      gitStatus: "timed_out",
      projects: input.projects,
      requestId: input.requestId,
    });
  }
  const { bindings, connectionsByProject } = localState;
  if (input.includeCandidates === false) {
    return buildDiscoveryResponse({
      candidates: [],
      checkedAtMs: input.checkedAtMs ?? now(),
      clientGeneration: input.clientGeneration,
      connectionsByProject,
      deviceId: input.deviceId,
      gitStatus: "not_checked",
      projects: input.projects,
      requestId: input.requestId,
    });
  }
  const verifier = (dependencies.createVerifier ?? createGitRepositoryVerifier)(
    { deadlineMs, now }
  );
  let gitStatus = await runWithinDeadline(
    () => verifier.checkAvailability(),
    deadlineMs,
    now
  ).catch((error: unknown) =>
    error instanceof DiscoveryDeadlineExceededError
      ? ("timed_out" as const)
      : ("unavailable" as const)
  );
  const candidatesByPath = new Map<string, LocalProjectControlCandidate>();

  if (gitStatus === "available") {
    const collected = await collectCandidateSources({
      bindings,
      deadlineMs,
      dependencies,
      homeDir: input.homeDir,
      now,
    });
    gitStatus = collected.gitStatus;
    if (gitStatus === "available") {
      gitStatus = await collectVerifiedCandidates({
        candidatesByPath,
        deadlineMs,
        initialGitStatus: gitStatus,
        now,
        onDiagnostic: dependencies.onDiagnostic,
        sources: collected.sources,
        verifier,
      });
    }
  }

  return buildDiscoveryResponse({
    candidates: [...candidatesByPath.values()],
    checkedAtMs: input.checkedAtMs ?? now(),
    clientGeneration: input.clientGeneration,
    connectionsByProject,
    deviceId: input.deviceId,
    gitStatus,
    projects: input.projects,
    requestId: input.requestId,
  });
}

async function readLocalDiscoveryState(input: {
  deadlineMs: number;
  expectedOrganizationId: string;
  ownerUserId?: string;
  now: () => number;
  onDiagnostic?: DiscoveryDependencies["onDiagnostic"];
  rootDir?: string;
}): Promise<
  | {
      bindings: ProjectBinding[];
      connectionsByProject: Awaited<
        ReturnType<typeof inspectConnectionAvailability>
      >;
      status: "ready";
    }
  | { status: "timed_out" }
> {
  try {
    const allBindings = await runWithinDeadline(
      () =>
        listProjectBindings({
          organizationId: input.expectedOrganizationId,
          rootDir: input.rootDir,
        }),
      input.deadlineMs,
      input.now
    );
    const bindings = allBindings.filter((binding) =>
      isProjectConnectionUsableByOwner(binding, input.ownerUserId)
    );
    const connectionsByProject = await runWithinDeadline(
      () =>
        inspectConnectionAvailability(bindings, {
          onDiagnostic: input.onDiagnostic,
        }),
      input.deadlineMs,
      input.now
    );
    return { bindings, connectionsByProject, status: "ready" };
  } catch (error) {
    if (error instanceof DiscoveryDeadlineExceededError) {
      return { status: "timed_out" };
    }
    throw error;
  }
}

async function collectCandidateSources(input: {
  bindings: ProjectBinding[];
  deadlineMs: number;
  dependencies: DiscoveryDependencies;
  homeDir?: string;
  now: () => number;
}): Promise<{
  gitStatus: "available" | "timed_out";
  sources: CandidateSource[];
}> {
  const abortController = new AbortController();
  let results: [PromiseSettledResult<string[]>, PromiseSettledResult<string[]>];
  try {
    results = await Promise.allSettled([
      runWithinDeadline(
        () =>
          (
            input.dependencies.collectSessionWorkingDirectories ??
            ((signal?: AbortSignal) =>
              collectObservedSessionWorkingDirectories({
                homeDir: input.homeDir,
                signal,
              }))
          )(abortController.signal),
        input.deadlineMs,
        input.now
      ),
      runWithinDeadline(
        () =>
          (
            input.dependencies.collectProfileWorkspacePaths ??
            collectProfileWorkspaceCandidatePaths
          )(abortController.signal),
        input.deadlineMs,
        input.now
      ),
    ]);
  } finally {
    abortController.abort(new DiscoveryDeadlineExceededError());
  }
  const [sessionPathsResult, profileWorkspacePathsResult] = results;
  for (const result of results) {
    if (
      result.status === "rejected" &&
      !(result.reason instanceof DiscoveryDeadlineExceededError)
    ) {
      reportDiscoveryDiagnostic(input.dependencies, {
        code: "metadata_source_failed",
        error: result.reason,
      });
    }
  }
  const sessionPaths =
    sessionPathsResult.status === "fulfilled" ? sessionPathsResult.value : [];
  const profileWorkspacePaths =
    profileWorkspacePathsResult.status === "fulfilled"
      ? profileWorkspacePathsResult.value
      : [];
  return {
    gitStatus: results.some(isDeadlineRejection) ? "timed_out" : "available",
    sources: [
      ...input.bindings.map((binding) => ({
        confirmedRepository: true,
        kind: "repository" as const,
        path: binding.repositoryPath,
      })),
      ...sessionPaths.map((path) => ({
        confirmedRepository: false,
        kind: "repository" as const,
        path,
      })),
      ...profileWorkspacePaths.map((path) => ({
        confirmedRepository: false,
        kind: "repository" as const,
        path,
      })),
    ],
  };
}

function buildDiscoveryResponse(input: {
  candidates: LocalProjectControlCandidate[];
  checkedAtMs: number;
  clientGeneration: number;
  connectionsByProject: Awaited<
    ReturnType<typeof inspectConnectionAvailability>
  >;
  deviceId: string;
  gitStatus: LocalProjectControlGitStatus;
  projects: CanonicalLocalProject[];
  requestId: string;
}): LocalProjectControlDiscoverProjectsResponse {
  const response = {
    checkedAtMs: input.checkedAtMs,
    clientGeneration: input.clientGeneration,
    deviceId: input.deviceId,
    gitStatus: input.gitStatus,
    projects: input.projects.map((project) =>
      buildProjectDiscovery({
        candidates: input.candidates,
        connections: input.connectionsByProject.get(project.projectId) ?? [],
        gitStatus: input.gitStatus,
        project,
      })
    ),
    requestId: input.requestId,
  };
  const parsed =
    localProjectControlDiscoverProjectsResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("Local Project discovery produced an invalid response.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function inspectConnectionAvailability(
  bindings: readonly ProjectBinding[],
  dependencies: Pick<DiscoveryDependencies, "onDiagnostic"> = {}
): Promise<
  Map<
    string,
    Array<{
      bindingGeneration: string;
      isDefault: boolean;
      path: string;
      status: "available" | "missing";
    }>
  >
> {
  const byProject = new Map<
    string,
    Array<{
      bindingGeneration: string;
      isDefault: boolean;
      path: string;
      status: "available" | "missing";
    }>
  >();
  await Promise.all(
    bindings.map(async (binding) => {
      const metadata = await stat(binding.repositoryPath).catch(
        (error: unknown) => {
          if (!isMissingPathError(error)) {
            reportDiscoveryDiagnostic(dependencies, {
              code: "connection_status_failed",
              error,
            });
          }
          return null;
        }
      );
      const connection = {
        bindingGeneration: binding.bindingGeneration,
        isDefault: binding.isDefault,
        path: binding.repositoryPath,
        status: metadata?.isDirectory()
          ? ("available" as const)
          : ("missing" as const),
      };
      const connections = byProject.get(binding.projectId) ?? [];
      connections.push(connection);
      byProject.set(binding.projectId, connections);
    })
  );
  for (const connections of byProject.values()) {
    connections.sort(
      (left, right) => Number(right.isDefault) - Number(left.isDefault)
    );
  }
  return byProject;
}

async function collectVerifiedCandidates(input: {
  candidatesByPath: Map<string, LocalProjectControlCandidate>;
  deadlineMs: number;
  initialGitStatus: LocalProjectControlGitStatus;
  now: () => number;
  onDiagnostic?: DiscoveryDependencies["onDiagnostic"];
  sources: CandidateSource[];
  verifier: GitRepositoryVerifier;
}): Promise<LocalProjectControlGitStatus> {
  const inspectedSourcePaths = new Set<string>();
  const worktreesListedFor = new Set<string>();
  for (const source of input.sources) {
    if (input.now() >= input.deadlineMs) {
      return "timed_out";
    }
    if (inspectedSourcePaths.has(source.path)) {
      continue;
    }
    inspectedSourcePaths.add(source.path);
    let outcome: LocalProjectControlGitStatus | null;
    try {
      outcome = await inspectCandidateSource({
        candidatesByPath: input.candidatesByPath,
        deadlineMs: input.deadlineMs,
        now: input.now,
        onDiagnostic: input.onDiagnostic,
        source,
        sources: input.sources,
        verifier: input.verifier,
        worktreesListedFor,
      });
    } catch (error) {
      if (error instanceof DiscoveryDeadlineExceededError) {
        return "timed_out";
      }
      throw error;
    }
    if (outcome !== null) {
      return outcome;
    }
  }
  return input.initialGitStatus;
}

async function inspectCandidateSource(input: {
  candidatesByPath: Map<string, LocalProjectControlCandidate>;
  deadlineMs: number;
  now: () => number;
  onDiagnostic?: DiscoveryDependencies["onDiagnostic"];
  source: CandidateSource;
  sources: CandidateSource[];
  verifier: GitRepositoryVerifier;
  worktreesListedFor: Set<string>;
}): Promise<LocalProjectControlGitStatus | null> {
  const metadata = await runWithinDeadline(
    () => stat(input.source.path),
    input.deadlineMs,
    input.now
  ).catch((error: unknown) => {
    if (error instanceof DiscoveryDeadlineExceededError) {
      throw error;
    }
    if (!isMissingPathError(error)) {
      reportDiscoveryDiagnostic(input, {
        code: "candidate_source_failed",
        error,
      });
    }
    return null;
  });
  if (!metadata?.isDirectory()) {
    return null;
  }
  try {
    await runWithinDeadline(
      () => access(input.source.path, constants.R_OK),
      input.deadlineMs,
      input.now
    );
  } catch (error) {
    if (error instanceof DiscoveryDeadlineExceededError) {
      return "timed_out";
    }
    reportDiscoveryDiagnostic(input, {
      code: "candidate_source_failed",
      error,
    });
    return null;
  }
  try {
    const repository = await runWithinDeadline(
      () => input.verifier.inspectRepository(input.source.path),
      input.deadlineMs,
      input.now
    );
    recordVerifiedCandidate({
      candidatesByPath: input.candidatesByPath,
      repository,
      sourceKind: input.source.kind,
    });
    await appendConfirmedRepositoryWorktrees({
      deadlineMs: input.deadlineMs,
      now: input.now,
      repositoryPath: repository.canonicalPath,
      shouldList:
        input.source.confirmedRepository &&
        !input.worktreesListedFor.has(repository.canonicalPath),
      sources: input.sources,
      verifier: input.verifier,
      worktreesListedFor: input.worktreesListedFor,
    });
    return null;
  } catch (error) {
    if (error instanceof DiscoveryDeadlineExceededError) {
      return "timed_out";
    }
    if (error instanceof NotGitRepositoryError) {
      return null;
    }
    if (
      error instanceof GitVerificationUnavailableError &&
      error.status !== "unavailable"
    ) {
      return error.status;
    }
    reportDiscoveryDiagnostic(input, {
      code: "candidate_source_failed",
      error,
    });
    return null;
  }
}

function recordVerifiedCandidate(input: {
  candidatesByPath: Map<string, LocalProjectControlCandidate>;
  repository: Awaited<ReturnType<GitRepositoryVerifier["inspectRepository"]>>;
  sourceKind: CandidateSource["kind"];
}): void {
  if (!input.repository.repositoryFingerprint) {
    return;
  }
  const existing = input.candidatesByPath.get(input.repository.canonicalPath);
  input.candidatesByPath.set(input.repository.canonicalPath, {
    candidateId: buildLocalProjectCandidateId(
      input.repository.canonicalPath,
      input.repository.repositoryFingerprint
    ),
    candidateKind:
      existing?.candidateKind === "worktree" || input.sourceKind === "worktree"
        ? "worktree"
        : "repository",
    canonicalPath: input.repository.canonicalPath,
    repositoryFingerprint: input.repository.repositoryFingerprint,
  });
}

async function appendConfirmedRepositoryWorktrees(input: {
  deadlineMs: number;
  now: () => number;
  repositoryPath: string;
  shouldList: boolean;
  sources: CandidateSource[];
  verifier: GitRepositoryVerifier;
  worktreesListedFor: Set<string>;
}): Promise<void> {
  if (!input.shouldList) {
    return;
  }
  input.worktreesListedFor.add(input.repositoryPath);
  const worktrees = await runWithinDeadline(
    () => input.verifier.listWorktrees(input.repositoryPath),
    input.deadlineMs,
    input.now
  );
  for (const worktreePath of worktrees) {
    if (worktreePath !== input.repositoryPath) {
      input.sources.push({
        confirmedRepository: false,
        kind: "worktree",
        path: worktreePath,
      });
    }
  }
}

function isDeadlineRejection(result: PromiseSettledResult<unknown>): boolean {
  return (
    result.status === "rejected" &&
    result.reason instanceof DiscoveryDeadlineExceededError
  );
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );
}

function reportDiscoveryDiagnostic(
  dependencies: Pick<DiscoveryDependencies, "onDiagnostic">,
  input: { code: DiscoveryDiagnostic["code"]; error: unknown }
): void {
  const diagnostic: DiscoveryDiagnostic = {
    code: input.code,
    errorCode:
      input.error && typeof input.error === "object" && "code" in input.error
        ? String(input.error.code)
        : null,
    errorName: input.error instanceof Error ? input.error.name : "UnknownError",
  };
  if (dependencies.onDiagnostic) {
    dependencies.onDiagnostic(diagnostic);
    return;
  }
  process.stderr.write(
    `[openmeld.local_project_discovery.${diagnostic.code}] ${JSON.stringify(diagnostic)}\n`
  );
}

async function runWithinDeadline<T>(
  operation: () => Promise<T>,
  deadlineMs: number,
  now: () => number
): Promise<T> {
  const remainingMs = deadlineMs - now();
  if (remainingMs <= 0) {
    throw new DiscoveryDeadlineExceededError();
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DiscoveryDeadlineExceededError()),
      remainingMs
    );
    timer.unref();
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildProjectDiscovery(input: {
  candidates: LocalProjectControlCandidate[];
  connections: Array<{
    bindingGeneration: string;
    isDefault: boolean;
    path: string;
    status: "available" | "missing";
  }>;
  gitStatus: LocalProjectControlGitStatus;
  project: CanonicalLocalProject;
}): LocalProjectControlProjectDiscovery {
  const connectionPaths = new Set(
    input.connections.map((connection) => connection.path)
  );
  const candidates = input.project.repositoryFingerprint
    ? input.candidates.filter(
        (candidate) =>
          candidate.repositoryFingerprint ===
            input.project.repositoryFingerprint &&
          !connectionPaths.has(candidate.canonicalPath)
      )
    : [];
  if (input.connections.length > 0) {
    const defaultConnection = input.connections.find(
      (connection) => connection.isDefault
    );
    return {
      candidates,
      connections: input.connections,
      projectId: input.project.projectId,
      status:
        defaultConnection?.status === "available"
          ? "connected"
          : "connected_folder_missing",
    };
  }
  if (input.gitStatus !== "available") {
    return {
      candidates: [],
      connections: [],
      projectId: input.project.projectId,
      status:
        input.gitStatus === "not_checked"
          ? "not_connected"
          : "verification_unavailable",
    };
  }
  if (candidates.length > 0) {
    return {
      candidates,
      connections: [],
      projectId: input.project.projectId,
      status: "found",
    };
  }
  return {
    candidates: [],
    connections: [],
    projectId: input.project.projectId,
    status: "not_found",
  };
}

export function buildLocalProjectCandidateId(
  path: string,
  repositoryFingerprint: string
): string {
  return `candidate-${createHash("sha256")
    .update(`${path}\0${repositoryFingerprint}`)
    .digest("hex")}`;
}
