import { basename, isAbsolute, resolve } from "node:path";
import process from "node:process";
import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import {
  createOpenMeldAgentProfile,
  listOpenMeldProfiles,
} from "../config/openmeld-profiles-api";
import { submitRuntimeAgentControllerReport } from "../local-service/reporting/runtime-agent-controller-reporting-submission";
import { resolveAgentControllerPermissionModeInput } from "../profile/controller-permission-mode-input";
import { describeProfileWorkspacePathValidationFailure } from "../profile-workspace/custom-path";
import {
  normalizeCustomProfileWorkspacePath,
  readProfileWorkspaceConfig,
  resolveConfiguredProfileWorkspacePath,
  setCustomProfileWorkspace,
  validateCustomProfileWorkspacePath,
} from "../profile-workspace/service";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { canUseInteractivePrompts } from "../runtime/interaction";
import type { Presenter } from "../runtime/presenter";
import { updateAgentProfilePrimaryBindingAgentControllerPermissionMode } from "../system/agent-profile-binding-agent-controller-permission-mode";
import {
  type AgentProfilePrimaryAgentControllerReport,
  resolveAgentProfilePrimaryAgentControllerReport,
} from "../system/agent-profile-primary-binding";
import { ensureAgentProfileRuntimeBinding } from "../system/ensure-agent-profile-runtime-binding";
import { createPrimaryBindingReadSession } from "../system/primary-binding-read-session";
import type {
  SpaceAddMeMembershipInput,
  SpaceAddMeMembershipRunner,
} from "./add-me-membership";
import { SPACE_ADD_MEMBERS_PROGRESS_HEARTBEAT_MS } from "./add-members-progress-contract";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  type DetectedLocalAgentEnvironment,
  detectLocalAgentEnvironment,
} from "./local-agent-environment";
import type { SpaceCommandNavigationStatus } from "./navigation-status";
import { parseSpaceTarget } from "./space-target";

const SHELL_SAFE_ARG_REGEX = /^[A-Za-z0-9_./:=@%+-]+$/u;

export type SpaceAddMeProjectFolderInput = {
  cwd?: readonly string[] | string;
  projectFolder?: readonly string[] | string;
  workingDirectory?: readonly string[] | string;
  workspacePath?: readonly string[] | string;
};

type SpaceAddMeDetectedSubject = DetectedLocalAgentEnvironment;

type NormalizedProjectFolder = {
  path: string;
  provided: boolean;
  resolvedRelativeInput?: string;
  source: string;
};

type AgentProfileResolution = {
  bindingOutcome: "created" | "reused" | "reconnected" | "updated";
  bindingStatus: string;
  profile: OpenMeldProfile;
  profileAction: "created" | "reused";
  projectFolderAction: "created" | "reused";
};

type SpaceAddMeProgressPhase = "prepare_agent_profile";

export async function runSpaceAddMe(input: {
  addMembers?: SpaceAddMeMembershipRunner;
  baseUrl?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  agentControllerPermissionModeInput?: string;
  details?: boolean;
  entryChecksHandled?: boolean;
  env?: NodeJS.ProcessEnv;
  json?: boolean;
  password?: string;
  profile?: string;
  projectFolders?: SpaceAddMeProjectFolderInput;
  space: string;
  view?: string;
  workingDirectory?: string;
}): Promise<SpaceCommandNavigationStatus> {
  const target = parseSpaceAddMeTarget(input.space);
  const profile = resolveSpaceAddMeActingProfileId({
    cliProfileId: input.profile,
    urlProfileId: target.profileId,
  });
  const baseUrl = input.baseUrl ?? target.baseUrl;
  const hasExplicitBaseUrlInput = normalizeOptionalString(baseUrl) !== null;

  const context = await prepareAuthenticatedSpaceCommandContext({
    profile,
    baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "adding yourself to a space"
    ),
    checkGatewayMismatch: hasExplicitBaseUrlInput,
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return "cancelled";
  }
  const { runtime, presenter, baseUrl: resolvedBaseUrl } = context;
  const interactive = canUseInteractivePrompts(runtime);
  assertValidSpaceIdTarget({
    space: target.spaceId,
    resolvedView: runtime.resolvedView,
  });

  const actorProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const detectedSubject = detectSpaceAddMeSubject(input.env ?? process.env);
  if (detectedSubject.kind === "codex_missing_thread") {
    throw new Error(
      "This looks like Codex, but OpenMeld cannot find CODEX_THREAD_ID. `openmeld space add-me` will not pretend to bind an unknown Codex thread. Open this task in a Codex Desktop session that exposes CODEX_THREAD_ID, or run the command from a non-Codex shell to use the Human Profile path."
    );
  }
  const addMembers = input.addMembers ?? runDefaultSpaceAddMeMembership;

  if (detectedSubject.kind === "human") {
    const projectFolderInput = collectProjectFolderCandidates(
      input.projectFolders
    );
    if (projectFolderInput.length > 0) {
      throw new Error(
        "--project-folder is only used when OpenMeld detects a local agent controller. Human Profile membership does not use a Project folder."
      );
    }
    if (actorProfile.profileKind !== "human") {
      throw new Error(
        `No current local agent controller was detected, so add-me is using the Human Profile path. Profile ${actorProfile.openMeldProfileId} is an Agent Profile; pass a Human Profile with --profile or run from a supported agent controller.`
      );
    }
    const status = await addMembers({
      mode: "human_profiles",
      profile: actorProfile.openMeldProfileId,
      baseUrl: resolvedBaseUrl,
      space: target.spaceId,
      password: input.password,
      members: [actorProfile.openMeldProfileId],
      allowCurrentProfileMember: true,
      suppressResultOutput: true,
      details: input.details === true,
      view: input.view,
      entryChecksHandled: true,
    });
    if (status !== "completed") {
      return status;
    }
    emitSpaceAddMeResult({
      actorProfile,
      details: input.details === true,
      json: input.json === true,
      presenter,
      result: {
        actorProfileId: actorProfile.openMeldProfileId,
        membershipProfileId: actorProfile.openMeldProfileId,
        membershipProfileKind: "human",
        projectFolder: null,
        profileAction: "reused",
        spaceId: target.spaceId,
      },
    });
    return "completed";
  }

  if (actorProfile.profileKind !== "human") {
    throw new Error(
      "`openmeld space add-me` detected a local agent controller, but --profile / selected profile must be a Human Profile because OpenMeld uses it as the signed-in user's acting identity; pass a Human Profile with --profile."
    );
  }

  const projectFolder = normalizeSpaceAddMeProjectFolderInput(
    input.projectFolders ?? {},
    input.workingDirectory ?? process.cwd()
  );
  await validateProjectFolder(projectFolder.path);
  const controllerPermissionMode =
    await resolveAgentControllerPermissionModeInput({
      agentControllerRef: detectedSubject.agentControllerRef,
      allowPrompt: interactive,
      confirmDangerousAgentControllerPermissionMode:
        input.confirmDangerousAgentControllerPermissionMode,
      agentControllerPermissionModeInput:
        input.agentControllerPermissionModeInput,
      flagName: "--agent-controller-permission-mode",
    });
  const agentProfile = await runSpaceAddMeProgressHeartbeat({
    enabled: shouldEmitSpaceAddMeProgress({
      details: input.details === true,
      json: input.json === true,
      presenter,
    }),
    phase: "prepare_agent_profile",
    presenter,
    spaceId: target.spaceId,
    text: `Preparing ${detectedSubject.label} Agent Profile before the Space membership write...`,
    operation: async () =>
      await ensureCurrentAgentProfile({
        actorProfile,
        baseUrl: resolvedBaseUrl,
        controllerPermissionMode:
          controllerPermissionMode.agentControllerPermissionMode ?? null,
        detectedSubject,
        projectFolder,
        spaceId: target.spaceId,
      }),
  });

  const status = await addMembers({
    mode: "agents",
    profile: actorProfile.openMeldProfileId,
    baseUrl: resolvedBaseUrl,
    space: target.spaceId,
    password: input.password,
    members: [agentProfile.profile.openMeldProfileId],
    allowCurrentProfileMember:
      actorProfile.openMeldProfileId === agentProfile.profile.openMeldProfileId,
    suppressResultOutput: true,
    details: input.details === true,
    view: input.view,
    entryChecksHandled: true,
  });
  if (status !== "completed") {
    return status;
  }
  emitSpaceAddMeResult({
    actorProfile,
    details: input.details === true,
    json: input.json === true,
    presenter,
    result: {
      actorProfileId: actorProfile.openMeldProfileId,
      agentControllerConversationId:
        detectedSubject.agentControllerConversationId,
      agentControllerRef: detectedSubject.agentControllerRef,
      bindingOutcome: agentProfile.bindingOutcome,
      bindingStatus: agentProfile.bindingStatus,
      conversationKind: detectedSubject.conversationKind,
      membershipProfileId: agentProfile.profile.openMeldProfileId,
      membershipProfileKind: "agent",
      profileAction: agentProfile.profileAction,
      projectFolder: projectFolder.path,
      projectFolderAction: agentProfile.projectFolderAction,
      projectFolderSource: projectFolder.source,
      resolvedRelativeProjectFolder: projectFolder.resolvedRelativeInput,
      spaceId: target.spaceId,
    },
  });
  return "completed";
}

export const parseSpaceAddMeTarget = parseSpaceTarget;

export function resolveSpaceAddMeActingProfileId(input: {
  cliProfileId?: string | null;
  urlProfileId?: string | null;
}): string | undefined {
  const cliProfileId = normalizeOptionalString(input.cliProfileId);
  const urlProfileId = normalizeOptionalString(input.urlProfileId);
  if (cliProfileId && urlProfileId && cliProfileId !== urlProfileId) {
    throw new Error(
      `Space URL profileId (${urlProfileId}) conflicts with --profile (${cliProfileId}). Pass one Human Profile acting identity.`
    );
  }
  return urlProfileId ?? cliProfileId ?? undefined;
}

export function detectSpaceAddMeSubject(
  env: NodeJS.ProcessEnv
): SpaceAddMeDetectedSubject {
  return detectLocalAgentEnvironment(env);
}

export function normalizeSpaceAddMeProjectFolderInput(
  input: SpaceAddMeProjectFolderInput,
  cwd: string
): NormalizedProjectFolder {
  const values = collectProjectFolderCandidates(input);
  if (values.length === 0) {
    return {
      path: normalizeProjectFolderPath(cwd, cwd),
      provided: false,
      source: "current working directory",
    };
  }
  const normalized = values.map((value) => ({
    ...value,
    ...normalizeProjectFolderValue(value.value, cwd),
  }));
  const uniquePaths = new Set(normalized.map((value) => value.path));
  if (uniquePaths.size > 1) {
    const details = normalized
      .map((value) => `${value.flag} ${value.value} -> ${value.path}`)
      .join("; ");
    throw new Error(
      `Conflicting Project folder options: ${details}. Pass one Project folder path.`
    );
  }
  const [first] = normalized;
  if (!first) {
    throw new Error("Project folder path is required.");
  }
  return {
    path: first.path,
    provided: true,
    ...(first.resolvedRelativeInput
      ? { resolvedRelativeInput: first.resolvedRelativeInput }
      : {}),
    source: first.flag,
  };
}

async function ensureCurrentAgentProfile(input: {
  actorProfile: OpenMeldProfile;
  baseUrl: string;
  controllerPermissionMode: AgentControllerPermissionMode | null;
  detectedSubject: Extract<SpaceAddMeDetectedSubject, { kind: "agent" }>;
  projectFolder: NormalizedProjectFolder;
  spaceId: string;
}): Promise<AgentProfileResolution> {
  const existing = await findAgentProfileByControllerConversation({
    baseUrl: input.baseUrl,
    detectedSubject: input.detectedSubject,
  }).catch((error: unknown) => {
    throw formatSpaceAddMeBindingReadFailure({
      error,
      projectFolder: input.projectFolder,
      spaceId: input.spaceId,
    });
  });
  if (existing.length > 1) {
    throw new Error(
      `Multiple Agent Profiles are already bound to ${input.detectedSubject.agentControllerRef} conversation ${input.detectedSubject.agentControllerConversationId}. OpenMeld will not choose one automatically.`
    );
  }
  const [match] = existing;
  if (match) {
    const projectFolderAction = await ensureAgentProfileProjectFolder({
      profile: match.profile,
      projectFolder: input.projectFolder.path,
    });
    if (input.controllerPermissionMode) {
      await updateAgentProfilePrimaryBindingAgentControllerPermissionMode({
        agentControllerPermissionMode: input.controllerPermissionMode,
        profile: match.profile,
      });
    }
    return {
      bindingOutcome: input.controllerPermissionMode ? "updated" : "reused",
      bindingStatus: match.report.bindingState,
      profile: match.profile,
      profileAction: "reused",
      projectFolderAction,
    };
  }

  const profile = await createOpenMeldAgentProfile({
    profileName: buildAgentProfileName({
      detectedSubject: input.detectedSubject,
      projectFolder: input.projectFolder.path,
    }),
    creatorProfileId: input.actorProfile.openMeldProfileId,
  });
  await setCustomProfileWorkspace({
    openMeldProfileId: profile.openMeldProfileId,
    customWorkspacePath: input.projectFolder.path,
  });
  const runtimeReportSubmission = await submitRuntimeAgentControllerReport({
    agentControllerRef: input.detectedSubject.agentControllerRef,
    diagnosticProfileId: profile.openMeldProfileId,
    localParticipationState: "ready",
    reasonCodes: ["space.add_me.current_agent"],
  });
  const binding = await ensureAgentProfileRuntimeBinding({
    agentControllerConversationId:
      input.detectedSubject.agentControllerConversationId,
    ...(input.controllerPermissionMode
      ? { agentControllerPermissionMode: input.controllerPermissionMode }
      : {}),
    confirmLocalExecutionEvidence: false,
    profile,
    runtimeReportSubmission,
  });
  if (binding.status !== "accepted") {
    throw new Error(
      `Agent Profile Binding was not accepted for ${profile.openMeldProfileId}: ${binding.status}${binding.reason ? ` (${binding.reason})` : ""}.`
    );
  }
  return {
    bindingOutcome: binding.outcome ?? "created",
    bindingStatus: binding.status,
    profile,
    profileAction: "created",
    projectFolderAction: "created",
  };
}

async function findAgentProfileByControllerConversation(input: {
  baseUrl: string;
  detectedSubject: Extract<SpaceAddMeDetectedSubject, { kind: "agent" }>;
}): Promise<
  Array<{
    profile: OpenMeldProfile;
    report: AgentProfilePrimaryAgentControllerReport;
  }>
> {
  const profiles = (await listOpenMeldProfiles()).filter(
    (profile) => profile.profileKind === "agent" && profile.status === "active"
  );
  const bindingReads = createPrimaryBindingReadSession({
    baseUrl: input.baseUrl,
  });
  const reports = await Promise.all(
    profiles.map(async (profile) => {
      const report = await resolveAgentProfilePrimaryAgentControllerReport({
        baseUrl: input.baseUrl,
        bindingReads,
        profile,
      });
      if (!report) {
        return null;
      }
      return { profile, report };
    })
  );
  const matches: Array<{
    profile: OpenMeldProfile;
    report: AgentProfilePrimaryAgentControllerReport;
  }> = [];
  for (const candidate of reports) {
    if (!candidate) {
      continue;
    }
    const { profile, report } = candidate;
    const executionTarget = report?.primaryBinding.executionTarget;
    if (
      executionTarget?.agentControllerConversationId !==
      input.detectedSubject.agentControllerConversationId
    ) {
      continue;
    }
    if (
      report.agentControllerRef !== input.detectedSubject.agentControllerRef
    ) {
      throw new Error(
        `Agent Controller conversation ${input.detectedSubject.agentControllerConversationId} is already bound to ${profile.openMeldProfileId} through ${report.agentControllerRef}. OpenMeld will not reuse that conversation for ${input.detectedSubject.agentControllerRef}.`
      );
    }
    matches.push({ profile, report });
  }
  return matches;
}

function shouldEmitSpaceAddMeProgress(input: {
  details: boolean;
  json: boolean;
  presenter: Presenter;
}): boolean {
  return !input.json && (input.details || input.presenter.view === "agent");
}

async function runSpaceAddMeProgressHeartbeat<T>(input: {
  enabled: boolean;
  operation: () => Promise<T>;
  phase: SpaceAddMeProgressPhase;
  presenter: Presenter;
  spaceId: string;
  text: string;
}): Promise<T> {
  if (!input.enabled) {
    return await input.operation();
  }
  const timer = setInterval(() => {
    input.presenter.line({
      code: "space.add_me.progress",
      text: input.text,
      data: {
        phase: input.phase,
        spaceId: input.spaceId,
      },
    });
  }, SPACE_ADD_MEMBERS_PROGRESS_HEARTBEAT_MS);
  if (
    typeof timer === "object" &&
    "unref" in timer &&
    typeof timer.unref === "function"
  ) {
    timer.unref();
  }
  try {
    return await input.operation();
  } finally {
    clearInterval(timer);
  }
}

function formatSpaceAddMeBindingReadFailure(input: {
  error: unknown;
  projectFolder: NormalizedProjectFolder;
  spaceId: string;
}): Error {
  const error = normalizeError(input.error);
  if (!isAgentProfileBindingReadTimeout(error)) {
    return error;
  }
  const statusCommand = formatOpenMeldCliCommand("openmeld service status");
  const retryCommand = formatOpenMeldCliCommand(
    `openmeld space add-me ${quoteShellArg(input.spaceId)} --project-folder ${quoteShellArg(input.projectFolder.path)}`
  );
  return new Error(
    `OpenMeld couldn't add you because it couldn't read Agent Profile Bindings, and no Space membership was changed. Run ${statusCommand}, then retry ${retryCommand}. Details: ${error.message}`
  );
}

function isAgentProfileBindingReadTimeout(error: Error): boolean {
  const code = (error as { code?: unknown }).code;
  return (
    error.message.includes("agent_profile_binding.primary.read") &&
    (code === "network.timeout" || error.message.includes("timed out"))
  );
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function quoteShellArg(value: string): string {
  if (SHELL_SAFE_ARG_REGEX.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function ensureAgentProfileProjectFolder(input: {
  profile: OpenMeldProfile;
  projectFolder: string;
}): Promise<"created" | "reused"> {
  const config = await readProfileWorkspaceConfig({
    openMeldProfileId: input.profile.openMeldProfileId,
  });
  if (config.status === "missing") {
    await setCustomProfileWorkspace({
      openMeldProfileId: input.profile.openMeldProfileId,
      customWorkspacePath: input.projectFolder,
    });
    return "created";
  }
  if (config.status === "invalid") {
    throw new Error(
      `Existing Project folder config for ${input.profile.openMeldProfileId} is invalid (${config.reason}) at ${config.path}.`
    );
  }
  const existingPath = normalizeCustomProfileWorkspacePath(
    await resolveConfiguredProfileWorkspacePath({
      openMeldProfileId: input.profile.openMeldProfileId,
      value: config.value,
    })
  );
  if (existingPath !== input.projectFolder) {
    throw new Error(
      `Agent Profile ${input.profile.openMeldProfileId} is already bound to Project folder ${existingPath} for this controller conversation. Refusing to reuse it for ${input.projectFolder}.`
    );
  }
  return "reused";
}

async function validateProjectFolder(projectFolder: string): Promise<void> {
  const validation = await validateCustomProfileWorkspacePath(projectFolder);
  if (validation.status === "invalid") {
    throw new Error(
      `Project folder is invalid: ${describeProfileWorkspacePathValidationFailure(
        {
          path: validation.path,
          reason: validation.reason,
        }
      )}`
    );
  }
}

function emitSpaceAddMeResult(input: {
  actorProfile: OpenMeldProfile;
  details: boolean;
  json: boolean;
  presenter: Presenter;
  result: {
    actorProfileId: string;
    agentControllerConversationId?: string;
    agentControllerRef?: string;
    bindingOutcome?: string;
    bindingStatus?: string;
    conversationKind?: string;
    membershipProfileId: string;
    membershipProfileKind: "agent" | "human";
    profileAction: "created" | "reused";
    projectFolder: string | null;
    projectFolderAction?: string;
    projectFolderSource?: string;
    resolvedRelativeProjectFolder?: string;
    spaceId: string;
  };
}): void {
  const nextCommand =
    input.result.membershipProfileKind === "agent"
      ? formatOpenMeldCliCommand(
          `openmeld space status ${input.result.spaceId} --profile ${input.result.membershipProfileId} --view agent`
        )
      : formatOpenMeldCliCommand(
          `openmeld space join ${input.result.spaceId} --profile ${input.result.membershipProfileId}`
        );
  const payload = {
    ...input.result,
    actorProfileKind: input.actorProfile.profileKind,
    membershipWritePath: "space.add-members",
    nextAction: nextCommand,
    wakeReadiness: "not_checked",
    proves:
      "OpenMeld completed the normal Space membership path for this profile.",
    doesNotProve:
      "Space membership does not prove Wake availability or that a Wake reply will succeed.",
  };
  if (input.json || input.details) {
    input.presenter.data({
      code: "space.add_me",
      payload,
    });
    return;
  }
  const projectFolderText = input.result.projectFolder
    ? ` Project folder: ${input.result.projectFolder}.`
    : "";
  input.presenter.line({
    code: "space.add_me",
    text: `Confirmed ${input.result.membershipProfileKind === "agent" ? "this agent's" : "your"} Space membership path for ${input.result.spaceId} as ${input.result.membershipProfileId}.${projectFolderText} Next: ${nextCommand}`,
    data: payload,
  });
}

function collectProjectFolderCandidates(input?: SpaceAddMeProjectFolderInput) {
  const entries: Array<{ flag: string; value: string }> = [];
  for (const [flag, value] of [
    ["--project-folder", input?.projectFolder],
    ["--workspace-path", input?.workspacePath],
    ["--working-directory", input?.workingDirectory],
    ["--cwd", input?.cwd],
  ] as const) {
    for (const item of arrayify(value)) {
      const normalized = normalizeOptionalString(item);
      if (normalized) {
        entries.push({ flag, value: normalized });
      }
    }
  }
  return entries;
}

function normalizeProjectFolderValue(
  value: string,
  cwd: string
): { path: string; resolvedRelativeInput?: string } {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error("Project folder path is required.");
  }
  const path = normalizeProjectFolderPath(normalized, cwd);
  return {
    path,
    ...(path !== normalized && !normalized.startsWith("~")
      ? { resolvedRelativeInput: normalized }
      : {}),
  };
}

function normalizeProjectFolderPath(value: string, cwd: string): string {
  const base = normalizeCustomProfileWorkspacePath(cwd);
  let expanded: string;
  if (value.startsWith("~") || isAbsolute(value)) {
    expanded = value;
  } else {
    expanded = resolve(base, value);
  }
  return normalizeCustomProfileWorkspacePath(expanded);
}

function arrayify(value: readonly string[] | string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  return [...value];
}

function buildAgentProfileName(input: {
  detectedSubject: Extract<SpaceAddMeDetectedSubject, { kind: "agent" }>;
  projectFolder: string;
}): string {
  const projectName = basename(input.projectFolder) || input.projectFolder;
  return `${input.detectedSubject.label} - ${projectName}`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function runDefaultSpaceAddMeMembership(
  input: SpaceAddMeMembershipInput
): Promise<SpaceCommandNavigationStatus> {
  const { runSpaceAddMeMembership } = await import("./add-me-membership");
  return await runSpaceAddMeMembership(input);
}
