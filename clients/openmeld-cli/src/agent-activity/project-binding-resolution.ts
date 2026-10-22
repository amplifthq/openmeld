import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export type LocalProjectConnectionIdentity = {
  bindingGeneration: string;
  organizationId: string;
  projectId: string;
  repositoryPath: string;
};

/**
 * One ownership rule for local Project connections. A connection written
 * before connections recorded their owner has no `ownerUserId`; it stays usable
 * by the signed-in account. Only a connection owned by another account is
 * excluded.
 */
export function isProjectConnectionUsableByOwner(
  connection: { ownerUserId?: string },
  ownerUserId: string | undefined
): boolean {
  return !connection.ownerUserId || connection.ownerUserId === ownerUserId;
}

export async function canonicalizeLocalProjectPath(
  path: string
): Promise<string | null> {
  return await realpath(resolve(path)).catch((error: unknown) => {
    if (isUnavailablePathError(error)) {
      return null;
    }
    throw error;
  });
}

export function resolveCanonicalLocalProjectConnection<
  Connection extends LocalProjectConnectionIdentity,
>(
  canonicalPath: string,
  connections: readonly Connection[]
): Connection | null {
  let longestMatch: Connection | null = null;
  let ambiguous = false;
  for (const connection of connections) {
    if (
      isPathWithin(canonicalPath, connection.repositoryPath) &&
      (longestMatch === null ||
        connection.repositoryPath.length > longestMatch.repositoryPath.length)
    ) {
      longestMatch = connection;
      ambiguous = false;
    } else if (
      longestMatch &&
      isPathWithin(canonicalPath, connection.repositoryPath) &&
      connection.repositoryPath.length === longestMatch.repositoryPath.length &&
      (connection.organizationId !== longestMatch.organizationId ||
        connection.projectId !== longestMatch.projectId)
    ) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : longestMatch;
}

export async function resolveLocalProjectConnectionForPath<
  Connection extends LocalProjectConnectionIdentity,
>(input: {
  connections: readonly Connection[];
  organizationId?: string;
  path: string;
}): Promise<Connection | null> {
  const sameLaneConnections =
    input.organizationId === undefined
      ? input.connections
      : input.connections.filter(
          (connection) => connection.organizationId === input.organizationId
        );
  const resolvedPath = resolve(input.path);
  const canonicalPath = await canonicalizeLocalProjectPath(resolvedPath);
  if (canonicalPath === null) {
    return null;
  }
  return resolveCanonicalLocalProjectConnection(
    canonicalPath,
    sameLaneConnections
  );
}

export function findExactLocalProjectConnection<
  Connection extends LocalProjectConnectionIdentity,
>(input: {
  bindingGeneration?: string;
  canonicalPath?: string;
  connections: readonly Connection[];
  organizationId: string;
  projectId: string;
}): Connection | null {
  return (
    input.connections.find(
      (connection) =>
        connection.organizationId === input.organizationId &&
        connection.projectId === input.projectId &&
        (input.bindingGeneration === undefined ||
          connection.bindingGeneration === input.bindingGeneration) &&
        (input.canonicalPath === undefined ||
          connection.repositoryPath === input.canonicalPath)
    ) ?? null
  );
}

function isPathWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function isUnavailablePathError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      UNAVAILABLE_PATH_ERROR_CODES.has(error.code)
  );
}

const UNAVAILABLE_PATH_ERROR_CODES = new Set([
  "EACCES",
  "ELOOP",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
  "ESTALE",
]);
