import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { LocalProjectControlGitStatus } from "@openmeld/schemas";
import {
  createGitRepositoryVerifier,
  type GitRepositoryVerifier,
  GitVerificationUnavailableError,
  NotGitRepositoryError,
} from "./git-repository-verifier";

export type LocalProjectConnectionErrorCode =
  | "confirmation_required"
  | "git_repository_required"
  | "git_verification_unavailable"
  | "path_not_directory"
  | "path_not_found"
  | "path_unreadable"
  | "repository_fingerprint_mismatch";

export class LocalProjectConnectionError extends Error {
  readonly code: LocalProjectConnectionErrorCode;
  readonly gitStatus?: LocalProjectControlGitStatus;

  constructor(
    code: LocalProjectConnectionErrorCode,
    message: string,
    options: { gitStatus?: LocalProjectControlGitStatus } = {}
  ) {
    super(message);
    this.code = code;
    this.gitStatus = options.gitStatus;
    this.name = "LocalProjectConnectionError";
  }
}

export async function validateLocalProjectConnectionPath(
  input: {
    allowUnverifiedNonGit: boolean;
    declaredPath: string;
    projectRepositoryFingerprint: string | null;
  },
  dependencies: { verifier?: GitRepositoryVerifier } = {}
): Promise<{
  canonicalPath: string;
  normalizedFrom: string | null;
  repositoryFingerprint: string | null;
}> {
  const requestedPath = resolve(input.declaredPath);
  const canonicalDeclaredPath = await realpath(requestedPath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new LocalProjectConnectionError(
          "path_not_found",
          "OpenMeld couldn’t find that folder on this computer. Check the path and try again."
        );
      }
      throw error;
    }
  );
  const metadata = await stat(canonicalDeclaredPath);
  if (!metadata.isDirectory()) {
    throw new LocalProjectConnectionError(
      "path_not_directory",
      "That path is not a folder. Enter the Project’s folder path."
    );
  }
  await access(canonicalDeclaredPath, constants.R_OK).catch(() => {
    throw new LocalProjectConnectionError(
      "path_unreadable",
      "OpenMeld can’t read that folder. Check its permissions and try again."
    );
  });

  const verifier = dependencies.verifier ?? createGitRepositoryVerifier({});
  try {
    const repository = await verifier.inspectRepository(canonicalDeclaredPath);
    if (
      input.projectRepositoryFingerprint &&
      repository.repositoryFingerprint !== input.projectRepositoryFingerprint
    ) {
      throw new LocalProjectConnectionError(
        "repository_fingerprint_mismatch",
        repository.repositoryFingerprint
          ? "This folder belongs to a different Git repository. Choose the folder that matches this Project."
          : "This Project has a saved repository identity, but this Git repository has no supported origin."
      );
    }
    return {
      canonicalPath: repository.canonicalPath,
      normalizedFrom:
        repository.canonicalPath === canonicalDeclaredPath
          ? null
          : canonicalDeclaredPath,
      repositoryFingerprint: repository.repositoryFingerprint,
    };
  } catch (error) {
    if (error instanceof LocalProjectConnectionError) {
      throw error;
    }
    if (error instanceof NotGitRepositoryError) {
      if (input.projectRepositoryFingerprint) {
        throw new LocalProjectConnectionError(
          "git_repository_required",
          "This Project has a saved repository identity, but this folder is not a Git repository."
        );
      }
      return allowUnverifiedConnectionOrThrow(
        canonicalDeclaredPath,
        input.allowUnverifiedNonGit
      );
    }
    if (error instanceof GitVerificationUnavailableError) {
      if (input.projectRepositoryFingerprint) {
        throw new LocalProjectConnectionError(
          "git_verification_unavailable",
          "OpenMeld can’t verify this repository because Git tools aren’t available on this computer. Install Git tools, then try again.",
          { gitStatus: error.status }
        );
      }
      return allowUnverifiedConnectionOrThrow(
        canonicalDeclaredPath,
        input.allowUnverifiedNonGit
      );
    }
    throw error;
  }
}

function allowUnverifiedConnectionOrThrow(
  canonicalPath: string,
  allowed: boolean
): {
  canonicalPath: string;
  normalizedFrom: null;
  repositoryFingerprint: null;
} {
  if (!allowed) {
    throw new LocalProjectConnectionError(
      "confirmation_required",
      "OpenMeld couldn’t verify this folder with Git. You can still connect it, but automatic matching and worktree discovery won’t be available."
    );
  }
  return {
    canonicalPath,
    normalizedFrom: null,
    repositoryFingerprint: null,
  };
}
