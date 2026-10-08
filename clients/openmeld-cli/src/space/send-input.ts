import { readFile } from "node:fs/promises";
import { createProjectsApi } from "@openmeld/api-client";
import { buildCanonicalRepositoryUrl } from "@openmeld/projects";
import {
  buildTargetWakeLifecycleId,
  executionContextSelectionSchema,
} from "@openmeld/schemas";
import type {
  ExecutionContextAssignment,
  ExecutionContextSelection,
  Project,
  ProjectRepositorySettings,
} from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import {
  createSpaceSendInputConflictGuideError,
  createSpaceSendInputEmptyGuideError,
  createSpaceSendInputFileReadFailedGuideError,
  createSpaceSendInputRequiredGuideError,
} from "../runtime/dual-view-guide-catalog";
import { createCliApiClientFoundation } from "./api-client-foundation";

type SelectedProjectWork = NonNullable<
  ExecutionContextAssignment["projectWork"]
>;

type SpaceTaskSelectionInput = {
  space: string;
  wakeTargets?: readonly string[];
  newTask?: boolean;
  forkFrom?: string;
  continueFrom?: string;
  taskAccess?: string;
  taskWorkspace?: string;
  projectWork?: SelectedProjectWork;
};

type ResolveSpaceSendTextInput = {
  allowEmpty?: boolean;
  text?: string;
  stdin?: boolean;
  file?: string;
  readFromStdin?: () => Promise<string>;
  readFromFile?: (path: string) => Promise<string>;
};

export function resolveSpaceTaskSelection(
  input: SpaceTaskSelectionInput
): ExecutionContextSelection | undefined {
  const modes =
    Number(input.newTask === true) +
    Number(Boolean(input.forkFrom)) +
    Number(Boolean(input.continueFrom));
  if (
    modes === 0 &&
    !input.taskAccess &&
    !input.taskWorkspace &&
    !input.projectWork
  ) {
    return undefined;
  }
  if (modes > 1) {
    throw new Error(
      "Choose only one of --new-task, --fork-from, or --continue-from."
    );
  }
  const targetProfileId = input.wakeTargets?.[0];
  if (!targetProfileId || input.wakeTargets?.length !== 1) {
    throw new Error("Task selection requires exactly one --wake <profile-id>.");
  }
  const sourceSignalId = input.forkFrom ?? input.continueFrom;
  const sourceWakeId = sourceSignalId
    ? buildTargetWakeLifecycleId({
        spaceId: input.space,
        sourceSignalId,
        targetProfileId,
      })
    : undefined;
  const preferences = resolveTaskPreferences(input);
  let value: unknown;
  if (input.continueFrom) {
    value = { mode: "resume", sourceWakeId };
  } else if (input.forkFrom) {
    value = { mode: "fork", sourceWakeId, ...preferences };
  } else {
    value = { mode: input.newTask ? "new" : "auto", ...preferences };
  }
  const parsed = executionContextSelectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid task selection."
    );
  }
  return parsed.data;
}

function resolveTaskPreferences(input: SpaceTaskSelectionInput) {
  if (input.continueFrom && (input.taskAccess || input.taskWorkspace)) {
    throw new Error(
      "A continued task keeps its original file access and workspace. Start a new task to change them."
    );
  }
  if (input.projectWork && !input.newTask) {
    throw new Error(
      "Choose --new-task when selecting a Project repository. A fork keeps its source workspace."
    );
  }
  if (input.projectWork && input.taskAccess === "space_context") {
    throw new Error(
      "Project repository work requires read_only or workspace file access."
    );
  }
  return {
    access: input.taskAccess ?? (input.projectWork ? "workspace" : undefined),
    workspace:
      input.taskWorkspace ?? (input.projectWork ? "isolated" : undefined),
    ...(input.projectWork ? { projectWork: input.projectWork } : {}),
  };
}

export async function resolveCliProjectWork(input: {
  baseUrl?: string;
  projectSlug?: string;
  repositoryUrl?: string;
}): Promise<SelectedProjectWork | undefined> {
  const projectSlug = input.projectSlug?.trim();
  if (!projectSlug) {
    if (input.repositoryUrl) {
      throw new Error("--repository requires --project.");
    }
    return undefined;
  }
  const api = createProjectsApi(
    createCliApiClientFoundation(await resolveBaseUrl(input.baseUrl))
  );
  const listed = await api.list();
  const project = listed.projects.find(
    (candidate) => candidate.slug === projectSlug
  );
  if (!project || project.organizationId !== listed.organizationId) {
    throw new Error(
      `Project "${projectSlug}" is unavailable in the active Organization.`
    );
  }
  const response = await api.readRepositorySettings({ projectId: project.id });
  return selectCliProjectWork({
    project,
    repositoryUrl: input.repositoryUrl,
    settings: response.settings,
  });
}

export function selectCliProjectWork(input: {
  project: Project;
  repositoryUrl?: string;
  settings: ProjectRepositorySettings;
}): SelectedProjectWork {
  if (input.settings.projectId !== input.project.id) {
    throw new Error(
      "Project repository settings changed. Refresh and try again."
    );
  }
  const requestedUrl = input.repositoryUrl
    ? buildCanonicalRepositoryUrl(input.repositoryUrl)
    : null;
  if (input.repositoryUrl && !requestedUrl) {
    throw new Error("--repository must be a valid Git repository URL.");
  }
  const repositories = input.settings.repositories;
  const selected = requestedUrl
    ? repositories.find((candidate) => candidate.repositoryUrl === requestedUrl)
    : (repositories.find((candidate) => candidate.isDefault) ??
      (repositories.length === 1 ? repositories[0] : undefined));
  if (selected) {
    return {
      projectId: input.project.id,
      repositoryFingerprint: selected.repositoryFingerprint,
    };
  }
  if (requestedUrl) {
    throw new Error("That repository is not associated with this Project.");
  }
  if (repositories.length === 0 && input.settings.legacyDefaultFingerprint) {
    return {
      projectId: input.project.id,
      repositoryFingerprint: input.settings.legacyDefaultFingerprint,
    };
  }
  throw new Error(
    repositories.length === 0
      ? "This Project has no code repository. Configure one before starting code work."
      : "This Project has several repositories. Choose one with --repository."
  );
}

export async function resolveSpaceSendText(
  input: ResolveSpaceSendTextInput
): Promise<string> {
  const textValue = String(input.text ?? "");
  const stdinEnabled = input.stdin === true;
  const filePath = String(input.file ?? "").trim();

  const hasTextSource = textValue.length > 0;
  const hasFileSource = filePath.length > 0;
  const sourceCount =
    Number(hasTextSource) + Number(stdinEnabled) + Number(hasFileSource);

  if (sourceCount === 0) {
    if (input.allowEmpty) {
      return "";
    }
    throw createSpaceSendInputRequiredGuideError();
  }
  if (sourceCount > 1) {
    throw createSpaceSendInputConflictGuideError();
  }

  let resolvedText = textValue;
  if (hasFileSource) {
    const readFromFile = input.readFromFile ?? readSpaceSendFile;
    try {
      resolvedText = await readFromFile(filePath);
    } catch (error) {
      throw createSpaceSendInputFileReadFailedGuideError(
        filePath,
        toErrorMessage(error)
      );
    }
  }
  if (stdinEnabled) {
    const readFromStdin = input.readFromStdin ?? readSpaceSendStdin;
    resolvedText = await readFromStdin();
  }

  if (resolvedText.trim().length === 0 && !input.allowEmpty) {
    throw createSpaceSendInputEmptyGuideError();
  }

  return resolvedText;
}

function readSpaceSendFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function readSpaceSendStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };

    const onData = (chunk: string | Buffer) => {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        return;
      }
      chunks.push(chunk.toString("utf8"));
    };

    const onEnd = () => {
      cleanup();
      resolve(chunks.join(""));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error ?? "unknown error");
}
