import type { SignalEnvelope } from "@openmeld/protocol";
import type {
  OpenMeldRequestContext,
  ProjectIssueDestination,
  ResolveProjectIssueActionResponse,
} from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { resolveSpaceStub } from "../rpc/space-ref";
import type { ProjectIssueRoutingCandidate } from "./project-repository";

type Candidate = ProjectIssueRoutingCandidate;
const REQUEST_LINE_BREAK_PATTERN = /\r?\n/gu;
const CODE_FENCE_PATTERN = /^\s*```/u;
const QUOTED_LINE_PATTERN = /^\s*>/u;
const URL_PATTERN = /https?:\/\/\S+/giu;
const WORD_CHARACTER_PATTERN = /[a-z0-9]/iu;
const GITHUB_REPOSITORY_URL_PATTERN =
  /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/giu;
const REGEX_SPECIAL_CHARACTER_PATTERN = /[.*+?^${}()|[\]\\]/gu;
const GIT_SUFFIX_PATTERN = /\.git$/iu;
const EXPLICIT_ISSUE_PROVIDER_PATTERNS = [
  /(?:\b(?:create|file|open|raise|log|track)\b|创建|新建|提交)\s+(?:(?:a|an|the)\s+)?(github|linear)\s+(?:issue|ticket|bug)\b/giu,
  /(?:\b(?:create|file|open|raise|log|track)\b|创建|新建|提交).{0,45}(?:\b(?:issue|ticket|bug)\b|工单|问题).{0,65}(?:\b(?:in|on|to)\s+(?:(?:the|this|that)\s+)?|在|到)(?:\s|这个|该)*(github|linear)\b/giu,
] as const;

export async function readLocalProjectIssueRequestText(input: {
  context: OpenMeldRequestContext;
  dispatchId: string | null;
  env: CoreBindings;
  sourceSignalId: string | null;
  sourceSpaceId: string | null;
  targetProfileId: string;
}): Promise<string> {
  if (!(input.dispatchId && input.sourceSignalId && input.sourceSpaceId)) {
    throw routingError(
      "project.issue_request_unavailable",
      "The original Wake request is unavailable for this issue action."
    );
  }
  const stub = resolveSpaceStub(
    input.env.OPENMELD_SPACES,
    input.sourceSpaceId
  ) as {
    rpcListSignalsResult(request: {
      afterCount: number;
      aroundSignalId: string;
      beforeCount: number;
      signalTypes: readonly ["signal.text"];
      spaceAccess: ReturnType<
        typeof createDispatchContinuationSpaceAccessContext
      >;
      spaceId: string;
    }): Promise<
      { ok: true; value: { signals: SignalEnvelope[] } } | { ok: false }
    >;
  } | null;
  if (!stub) {
    throw routingError(
      "project.issue_request_unavailable",
      "The original Space request is unavailable for this issue action."
    );
  }
  const result = await stub.rpcListSignalsResult({
    afterCount: 0,
    aroundSignalId: input.sourceSignalId,
    beforeCount: 1,
    signalTypes: ["signal.text"],
    spaceAccess: createDispatchContinuationSpaceAccessContext({
      dispatchId: input.dispatchId,
      requestContext: input.context,
      sourceSignalId: input.sourceSignalId,
      spaceId: input.sourceSpaceId,
      targetProfileId: input.targetProfileId,
    }),
    spaceId: input.sourceSpaceId,
  });
  if (!result.ok) {
    throw routingError(
      "project.issue_request_unavailable",
      "The original Space request could not be verified."
    );
  }
  const signal = result.value.signals.find(
    (candidate: SignalEnvelope) => candidate.id === input.sourceSignalId
  );
  if (signal?.type !== "signal.text" || !signal.data.text.trim()) {
    throw routingError(
      "project.issue_request_unavailable",
      "The original issue request is unavailable."
    );
  }
  return signal.data.text;
}

export function resolveProjectIssueAction(input: {
  projects: Candidate[];
  proposedDestination: ProjectIssueDestination;
  requestText: string;
  taskProjectIds?: string[];
}): ResolveProjectIssueActionResponse {
  const requestText = readTopLevelRequestText(input.requestText);
  if (!requestText) {
    throw routingError(
      "project.issue_request_unavailable",
      "The original issue request is unavailable. Ask the requester for its destination."
    );
  }
  const referencedRepositories = readGitHubRepositories(requestText);
  const candidates = selectProjectCandidates({
    projects: input.projects,
    referencedRepositories,
    requestText,
    taskProjectIds: input.taskProjectIds,
  });
  if (candidates.length > 1) {
    throw routingError(
      "project.issue_project_ambiguous",
      `Choose the Project for this issue: ${candidates.map((project) => project.name).join(", ")}.`
    );
  }
  const project = candidates[0] ?? null;
  const explicitProvider = readExplicitIssueProvider(requestText);
  if (explicitProvider === "ambiguous") {
    throw routingError(
      "project.issue_destination_ambiguous",
      "The request names both GitHub and Linear for a new issue. Choose one destination."
    );
  }
  if (explicitProvider) {
    if (input.proposedDestination.provider !== explicitProvider) {
      throw routingError(
        "project.issue_destination_mismatch",
        `The requester asked for ${explicitProvider}. Use that provider for this issue.`
      );
    }
    assertExplicitTarget({
      destination: input.proposedDestination,
      project,
      referencedRepositories,
      requestText,
    });
    return {
      basis: "explicit_request",
      destination: input.proposedDestination,
      projectId: project?.id ?? null,
      projectRevision: null,
    };
  }
  const configured = project?.routing.destination;
  if (configured) {
    if (!sameDestination(configured, input.proposedDestination)) {
      throw routingError(
        "project.issue_destination_mismatch",
        `New issues for ${project.name} go to ${describeDestination(configured)}. Use that exact target or ask the requester to choose another. A GitHub PR cited as background is not a destination override.`
      );
    }
    return {
      basis: "project_default",
      destination: configured,
      projectId: project.id,
      projectRevision: project.routing.revision,
    };
  }
  if (
    hasGitHubObjectTarget(
      input.proposedDestination,
      referencedRepositories,
      requestText
    )
  ) {
    return {
      basis: "object_context",
      destination: input.proposedDestination,
      projectId: project?.id ?? null,
      projectRevision: null,
    };
  }
  throw routingError(
    "project.issue_destination_unresolved",
    "The issue destination is not established by the request or a Project default. Ask for the exact provider and target."
  );
}

function selectProjectCandidates(input: {
  projects: Candidate[];
  referencedRepositories: string[];
  requestText: string;
  taskProjectIds?: string[];
}): Candidate[] {
  const namedProjects = input.projects.filter((project) =>
    namesProject(input.requestText, project)
  );
  if (namedProjects.length > 0) {
    return namedProjects;
  }
  const taskProjects = input.projects.filter((project) =>
    input.taskProjectIds?.includes(project.id)
  );
  const repositoryProjects = input.projects.filter((project) =>
    (
      project.repositoryUrls ??
      (project.repositoryUrl ? [project.repositoryUrl] : [])
    ).some((url) =>
      input.referencedRepositories.includes(
        canonicalGitHubRepository(url) ?? ""
      )
    )
  );
  if (repositoryProjects.length === 0) {
    return taskProjects;
  }
  if (taskProjects.length === 0) {
    return repositoryProjects;
  }
  const overlap = repositoryProjects.filter((project) =>
    taskProjects.some((taskProject) => taskProject.id === project.id)
  );
  return overlap.length > 0 ? overlap : taskProjects;
}

function hasGitHubObjectTarget(
  destination: ProjectIssueDestination,
  referencedRepositories: string[],
  requestText: string
): boolean {
  if (destination.provider !== "github") {
    return false;
  }
  const target = `${destination.owner}/${destination.repo}`;
  if (referencedRepositories.length === 1) {
    return referencedRepositories[0] === target.toLowerCase();
  }
  return (
    referencedRepositories.length === 0 &&
    isDirectGitHubIssueTarget(requestText, target)
  );
}

function readTopLevelRequestText(value: string): string {
  let inCodeFence = false;
  const lines: string[] = [];
  for (const line of value.split(REQUEST_LINE_BREAK_PATTERN)) {
    if (CODE_FENCE_PATTERN.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || QUOTED_LINE_PATTERN.test(line)) {
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n").trim();
}

function assertExplicitTarget(input: {
  destination: ProjectIssueDestination;
  project: Candidate | null;
  referencedRepositories: string[];
  requestText: string;
}): void {
  if (input.destination.provider === "github") {
    const target = canonicalGitHubRepository(
      `https://github.com/${input.destination.owner}/${input.destination.repo}`
    );
    if (
      target &&
      (input.referencedRepositories.includes(target) ||
        mentionsExactRepository(input.requestText, target) ||
        (
          input.project?.repositoryUrls ??
          (input.project?.repositoryUrl ? [input.project.repositoryUrl] : [])
        ).some((url) => canonicalGitHubRepository(url) === target))
    ) {
      return;
    }
  } else if (
    input.requestText
      .toLowerCase()
      .includes(input.destination.teamId.toLowerCase()) ||
    (input.project?.routing.destination?.provider === "linear" &&
      sameDestination(input.project.routing.destination, input.destination))
  ) {
    return;
  }
  throw routingError(
    "project.issue_target_unresolved",
    "The requester named a provider, but the exact issue target cannot be verified. Ask for the repository or Linear team."
  );
}

function readExplicitIssueProvider(
  text: string
): "github" | "linear" | "ambiguous" | null {
  const matches: Array<"github" | "linear"> = [];
  for (const pattern of EXPLICIT_ISSUE_PROVIDER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      matches.push(match[1]?.toLowerCase() === "github" ? "github" : "linear");
    }
  }
  const providers = new Set(matches);
  if (providers.size > 1) {
    return "ambiguous";
  }
  return matches[0] ?? null;
}

function namesProject(text: string, project: Candidate): boolean {
  const haystack = text.replace(URL_PATTERN, " ").toLocaleLowerCase("en-US");
  return [project.name, project.slug].some((name) => {
    const needle = name.toLocaleLowerCase("en-US");
    const index = haystack.indexOf(needle);
    if (index < 0) {
      return false;
    }
    return (
      (index === 0 ||
        !WORD_CHARACTER_PATTERN.test(haystack[index - 1] ?? "")) &&
      (index + needle.length === haystack.length ||
        !WORD_CHARACTER_PATTERN.test(haystack[index + needle.length] ?? ""))
    );
  });
}

function readGitHubRepositories(text: string): string[] {
  const repositories = new Set<string>();
  for (const match of text.matchAll(GITHUB_REPOSITORY_URL_PATTERN)) {
    const repository = canonicalGitHubRepository(
      `https://github.com/${match[1]}/${match[2]}`
    );
    if (repository) {
      repositories.add(repository);
    }
  }
  return [...repositories];
}

function mentionsExactRepository(text: string, repository: string): boolean {
  const escaped = repository.replace(REGEX_SPECIAL_CHARACTER_PATTERN, "\\$&");
  return new RegExp(
    `(?:^|[^a-z0-9_.-])${escaped}(?:$|[^a-z0-9_.-])`,
    "iu"
  ).test(text);
}

function isDirectGitHubIssueTarget(text: string, repository: string): boolean {
  const escaped = repository.replace(REGEX_SPECIAL_CHARACTER_PATTERN, "\\$&");
  return new RegExp(
    `(?:issue|ticket|bug).{0,65}\\b(?:in|on|to)\\s+(?:(?:the|this)\\s+)?(?:github\\s+)?${escaped}(?:$|[^a-z0-9_.-])`,
    "iu"
  ).test(text);
}

function canonicalGitHubRepository(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com") {
      return null;
    }
    const [owner, repository] = url.pathname.split("/").filter(Boolean);
    return owner && repository
      ? `${owner.toLowerCase()}/${repository.replace(GIT_SUFFIX_PATTERN, "").toLowerCase()}`
      : null;
  } catch {
    return null;
  }
}

function sameDestination(
  a: ProjectIssueDestination,
  b: ProjectIssueDestination
): boolean {
  if (a.provider !== b.provider) {
    return false;
  }
  return a.provider === "github" && b.provider === "github"
    ? a.owner.toLowerCase() === b.owner.toLowerCase() &&
        a.repo.toLowerCase() === b.repo.toLowerCase()
    : a.provider === "linear" &&
        b.provider === "linear" &&
        a.teamId === b.teamId &&
        a.projectId === b.projectId;
}

function describeDestination(destination: ProjectIssueDestination): string {
  return destination.provider === "github"
    ? `GitHub ${destination.owner}/${destination.repo}`
    : `Linear team ${destination.teamId}${destination.projectId ? ` project ${destination.projectId}` : ""}`;
}

function routingError(code: string, reason: string): Error {
  return createCoreRpcHttpError({ code, reason, status: 409 });
}
